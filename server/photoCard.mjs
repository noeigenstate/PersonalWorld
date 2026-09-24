// Photo card: builds the request for the photo-card skill and turns the model's answer into
// what the app shows. Shared by the API route and the skill's evals.
import { maskDeep } from './privacy.mjs'

const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '')
const clamp = (value, fallback = 0.5) => (typeof value === 'number' ? Math.max(0, Math.min(1, value)) : fallback)
const strings = (value, max) => (Array.isArray(value) ? value.filter((v) => typeof v === 'string').slice(0, max) : [])
const PLATE = /车牌|牌照/
// Provinces and their capitals: the places a plate's first two characters point to
const PLACE_NAMES = ['北京', '天津', '上海', '重庆', '河北', '石家庄', '河南', '郑州', '云南', '昆明', '辽宁', '沈阳', '黑龙江', '哈尔滨', '湖南', '长沙', '安徽', '合肥', '山东', '济南', '新疆', '乌鲁木齐', '江苏', '南京', '浙江', '杭州', '江西', '南昌', '湖北', '武汉', '广西', '南宁', '甘肃', '兰州', '山西', '太原', '内蒙古', '呼和浩特', '陕西', '西安', '吉林', '长春', '福建', '福州', '贵州', '贵阳', '广东', '广州', '青海', '西宁', '西藏', '拉萨', '四川', '成都', '宁夏', '银川', '海南', '海口']

export function cardMessages({ system, dataUrl, facts = {}, consented }) {
  const metadata = [
    `文件名：${String(facts.fileName || '未知').slice(0, 120)}`,
    `时间：${String(facts.time || '未知')}（来源：${String(facts.timeSource || '未知')}）`,
    `GPS：${facts.latitude && facts.longitude ? `${facts.latitude},${facts.longitude}` : '无'}`,
    `城市：${String(facts.city || '未知')} ${String(facts.address || '')}`.trim(),
    `尺寸：${String(facts.size || '未知')}`,
    `拍摄设备：${String(facts.device || '未知').slice(0, 60)}`,
    `元数据中的地名：${String(facts.metaPlace || '无').slice(0, 60)}`,
    `隐私声明：${consented ? '用户已同意' : '用户未同意'}`,
  ].join('\n')
  return [
    { role: 'system', content: system },
    { role: 'user', content: [{ type: 'text', text: `为这张照片写信息卡。程序读出的元数据：\n${metadata}` }, { type: 'image_url', image_url: { url: dataUrl } }] },
  ]
}

export function readCard(answer, { consented }) {
  const clues = (Array.isArray(answer.clues) ? answer.clues : []).slice(0, 5).map((c) => {
    const clue = { kind: text(c?.kind, 8), evidence: text(c?.evidence, 120), inference: text(c?.inference, 120), confidence: clamp(c?.confidence) }
    // Plates only say where a car is registered, and the province character is often unreadable
    // (a real test photo got read as 云/藏/浙/鄂/苏/鲁 across runs); never let one place a photo
    // Any plate clue that names a place counts, whatever kind the model filed it under
    if (PLATE.test(`${clue.evidence}${clue.inference}`) && (clue.kind === '地点' || PLACE_NAMES.some((name) => clue.inference.includes(name)))) {
      clue.confidence = Math.min(clue.confidence, 0.3)
      if (!/登记地/.test(clue.inference)) clue.inference = `${clue.inference}（车牌只说明车辆登记地，首字也常难以辨认）`.slice(0, 160)
    }
    return clue
  }).filter((c) => c.evidence && c.inference)
  // A place named only by a plate clue must not reach the title, caption, tags or the map search
  const plateOnly = (name) => clues.some((c) => PLATE.test(`${c.evidence}${c.inference}`) && c.inference.includes(name)) &&
    !clues.some((c) => !PLATE.test(`${c.evidence}${c.inference}`) && c.inference.includes(name))
  const plateNames = PLACE_NAMES.filter((name) => plateOnly(name))
  const mentionsPlateName = (value) => plateNames.some((name) => value.includes(name))
  // Drop whole clauses (and 〔…〕 inferences) that rest on a plate, rather than leaving half sentences
  const withoutPlateNames = (raw) => {
    const value = raw.replace(/〔\s*〕/g, '')
    if (!plateNames.length) return value
    const cleaned = value.replace(/〔[^〕]*〕/g, (part) => (mentionsPlateName(part) ? '' : part))
    const clauses = cleaned.match(/[^，。；,;]+[，。；,;]?/g) || []
    const kept = clauses.filter((clause) => !mentionsPlateName(clause.replace(/[（(][^）)]*[A-Z]\s?[A-Z0-9·]{4,}[）)]/g, ''))).join('')
    return kept.replace(/[，,；;]\s*$/, '。').trim()
  }
  const query = answer.placeQuery && typeof answer.placeQuery === 'object' ? answer.placeQuery : null
  const queryText = text(query?.text, 40)
  const placeQuery = queryText && !PLATE.test(queryText) && !plateOnly(queryText)
    ? { text: queryText, city: text(query.city, 20), from: query.from === 'landmark' ? 'landmark' : 'text', level: ['poi', 'district', 'city', 'province'].includes(query.level) ? query.level : 'poi', confidence: clamp(query.confidence) }
    : null
  const card = {
    title: withoutPlateNames(text(answer.title, 20)),
    caption: withoutPlateNames(text(answer.caption, 120)),
    scene: text(answer.scene, 160),
    visibleText: text(answer.visibleText, 200),
    clues,
    landmark: answer.landmark && typeof answer.landmark === 'object' && text(answer.landmark.name, 30)
      ? { name: text(answer.landmark.name, 30), city: text(answer.landmark.city, 20), confidence: clamp(answer.landmark.confidence) }
      : null,
    placeQuery,
    eventGuess: { type: text(answer.eventGuess?.type, 10), reason: text(answer.eventGuess?.reason, 120) },
    tags: strings(answer.tags, 6).filter((t) => !plateOnly(t) && !mentionsPlateName(t)).slice(0, 5),
    questions: strings(answer.questions, 2),
  }
  // Numbers are shown as-is only after the user accepted the privacy statement
  return consented ? card : maskDeep(card)
}

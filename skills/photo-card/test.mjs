import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkSkillFile, imageDataUrl, importRoot, live, startApi } from '../../tests/skill-kit.mjs'

const dir = fileURLToPath(new URL('.', import.meta.url))
const { loadSkill } = await importRoot('server/skills.mjs')
const pearl = imageDataUrl('skills/photo-context/evals/2026-09-24/images/pearl-a.jpg')

test('SKILL.md 格式完整，写明了事实与推断、地标、隐私和输出字段', () => {
  const { body } = checkSkillFile(dir)
  for (const key of ['scene', 'visibleText', 'clues', 'landmark', 'placeQuery', 'eventGuess', 'questions']) assert.match(body, new RegExp(`"${key}"`), `缺少字段 ${key}`)
  assert.match(body, /车牌永远不作为 `placeQuery`/)
  assert.match(body, /认不出的字写"\?"/)
  assert.match(body, /来源是 `exif` 才是拍摄时间/)
  assert.match(body, /不高于 0\.6/)
  assert.match(body, /隐私声明：用户已同意/)
})

let api
let incompleteObservation = false
before(async () => {
  api = await startApi(() => ({
    title: '外滩看东方明珠', caption: '〔在黄浦江边〕', scene: incompleteObservation ? '  ' : '电视塔', visibleText: '',
    clues: [{ kind: '地点', evidence: '东方明珠塔身', inference: '在上海', confidence: 0.9 }, { kind: '事件', evidence: '', inference: '没有依据', confidence: 0.8 }],
    landmark: { name: '东方明珠', city: '上海市', confidence: 2 },
    placeQuery: { text: '东方明珠', city: '上海市', from: 'landmark', confidence: 0.9 },
    eventGuess: { type: '旅行', reason: '地标' }, tags: ['1', '2', '3', '4', '5', '6'], questions: ['a', 'b', 'c'],
  }))
})
after(() => api?.close())

test('/api/photo-card 不把缺少画面观察的响应标记为成功', async () => {
  incompleteObservation = true
  try {
    const { status, json } = await api.post('/api/photo-card', { image: { dataUrl: pearl }, facts: {} })
    assert.equal(status, 422)
    assert.match(json.error, /缺少画面观察/)
  } finally { incompleteObservation = false }
})

test('/api/photo-card 用这个 skill，并整理地标、线索和列表长度', async () => {
  const { status, json } = await api.post('/api/photo-card', { image: { dataUrl: pearl }, facts: { fileName: 'IMG.jpg', time: '2026-01-01T00:00:00Z', timeSource: 'filename', size: '960 × 1280' } })
  assert.equal(status, 200)
  const call = api.calls.at(-1)
  assert.equal(call.messages[0].content, loadSkill('photo-card'))
  assert.match(call.messages[1].content[0].text, /来源：filename/)
  assert.deepEqual(json.landmark, { name: '东方明珠', city: '上海市', confidence: 1 })
  assert.deepEqual(json.placeQuery, { text: '东方明珠', city: '上海市', from: 'landmark', level: 'poi', confidence: 0.9 })
  assert.equal(json.clues.length, 1, '没有依据的线索被丢弃')
  assert.equal(json.tags.length, 5)
  assert.equal(json.questions.length, 2)
})

// Answers the real model gave for a rainy-windscreen photo whose plate province is unreadable
test('车牌不能决定照片地点：线索降级，标题、描述、标签、地图搜索都不带车牌推出的地方', async () => {
  const { readCard } = await importRoot('server/photoCard.mjs')
  const answers = [
    { title: '雨天行车', caption: '雨天透过挡风玻璃拍摄前车〔推测拍摄于云南省境内，时值2021年国庆假期〕', clues: [{ kind: '地点', evidence: '白色汽车车牌号为云A 12345', inference: '云A为云南省昆明市车牌代码，拍摄地点可能在云南省境内', confidence: 0.7 }], tags: ['雨天', '云南', '昆明'], placeQuery: { text: '昆明', city: '', from: 'text', confidence: 0.6 } },
    { title: '国庆假期雨天行车', caption: '从车内拍摄，可见前方白色轿车（车牌鄂A 12345），推测正行驶在湖北境内的山路上，背景为山地。', clues: [{ kind: '地点', evidence: '车牌鄂A', inference: '车辆注册地为湖北武汉，拍摄地点可能在武汉或湖北境内', confidence: 0.8 }], tags: ['雨天', '武汉车牌'] },
    { title: '雨天行车记录', caption: '雨天公路上的前车', clues: [{ kind: '物品', evidence: '前车牌照', inference: '前方车辆为江苏南京牌照的标致汽车', confidence: 0.9 }], tags: ['自驾'] },
    { title: '雨后山路', caption: '2021年国庆假期自驾途中，〔〕雨后山路上跟随前车行驶。', clues: [{ kind: '地点', evidence: '车牌鲁A', inference: '车辆登记地为山东济南，当前行驶地点不确定', confidence: 0.6 }], tags: ['山路'] },
  ]
  for (const answer of answers) {
    const card = readCard({ scene: '', visibleText: '', eventGuess: {}, questions: [], ...answer }, { consented: true })
    const plate = card.clues.find((c) => /车牌|牌照/.test(c.evidence + c.inference))
    assert.ok(plate.confidence <= 0.3, `车牌线索应降到 0.3 以下：${plate.inference}`)
    for (const place of ['云南', '昆明', '湖北', '武汉', '江苏', '南京', '山东', '济南']) {
      assert.ok(!card.title.includes(place) && !card.caption.includes(place), `标题或描述不应带${place}：${card.caption}`)
      assert.ok(!card.tags.some((t) => t.includes(place)), `标签不应带${place}`)
    }
    assert.equal(card.placeQuery, null)
    assert.ok(!card.caption.includes('〔〕'), '空的推断括号应去掉')
  }
})

test('单位名称只能证明到省：placeQuery 带 level，未知 level 按具体地点处理', async () => {
  const { readCard } = await importRoot('server/photoCard.mjs')
  const base = { title: '', caption: '', scene: '', visibleText: '青海公路', clues: [], eventGuess: {}, tags: [], questions: [] }
  const region = readCard({ ...base, placeQuery: { text: '青海省', city: '', from: 'text', level: 'province', confidence: 0.8 } }, { consented: true })
  assert.deepEqual(region.placeQuery, { text: '青海省', city: '', from: 'text', level: 'province', confidence: 0.8 })
  const odd = readCard({ ...base, placeQuery: { text: '外滩', from: 'text', level: 'planet' } }, { consented: true })
  assert.equal(odd.placeQuery.level, 'poi')
  const skill = checkSkillFile(dir).body
  assert.match(skill, /"青海公路"/)
  assert.match(skill, /`level` 取 `poi`（具体地点）、`district`（区县）、`city`（城市）、`province`（省份）/)
})

test('真实模型：认出东方明珠并给出有依据的线索', { skip: !live && '设置 LIVE=1 才调用真实模型' }, async () => {
  const { stepfunConfig, chat, parseJsonAnswer } = await importRoot('server/stepfun.mjs')
  const card = parseJsonAnswer(await chat(stepfunConfig(), [
    { role: 'system', content: loadSkill('photo-card') },
    { role: 'user', content: [{ type: 'text', text: '为这张照片写信息卡。程序读出的元数据：\n文件名：pearl.jpg\n时间：未知（来源：file）\nGPS：无\n城市：未知\n尺寸：960 × 1280\n隐私声明：用户已同意' }, { type: 'image_url', image_url: { url: pearl } }] },
  ], { json: true }))
  assert.match(card.landmark?.name || '', /东方明珠/)
  assert.match(card.landmark?.city || '', /上海/)
  assert.match(card.placeQuery?.text || '', /东方明珠/, '认出地标时给出地图搜索词')
  assert.ok(card.clues.length > 0 && card.clues.every((c) => c.evidence && c.inference && typeof c.confidence === 'number'))
  assert.ok(!/拍摄(于|时间)/.test(card.caption || ''), '没有 EXIF 时不能声称拍摄时间')
})

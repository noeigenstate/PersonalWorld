import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chat, parseJsonAnswer } from './stepfun.mjs'
import { loadSkill } from './skills.mjs'
import { knownKinshipWords } from './storyRelationships.mjs'

export const STORY_VERSION = 'memory-storytelling-9'
const text = (value, max = 300) => typeof value === 'string' ? value.replace(/[\x00-\x1f]/g, ' ').trim().slice(0, max) : ''
const list = value => Array.isArray(value) ? value : []
const unique = values => [...new Set(values)]
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)
const bound = (value, fallback, low, high) => Number.isFinite(value) ? Math.round(Math.max(low, Math.min(high, value))) : fallback
const formats = ['motif', 'relationship', 'revisit', 'details', 'outing']

// The server graph supplies identity. A browser's old generic caption cannot overwrite it.
export function storytellingInput({ question, photos, storyGraph = {}, events = [], focus = null, recent = [] }) {
  const people = list(storyGraph.people).map(p => ({ id: p.id, name: text(p.name, 50), relationship: text(p.relationship, 100) }))
  const memberships = storyGraph.memberships || {}
  const knownPeople = new Set(people.map(p => p.id))
  const facts = list(storyGraph.facts)
  const sources = photos.map(p => {
    const observation = facts.find(f => f.assetId === p.id && f.type === 'observation')
    const event = list(storyGraph.events).find(e => list(e.assetIds).includes(p.id))
    const derived = event?.interpretation?.photos?.find(note => note.assetId === p.id)
    const observed = text(p.scene || observation?.value, 700)
    return { id: p.id, date: text(p.date, 10), timeSource: text(p.dateSource || facts.find(f => f.assetId === p.id && f.type === 'time')?.status || 'unknown', 30),
      city: text(p.city, 30), place: text(p.place, 100), observed,
      narrative: observation?.value === observed ? text(derived?.caption, 200) : '',
      tags: list(p.tags).slice(0, 10), personIds: list(memberships[p.id]).filter(id => knownPeople.has(id)), eventId: p.eventId || '' }
  }).filter(p => p.observed)
  const ids = new Set(sources.map(p => p.id))
  const personIds = new Set(sources.flatMap(p => p.personIds))
  const confirmed = facts.filter(f => f.source === 'user' && f.status === 'confirmed' &&
    (!f.subjectId || personIds.has(f.subjectId)) && (!f.assetIds?.length || f.assetIds.some(id => ids.has(id))))
    .map(({ id, value, subjectId, objectId, assetIds }) => ({ id, value, subjectId, objectId, assetIds }))
  // The browser may still hold its request-time card while the server receives a correction.
  // Track the authoritative evidence too, so an in-flight result cannot publish against old cards.
  const observationsRevision = hash(facts.filter(f => ids.has(f.assetId) && ['observation', 'time', 'place'].includes(f.type))
    .map(({ assetId, type, value, status, source }) => ({ assetId, type, value, status, source })))
  return { question: text(question, 500), focus, photos: sources, observationsRevision, people: people.filter(p => personIds.has(p.id)),
    relationships: list(storyGraph.relationships).filter(r => personIds.has(r.subjectId) && personIds.has(r.objectId)), confirmed,
    events: /第一次|首次|最后一次/.test(question) ? events.map(e => ({ id: e.id, status: e.status, title: e.title, firsts: e.firsts, lasts: e.lasts })) : [],
    chapters: list(storyGraph.chapters).filter(c => list(c.assetIds).some(id => ids.has(id))).slice(0, 16)
      .map(c => ({ key: c.id, assetIds: c.assetIds.filter(id => ids.has(id)), title: c.title, brief: c.brief, explanation: c.explanation })),
    recent: recent.slice(0, 6).map(s => ({ key: s.key, title: s.title, format: s.format, premise: s.premise, assetIds: s.assetIds })) }
}

export function sourceRevision(input, model = '') {
  // All actual observations and user facts participate; random graph timestamps do not.
  const { question: _question, recent: _recent, focus: _focus, ...sources } = input
  return hash([STORY_VERSION, model, loadSkill('memory-storytelling'), sources])
}

function checkClaims(value, ids, input) {
  const members = new Set(input.photos.filter(p => ids.includes(p.id)).flatMap(p => p.personIds))
  const absent = input.people.filter(p => p.name && !members.has(p.id) && value.includes(p.name))
  if (absent.length) throw new Error(`该段照片没有确认这些人物：${absent.map(p => p.name).join('、')}`)
  const people = input.people.filter(p => members.has(p.id))
  const relations = input.relationships.filter(r => members.has(r.subjectId) && members.has(r.objectId))
  const confirmed = input.confirmed.filter(f => (!f.subjectId || members.has(f.subjectId)) && (!f.assetIds?.length || f.assetIds.some(id => ids.includes(id))))
  const aliases = knownKinshipWords(people, relations)
  const support = JSON.stringify([people, relations, confirmed])
  const observed = input.photos.filter(p => ids.includes(p.id)).map(p => p.observed).join(' ')
  const attitudes = value.match(/不太配合|不愿配合|不配合|耍赖|闹脾气|发呆/g) || []
  if (attitudes.some(claim => !confirmed.some(f => String(f.value || '').includes(claim)))) throw new Error('静态表情不能证明意愿或心情，请保留可见表情：' + unique(attitudes).join('、'))
  const personal = value.match(/最固定|固定(?:快乐|习惯|符号)|每次(?:出行|外出|游玩|出游)|唯一没变|总在|(?:执念|偏爱)|从来[^，。！？]{0,10}|哪儿都没变/g) || []
  if (personal.some(claim => !support.includes(claim))) throw new Error('少数照片不能证明个人习惯或不变的规律：' + personal.join('、'))
  const occasion = observed.includes('生日帽') ? value.replaceAll('生日帽', '彩色帽子') : value
  if (/生日/.test(occasion) && !confirmed.some(f => /生日/.test(f.value || ''))) throw new Error('当前未确认生日信息：蛋糕与帽子只能支持庆祝场面，请删除生日断言')
  const risky = value.match(/不肯[^，。！？]{0,8}|舍不得[^，。！？]{0,8}|还只会[^，。！？]{0,8}|已经敢[^，。！？]{0,8}|快乐开关|快乐信号|(?:风把|风吹)[^，。！？]{0,10}|(?:过生日|生日时)|同一个甜筒|同一支甜筒|换件[^，。！？]{0,8}|换了[^，。！？]{0,5}(?:衣|衫)|还没擦|一直[^，。！？]{0,8}没放|没离开过|晃着|抬手晃|等站定/g) || []
  if (risky.some(claim => !support.includes(claim) && !observed.includes(claim))) throw new Error('缺少依据的意图、成长、因果或背景情节：' + risky.join('、'))
  if (/元旦/.test(value) && !input.photos.some(p => ids.includes(p.id) && /-01-01$/.test(p.date)) && !support.includes('元旦')) throw new Error('元旦不是元旦假期中任意一天，请保留真实日期')
  if (/\d+个月(?:前|后)/.test(value)) throw new Error('月份跨度请交给画面日期，避免不精确的口头计算')
  const claims = value.match(/最喜欢|最爱|一直喜欢|每次出游|学会了|长高了|\d+岁|[一二三四五六七八九十]+岁|单独出游|没有其他家人|三代同框|女儿|儿子|妈妈|母亲|爸爸|父亲|姥姥|姥爷|外婆|外公|奶奶|爷爷|父女|母女|祖孙/g) || []
  const unsupported = claims.filter(c => !support.includes(c) && !aliases.has(c))
  if (unsupported.length) throw new Error(`该段缺少个人事实依据：${unique(unsupported).join('、')}`)
  if (/第一次|首次|最后一次/.test(value)) {
    const eventIds = new Set(input.photos.filter(p => ids.includes(p.id)).map(p => p.eventId))
    const evidence = input.events.filter(e => eventIds.has(e.id)).flatMap(e => [...list(e.firsts), ...list(e.lasts)])
    if (!/第一次|首次|最后一次/.test(input.question) || !evidence.length || !/照片记录/.test(value)) throw new Error('第一次/最后一次必须是用户明确询问、有对应记录且限定为照片记录')
  }
}

export function validateStorytelling(answer, input) {
  const raw = answer?.story || answer?.draft?.story
  if (!raw || !Array.isArray(raw.beats) || !raw.beats.length || raw.beats.length > 9) throw new Error('需要 1–9 个有照片依据的段落')
  if (input.photos.length >= 4 && raw.beats.length < 4) throw new Error('材料充足时请用至少四个短段落组织铺垫、发现和收束，不压成两三段图片清单')
  const known = new Set(input.photos.map(p => p.id)), uses = new Map()
  const beats = raw.beats.map((b, index) => {
    const assetIds = unique(list(b.assetIds))
    if (!assetIds.length || assetIds.length > 3 || assetIds.some(id => !known.has(id))) throw new Error(`第 ${index + 1} 段照片编号无效或超过三张`)
    for (const id of assetIds) { uses.set(id, (uses.get(id) || 0) + 1); if (uses.get(id) > 3) throw new Error('同一张照片最多回看三段') }
    const evidenceIds = unique(list(b.evidenceIds))
    if (!evidenceIds.length || evidenceIds.some(id => !assetIds.includes(id))) throw new Error('每段证据必须来自本段展示的照片')
    const narration = text(b.text, 600)
    if (narration.length > 70) throw new Error('每段旁白最多 70 字，请删去服装、地名和背景清单，只保留与这一段发现有关的短句')
    checkClaims(narration, evidenceIds, input)
    const layout = assetIds.length === 1 ? 'single' : b.layout === 'compare' ? 'compare' : 'sequence'
    return { id: `beat-${index + 1}`, assetIds, evidenceIds, text: narration, layout,
      leadInMs: bound(b.leadInMs, 500, 0, 3000), holdMs: bound(b.holdMs, narration ? 1000 : 2800, narration ? 400 : 1800, 5000) }
  })
  const spoken = beats.map(b => b.text).join('')
  // Timing is a renderer responsibility: guarantee a breath without spending another model call on milliseconds.
  if (beats.length >= 4 && !beats.some(b => !b.text || b.leadInMs >= 1800)) beats.at(-1).leadInMs = 2200
  if (spoken.length < 12 || spoken.length > 360) throw new Error('旁白总长需为 12–360 字，材料不足就缩短')
  const assetIds = unique(beats.flatMap(b => b.assetIds))
  const title = text(raw.title, 36), premise = text(raw.premise, 200)
  if (!title || !premise) throw new Error('需要标题和具体叙事发现')
  checkClaims(title + premise, assetIds, input)
  if (beats.length >= 4 && beats.every(b => b.text && b.assetIds.length === 1) && uses.size === beats.length) throw new Error('编排仍是逐张解说：根据素材加入跨图、对照、留白或回扣')
  if (beats.filter(b => /^(?:然后|接下来|这张照片|在?20\d\d年)/.test(b.text)).length >= 3) throw new Error('避免连续报日期或串接图片说明，围绕具体发现重新编排')
  if (answer.review?.grounded !== true || answer.review?.specific !== true || answer.review?.coherent !== true) throw new Error('需要完成事实、细节与连贯性复核：' + list(answer.review?.notes).join('；'))
  let reflection = null
  if (raw.reflection?.question) {
    const ids = unique(list(raw.reflection.assetIds)).filter(id => assetIds.includes(id))
    const question = text(raw.reflection.question, 100)
    // Relationships and identities already exist in the graph; never ask for them again here.
    if (ids.length && !/是谁|什么关系|是.{0,8}(?:爸爸|妈妈|姥姥|女儿)|叫什么|哪一年|几月几日/.test(question)) reflection = { question, assetIds: ids }
  }
  return { key: text(raw.key, 60).replace(/[^a-zA-Z0-9-]/g, '') || hash([raw.format, assetIds]), title, premise,
    format: formats.includes(raw.format) ? raw.format : 'details', tone: ['playful', 'tender', 'quiet', 'bright'].includes(raw.tone) ? raw.tone : 'tender',
    assetIds, beats, reflection, evidence: input.photos.filter(p => assetIds.includes(p.id)),
    people: input.people.filter(p => input.photos.some(photo => assetIds.includes(photo.id) && photo.personIds.includes(p.id))),
    review: { notes: list(answer.review?.notes).map(v => text(v, 180)).slice(0, 5) },
    candidates: list(answer.candidates).slice(0, 3).map(c => ({ key: text(c.key, 60), format: text(c.format, 30), angle: text(c.angle, 160), assetIds: list(c.assetIds).filter(id => known.has(id)).slice(0, 12) })) }
}

export async function composeStorytelling(config, input, call = chat, { imageFor } = {}) {
  const writer = { ...config, model: config.storyModel || config.model }
  if (!input.photos.length) throw new Error('照片还没有可用的画面观察，等自动理解完成后就能讲述')
  const skill = loadSkill('memory-storytelling')
  const options = { json: true, reasoningEffort: 'medium', timeoutMs: 120_000 }
  // Each role reads only its instructions. The writer never sees the editor's example corrections as a script.
  const system = mode => skill.split('## mode:')[0] + '## mode:' + skill.split('## mode:').slice(1).find(part => part.startsWith(' ' + mode))
  const known = new Set(input.photos.map(p => p.id))
  // Real providers sometimes return an empty object or unwrap one item in JSON mode.
  // Normalize harmless wrappers, then request at most one shape repair per role.
  const stage = async (mode, payload, check, contract, images = []) => {
    const payloadText = JSON.stringify({ mode, ...payload })
    const messages = [{ role: 'system', content: system(mode) }, { role: 'user', content: images.length ? [{ type: 'text', text: payloadText }, ...images] : payloadText }]
    for (let attempt = 0; attempt < 2; attempt++) {
      const answer = parseJsonAnswer(await call(mode === 'compose' ? writer : config, messages, options)) || {}
      if (check(answer)) return answer
      if (attempt) throw new Error('讲述模型未返回完整的' + ({ select: '选题', compose: '编排', observe: '画面核对' }[mode]) + '，请稍后再试')
      messages.push({ role: 'assistant', content: JSON.stringify(answer) }, { role: 'user', content: '请根据原始资料返回完整对象，不能返回空对象。' + (typeof contract === 'function' ? contract(answer) : contract) })
    }
  }
  const choicesOf = selection => Array.isArray(selection.candidates) ? selection.candidates : selection.assetIds && selection.angle ? [selection] : []
  const selection = await stage('select', input, answer => choicesOf(answer).some(c => list(c.assetIds).some(id => known.has(id))), '{"candidates":[{"key":"short-key","format":"details","angle":"具体发现","assetIds":["原始真实ID"]}],"selectedKey":"short-key"}')
  const candidates = choicesOf(selection).slice(0, 3).map(c => ({ key: text(c.key, 60), format: text(c.format, 30), angle: text(c.angle, 200), assetIds: unique(list(c.assetIds)).filter(id => known.has(id)).slice(0, 8) })).filter(c => c.assetIds.length)
  const selected = candidates.find(c => c.key === selection.selectedKey) || candidates[0]
  if (!selected) throw new Error('还没找到有照片依据的叙事角度，请稍后再试')
  const photos = input.photos.filter(p => selected.assetIds.includes(p.id)).map(({ narrative: _narrative, tags: _tags, ...photo }) => photo), members = new Set(photos.flatMap(p => p.personIds))
  const visualEvidence = [], visualIds = []
  if (imageFor) for (const photo of photos) {
    const bytes = await imageFor(photo.id)
    if (bytes?.length) {
      visualIds.push(photo.id)
      visualEvidence.push({ type: 'text', text: '原始照片编号：' + photo.id }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + Buffer.from(bytes).toString('base64') } })
    }
  }
  if (visualIds.length) {
    const observation = await stage('observe', { photos: photos.filter(p => visualIds.includes(p.id)).map(({ id, personIds }) => ({ id, personIds })), people: input.people.filter(p => members.has(p.id)) },
      answer => visualIds.every(id => list(answer.photos).some(p => p.id === id && text(p.observed, 300))),
      '逐张返回 {"photos":[{"id":"提供的真实ID","observed":"仅可见事实"}]}，不能遗漏照片。', visualEvidence)
    for (const photo of photos) {
      const updated = observation.photos.find(p => p.id === photo.id)
      if (updated) { photo.observed = text(updated.observed, 300); photo.observationSource = 'fresh-visual-observation' }
    }
  }
  const scoped = { ...input, photos, people: input.people.filter(p => members.has(p.id)), relationships: input.relationships.filter(r => members.has(r.subjectId) && members.has(r.objectId)),
    confirmed: input.confirmed.filter(f => (!f.subjectId || members.has(f.subjectId)) && (!f.assetIds?.length || f.assetIds.some(id => selected.assetIds.includes(id)))), chapters: [], selected }
  // Exact dates/addresses remain available to selection, the fact editor and the screen.
  // Keeping them off the writer's desk avoids turning a shared detail into a travel itinerary.
  // The selector's proposed interpretation is not evidence. The writer finds the connection again
  // in the chosen photos instead of inheriting claims such as "her favourite" from a proposal.
  const writing = { ...scoped, selected: { key: selected.key, format: selected.format }, photos: photos.map(({ date: _date, city: _city, place: _place, timeSource: _time, ...photo }) => photo) }
  const shapeProblems = answer => {
    const beats = list((answer.story || answer).beats), issues = [], selectedIds = new Set(photos.map(p => p.id)), uses = new Map()
    if (!beats.length || beats.length > 9 || (photos.length >= 4 && beats.length < 4)) issues.push('需 4–7 段；素材少于四张时可缩短')
    beats.forEach((b, i) => {
      if (!b || typeof b !== 'object') { issues.push(`第 ${i} 段格式无效`); return }
      if (!list(b.assetIds).length || b.assetIds.length > 3 || b.assetIds.some(id => !selectedIds.has(id))) issues.push(`第 ${i} 段只能用 1–3 张所选照片，请调整选片`)
      if (!list(b.evidenceIds).length || b.evidenceIds.some(id => !list(b.assetIds).includes(id))) issues.push(`第 ${i} 段 evidenceIds 必须来自本段 assetIds`)
      if (String(b.text || '').length > 70) issues.push(`第 ${i} 段超出 70 字，请缩短`)
      for (const id of list(b.assetIds)) uses.set(id, (uses.get(id) || 0) + 1)
    })
    if ([...uses.values()].some(n => n > 3)) issues.push('每张照片最多出现三段，请减少重复回看')
    return issues
  }
  const draft = await stage('compose', writing, answer => !shapeProblems(answer).length, answer => '修复编排中的所有问题后重新返回 {"story":完整故事对象}：' + shapeProblems(answer).join('；'))
  const checks = []
  const draftStory = draft.story || draft
  list(draftStory.beats).forEach((b, i) => {
    if (String(b.text || '').length > 70) checks.push(`第 ${i} 段有 ${b.text.length} 字，缩至 70 字内，删去衣着背景清单`)
    try { checkClaims(String(b.text || ''), list(b.evidenceIds), scoped) } catch (e) { checks.push(`第 ${i} 段：${e.message}`) }
  })
  try { checkClaims((draftStory.title || '') + (draftStory.premise || ''), photos.map(p => p.id), scoped) } catch (e) { checks.push(`标题/主题：${e.message}`) }
  const reviewPayload = JSON.stringify({ mode: 'review', ...scoped, selected: { key: selected.key, format: selected.format }, draft, checks })
  const reviewInstruction = system('review') + '\n如果提供了实际照片，逐张对照图像；observed 是旧单图模型的观察，也可能写错。当前图像与旧观察冲突时，不沿用旧观察中的动作、睡眠、衣物或表情断言。人物姓名与关系仍以确认的 personIds 为准，不凭长相补身份。检查每段完整句子；看到一瞬间不能补出持续动作、换手、进屋或成长。'
  const messages = [{ role: 'system', content: reviewInstruction }, { role: 'user', content: visualEvidence.length ? [{ type: 'text', text: reviewPayload }, ...visualEvidence] : reviewPayload }]
  for (let attempt = 0; attempt < 2; attempt++) {
    const answer = parseJsonAnswer(await call(config, messages, options))
    try { return { ...validateStorytelling({ ...applyStoryEdits(draft, answer), candidates }, scoped), visualReviewPhotos: visualEvidence.length / 2 } }
    catch (error) {
      if (attempt) throw new Error(`这段故事还没通过检查：${error.message}`)
      messages.push({ role: 'assistant', content: JSON.stringify(answer) }, { role: 'user', content: `请对原草稿重新返回完整复核对象，包含本轮需要的全部补丁。校验问题：${error.message}。完整形状是 {"edits":[{"beat":0,"text":"改后的整段","reason":"依据"}],"metadata":{},"review":{"grounded":true,"specific":true,"coherent":true,"notes":["核对结论"]}}。不要只返回一个 edit。若无法证实则 grounded 为 false。` })
    }
  }
}

export function applyStoryEdits(draft, answer) {
  const story = structuredClone(draft.story || (Array.isArray(draft.beats) ? draft : null))
  if (!story?.beats?.length || !Array.isArray(answer.edits)) throw new Error('需要原草稿以及 edits 数组形式的复核补丁')
  const edited = new Set()
  for (const edit of answer.edits) {
    if (!Number.isInteger(edit.beat) || !story.beats[edit.beat] || edited.has(edit.beat) || typeof edit.text !== 'string') throw new Error('复核段落编号无效或重复')
    if (!story.beats[edit.beat].text && edit.text) continue // an editor cannot fill a deliberate breath
    story.beats[edit.beat].text = edit.text; edited.add(edit.beat)
  }
  for (const key of ['title', 'premise', 'reflection']) if (Object.hasOwn(answer.metadata || {}, key)) story[key] = answer.metadata[key]
  return { story, review: answer.review }
}

// Private, account-scoped scripts. A changed source invalidates replay; old text is never fed back as fact.
export function createStorytellingService(root, config, { call = chat, photoPreview } = {}) {
  const queues = new Map()
  const epochs = new Map()
  const models = { select: config.model || '', observe: config.model || '', compose: config.storyModel || config.model || '', review: config.model || '' }
  const modelSignature = JSON.stringify(models)
  const file = user => join(root, createHash('sha256').update(user.id).digest('hex'), 'stories.json')
  const read = async user => JSON.parse(await readFile(file(user), 'utf8').catch(error => { if (error.code === 'ENOENT') return '[]'; throw error }))
  const write = async (user, records) => {
    const path = file(user); await mkdir(join(path, '..'), { recursive: true })
    const temp = path + '.' + randomUUID() + '.tmp'
    await writeFile(temp, JSON.stringify(records)); await rename(temp, path)
  }
  return {
    async list(user) { return (await read(user)).filter(s => s.version === STORY_VERSION).slice(0, 8).map(({ id, title, format, createdAt }) => ({ id, title, format, createdAt })) },
    async removeAssets(user, ids) {
      epochs.set(user.id, (epochs.get(user.id) || 0) + 1)
      const records = await read(user), kept = records.filter(s => !s.assetIds.some(id => ids.includes(id)))
      if (kept.length !== records.length) await write(user, kept)
    },
    async compose(user, raw, { storyId, freshInput } = {}) {
      if (queues.has(user.id)) throw new Error('正在编排上一段回忆，请稍候')
      const task = (async () => {
        const epoch = epochs.get(user.id) || 0
        const records = await read(user), prior = records.find(s => s.id === storyId)
        const input = storytellingInput({ ...raw, question: prior?.question || raw.question, recent: records.filter(s => s.version === STORY_VERSION) })
        const revision = sourceRevision(input, modelSignature)
        if (prior?.sourceRevision === revision && prior.version === STORY_VERSION) return { ...prior, cached: true }
        const result = await composeStorytelling(config, input, call, { imageFor: photoPreview ? id => photoPreview(user, id) : undefined })
        // Identity or facts may have changed while the model was talking.
        if ((epochs.get(user.id) || 0) !== epoch || (freshInput && sourceRevision(storytellingInput({ ...await freshInput(), question: input.question }), modelSignature) !== revision)) throw new Error('照片或人物资料刚刚更新，请再讲一次以使用最新资料')
        const record = { ...result, id: randomUUID(), question: input.question, version: STORY_VERSION, models, sourceRevision: revision, createdAt: new Date().toISOString() }
        await write(user, [record, ...records.filter(s => s.id !== prior?.id)].slice(0, 12))
        return record
      })()
      queues.set(user.id, task)
      try { return await task } finally { queues.delete(user.id) }
    },
    async note(user, body, saveFact) {
      const story = (await read(user)).find(s => s.id === body.storyId)
      if (!story) throw new Error('这段讲述已不在当前账户中')
      const assetIds = unique(list(body.assetIds)).filter(id => story.assetIds.includes(id))
      const value = text(body.value, 500)
      if (!value || !assetIds.length) throw new Error('请填写补充，并选择对应的照片')
      await saveFact({ value, assetIds })
      return { ok: true }
    },
  }
}

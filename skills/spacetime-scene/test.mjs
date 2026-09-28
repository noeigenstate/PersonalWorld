import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkSkillFile, importRoot, live, startApi } from '../../tests/skill-kit.mjs'

const dir = fileURLToPath(new URL('.', import.meta.url))
const { loadSkill } = await importRoot('server/skills.mjs')
const { readScenePlan, sceneMessages, reliefCapability } = await importRoot('server/spacetimeScene.mjs')
const photos = [
  { id: 'photo-0001', date: '2020-10-03', scene: '运河边，树叶发黄，远处有塔吊', tags: ['运河', '秋天'], event: '运河散步', confirmed: true },
  { id: 'photo-0002', date: '2020-10-03', scene: '桌上的蛋糕特写', tags: ['蛋糕'], event: '运河散步', confirmed: true },
  { id: 'photo-0003', date: '2023-04-16', scene: '同一河边，体育馆已建成，樱花盛开', tags: ['体育馆'], event: '再来运河', confirmed: false },
  { id: 'photo-0004', date: '', scene: '室内合影', tags: [], event: '', confirmed: false },
]
const answer = () => ({
  place: '拱墅运河体育公园',
  epochs: [
    { ref: 'E1', from: '2020-10-03', to: '2020-10-03', title: '运河边的秋天', photoRefs: ['P1', 'P2', 'P4'], keyPhoto: 'P1',
      layers: { season: { value: '深秋', evidence: 'observed', basis: 'P1 树叶发黄' }, timeOfDay: { value: '白天', evidence: 'inferred', basis: '光线明亮' }, weather: { value: '多云', evidence: 'maybe', basis: '' }, buildings: [{ name: '河边的体育馆', state: '在建', evidence: 'observed', basis: 'P1 有塔吊' }, { name: '', state: 'x' }], sound: { value: '有人说话', evidence: 'observed', basis: '编的' }, traffic: { value: null, evidence: 'unknown', basis: '' } },
      changes: '', caption: '运河边，体育馆还在建' },
    { ref: 'E2', from: '2019-01-01', to: '2023-04-16', title: '春天再来', photoRefs: ['P3', 'P1'], keyPhoto: 'P9', layers: {}, changes: '体育馆从在建到建成', caption: '樱花开了' },
    { ref: 'E3', photoRefs: ['P4'], keyPhoto: 'P4', layers: {} },
  ],
  undated: ['P4'],
  summary: '两个时段',
})

test('SKILL.md 格式完整，写明了分段、关键照片、证据等级和输出格式', () => {
  const { body } = checkSkillFile(dir)
  for (const text of ['只有带可靠日期的照片才能组成时段', 'keyPhoto', '`observed`', '`inferred`', '`unknown`', '不用现在的路况回填过去', '`changes` 只写两个时段都拍到同一事物时的变化', '不要辨认或猜测人物身份', '"epochs"', '"undated"']) assert.ok(body.includes(text), `缺少 ${text}`)
})

test('请求里列出地点、每张照片的日期、画面和事件；日期不可靠的照片写明', () => {
  const messages = sceneMessages({ system: 'S', place: '运河公园', photos })
  assert.equal(messages[0].content, 'S')
  assert.match(messages[1].content, /^地点：运河公园\n共 4 张照片：/)
  assert.match(messages[1].content, /P1：拍摄于 2020-10-03；画面：运河边，树叶发黄，远处有塔吊；标签：运河、秋天；事件：运河散步（已确认）/)
  assert.match(messages[1].content, /P4：日期不可靠；画面：室内合影$/)
})

test('读取答案：编号换回照片 id，无日期的照片进不了时段，每张只属于一个时段，证据等级不合法就当无依据', () => {
  const plan = readScenePlan(answer(), photos)
  assert.equal(plan.place, '拱墅运河体育公园')
  assert.equal(plan.epochs.length, 2, '只有 P4 的时段被丢掉')
  const [autumn, spring] = plan.epochs
  assert.deepEqual(autumn.photoIds, ['photo-0001', 'photo-0002'], '无日期的 P4 不在时段里')
  assert.equal(autumn.keyPhoto, 'photo-0001')
  assert.deepEqual(autumn.layers.season, { value: '深秋', evidence: 'observed', basis: 'P1 树叶发黄' })
  assert.deepEqual(autumn.layers.weather, { value: null, evidence: 'unknown', basis: '' }, '不合法的证据等级当无依据')
  assert.deepEqual(autumn.layers.sound, { value: null, evidence: 'unknown', basis: '' }, '照片没有声音')
  assert.deepEqual(autumn.layers.buildings, [{ name: '河边的体育馆', state: '在建', evidence: 'observed', basis: 'P1 有塔吊' }])
  assert.deepEqual(spring.photoIds, ['photo-0003'], 'P1 已属于第一个时段')
  assert.equal(spring.keyPhoto, null, '关键照片不在时段里就为空')
  assert.equal(spring.from, '2023-04-16', '起止日期超出照片日期时按照片日期')
  assert.equal(spring.layers.traffic.evidence, 'unknown')
  assert.deepEqual(plan.undated, ['photo-0004'])
  assert.equal(plan.summary, '两个时段')
})

test('没有 ComfyUI 时重建能力为不可用，并说明原因', async () => {
  const capability = await reliefCapability({ comfy: 'http://127.0.0.1:9' })
  assert.equal(capability.available, false)
  assert.match(capability.reason, /ComfyUI/)
})

// The API under test has no ComfyUI; the real one (if running) is kept for the LIVE reconstruction
const realComfy = process.env.COMFY_URL || 'http://127.0.0.1:8188'
let api
before(async () => {
  process.env.COMFY_URL = 'http://127.0.0.1:9'
  api = await startApi(answer)
})
after(() => api?.close())

test('/api/spacetime-scene 用这个 skill 作系统提示，返回计划、本机重建能力和已有模型', async () => {
  const { status, json } = await api.post('/api/spacetime-scene', { place: '运河公园', photos: [...photos, { id: 'bad id', date: '2020-01-01' }] })
  assert.equal(status, 200)
  const call = api.calls.at(-1)
  assert.equal(call.messages[0].content, loadSkill('spacetime-scene'))
  assert.match(call.messages[1].content, /共 4 张照片/, '编号不合法的照片被过滤')
  assert.equal(json.plan.epochs.length, 2)
  assert.equal(json.capability.available, false)
  assert.deepEqual(json.scenes, [])
})

test('/api/spacetime-scene 没有照片时拒绝', async () => {
  const { status } = await api.post('/api/spacetime-scene', { place: 'x', photos: [] })
  assert.equal(status, 400)
})

test('/api/spacetime-scene/relief 没有本机模型时明确说明，不保存任何东西', async () => {
  const { status, json } = await api.post('/api/spacetime-scene/relief', { id: 'photo-0001', dataUrl: 'data:image/jpeg;base64,/9j/2Q==' })
  assert.equal(status, 503)
  assert.match(json.error, /ComfyUI/)
  const bad = await api.post('/api/spacetime-scene/relief', { id: 'photo-0001', dataUrl: 'not an image' })
  assert.equal(bad.status, 400)
})

test('真实调用：StepFun 按 skill 分段（LIVE=1）', { skip: !live }, async () => {
  const { chat, parseJsonAnswer, stepfunConfig } = await importRoot('server/stepfun.mjs')
  const plan = readScenePlan(parseJsonAnswer(await chat(stepfunConfig(), sceneMessages({ system: loadSkill('spacetime-scene'), place: '拱墅运河体育公园', photos }), { json: true })), photos)
  assert.equal(plan.epochs.length, 2, JSON.stringify(plan))
  assert.equal(plan.epochs[0].keyPhoto, 'photo-0001', '视野开阔的照片当关键照片')
  assert.equal(plan.epochs[0].layers.sound.evidence, 'unknown')
  assert.ok(plan.epochs.every((e) => Object.values(e.layers).flat().every((l) => ['observed', 'inferred', 'unknown'].includes(l.evidence))))
})

test('真实重建：本机 ComfyUI 把一张照片变成模型（LIVE=1 且 ComfyUI 在运行）', { skip: !live }, async () => {
  const capability = await reliefCapability({ comfy: realComfy })
  if (!capability.available) { console.log(`跳过：${capability.reason}`); return }
  const { readFileSync } = await import('node:fs')
  const { reconstructRelief } = await importRoot('server/spacetimeScene.mjs')
  const glb = await reconstructRelief(readFileSync(new URL('../photo-cull/evals/2026-09-28/images/all-a.jpg', import.meta.url)), { comfy: realComfy })
  const { writeFileSync } = await import('node:fs')
  if (process.env.SCENE_OUT) writeFileSync(process.env.SCENE_OUT, glb)
  assert.equal(glb.toString('ascii', 0, 4), 'glTF')
  assert.ok(glb.length > 50_000, `模型 ${glb.length} 字节`)
})

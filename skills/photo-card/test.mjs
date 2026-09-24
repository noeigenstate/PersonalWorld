import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkSkillFile, imageDataUrl, importRoot, live, startApi } from '../../tests/skill-kit.mjs'

const dir = fileURLToPath(new URL('.', import.meta.url))
const { loadSkill } = await importRoot('server/skills.mjs')
const pearl = imageDataUrl('skills/photo-context/evals/2026-09-24/images/pearl-a.jpg')

test('SKILL.md 格式完整，写明了事实与推断、地标、隐私和输出字段', () => {
  const { body } = checkSkillFile(dir)
  for (const key of ['scene', 'visibleText', 'clues', 'landmark', 'eventGuess', 'questions']) assert.match(body, new RegExp(`"${key}"`), `缺少字段 ${key}`)
  assert.match(body, /来源是 `exif` 才是拍摄时间/)
  assert.match(body, /不高于 0\.6/)
  assert.match(body, /隐私声明：用户已同意/)
})

let api
before(async () => {
  api = await startApi(() => ({
    title: '外滩看东方明珠', caption: '〔在黄浦江边〕', scene: '电视塔', visibleText: '',
    clues: [{ kind: '地点', evidence: '东方明珠塔身', inference: '在上海', confidence: 0.9 }, { kind: '事件', evidence: '', inference: '没有依据', confidence: 0.8 }],
    landmark: { name: '东方明珠', city: '上海市', confidence: 2 },
    eventGuess: { type: '旅行', reason: '地标' }, tags: ['1', '2', '3', '4', '5', '6'], questions: ['a', 'b', 'c'],
  }))
})
after(() => api?.close())

test('/api/photo-card 用这个 skill，并整理地标、线索和列表长度', async () => {
  const { status, json } = await api.post('/api/photo-card', { image: { dataUrl: pearl }, facts: { fileName: 'IMG.jpg', time: '2026-01-01T00:00:00Z', timeSource: 'filename', size: '960 × 1280' } })
  assert.equal(status, 200)
  const call = api.calls.at(-1)
  assert.equal(call.messages[0].content, loadSkill('photo-card'))
  assert.match(call.messages[1].content[0].text, /来源：filename/)
  assert.deepEqual(json.landmark, { name: '东方明珠', city: '上海市', confidence: 1 })
  assert.equal(json.clues.length, 1, '没有依据的线索被丢弃')
  assert.equal(json.tags.length, 5)
  assert.equal(json.questions.length, 2)
})

test('真实模型：认出东方明珠并给出有依据的线索', { skip: !live && '设置 LIVE=1 才调用真实模型' }, async () => {
  const { stepfunConfig, chat, parseJsonAnswer } = await importRoot('server/stepfun.mjs')
  const card = parseJsonAnswer(await chat(stepfunConfig(), [
    { role: 'system', content: loadSkill('photo-card') },
    { role: 'user', content: [{ type: 'text', text: '为这张照片写信息卡。程序读出的元数据：\n文件名：pearl.jpg\n时间：未知（来源：file）\nGPS：无\n城市：未知\n尺寸：960 × 1280\n隐私声明：用户已同意' }, { type: 'image_url', image_url: { url: pearl } }] },
  ], { json: true }))
  assert.match(card.landmark?.name || '', /东方明珠/)
  assert.match(card.landmark?.city || '', /上海/)
  assert.ok(card.clues.length > 0 && card.clues.every((c) => c.evidence && c.inference && typeof c.confidence === 'number'))
  assert.ok(!/拍摄(于|时间)/.test(card.caption || ''), '没有 EXIF 时不能声称拍摄时间')
})

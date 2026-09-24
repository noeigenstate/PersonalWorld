import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkSkillFile, imageDataUrl, importRoot, live, startApi } from '../../tests/skill-kit.mjs'

const dir = fileURLToPath(new URL('.', import.meta.url))
const { loadSkill } = await importRoot('server/skills.mjs')
const pearl = imageDataUrl('skills/photo-context/evals/2026-09-24/images/pearl-a.jpg')

test('SKILL.md 格式完整，规定了全部输出字段和规则', () => {
  const { body } = checkSkillFile(dir)
  for (const field of ['title', 'summary', 'type', 'place', 'city', 'people', 'visibleText', 'tags', 'questions', 'confidence']) assert.match(body, new RegExp(field), `缺少字段 ${field}`)
  assert.match(body, /地标/)
  assert.match(body, /隐私声明/)
  assert.equal(loadSkill('event-analysis'), body, '运行时加载的内容应去掉 front matter')
})

let api
before(async () => {
  api = await startApi(() => ({ title: '外滩夜景', summary: '在外滩看东方明珠。', type: '旅行', place: '外滩', city: '上海市', people: [], visibleText: '热线 021-12345678', tags: ['a', 'b', 'c', 'd', 'e'], questions: ['1', '2', '3'], confidence: 1.4 }))
})
after(() => api?.close())

test('/api/analyze 用这个 skill 作为系统提示，并整理模型输出', async () => {
  const { status, json } = await api.post('/api/analyze', { images: [{ name: 'a.jpg', capturedAt: '2026-01-01T00:00:00Z', dataUrl: pearl }] })
  assert.equal(status, 200)
  const call = api.calls.at(-1)
  assert.equal(call.messages[0].content, loadSkill('event-analysis'))
  assert.match(call.messages[1].content[0].text, /隐私声明：用户已同意/)
  assert.equal(call.response_format.type, 'json_object')
  assert.equal(json.tags.length, 4)
  assert.equal(json.questions.length, 2)
  assert.equal(json.confidence, 1)
  assert.equal(json.visibleText, '热线 021-12345678', '同意隐私声明后号码原样返回')
})

test('真实模型：从地标照片推断出上海', { skip: !live && '设置 LIVE=1 才调用真实模型' }, async () => {
  const { stepfunConfig, chat, parseJsonAnswer } = await importRoot('server/stepfun.mjs')
  const answer = parseJsonAnswer(await chat(stepfunConfig(), [
    { role: 'system', content: loadSkill('event-analysis') },
    { role: 'user', content: [{ type: 'text', text: '请判断这些影像属于什么事件。元数据如下：\n1. pearl.jpg；拍摄时间：未知；坐标：未知\n隐私声明：用户已同意' }, { type: 'image_url', image_url: { url: pearl } }] },
  ], { json: true }))
  assert.match(answer.city, /上海/)
  assert.ok(typeof answer.title === 'string' && answer.title.length <= 14)
  assert.ok(typeof answer.confidence === 'number')
})

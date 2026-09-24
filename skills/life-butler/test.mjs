import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkSkillFile, importRoot, live, startApi } from '../../tests/skill-kit.mjs'

const dir = fileURLToPath(new URL('.', import.meta.url))
const { loadSkill } = await importRoot('server/skills.mjs')

const memory = {
  places: [{ city: '上海市', role: 'work', roleConfirmed: true, firstAt: '2018-07-02', lastAt: '2026-09-20', eventCount: 2 }],
  events: [
    { id: 'e1', title: '入职第一天', start: '2018-07-02', end: '2018-07-02', city: '上海市', status: 'confirmed', firsts: ['照片记录中第一次在上海'], photoCount: 4 },
    { id: 'e2', title: '父母来沪', summary: '和父母在外滩散步。', start: '2019-10-02', end: '2019-10-02', city: '上海市', place: '外滩', status: 'analyzed', photoCount: 26 },
  ],
}

test('SKILL.md 格式完整，写明了推断标记、第一次和输出格式', () => {
  const { body } = checkSkillFile(dir)
  assert.match(body, /〔〕/)
  assert.match(body, /照片记录中的第一次/)
  assert.match(body, /不要主动提起任何"最后一次"/)
  assert.match(body, /"answer"/)
  assert.match(body, /"eventIds"/)
})

let api
before(async () => { api = await startApi(() => ({ answer: '那是〔爸妈来上海〕。', eventIds: ['e2', 'unknown'] })) })
after(() => api?.close())

test('/api/butler 把 skill 和记忆一起作为系统提示，并过滤不存在的事件', async () => {
  const { status, json } = await api.post('/api/butler', { question: '2019 年国庆发生了什么？', history: [{ role: 'assistant', content: '你好' }], memory, focus: { city: '上海市', from: '2018-07-02', to: '2026-09-20' } })
  assert.equal(status, 200)
  const system = api.calls.at(-1).messages[0].content
  assert.ok(system.startsWith(loadSkill('life-butler')))
  assert.match(system, /记忆：\{"today":"\d{4}-\d{2}-\d{2}","focus":\{"city":"上海市"/)
  assert.deepEqual(json.eventIds, ['e2'])
  assert.equal(api.calls.at(-1).messages[1].role, 'assistant', '对话历史按顺序带上')
})

test('真实模型：依据记忆回答，推断内容加〔〕，引用正确的事件', { skip: !live && '设置 LIVE=1 才调用真实模型' }, async () => {
  const { stepfunConfig, chat, parseJsonAnswer } = await importRoot('server/stepfun.mjs')
  const answer = parseJsonAnswer(await chat(stepfunConfig(), [
    { role: 'system', content: `${loadSkill('life-butler')}\n\n记忆：${JSON.stringify({ today: '2026-09-24', focus: null, ...memory })}` },
    { role: 'user', content: '2019 年国庆那会儿发生了什么？' },
  ], { json: true }))
  assert.equal(answer.eventIds?.[0], 'e2')
  assert.match(answer.answer, /〔/, 'e2 未经确认，推断内容应加〔〕')
  assert.ok(answer.answer.length <= 150, '回答要短，便于朗读')
})

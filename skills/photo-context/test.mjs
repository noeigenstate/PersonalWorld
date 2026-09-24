import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkSkillFile, imageDataUrl, importRoot, live, startApi } from '../../tests/skill-kit.mjs'

const dir = fileURLToPath(new URL('.', import.meta.url))
const { loadSkill } = await importRoot('server/skills.mjs')
const img = (name) => imageDataUrl(`skills/photo-context/evals/2026-09-24/images/${name}`)

test('SKILL.md 格式完整，写明了关系类型、补全规则和反例', () => {
  const { body } = checkSkillFile(dir)
  for (const relation of ['同一场景', '同一地点', '同一事件', '无关']) assert.match(body, new RegExp(relation))
  assert.match(body, /"都是室内""都是白墙"/)
  assert.match(body, /\["landmark"\]/)
  assert.match(body, /`matches` 必须覆盖每一张参考照片/)
})

let api
before(async () => {
  api = await startApi(() => ({
    matches: [{ ref: 'R1', relation: '无关', evidence: '', confidence: 0.2 }, { ref: 'R2', relation: '同一场景', evidence: '同一盏吊灯', confidence: 0.9 }, { ref: 'landmark', relation: '同一地点', evidence: 'x', confidence: 1 }],
    fills: { city: { value: '杭州市', fromRefs: ['R2', 'landmark'], reason: '同一房间', confidence: 0.85 }, place: { value: '没有来源', fromRefs: [], reason: '', confidence: 0.9 }, time: null, event: null },
    conflicts: ['无'],
  }))
})
after(() => api?.close())

test('/api/photo-context 把 R1、R2 换回照片 id，丢掉没有来源的补全', async () => {
  const body = {
    target: { dataUrl: img('empty-room.jpg'), known: {} },
    refs: [
      { id: 'a', dataUrl: img('crane.jpg'), known: { city: '武汉市', citySource: 'GPS 定位' } },
      { id: 'no-image', dataUrl: 'not an image' },
      { id: 'b', dataUrl: img('pearl-b.jpg'), known: { city: '杭州市', citySource: '用户确认' } },
    ],
  }
  const { status, json } = await api.post('/api/photo-context', body)
  assert.equal(status, 200)
  const call = api.calls.at(-1)
  assert.equal(call.messages[0].content, loadSkill('photo-context'))
  assert.equal(call.messages[1].content.filter((p) => p.type === 'image_url').length, 3, '目标 + 两张有效参考照片')
  assert.match(call.messages[1].content[0].text, /R2（第 3 张图）：城市：杭州市（来源：用户确认）/)
  assert.deepEqual(json.matches.map((m) => [m.refId, m.relation]), [['a', '无关'], ['b', '同一场景']])
  assert.deepEqual(json.fills.city.fromRefIds, ['b', 'landmark'])
  assert.equal(json.fills.place, null)
  assert.equal((await api.post('/api/photo-context', { target: body.target, refs: [] })).status, 400)
})

test('真实模型：地标照片补全为上海，与无关参考照片不混淆', { skip: !live && '设置 LIVE=1 才调用真实模型' }, async () => {
  const { stepfunConfig, chat, parseJsonAnswer } = await importRoot('server/stepfun.mjs')
  const { contextMessages, readContext } = await importRoot('server/photoContext.mjs')
  const refs = [{ id: 'crane', dataUrl: img('crane.jpg'), known: { city: '武汉市', citySource: 'GPS 定位' } }, { id: 'empty', dataUrl: img('empty-room.jpg'), known: { city: '杭州市', citySource: 'GPS 定位' } }]
  const answer = parseJsonAnswer(await chat(stepfunConfig(), contextMessages({ system: loadSkill('photo-context'), target: { dataUrl: img('pearl-a.jpg'), known: {} }, refs, consented: true }), { json: true }))
  const result = readContext(answer, refs)
  assert.match(result.fills.city?.value || '', /上海/)
  assert.ok(result.fills.city.fromRefIds.includes('landmark'))
  assert.ok(result.matches.every((m) => m.relation === '无关'), '黄鹤楼和空房间都与东方明珠无关')
  assert.equal(result.matches.length, 2, '每张参考照片都要判断')
})

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkSkillFile, imageDataUrl, importRoot, live, root, startApi } from '../../tests/skill-kit.mjs'

const dir = fileURLToPath(new URL('.', import.meta.url))
const { loadSkill } = await importRoot('server/skills.mjs')
const { cullMessages, readCull } = await importRoot('server/photoCull.mjs')
const images = 'skills/photo-cull/evals/2026-09-28/images'
const img = (name) => imageDataUrl(`${images}/${name}`)
const tiny = 'data:image/jpeg;base64,/9j/2Q=='

test('SKILL.md 格式完整，写明了闭眼、模糊的判断标准和输出格式', () => {
  const { body } = checkSkillFile(dir)
  for (const text of ['eyesClosed', 'blurry', '项数必须等于照片张数', '只要有一个人闭眼', '眯眼笑', '背景虚化而主体清楚不算模糊', '建议保留张数', '不要猜测人物身份', '"keep"']) assert.ok(body.includes(text), `缺少 ${text}`)
})

test('请求里写明张数、建议保留张数和每张的清晰度，图片顺序与 P 编号一致', () => {
  const messages = cullMessages({ system: 'S', photos: [{ id: 'a', dataUrl: tiny, time: '2021-10-07 10:55', sharpness: 812.4 }, { id: 'b', dataUrl: tiny }], keep: 1 })
  assert.equal(messages[0].content, 'S')
  const [text, ...pictures] = messages[1].content
  assert.match(text.text, /这 2 张照片构图相似.*建议保留张数：1/s)
  assert.match(text.text, /P1（第 1 张图）：拍摄于 2021-10-07 10:55；清晰度 812/)
  assert.match(text.text, /P2（第 2 张图）：拍摄时间未知$/)
  assert.equal(pictures.length, 2)
})

test('读取答案：P 编号换回照片 id，重复和越界的编号丢掉，分数限制在 0–10', () => {
  const photos = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const read = readCull({
    photos: [
      { ref: 'P1', eyesClosed: true, blurry: 'yes', issues: ['表情僵硬', '', 3, '这一条问题的描述写得实在是太长了'], score: 14, note: '闭眼' },
      { ref: 'P1', eyesClosed: false, score: 9 },
      { ref: 'P9', score: 10 },
      { ref: 'P3', score: 'x' },
    ],
    keep: ['P3', 'P3', 'P7'],
    summary: '这组都不太理想',
  }, photos)
  assert.deepEqual(read.reviews.a, { eyesClosed: true, blurry: false, issues: ['表情僵硬', '这一条问题的描述写得实在'], score: 10, note: '闭眼' })
  assert.equal(read.reviews.b, undefined, '模型跳过的照片没有评价')
  assert.equal(read.reviews.c.score, 5)
  assert.deepEqual(read.keep, ['c'])
  assert.equal(read.summary, '这组都不太理想')
})

let api
before(async () => {
  api = await startApi(() => ({ photos: [{ ref: 'P1', eyesClosed: false, blurry: false, issues: [], score: 8, note: '好' }, { ref: 'P2', eyesClosed: true, blurry: false, issues: [], score: 3, note: '闭眼' }], keep: ['P1'], summary: '留第一张' }))
})
after(() => api?.close())

test('/api/photo-cull 用这个 skill 作系统提示，只收图片，保留张数少于总数', async () => {
  const { status, json } = await api.post('/api/photo-cull', { photos: [{ id: 'x', dataUrl: tiny }, { id: 'bad', dataUrl: 'not an image' }, { id: 'y', dataUrl: tiny }], keep: 9 })
  assert.equal(status, 200)
  const call = api.calls.at(-1)
  assert.equal(call.messages[0].content, loadSkill('photo-cull'))
  assert.match(call.messages[1].content[0].text, /这 2 张照片.*建议保留张数：1/s, '无效图片被过滤，保留张数被限制')
  assert.deepEqual(json.keep, ['x'])
  assert.equal(json.reviews.y.eyesClosed, true)
  assert.equal((await api.post('/api/photo-cull', { photos: [{ id: 'x', dataUrl: tiny }] })).status, 400, '一张照片不需要挑')
})

test('真实模型：认出闭眼和模糊，保留两人都睁眼的清晰照片', { skip: (!live && '设置 LIVE=1 才调用真实模型') || (!existsSync(join(root, images, 'blink-a.jpg')) && '先运行 evals/2026-09-28/make-images.mjs') }, async () => {
  const { stepfunConfig, chat, parseJsonAnswer } = await importRoot('server/stepfun.mjs')
  const photos = ['blink-a', 'blink-b', 'blink-c', 'blink-d'].map((id) => ({ id, dataUrl: img(`${id}.jpg`) }))
  const result = readCull(parseJsonAnswer(await chat(stepfunConfig(), cullMessages({ system: loadSkill('photo-cull'), photos, keep: 1 }), { json: true })), photos)
  assert.deepEqual(result.keep, ['blink-a'])
  assert.equal(result.reviews['blink-b']?.eyesClosed, true)
  assert.equal(result.reviews['blink-a']?.eyesClosed, false)
  assert.equal(result.reviews['blink-d']?.blurry, true)
})

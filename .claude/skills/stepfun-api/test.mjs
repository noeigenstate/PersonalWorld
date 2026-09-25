// Checks that what the stepfun-api skill documents is still true.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkSkillFile, imageDataUrl, live } from '../../../tests/skill-kit.mjs'

const dir = fileURLToPath(new URL('.', import.meta.url))
const wavSource = readFileSync(new URL('./scripts/wav.ts', import.meta.url), 'utf8')
const wavModule = stripTypeScriptTypes(wavSource, { mode: 'strip' })
const { encodeWav } = await import(`data:text/javascript;base64,${Buffer.from(wavModule).toString('base64')}`)

test('SKILL.md 格式完整，记录了已验证的模型和接口', () => {
  const { body } = checkSkillFile(dir)
  for (const fact of ['/v1/chat/completions', 'step-3.7-flash', '/v1/audio/transcriptions', 'stepaudio-2.5-asr', '/v1/audio/speech', 'stepaudio-2.5-tts', 'cixingnansheng', 'json_object']) assert.ok(body.includes(fact), `缺少 ${fact}`)
})

test('scripts/wav.ts 生成 16 位单声道 PCM WAV', async () => {
  const samples = new Float32Array(1600).map((_, i) => Math.sin(i / 10))
  const bytes = new Uint8Array(await encodeWav(samples, 16000).arrayBuffer())
  const view = new DataView(bytes.buffer)
  const ascii = (at, n) => String.fromCharCode(...bytes.slice(at, at + n))
  assert.equal(ascii(0, 4), 'RIFF')
  assert.equal(ascii(8, 4), 'WAVE')
  assert.equal(view.getUint16(22, true), 1, '单声道')
  assert.equal(view.getUint32(24, true), 16000, '采样率')
  assert.equal(view.getUint16(34, true), 16, '16 位')
  assert.equal(bytes.length, 44 + 1600 * 2)
})

const base = 'https://api.stepfun.com/v1'
const auth = () => ({ Authorization: `Bearer ${process.env.STEPFUN_API_KEY}` })

test('真实接口：文档里的三种调用都能用', { skip: !live && '设置 LIVE=1 才调用真实接口' }, async () => {
  const chat = await fetch(`${base}/chat/completions`, {
    method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'step-3.7-flash', response_format: { type: 'json_object' }, messages: [
      { role: 'system', content: '严格输出 JSON 对象：{"subject":"一句话"}' },
      { role: 'user', content: [{ type: 'text', text: '图里主要是什么？' }, { type: 'image_url', image_url: { url: imageDataUrl('skills/photo-context/evals/2026-09-24/images/pearl-a.jpg') } }] },
    ] }),
  })
  assert.equal(chat.status, 200)
  assert.ok(JSON.parse((await chat.json()).choices[0].message.content).subject)

  const speech = await fetch(`${base}/audio/speech`, { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'stepaudio-2.5-tts', input: '我们去外滩散步吧', voice: 'cixingnansheng', response_format: 'wav' }) })
  assert.equal(speech.status, 200)
  const wav = Buffer.from(await speech.arrayBuffer())
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF')

  const form = new FormData()
  form.append('model', 'stepaudio-2.5-asr')
  form.append('response_format', 'json')
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'q.wav')
  const asr = await fetch(`${base}/audio/transcriptions`, { method: 'POST', headers: auth(), body: form })
  assert.equal(asr.status, 200)
  assert.match((await asr.json()).text, /外滩/)
})

import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'

const requests = []
const mock = http.createServer(async (req, res) => {
  let body = ''
  for await (const chunk of req) body += chunk.toString()
  const payload = JSON.parse(body)
  requests.push({ url: req.url, auth: req.headers.authorization, payload })
  const output = JSON.stringify({ title: '海边旅行', summary: '画面显示海边风景。', type: '旅行', place: '', people: [], visibleText: '海边', tags: ['海边'], questions: ['同行的人是谁？'], confidence: 0.7 })
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ choices: [{ message: { content: output }, finish_reason: 'stop' }] }))
})
await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve))
const mockPort = mock.address().port

const api = spawn(process.execPath, ['server/index.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: '0',
    STEPFUN_BASE_URL: `http://127.0.0.1:${mockPort}/v1`,
    STEPFUN_API_KEY: 'mock-key',
    STEPFUN_MODEL: 'step-3.7-flash',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

const apiPort = await new Promise((resolve, reject) => {
  let output = ''
  const timeout = setTimeout(() => reject(new Error(`测试 API 未启动：${output}`)), 10_000)
  api.stdout.on('data', (chunk) => {
    output += chunk.toString()
    const match = output.match(/Personal World API running on http:\/\/127\.0\.0\.1:(\d+)/)
    if (match) { clearTimeout(timeout); resolve(Number(match[1])) }
  })
  api.stderr.on('data', (chunk) => { output += chunk.toString() })
  api.on('exit', () => { clearTimeout(timeout); reject(new Error(`测试 API 提前退出：${output}`)) })
})
const apiBase = `http://127.0.0.1:${apiPort}`

try {
  const badRequest = await fetch(`${apiBase}/api/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  assert.equal(badRequest.status, 403)

  const analyzed = await fetch(`${apiBase}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Memory-Agent': 'web' },
    body: JSON.stringify({ images: [{ name: 'beach.jpg', capturedAt: '2026-09-23T10:00:00Z', dataUrl: 'data:image/jpeg;base64,/9j/2Q==' }] }),
  })
  assert.equal(analyzed.status, 200)
  const event = await analyzed.json()
  assert.equal(event.title, '海边旅行')
  assert.equal(event.questions[0], '同行的人是谁？')
  assert.equal(event.visibleText, '海边')
  assert.equal(requests[0].auth, 'Bearer mock-key')
  assert.equal(requests[0].payload.model, 'step-3.7-flash')
  assert.equal(requests[0].payload.messages[1].content[1].type, 'image_url')
  assert.equal(requests[0].payload.response_format.type, 'json_object')

  const chatRemoved = await fetch(`${apiBase}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Memory-Agent': 'web' }, body: '{}' })
  assert.equal(chatRemoved.status, 404, '回忆对话接口已移除')
  console.log('API test passed: request guard, image payload, JSON parse.')
} finally {
  api.kill()
  await new Promise((resolve) => mock.close(resolve))
}

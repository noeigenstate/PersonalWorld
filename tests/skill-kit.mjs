// Shared helpers for all project skills (skills/*/test.mjs).
// Offline checks always run; checks against real services run with LIVE=1.
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const root = fileURLToPath(new URL('../', import.meta.url))
export const live = process.env.LIVE === '1'
if (live) process.loadEnvFile(join(root, '.env'))

export const importRoot = (path) => import(pathToFileURL(join(root, path)).href)
export const imageDataUrl = (path) => 'data:image/jpeg;base64,' + readFileSync(join(root, path)).toString('base64')

// Front matter: name must match the folder, description must say what it is for
export function checkSkillFile(dir) {
  const text = readFileSync(join(dir, 'SKILL.md'), 'utf8')
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  assert.ok(match, 'SKILL.md 需要以 front matter 开头')
  const meta = Object.fromEntries(match[1].split(/\r?\n/).filter((l) => /^\w+:/.test(l)).map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]))
  assert.equal(meta.name, basename(dir), 'name 应与目录名一致')
  assert.ok(meta.description && meta.description.length > 30, 'description 需要说明用途')
  assert.ok(match[2].trim().length > 100, '正文不能为空')
  return { meta, body: match[2].trim() }
}

// The real API server, with StepFun replaced by `reply(system, payload)` and a consenting user signed in
export async function startApi(reply) {
  const calls = []
  const mock = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const payload = JSON.parse(Buffer.concat(chunks).toString() || '{}')
    calls.push(payload)
    const system = payload.messages?.[0]?.content || ''
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply(system, payload)) }, finish_reason: 'stop' }] }))
  })
  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve))
  const api = spawn(process.execPath, ['server/index.mjs'], {
    cwd: root,
    env: { ...process.env, PORT: '0', STEPFUN_BASE_URL: `http://127.0.0.1:${mock.address().port}/v1`, STEPFUN_API_KEY: 'mock', STEPFUN_MODEL: 'mock-model', USERS_FILE: join(mkdtempSync(join(tmpdir(), 'pw-skill-')), 'users.json') },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const port = await new Promise((resolve, reject) => {
    let out = ''
    const timer = setTimeout(() => reject(new Error(out)), 10_000)
    api.stdout.on('data', (c) => { out += c; const m = out.match(/running on http:\/\/127\.0\.0\.1:(\d+)/); if (m) { clearTimeout(timer); resolve(Number(m[1])) } })
    api.stderr.on('data', (c) => { out += c })
  })
  const base = `http://127.0.0.1:${port}`
  const headers = { 'Content-Type': 'application/json', 'X-Memory-Agent': 'web' }
  const registered = await fetch(`${base}/api/auth/register`, { method: 'POST', headers, body: JSON.stringify({ username: 'skilltest', password: 'secret12', acceptPrivacy: true }) })
  headers.Cookie = (registered.headers.get('set-cookie') || '').split(';')[0]
  return {
    calls,
    post: async (path, body) => { const r = await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) }); return { status: r.status, json: await r.json() } },
    close: async () => { api.kill(); await new Promise((resolve) => mock.close(resolve)) },
  }
}

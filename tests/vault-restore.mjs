import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { fakeGeocode, makeLifeFixtures } from './fixtures.mjs'

// Clearing the browser's site data must not lose photos: the second browser context starts with
// empty IndexedDB (as after clearing the cache), signs in again and gets everything back from the
// account vault. The vault is mocked in memory here; tests/api.mjs covers server/accountVault.mjs.
const BASE = process.env.BASE_URL || 'http://localhost:5183/'
const browser = await chromium.launch({ channel: 'chrome', headless: true })

const vault = { state: null, previews: new Map(), originals: new Map() }
const calls = []
let signedIn = false

async function mockServer(context) {
  const user = { user: { id: 'vault-user-1', username: '小丁', createdAt: '2026-09-28T00:00:00Z', privacyAccepted: true } }
  await context.route('**/api/auth/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/me')) return signedIn ? route.fulfill({ json: user }) : route.fulfill({ status: 401, json: { error: '请先登录' } })
    if (path.endsWith('/logout')) { signedIn = false; return route.fulfill({ json: { ok: true } }) }
    signedIn = true
    return route.fulfill({ status: path.endsWith('/register') ? 201 : 200, json: user })
  })
  await context.route('**/api/config', (route) => route.fulfill({ json: { available: true, mode: 'model', message: '模拟', geocode: true } }))
  await context.route('**/api/geocode', (route) => route.fulfill({ json: { results: route.request().postDataJSON().points.map(fakeGeocode) } }))
  await context.route('**/api/photo-card', (route) => route.fulfill({ status: 503, json: { error: '测试中不生成信息卡' } }))
  await context.route('**/api/vault/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()
    calls.push(`${method} ${path}`)
    if (method !== 'GET') assert.equal(request.headers()['x-memory-agent'], 'web')
    if (path === '/api/vault/state') {
      if (method === 'GET') return route.fulfill({ json: vault.state || { memory: null, extras: {}, savedAt: null } })
      const body = request.postDataJSON()
      assert.ok(body.memory.assets.every((asset) => typeof asset.preview === 'string'), '客户端发送完整状态，由服务端剥离预览图')
      vault.state = { memory: { ...body.memory, assets: body.memory.assets.map(({ preview: _p, ...asset }) => asset) }, extras: body.extras, savedAt: new Date().toISOString() }
      return route.fulfill({ json: { ok: true } })
    }
    if (path === '/api/vault/assets') return route.fulfill({ json: { previews: [...vault.previews.keys()], originals: [...vault.originals.keys()] } })
    const [, id, part] = /^\/api\/vault\/assets\/([^/]+)(?:\/(preview|original))?$/.exec(path)
    if (method === 'DELETE') { vault.previews.delete(id); vault.originals.delete(id); return route.fulfill({ json: { ok: true } }) }
    const store = part === 'preview' ? vault.previews : vault.originals
    if (method === 'PUT') {
      store.set(id, { body: request.postDataBuffer(), type: request.headers()['content-type'], name: request.headers()['x-file-name'], lastModified: request.headers()['x-last-modified'] })
      return route.fulfill({ json: { ok: true } })
    }
    const item = store.get(id)
    if (!item) return route.fulfill({ status: 404, json: { error: '不存在' } })
    return route.fulfill({ body: item.body, contentType: item.type, headers: { 'X-File-Name': item.name || '', 'X-Last-Modified': item.lastModified || '' } })
  })
}

try {
  // First browser: register, import a life's photos, let the backup finish
  const first = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await mockServer(first)
  const page = await first.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.locator('#auth-username').fill('小丁')
  await page.locator('#auth-password').fill('secret12')
  await page.locator('#auth-consent').check()
  await page.getByRole('button', { name: '注册' }).first().click()
  const files = await makeLifeFixtures(page, mkdtempSync(join(tmpdir(), 'pw-vault-')))
  await page.getByRole('button', { name: '导入第一批影像' }).click()
  await page.locator('input[type="file"]').setInputFiles(files)
  await page.locator('.map-label.place').nth(3).waitFor()
  const events = await page.locator('.timebar .dot').count()
  const deadline = Date.now() + 30_000
  while ((vault.previews.size < files.length || vault.originals.size < files.length) && Date.now() < deadline) await page.waitForTimeout(250)
  assert.equal(vault.previews.size, files.length, `每张照片的预览图都应备份（${vault.previews.size}/${files.length}）`)
  assert.equal(vault.originals.size, files.length, '每张原图都应备份')
  assert.equal(vault.state.memory.assets.length, files.length)
  assert.equal(vault.state.memory.events.length, events)
  await first.close()

  // Second browser = site data cleared: nothing in IndexedDB, sign in again
  signedIn = false
  const second = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await mockServer(second)
  const again = await second.newPage()
  const errors = []
  again.on('pageerror', (error) => errors.push(error.message))
  await again.goto(BASE, { waitUntil: 'networkidle' })
  assert.equal(await again.evaluate(async () => (await indexedDB.databases()).length), 0, '新的浏览器没有本地数据')
  const putsBefore = calls.filter((call) => call.startsWith('PUT /api/vault/state')).length
  await again.locator('.auth-switch button').click()
  await again.locator('#auth-username').fill('小丁')
  await again.locator('#auth-password').fill('secret12')
  await again.locator('.auth-submit').click()
  await again.locator('.map-label.place').nth(3).waitFor()
  assert.equal(await again.locator('.timebar .dot').count(), events, '事件全部恢复')
  await again.getByText(`已从本机照片库恢复 ${files.length} 张照片`).waitFor()
  // Restored previews render as images
  const decoded = await again.evaluate(async () => {
    const { loadMemory } = await import(performance.getEntriesByType('resource').map((entry) => entry.name).find((url) => url.includes('/src/lib/storage.ts')))
    const { assets } = await loadMemory()
    const sizes = await Promise.all(assets.map((asset) => new Promise((resolve) => { const img = new Image(); img.onload = () => resolve(img.naturalWidth); img.onerror = () => resolve(0); img.src = asset.preview })))
    return sizes.filter((width) => width > 0).length
  })
  assert.equal(decoded, files.length, '恢复的预览图都能显示')
  // Originals come back on demand and are cached locally again
  const firstId = vault.state.memory.assets[0].id
  const original = await again.evaluate(async (id) => {
    const { getFile } = await import(performance.getEntriesByType('resource').map((entry) => entry.name).find((url) => url.includes('/src/lib/storage.ts')))
    const file = await getFile(id)
    return file && { name: file.name, size: file.size }
  }, firstId)
  assert.equal(original?.size, vault.originals.get(firstId).body.length, '原图从照片库取回')
  assert.equal(original.name, decodeURIComponent(vault.originals.get(firstId).name))
  await again.waitForTimeout(1500)
  assert.equal(vault.state.memory.assets.length, files.length, '恢复后的备份不应丢照片')
  assert.ok(calls.filter((call) => call.startsWith('PUT /api/vault/state')).length >= putsBefore)
  assert.deepEqual(errors, [])
  await second.close()
  console.log(`Vault restore test passed: ${files.length} photos and ${events} events backed up, restored after clearing site data, originals fetched on demand.`)
} finally {
  await browser.close()
}

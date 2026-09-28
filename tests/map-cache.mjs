// Map persistence: after one visit, AMap tiles, imagery and terrain come from the browser's cache
// (public/map-cache-sw.js) instead of being loaded again. Needs `npm run dev` and the AMap keys.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

process.loadEnvFile(new URL('../.env', import.meta.url))
const BASE = process.env.BASE_URL || 'http://localhost:5183/'
const key = process.env.AMAP_JS_KEY
const code = process.env.AMAP_JS_SECURITY_CODE
if (!key || !code) { console.log('跳过：.env 中没有 AMAP_JS_KEY / AMAP_JS_SECURITY_CODE'); process.exit(0) }

const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const errors = []
// Context routes also see the service worker's own requests
await context.route('**/api/auth/me', (route) => route.fulfill({ json: { user: { id: 'map-cache-test', username: '测试', createdAt: '2026-09-28T00:00:00Z', privacyAccepted: true } } }))
await context.route('**/api/config', (route) => route.fulfill({ json: { available: true, mode: 'model', message: '测试', geocode: false, amapJsKey: key } }))
await context.route('**/api/vault/**', (route) => route.request().method() === 'GET' && route.request().url().endsWith('/assets') ? route.fulfill({ json: { previews: [], originals: [] } }) : route.request().method() === 'GET' ? route.fulfill({ json: { memory: null, extras: {} } }) : route.fulfill({ json: { ok: true } }))
await context.route('**/_AMapService/**', async (route) => {
  const url = new URL(route.request().url())
  const targets = [['/_AMapService/v4/map/styles', 'https://webapi.amap.com/v4/map/styles'], ['/_AMapService/v3/vectormap', 'https://fmap01.amap.com/v3/vectormap'], ['/_AMapService/', 'https://restapi.amap.com/']]
  const [prefix, target] = targets.find(([p]) => url.pathname.startsWith(p))
  url.searchParams.set('jscode', code)
  try {
    const upstream = await fetch(`${target}${url.pathname.slice(prefix.length)}?${url.searchParams}`, { signal: AbortSignal.timeout(15000) })
    await route.fulfill({ status: upstream.status, contentType: upstream.headers.get('content-type') || undefined, body: Buffer.from(await upstream.arrayBuffer()) })
  } catch { await route.fulfill({ status: 502, body: '' }).catch(() => {}) }
})

// The cartoon ground's tiles (the map's own tiles are only the camera's; no satellite or terrain tiles now)
const tile = (url) => /\/api\/cartoon-tiles\//.test(url)
async function visit(page) {
  const seen = { network: 0, cache: 0 }
  page.on('response', (response) => {
    if (!tile(response.url())) return
    if (response.fromServiceWorker()) seen.cache++
    else seen.network++
  })
  await page.goto(BASE, { waitUntil: 'load' })
  await page.evaluate(() => navigator.serviceWorker.ready)
  // Walk from the globe into the street map so tiles are requested
  await page.locator('.life-globe-canvas').waitFor({ timeout: 20000 })
  const box = await page.locator('.life-globe-canvas').boundingBox()
  // Off-centre: with no photos yet the empty-state card covers the middle
  await page.mouse.move(box.x + box.width * 0.82, box.y + box.height * 0.3)
  for (let i = 0; i < 40 && !(await page.locator('.life-map-globe.away').count()); i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(120) }
  await page.locator('.life-map-globe.away').waitFor({ state: 'attached', timeout: 5000 })
  await page.waitForTimeout(6000)
  return seen
}

try {
  const first = await context.newPage()
  first.on('pageerror', (error) => errors.push(error.message))
  await first.goto(BASE, { waitUntil: 'load' })
  // The first page load installs the worker; it controls the page from the next load on
  await first.evaluate(() => navigator.serviceWorker.ready)
  const one = await visit(first)
  const saved = await first.evaluate(async () => (await (await caches.open('pw-map-v1')).keys()).map((request) => new URL(request.url).hostname + new URL(request.url).pathname))
  assert.ok(saved.filter((k) => /cartoon-tiles/.test(k)).length >= 10, `卡通地面瓦片存进了浏览器缓存（${saved.length} 条）`)
  assert.ok(!saved.some((k) => /log/.test(k)), '日志请求不缓存')
  assert.ok(saved.every((k) => !/webst0\d|vdata0\d/.test(k)), '不同编号的服务器共用一条缓存')
  await first.close()

  const second = await context.newPage()
  second.on('pageerror', (error) => errors.push(error.message))
  const two = await visit(second)
  assert.ok(two.cache > 0, `再次打开时瓦片来自本地（本地 ${two.cache}，网络 ${two.network}）`)
  assert.ok(two.network < Math.max(1, one.network), `再次打开时网络请求明显减少（${one.network} → ${two.network}）`)
  assert.deepEqual(errors, [])
  console.log(`Map cache test passed: ${saved.length} entries saved; second visit ${two.cache} tiles from the browser, ${two.network} from the network (first visit ${one.network}).`)
} finally {
  await browser.close()
}

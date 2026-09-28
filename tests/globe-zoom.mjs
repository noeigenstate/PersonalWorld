// Continuous zoom between the globe and the real street map: wheel in on the globe until the AMap
// map carries on from the same point and scale, then wheel out until the globe comes back there.
// Also: the globe keeps north up, and scrubbing the time bar changes how many photos the map shows.
// Needs `npm run dev` and the AMap keys in .env (network access).
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { makeLifeFixtures } from './fixtures.mjs'

process.loadEnvFile(new URL('../.env', import.meta.url))
const BASE = process.env.BASE_URL || 'http://localhost:5183/'
const key = process.env.AMAP_JS_KEY
const code = process.env.AMAP_JS_SECURITY_CODE
if (!key || !code) { console.log('跳过：.env 中没有 AMAP_JS_KEY / AMAP_JS_SECURITY_CODE'); process.exit(0) }
const shots = process.env.SMOKE_SHOTS || tmpdir()

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
await page.route('**/api/auth/me', (route) => route.fulfill({ json: { user: { id: 'globe-zoom-test', username: '测试', createdAt: '2026-09-28T00:00:00Z', privacyAccepted: true } } }))
await page.route('**/api/config', (route) => route.fulfill({ json: { available: true, mode: 'model', message: '测试', geocode: false, amapJsKey: key } }))
await page.route('**/api/photo-card', (route) => route.fulfill({ status: 503, json: { error: '测试中不生成信息卡' } }))
// Events analyze themselves; a real 401 here (mocked session) would sign the test out
await page.route('**/api/analyze', (route) => route.fulfill({ status: 503, json: { error: '测试中不分析事件' } }))
await page.route('**/api/vault/**', (route) => route.request().method() === 'GET' && route.request().url().endsWith('/assets') ? route.fulfill({ json: { previews: [], originals: [] } }) : route.request().method() === 'GET' ? route.fulfill({ json: { memory: null, extras: {} } }) : route.fulfill({ json: { ok: true } }))
// Same mapping as server/amap.mjs, done here so the test needs no signed-in session
await page.route('**/_AMapService/**', async (route) => {
  const url = new URL(route.request().url())
  const targets = [['/_AMapService/v4/map/styles', 'https://webapi.amap.com/v4/map/styles'], ['/_AMapService/v3/vectormap', 'https://fmap01.amap.com/v3/vectormap'], ['/_AMapService/', 'https://restapi.amap.com/']]
  const [prefix, target] = targets.find(([p]) => url.pathname.startsWith(p))
  url.searchParams.set('jscode', code)
  try {
    const upstream = await fetch(`${target}${url.pathname.slice(prefix.length)}?${url.searchParams}`, { signal: AbortSignal.timeout(15000) })
    await route.fulfill({ status: upstream.status, contentType: upstream.headers.get('content-type') || undefined, body: Buffer.from(await upstream.arrayBuffer()) })
  } catch { await route.fulfill({ status: 502, body: '' }).catch(() => {}) }
})

const globe = page.locator('.life-globe')
const center = async (el) => (await el.getAttribute('data-center')).split(',').map(Number)
const wheel = async (x, y, deltaY, times) => { await page.mouse.move(x, y); for (let i = 0; i < times; i++) { await page.mouse.wheel(0, deltaY); await page.waitForTimeout(120) } }

try {
  await page.goto(BASE, { waitUntil: 'load' })
  await page.locator('.life-globe-canvas').waitFor({ timeout: 20000 })
  const files = await makeLifeFixtures(page, mkdtempSync(join(tmpdir(), 'pw-globe-')))
  await page.getByRole('button', { name: '导入第一批影像' }).click()
  await page.locator('input[type="file"]').setInputFiles(files)
  await page.locator('.life-globe[data-place-count="4"]').waitFor({ timeout: 45000 })
  await page.waitForTimeout(1500)

  // North up: dragging turns the globe in longitude and latitude only
  const box = await page.locator('.life-globe-canvas').boundingBox()
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx - 180, cy + 90, { steps: 8 }); await page.mouse.up()
  const [q0, q1, q2, q3] = (await globe.getAttribute('data-orientation')).split(',').map(Number)
  // Roll = rotation about the view axis; with north up the local north stays in the y-z plane
  const northAfter = { x: 2 * (q0 * q1 - q3 * q2), y: 1 - 2 * (q0 * q0 + q2 * q2) }
  assert.ok(Math.abs(northAfter.x) < 1e-3, `拖动后北方仍朝上（x 分量 ${northAfter.x}）`)
  await page.getByRole('button', { name: '回到照片区域' }).click()
  await page.screenshot({ path: join(shots, 'pw-globe-0-earth.png') })

  // Wheel in: the globe zooms continuously, then the street map carries on
  const startAltitude = Number(await globe.getAttribute('data-altitude'))
  const before = await center(globe)
  const altitudes = []
  for (let i = 0; i < 40 && !(await page.locator('.life-map-globe.away').count()); i++) {
    await wheel(cx, cy, -120, 1)
    altitudes.push(Number(await globe.getAttribute('data-altitude')))
  }
  await page.locator('.life-map-globe.away').waitFor({ state: 'attached', timeout: 5000 })
  assert.ok(altitudes.length >= 4, `地球仪先连续放大几步再交给街区地图（${altitudes.length} 步）`)
  assert.ok(altitudes.every((a, i) => i === 0 || a <= altitudes[i - 1] + 1e-6) && altitudes.at(-1) < startAltitude, '高度一路下降')
  const amap = page.locator('.life-map.life-map-layer')
  await page.waitForTimeout(800)
  const handZoom = Number(await amap.getAttribute('data-zoom'))
  // The hand-over is close (HANDOFF_ALTITUDE ≈ 500 km of view): the street map starts at city scale
  assert.ok(handZoom > 7.2 && handZoom < 8.8, `街区地图从城市尺度接手（${handZoom} 级）`)
  assert.equal(await globe.getAttribute('data-detail'), 'on', '交接前地球已经换上局部高清贴图')
  const [mlng, mlat] = await center(amap)
  assert.ok(Math.abs(mlng - before[0]) < 3 && Math.abs(mlat - before[1]) < 3, `接手时仍对着同一处（地球 ${before}，地图 ${mlng},${mlat}）`)
  assert.equal(await page.locator('.app-shell.globe-mode').count(), 0)
  await page.screenshot({ path: join(shots, 'pw-globe-1-handed-over.png') })

  // Keep going in on the street map, then back out past the country scale: the globe returns there
  await wheel(cx, cy, -120, 4)
  await page.waitForTimeout(800)
  const deeper = Number(await amap.getAttribute('data-zoom'))
  assert.ok(deeper > handZoom, `街区地图继续放大（${handZoom} → ${deeper}）`)
  for (let i = 0; i < 30 && (await page.locator('.life-map-globe.away').count()); i++) await wheel(cx, cy, 160, 1)
  await page.locator('.life-map-globe:not(.away)').waitFor({ timeout: 5000 })
  const [glng, glat] = await center(globe)
  const [alng, alat] = await center(amap)
  assert.ok(Math.abs(glng - alng) < 3 && Math.abs(glat - alat) < 3, `地球回到地图所在处（地图 ${alng},${alat}，地球 ${glng},${glat}）`)
  assert.ok(Number(await globe.getAttribute('data-altitude')) > 0.16, '回到地球时高度高于交接点（HANDOFF_ALTITUDE），不会立刻又切走')
  await page.locator('.app-shell.globe-mode').waitFor()

  // Time bar: scrubbing back hides photos taken later
  const photoTotal = async () => (await page.locator('.life-map-globe .map-photo').evaluateAll((els) => els.map((el) => Number(el.querySelector('b')?.textContent || 1)))).reduce((a, b) => a + b, 0)
  const all = await photoTotal()
  const track = await page.locator('.timebar .track, .timebar [role="slider"]').first().boundingBox()
  await page.mouse.click(track.x + track.width * 0.3, track.y + track.height / 2)
  await page.waitForTimeout(600)
  const early = await photoTotal()
  assert.ok(early < all, `拖到较早的时间，地图上的照片变少（${all} → ${early}）`)
  await page.mouse.click(track.x + track.width - 2, track.y + track.height / 2)
  await page.waitForTimeout(600)
  assert.equal(await photoTotal(), all, '拖到最后，照片全部回来')
  await page.screenshot({ path: join(shots, 'pw-globe-2-back.png') })
  assert.deepEqual(errors, [])
  console.log(`Globe zoom test passed: ${altitudes.length} globe steps, street map took over at zoom ${handZoom}, zoomed to ${deeper}, back to the globe at the same place; time bar ${all} → ${early} photos.`)
} finally {
  await browser.close()
}

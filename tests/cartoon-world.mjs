// The cartoon world on the real map: from the globe down to a street, everything drawn is the
// locally built cartoon (no satellite or AMap base map), with woods, water, streets, buildings.
// Needs `npm run dev` and the AMap keys in .env (network access for tiles not yet built).
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
const tileAnswers = []
page.on('response', (response) => { if (response.url().includes('/api/cartoon-tiles/')) tileAnswers.push(response.status()) })
await page.route('**/api/auth/me', (route) => route.fulfill({ json: { user: { id: 'cartoon-world-test', username: '测试', createdAt: '2026-09-28T00:00:00Z', privacyAccepted: true } } }))
await page.route('**/api/config', (route) => route.fulfill({ json: { available: true, mode: 'model', message: '测试', geocode: false, amapJsKey: key } }))
await page.route('**/api/photo-card', (route) => route.fulfill({ status: 503, json: { error: '测试中不生成信息卡' } }))
await page.route('**/api/vault/**', (route) => route.request().method() === 'GET' && route.request().url().endsWith('/assets') ? route.fulfill({ json: { previews: [], originals: [] } }) : route.request().method() === 'GET' ? route.fulfill({ json: { memory: null, extras: {} } }) : route.fulfill({ json: { ok: true } }))
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

const street = page.locator('.life-map.life-map-layer')
const stats = async () => {
  const text = (await street.getAttribute('data-cartoon')) || ''
  const num = (name) => Number((text.match(new RegExp(`${name}:(\\d+)`)) || [])[1] || 0)
  return { text, tiles: Number((text.match(/^(\d+) tiles/) || [])[1] || 0), zoom: Number((text.match(/ z(\d+)/) || [])[1] || 0), buildings: num('buildings'), trees: num('trees'), crossings: num('crossings') }
}
const settle = async (predicate, timeout = 45000) => { const end = Date.now() + timeout; let s; while (Date.now() < end) { s = await stats(); if (predicate(s)) return s; await page.waitForTimeout(500) } return s }

try {
  await page.goto(BASE, { waitUntil: 'load' })
  await page.locator('.life-globe-canvas').waitFor({ timeout: 20000 })
  const files = await makeLifeFixtures(page, mkdtempSync(join(tmpdir(), 'pw-cartoon-')))
  await page.getByRole('button', { name: '导入第一批影像' }).click()
  await page.locator('input[type="file"]').setInputFiles(files)
  await page.locator('.life-globe[data-place-count="4"]').waitFor({ timeout: 45000 })
  assert.equal(await page.locator('.life-map-amap').evaluate((el) => getComputedStyle(el).opacity), '0', '高德底图不显示，只用它的相机')

  // Globe → country scale
  const box = await page.locator('.life-globe-canvas').boundingBox()
  await page.mouse.move(box.x + box.width * 0.82, box.y + box.height * 0.3)
  for (let i = 0; i < 40 && !(await page.locator('.life-map-globe.away').count()); i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(120) }
  await page.locator('.life-map-globe.away').waitFor({ state: 'attached', timeout: 5000 })
  const country = await settle((s) => s.tiles >= 10)
  assert.ok(country.tiles >= 10, `全国尺度的卡通地面已铺开（${country.text}）`)
  await page.screenshot({ path: join(shots, 'pw-cartoon-1-country.png') })

  // A city
  await page.locator('.map-label.place:visible').filter({ hasText: '杭州' }).first().click()
  await page.locator('.subtitle.bot').waitFor()
  const city = await settle((s) => s.zoom >= 10 && s.tiles >= 20)
  await page.screenshot({ path: join(shots, 'pw-cartoon-2-city.png') })
  // Close-up of the story's event marker
  const marker = await page.locator('.map-label.event:visible').first().boundingBox()
  if (marker) await page.screenshot({ path: join(shots, 'pw-cartoon-2b-marker.png'), clip: { x: Math.max(0, marker.x - 60), y: Math.max(0, marker.y - 20), width: 280, height: 200 } })
  assert.ok(city.zoom >= 10, `城市尺度用精细瓦片（${city.text}）`)

  // Down to the street: buildings from real footprints, trees, zebra crossings
  // Straight on from the city view (closing the butler would frame the whole life again)
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.68)
  for (let i = 0; i < 24; i++) { await page.mouse.wheel(0, -160); await page.waitForTimeout(150) }
  const streetLevel = await settle((s) => s.zoom >= 14 && s.buildings > 0, 60000)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: join(shots, 'pw-cartoon-3-street.png') })
  assert.ok(streetLevel.zoom >= 14 && streetLevel.buildings > 0, `街道尺度有按真实轮廓的建筑（${streetLevel.text}）`)
  assert.ok(streetLevel.trees > 0, `有树（${streetLevel.text}）`)
  // Tilted over a wetland (Xixi, many shores): the cliffs hang below the shores, none stand on the land
  await page.evaluate(() => { const map = window.__amap; map.setPitch(55, true); map.setZoomAndCenter(15.6, [120.075, 30.268], true) })
  await settle((s) => s.zoom >= 15 && s.tiles >= 20, 60000)
  await page.waitForTimeout(2500)
  await page.screenshot({ path: join(shots, 'pw-cartoon-4-shores.png') })
  // A tile whose source is slow answers 503 and is asked for again a few seconds later
  const ok = tileAnswers.filter((s) => s === 200).length
  assert.ok(tileAnswers.length && ok / tileAnswers.length >= 0.9, `卡通瓦片大都构建成功（${ok}/${tileAnswers.length}）`)
  assert.deepEqual(errors, [])
  console.log(`Cartoon world test passed: country ${country.text}; city ${city.text}; street ${streetLevel.text}.`)
} finally {
  await browser.close()
}

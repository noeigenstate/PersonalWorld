// Real AMap check: loads the JS API with the keys in .env, geocodes the fixture photos with the
// browser geocoder and draws the life map on the real 3D base map. Needs network access.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { makeLifeFixtures } from './fixtures.mjs'

process.loadEnvFile(new URL('../.env', import.meta.url))
// npm run dev → http://localhost:5183/; npm run dev:lan → BASE_URL=https://localhost:5183/
const BASE = process.env.BASE_URL || 'http://localhost:5183/'
const key = process.env.AMAP_JS_KEY
const code = process.env.AMAP_JS_SECURITY_CODE
if (!key || !code) { console.log('跳过：.env 中没有 AMAP_JS_KEY / AMAP_JS_SECURITY_CODE'); process.exit(0) }

const shots = process.env.SMOKE_SHOTS || tmpdir()
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

await page.route('**/api/auth/me', (route) => route.fulfill({ json: { user: { id: 'amap-test', username: '测试', createdAt: '2026-09-24T00:00:00Z', privacyAccepted: true } } }))
await page.route('**/api/config', (route) => route.fulfill({ json: { available: false, mode: 'unconfigured', message: '测试', geocode: false, amapJsKey: key } }))
// Same mapping as server/amap.mjs, done here so the test needs no signed-in session
await page.route('**/_AMapService/**', async (route) => {
  const url = new URL(route.request().url())
  const targets = [['/_AMapService/v4/map/styles', 'https://webapi.amap.com/v4/map/styles'], ['/_AMapService/v3/vectormap', 'https://fmap01.amap.com/v3/vectormap'], ['/_AMapService/', 'https://restapi.amap.com/']]
  const [prefix, target] = targets.find(([p]) => url.pathname.startsWith(p))
  url.searchParams.set('jscode', code)
  const upstream = await fetch(`${target}${url.pathname.slice(prefix.length)}?${url.searchParams}`)
  await route.fulfill({ status: upstream.status, contentType: upstream.headers.get('content-type') || undefined, body: Buffer.from(await upstream.arrayBuffer()) })
})

try {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.locator('.life-map-amap .amap-layer, .life-map-amap canvas').first().waitFor({ timeout: 20000 })
  const files = await makeLifeFixtures(page, mkdtempSync(join(tmpdir(), 'pw-amap-')))
  await page.getByRole('button', { name: '导入第一批影像' }).click()
  await page.locator('input[type="file"]').setInputFiles(files)
  await page.locator('.map-label.place').nth(3).waitFor({ timeout: 30000 })
  const names = (await page.locator('.map-label.place strong').allInnerTexts()).map((t) => t.split(' · ')[0]).sort()
  assert.deepEqual(names, ['上海', '杭州', '武汉', '湘潭'], '高德浏览器端地理编码应识别出四个城市')
  await page.waitForTimeout(2500)
  await page.screenshot({ path: join(shots, 'pw-amap-1-overview.png') })

  await page.locator('.map-label.place').filter({ hasText: '上海' }).click()
  await page.locator('.butler').waitFor()
  await page.waitForTimeout(2500)
  assert.ok(await page.locator('.map-label.event').count() >= 5, '上海的故事线节点')
  await page.screenshot({ path: join(shots, 'pw-amap-2-story.png') })
  assert.equal(errors.length, 0, `浏览器运行时不应报错：${errors.join('; ')}`)
  console.log('AMap test passed: JS API through the security proxy, browser geocoding, life map and story line on the real base map.')
} finally {
  await browser.close()
}

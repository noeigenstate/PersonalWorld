// Screenshots of the main surfaces for design review: node tests/ui-shots.mjs <outDir>
// (needs npm run dev; W/H set the viewport; REAL_MAP=1 uses the real AMap map)
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { fakeGeocode, makeLifeFixtures } from './fixtures.mjs'

const out = process.argv[2]
mkdirSync(out, { recursive: true })
const BASE = process.env.BASE_URL || 'http://localhost:5183/'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
let signedIn = false
async function setup(context) {
  const user = { user: { id: 'shots-user-1', username: '小丁', createdAt: '2026-09-28T00:00:00Z', privacyAccepted: true } }
  await context.route('**/api/auth/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/me')) return signedIn ? route.fulfill({ json: user }) : route.fulfill({ status: 401, json: {} })
    signedIn = true
    return route.fulfill({ json: user })
  })
  await context.route('**/api/vault/**', (route) => route.request().method() === 'GET' && route.request().url().endsWith('/assets') ? route.fulfill({ json: { previews: [], originals: [] } }) : route.request().method() === 'GET' ? route.fulfill({ json: { memory: null, extras: {} } }) : route.fulfill({ json: { ok: true } }))
  // REAL_MAP=1 keeps the real /api/config so AMap loads with the key in .env
  if (!process.env.REAL_MAP) await context.route('**/api/config', (route) => route.fulfill({ json: { available: true, mode: 'model', message: '模拟', geocode: true } }))
  await context.route('**/api/geocode', (route) => route.fulfill({ json: { results: route.request().postDataJSON().points.map(fakeGeocode) } }))
  await context.route('**/api/photo-card', (route) => route.fulfill({ json: { title: '外滩的傍晚', caption: '江边的灯刚亮起来。', scene: '江边步道', visibleText: '', clues: [{ kind: '地标', evidence: '东方明珠', inference: '上海外滩', confidence: 0.8 }], landmark: null, placeQuery: null, eventGuess: { type: '旅行', reason: '' }, tags: ['夜景', '江边'], questions: ['那天和谁一起？'] } }))
  await context.route('**/api/butler', (route) => route.fulfill({ json: { answer: '那是你第一次来上海，你们去了〔外滩〕。', eventIds: [], assetIds: [], actions: [] } }))
  await context.route('**/api/analyze', (route) => route.fulfill({ json: { title: '', summary: '', type: '', place: '', city: '', people: [], visibleText: '', tags: [], questions: [], confidence: 0.5 } }))
}
const width = Number(process.env.W || 1440), height = Number(process.env.H || 900)
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })
await setup(context)
const page = await context.newPage()
async function chooseGlobeCity(name) {
  const single = page.locator('.globe-place').filter({ hasText: name })
  if (await single.count()) return single.first().click()
  await page.locator('.globe-cluster').filter({ hasText: name }).first().click()
  await page.getByRole('dialog', { name: '选择地点' }).getByRole('button', { name: new RegExp(name) }).click()
}
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
await page.screenshot({ path: join(out, '0-auth.png') })
await page.locator('#auth-username').fill('小丁')
await page.locator('#auth-password').fill('secret12')
await page.locator('#auth-consent').check()
await page.locator('.auth-submit').click()
await page.getByRole('heading', { name: '从照片开始，画出你的人生地图' }).waitFor()
await page.waitForTimeout(1500)
await page.screenshot({ path: join(out, '1-empty.png') })
const files = await makeLifeFixtures(page, mkdtempSync(join(tmpdir(), 'pw-shots-')))
await page.getByRole('button', { name: '导入第一批影像' }).click()
await page.waitForTimeout(300)
await page.screenshot({ path: join(out, '2-import.png') })
await page.locator('input[type="file"]').setInputFiles(files)
await page.locator('.life-globe[data-place-count="4"]').waitFor()
await page.waitForTimeout(4000)
await page.screenshot({ path: join(out, '3-overview.png') })
if (width > 700) {
  await page.mouse.move(410, 450)
  await page.mouse.down()
  await page.mouse.move(1050, 450, { steps: 14 })
  await page.mouse.up()
  await page.screenshot({ path: join(out, '3-overview-rotated.png') })
  await page.getByRole('button', { name: '回到照片区域' }).click()
}
// How bubbles look zoomed out (the AMap map picks the level from its zoom)
for (const level of ['brief', 'name']) {
  await page.evaluate((level) => document.querySelectorAll('.map-label.place').forEach((el) => { el.dataset.detail = level }), level)
  await page.screenshot({ path: join(out, `3-overview-${level}.png`), clip: { x: 0, y: 60, width: width, height: 560 } })
}
await page.evaluate(() => document.querySelectorAll('.map-label.place').forEach((el) => { el.dataset.detail = 'full' }))
await chooseGlobeCity('上海')
await page.locator('.subtitle.bot').waitFor()
await page.waitForTimeout(4000)
await page.screenshot({ path: join(out, '4-butler.png') })
const photo = page.locator('.map-photo').first()
if (await photo.count()) {
  await photo.click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: join(out, '5-photo.png') })
}
await browser.close()
console.log('shots in', out)

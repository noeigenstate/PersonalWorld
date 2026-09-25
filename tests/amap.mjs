// Real AMap check: loads the JS API with the keys in .env, geocodes the fixture photos with the
// browser geocoder and draws the life map on the real 3D base map. Needs network access.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
const consoleLog = []
page.on('console', (m) => consoleLog.push(`${m.type()}: ${m.text().slice(0, 200)}`))

await page.route('**/api/auth/me', (route) => route.fulfill({ json: { user: { id: 'amap-test', username: '测试', createdAt: '2026-09-24T00:00:00Z', privacyAccepted: true } } }))
await page.route('**/api/config', (route) => route.fulfill({ json: { available: true, mode: 'model', message: '测试', geocode: false, amapJsKey: key } }))
// The card itself is mocked; what is tested here is the map search that follows it.
// Only the landmark photo "recognises" something; other photos without GPS find nothing.
const cardRequests = []
await page.route('**/api/photo-card', (route) => {
  const fileName = route.request().postDataJSON().facts.fileName
  cardRequests.push(fileName)
  const landmark = fileName === 'pearl-a.jpg'
  return route.fulfill({ json: { title: landmark ? '东方明珠' : '夜晚的截图', caption: '', scene: landmark ? '电视塔' : '室内', visibleText: '', clues: [], landmark: landmark ? { name: '东方明珠', city: '上海市', confidence: 0.95 } : null, placeQuery: landmark ? { text: '东方明珠', city: '上海市', from: 'landmark', confidence: 0.9 } : null, eventGuess: { type: '旅行', reason: '' }, tags: [], questions: [] } })
})
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
  // Photo layer: thumbnails clustered with a count, like a phone album's map
  await page.locator('.map-photo b').first().waitFor({ timeout: 20000 })
  const counts = (await page.locator('.map-photo b').allInnerTexts()).map(Number)
  assert.ok(counts.length >= 3 && counts.every((n) => n > 1), `缩小时照片按位置聚合并显示张数：${counts}`)
  assert.equal(await page.locator('.map-photo.inferred').count(), 0, '有 GPS 的照片不显示为推断')
  await page.screenshot({ path: join(shots, 'pw-amap-1-overview.png') })
  // The map's Shanghai preview works before any photo card has identified the landmark.
  await page.getByRole('button', { name: '查看上海地标样例' }).click()
  await page.locator('.map-scene-caption').getByText('高德地标位置').waitFor({ timeout: 15000 }).catch((error) => {
    throw new Error(`Shanghai preview did not appear. Browser errors: ${errors.join('; ') || 'none'}. Recent console: ${consoleLog.slice(-5).join('; ')}`, { cause: error })
  })
  await page.locator('.map-scene-source').waitFor({ state: 'visible', timeout: 15000 })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: join(shots, 'pw-amap-shanghai-preview.png') })
  // Leave street zoom and return with the mouse wheel: the scene must come back without
  // clicking a photo card or the preview button again.
  await page.mouse.move(710, 450)
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 600); await page.waitForTimeout(250) }
  await page.locator('.map-scene-caption').waitFor({ state: 'hidden', timeout: 10000 })
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -600); await page.waitForTimeout(250) }
  await page.locator('.map-scene-caption').getByText('高德地标位置').waitFor({ timeout: 15000 })
  await page.screenshot({ path: join(shots, 'pw-amap-manual-zoom.png') })
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.map-label.place').nth(3).waitFor({ timeout: 30000 })
  // The one fixture photo without GPS was read automatically and found nothing to place it by
  await page.waitForFunction(() => !document.querySelector('.locating-chip'), null, { timeout: 30000 })
  assert.deepEqual(cardRequests, ['IMG_029.jpg'], '没有 GPS 的照片自动生成信息卡，有 GPS 的不需要')

  await page.locator('.map-label.place').filter({ hasText: '上海' }).click()
  await page.locator('.butler').waitFor()
  await page.waitForTimeout(2500)
  assert.ok(await page.locator('.map-label.event').count() >= 5, '上海的故事线节点')
  await page.screenshot({ path: join(shots, 'pw-amap-2-story.png') })

  // Location chain, level 1: a GPS photo is resolved to street level or finer
  await page.locator('.map-label.event').filter({ hasText: '2019.10' }).click()
  await page.locator('.photo-open').first().click()
  const gpsPlace = page.locator('.pc-facts div').filter({ hasText: '地点' })
  await gpsPlace.getByText('来自照片自带的 GPS').waitFor({ timeout: 45000 }).catch(async (error) => {
    console.log('place row:', await gpsPlace.innerText().catch(() => '?'))
    console.log('toast:', await page.getByRole('status').allInnerTexts().catch(() => []))
    console.log(consoleLog.filter((l) => !l.startsWith('log')).slice(-10).join(' || '))
    await page.screenshot({ path: join(shots, 'pw-amap-debug.png') })
    throw error
  })
  assert.match(await gpsPlace.innerText(), /精确到(门牌|地点|街道)/)
  assert.match(await gpsPlace.innerText(), /上海/)
  console.log('GPS photo resolved to:', (await gpsPlace.locator('dd').innerText()).split(String.fromCharCode(10)).join(' | '))
  await page.getByRole('button', { name: '在地图上看' }).click()
  await page.locator('.map-scene-caption').getByText('照片地点 · 玩具小景示意').waitFor({ timeout: 10000 }).catch(async (error) => {
    await page.screenshot({ path: join(shots, 'pw-amap-generic-debug.png') })
    console.log('generic caption:', await page.locator('.map-scene-caption').evaluate((element) => ({ hidden: element.hidden, text: element.innerText, style: element.style.transform })))
    console.log('browser errors:', errors)
    throw error
  })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: join(shots, 'pw-amap-generic-scene.png') })
  if (await page.getByRole('button', { name: '关闭影像' }).isVisible().catch(() => false)) await page.getByRole('button', { name: '关闭影像' }).click()
  if (await page.getByRole('button', { name: '关闭事件详情' }).isVisible().catch(() => false)) await page.getByRole('button', { name: '关闭事件详情' }).click()

  // Level 2, automatic: a photo without GPS is read on import; its landmark places it on the map
  await page.getByRole('button', { name: '关闭人生管家' }).click()
  await page.getByRole('button', { name: '导入影像' }).click()
  await page.locator('input[type="file"]').setInputFiles(fileURLToPath(new URL('../skills/photo-context/evals/2026-09-24/images/pearl-a.jpg', import.meta.url)))
  await page.getByRole('status').getByText(/已导入 1 个影像/).waitFor({ timeout: 30000 })
  await page.waitForFunction(() => document.querySelector('.locating-chip'), null, { timeout: 15000 }).catch(() => undefined)
  await page.waitForFunction(() => !document.querySelector('.locating-chip'), null, { timeout: 60000 })
  assert.deepEqual(cardRequests, ['IMG_029.jpg', 'pearl-a.jpg'], '新导入的无 GPS 照片自动生成信息卡')
  // The file has no EXIF, so it is the newest event: the last dot on the time bar
  await page.locator('.timebar .dot').last().click()
  await page.locator('.photo-open').first().click()
  const landmarkPlace = page.locator('.pc-facts div').filter({ hasText: '地点' })
  await landmarkPlace.getByText('画面中认出地标，经高德地点搜索定位').waitFor({ timeout: 20000 })
  assert.match(await landmarkPlace.innerText(), /东方明珠/)
  assert.match(await landmarkPlace.innerText(), /画面中认出「东方明珠」/)
  console.log('Landmark photo resolved to:', (await landmarkPlace.locator('dd').innerText()).split(String.fromCharCode(10)).join(' | '))
  await page.screenshot({ path: join(shots, 'pw-amap-3-landmark.png') })

  // "Show on map": the map flies in to building level and the photo stands out, drawn as inferred
  await page.getByRole('button', { name: '在地图上看' }).click()
  const focused = page.locator('.map-photo.focused.inferred[aria-label="打开照片 pearl-a.jpg"]')
  await focused.waitFor({ timeout: 20000 })
  await page.waitForTimeout(2500)
  const sceneCaption = page.locator('.map-scene-caption')
  await sceneCaption.getByText('东方明珠 · 风格化地标').waitFor({ timeout: 10000 })
  assert.equal(await sceneCaption.isVisible(), true, '照片识别的地标应出现可辨认的记忆场景')
  await page.screenshot({ path: join(shots, 'pw-amap-4-focus.png') })
  const buildingToggle = page.getByRole('button', { name: /3D 记忆场景/ })
  assert.equal(await buildingToggle.getAttribute('aria-pressed'), 'true')
  await buildingToggle.click()
  assert.equal(await buildingToggle.getAttribute('aria-pressed'), 'false')
  assert.equal(await sceneCaption.isVisible(), false)
  assert.equal(await page.locator('.map-scene-source').isVisible(), false)
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(shots, 'pw-amap-5-scene-off.png') })
  await buildingToggle.click()
  assert.equal(await buildingToggle.getAttribute('aria-pressed'), 'true')
  assert.equal(await sceneCaption.isVisible(), true)
  assert.equal(await page.locator('.map-scene-source').isVisible(), true)
  await page.waitForTimeout(350)
  await page.screenshot({ path: join(shots, 'pw-amap-6-scene-on.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(700)
  await page.screenshot({ path: join(shots, 'pw-amap-7-scene-mobile.png') })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(500)
  const beforeDrag = await sceneCaption.evaluate((element) => element.style.transform)
  await page.mouse.move(520, 580)
  await page.mouse.down()
  await page.mouse.move(490, 605, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  assert.notEqual(await sceneCaption.evaluate((element) => element.style.transform), beforeDrag, '记忆场景应跟随地图拖动')
  await focused.click()
  await page.locator('.photo-card').getByText('画面中认出地标，经高德地点搜索定位').waitFor({ timeout: 10000 })
  assert.equal(errors.length, 0, `浏览器运行时不应报错：${errors.join('; ')}`)
  console.log('AMap test passed: security proxy, geocoding, life map, story line, photo clusters, GPS → street number, automatic landmark locating, Shanghai preview without a photo card, manual zoom scene recovery, scene comparison, map dragging.')
  assert.equal(consoleLog.filter((item) => /error: THREE\.WebGLProgram: Shader Error/i.test(item)).length, 0, '地图场景着色器应在真实浏览器中编译成功')
} finally {
  await browser.close()
}

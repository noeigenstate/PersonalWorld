// Real AMap check: loads the JS API with the keys in .env, geocodes the fixture photos with the
// browser geocoder and draws the life map on the real 3D base map. Needs network access.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { makeLifeFixtures } from './fixtures.mjs'
import { mapSceneForPoint } from '../server/mapScene.mjs'

process.loadEnvFile(new URL('../.env', import.meta.url))
// npm run dev → http://localhost:5183/; npm run dev:lan → BASE_URL=https://localhost:5183/
const BASE = process.env.BASE_URL || 'http://localhost:5183/'
const key = process.env.AMAP_JS_KEY
const code = process.env.AMAP_JS_SECURITY_CODE
if (!key || !code) { console.log('跳过：.env 中没有 AMAP_JS_KEY / AMAP_JS_SECURITY_CODE'); process.exit(0) }

const shots = process.env.SMOKE_SHOTS || tmpdir()
const browser = await chromium.launch({ channel: 'chrome' })
// Map tiles here go through the routes below, not the map cache (tests/map-cache.mjs covers that)
const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const consoleLog = []
page.on('console', (m) => consoleLog.push(`${m.type()}: ${m.text().slice(0, 200)}`))
async function chooseGlobeCity(name) {
  const single = page.locator('.globe-place').filter({ hasText: name })
  if (await single.count()) return single.first().click()
  await page.locator('.globe-cluster').filter({ hasText: name }).first().click()
  await page.getByRole('dialog', { name: '选择地点' }).getByRole('button', { name: new RegExp(name) }).click()
}

await page.route('**/api/auth/me', (route) => route.fulfill({ json: { user: { id: 'amap-test', username: '测试', createdAt: '2026-09-24T00:00:00Z', privacyAccepted: true } } }))
await page.route('**/api/config', (route) => route.fulfill({ json: { available: true, mode: 'model', message: '测试', geocode: false, amapJsKey: key } }))
const regionRequests = []
await page.route('**/api/map-scene', async (route) => {
  const { lng, lat } = route.request().postDataJSON()
  regionRequests.push([lng, lat])
  try { await route.fulfill({ json: await mapSceneForPoint(lng, lat) }) }
  catch (error) { await route.fulfill({ status: 503, json: { error: error.message } }) }
})
// The card itself is mocked; what is tested here is the map search that follows it.
// Only the landmark photo "recognises" something; other photos without GPS find nothing.
const cardRequests = []
await page.route('**/api/photo-card', (route) => {
  const fileName = route.request().postDataJSON().facts.fileName
  cardRequests.push(fileName)
  const landmark = fileName === 'pearl-a.jpg'
  const reading = ['IMG_020.jpg', 'IMG_021.jpg', 'IMG_022.jpg'].includes(fileName)
  const classroom = fileName === 'IMG_006.jpg' || fileName === 'IMG_007.jpg'
  return route.fulfill({ json: { title: landmark ? '东方明珠' : reading ? '绘本阅读' : classroom ? '教室里上课' : '夜晚的截图', caption: '', scene: landmark ? '电视塔' : reading ? '亲子共读绘本' : classroom ? '学校教室' : '室内', visibleText: '', clues: [], landmark: landmark ? { name: '东方明珠', city: '上海市', confidence: 0.95 } : null, placeQuery: landmark ? { text: '东方明珠', city: '上海市', from: 'landmark', confidence: 0.9 } : null, eventGuess: { type: reading ? '阅读' : classroom ? '上课' : '旅行', reason: '' }, tags: [], questions: [] } })
})
// Same mapping as server/amap.mjs, done here so the test needs no signed-in session
await page.route('**/_AMapService/**', async (route) => {
  const url = new URL(route.request().url())
  const targets = [['/_AMapService/v4/map/styles', 'https://webapi.amap.com/v4/map/styles'], ['/_AMapService/v3/vectormap', 'https://fmap01.amap.com/v3/vectormap'], ['/_AMapService/', 'https://restapi.amap.com/']]
  const [prefix, target] = targets.find(([p]) => url.pathname.startsWith(p))
  url.searchParams.set('jscode', code)
  // Terrain asks for many tiles at once; a lost one must not end the test
  try {
    const upstream = await fetch(`${target}${url.pathname.slice(prefix.length)}?${url.searchParams}`, { signal: AbortSignal.timeout(15000) })
    await route.fulfill({ status: upstream.status, contentType: upstream.headers.get('content-type') || undefined, body: Buffer.from(await upstream.arrayBuffer()) })
  } catch {
    await route.fulfill({ status: 502, body: '' }).catch(() => {})
  }
})

try {
  await page.goto(BASE, { waitUntil: 'load' })
  const sceneKeyCheck = await page.evaluate(async () => {
    const { photoSceneKey } = await import('/src/map/regionScene.ts')
    const local = { id: 'local', gcj: [121.5, 31.2], sceneCard: { createdAt: '1', scene: '阅读', tags: [] } }
    const distant = { id: 'distant', gcj: [120.1, 30.2], sceneCard: { createdAt: '1', scene: '旅行', tags: [] } }
    return [photoSceneKey([local, distant], local) === photoSceneKey([local, { ...distant, sceneCard: { ...distant.sceneCard, createdAt: '2' } }], local),
      photoSceneKey([local, distant], local) === photoSceneKey([{ ...local, sceneCard: { ...local.sceneCard, createdAt: '2' } }, distant], local),
      photoSceneKey([local, { ...local, id: 'same-group' }, distant], local) === photoSceneKey([local, { ...local, id: 'same-group' }, distant], { ...local, id: 'same-group' })]
  })
  assert.deepEqual(sceneKeyCheck, [true, true, true], '信息卡更新及同组照片切换都不能重建地理场景')
  await page.locator('.life-globe-canvas').waitFor({ timeout: 20000 })
  const files = await makeLifeFixtures(page, mkdtempSync(join(tmpdir(), 'pw-amap-')))
  await page.getByRole('button', { name: '导入第一批影像' }).click()
  await page.locator('input[type="file"]').setInputFiles(files)
  await page.locator('.life-globe[data-place-count="4"]').waitFor({ timeout: 30000 })
  const names = (await page.locator('.life-globe').getAttribute('data-place-names')).split('|').sort()
  assert.deepEqual(names, ['上海', '杭州', '武汉', '湘潭'], '高德浏览器端地理编码应识别出四个城市')
  await page.waitForTimeout(2500)
  // Photo layer: thumbnails clustered with a count, like a phone album's map
  await page.locator('.map-photo b').first().waitFor({ timeout: 20000 })
  const counts = (await page.locator('.map-photo b').allInnerTexts()).map(Number)
  assert.ok(counts.length >= 1 && counts.reduce((sum, n) => sum + n, 0) === files.length - 1, `缩小时每张有定位的照片都应进入聚合：${counts}`)
  assert.equal(await page.locator('.map-photo.inferred').count(), 0, '有 GPS 的照片不显示为推断')
  await page.screenshot({ path: join(shots, 'pw-amap-1-overview.png') })
  assert.equal(await page.getByRole('button', { name: '查看上海地标样例' }).count(), 0, '导入真实定位照片后不再把公共样例当作个人区域展示')
  // A cluster must expose every photo directly, even when multiple photos share a coordinate.
  const grouped = page.locator('.map-photo:has(b)')
  let reachable
  for (const marker of await grouped.all()) {
    const box = await marker.boundingBox()
    if (box && box.x > 450 && box.y > 190 && box.y < 680) { reachable = marker; break }
  }
  assert.ok(reachable, '概览里应有一组可点击的照片')
  const groupCount = Number(await reachable.locator('b').innerText())
  await reachable.click()
  await page.locator('.map-photo-menu').waitFor({ state: 'visible' })
  assert.equal(await page.locator('.map-photo-menu-item').count(), groupCount)
  const secondName = await page.locator('.map-photo-menu-item').nth(1).locator('span').innerText()
  await page.locator('.map-photo-menu-item').nth(1).click()
  await page.locator('.photo-card .pc-file').getByText(secondName).waitFor()
  await page.getByRole('button', { name: '关闭影像' }).click()
  await page.getByRole('button', { name: '关闭事件详情' }).click()
  await page.reload({ waitUntil: 'load' })
  await page.locator('.life-globe[data-place-count="4"]').waitFor({ timeout: 30000 })
  await page.locator('.locating-chip').getByText(`已生成 ${files.length} 张照片信息卡`).waitFor({ timeout: 90000 })
  assert.equal(cardRequests.length, files.length, '有 GPS 和无 GPS 的真实导入照片都各生成一次信息卡')

  await chooseGlobeCity('上海')
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
  await page.locator('.life-map[data-scene-state="ready"]').waitFor({ timeout: 30000 }).catch(async (error) => {
    await page.screenshot({ path: join(shots, 'pw-amap-generic-debug.png') })
    console.log('generic caption:', await page.locator('.map-scene-caption').evaluate((element) => ({ hidden: element.hidden, text: element.innerText, style: element.style.transform })))
    console.log('scene requests:', regionRequests.slice(-3))
    console.log('browser errors:', errors)
    throw error
  })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: join(shots, 'pw-amap-generic-scene.png') })
  if (await page.getByRole('button', { name: '关闭影像' }).isVisible().catch(() => false)) await page.getByRole('button', { name: '关闭影像' }).click()
  if (await page.getByRole('button', { name: '关闭事件详情' }).isVisible().catch(() => false)) await page.getByRole('button', { name: '关闭事件详情' }).click()

  // The same complete renderer serves each group, before any photo theme is known.
  await page.reload({ waitUntil: 'load' })
  await chooseGlobeCity('杭州')
  await page.locator('.map-label.event').first().click()
  await page.locator('.photo-open').first().click()
  await page.getByRole('button', { name: '在地图上看' }).click()
  await page.locator('.life-map[data-scene-state="ready"]').waitFor({ timeout: 30000 })
  // The caption is drawn on the frame after the scene becomes ready
  assert.equal(await page.locator('.map-scene-caption').waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false), true, '无主题照片也有完整街区')
  assert.ok(Number(await page.locator('.life-map').getAttribute('data-scene-buildings')) > 100, '杭州应恢复完整的窗格楼群，不是少量装饰楼')
  assert.ok(regionRequests.some(([lng, lat]) => Math.abs(lng - 120.13) < .1 && Math.abs(lat - 30.26) < .1), '无主题照片也应读取地理场景')
  assert.equal(await page.locator('.map-scene-source').isVisible(), true, '有地图地景素材时显示 OSM 署名')
  await page.screenshot({ path: join(shots, 'pw-amap-hangzhou-region.png') })
  if (await page.getByRole('button', { name: '关闭影像' }).isVisible().catch(() => false)) await page.getByRole('button', { name: '关闭影像' }).click()
  if (await page.getByRole('button', { name: '关闭事件详情' }).isVisible().catch(() => false)) await page.getByRole('button', { name: '关闭事件详情' }).click()

  await page.reload({ waitUntil: 'load' })
  await chooseGlobeCity('武汉')
  await page.locator('.map-label.event').first().click()
  await page.locator('.photo-open').first().click()
  await page.getByRole('button', { name: '在地图上看' }).click()
  await page.locator('.life-map[data-scene-state="ready"]').waitFor({ timeout: 30000 }).catch(async (error) => {
    console.log('Wuhan caption:', await page.locator('.map-scene-caption').evaluate((el) => ({ hidden: el.hidden, text: el.innerText })))
    console.log('Wuhan scene requests:', regionRequests.slice(-3))
    throw error
  })
  assert.ok(regionRequests.some(([lng, lat]) => Math.abs(lng - 114.365) < .1 && Math.abs(lat - 30.54) < .1), '武汉照片区域也应独立读取地理场景数据')
  assert.ok(Number(await page.locator('.life-map').getAttribute('data-scene-buildings')) > 100, '武汉应恢复完整的窗格楼群')
  await page.waitForTimeout(3500)
  await page.screenshot({ path: join(shots, 'pw-amap-wuhan-region.png') })
  if (await page.getByRole('button', { name: '关闭影像' }).isVisible().catch(() => false)) await page.getByRole('button', { name: '关闭影像' }).click()
  if (await page.getByRole('button', { name: '关闭事件详情' }).isVisible().catch(() => false)) await page.getByRole('button', { name: '关闭事件详情' }).click()

  // Level 2, automatic: a photo without GPS is read on import; its landmark places it on the map
  await page.getByRole('button', { name: '关闭人生管家' }).click()
  await page.getByRole('button', { name: '导入影像' }).click()
  await page.locator('input[type="file"]').setInputFiles(fileURLToPath(new URL('../skills/photo-context/evals/2026-09-24/images/pearl-a.jpg', import.meta.url)))
  await page.getByRole('status').getByText(/已导入 1 个影像/).waitFor({ timeout: 30000 })
  await page.waitForFunction(() => document.querySelector('.locating-chip'), null, { timeout: 15000 }).catch(() => undefined)
  await page.locator('.locating-chip').getByText(`已生成 ${files.length + 1} 张照片信息卡`).waitFor({ timeout: 60000 })
  assert.ok(cardRequests.includes('pearl-a.jpg'), '新导入的无 GPS 照片自动生成信息卡')
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
  await page.reload({ waitUntil: 'load' })
  await page.locator('.life-globe[data-place-count="4"]').waitFor({ timeout: 30000 })
  await page.locator('.globe-photo:has(b)').first().click()
  await page.getByRole('button', { name: '放大到此处场景' }).click()
  await page.locator('.life-map[data-scene-state="ready"]').waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: '返回地球' }).click()
  await page.locator('.life-globe').waitFor()
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: '放大地球' }).click()
  await page.locator('.life-map[data-scene-state="ready"]').waitFor({ timeout: 30000 })
  assert.equal(errors.length, 0, `浏览器运行时不应报错：${errors.join('; ')}`)
  console.log('AMap test passed: security proxy, geocoding, real-photo map, story line, photo cluster chooser, GPS → street number, automatic cards and landmark locating, regional scenes, map dragging.')
  assert.equal(consoleLog.filter((item) => /error: THREE\.WebGLProgram: Shader Error/i.test(item)).length, 0, '地图场景着色器应在真实浏览器中编译成功')
} finally {
  await browser.close()
}

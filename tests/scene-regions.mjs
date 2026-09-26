// Real authenticated map-scene API + real AMap, with public photo coordinates.
// The temporary account belongs to an isolated API process, never the user's database.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const temporary = mkdtempSync(join(tmpdir(), 'pw-scene-regions-'))
const base = process.env.BASE_URL || 'http://localhost:5183/'
const api = spawn(process.execPath, ['server/index.mjs'], {
  env: { ...process.env, PORT: '0', USERS_FILE: join(temporary, 'users.json') },
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
})
let browser
let releaseHeld
let closing = false
try {
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('测试 API 启动超时')), 10000)
    api.stdout.on('data', (chunk) => {
      const match = chunk.toString().match(/127\.0\.0\.1:(\d+)/)
      if (match) { clearTimeout(timer); resolve(match[1]) }
    })
    api.on('exit', () => { clearTimeout(timer); reject(new Error('测试 API 提前退出')) })
  })
  const apiBase = `http://127.0.0.1:${port}`
  const account = await fetch(`${apiBase}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-memory-agent': 'web' },
    body: JSON.stringify({ username: 'scene-regression', password: 'test-map-regions-123', acceptPrivacy: true }),
  })
  assert.equal(account.status, 201)
  const cookie = account.headers.get('set-cookie').split(';')[0]
  const config = await (await fetch(`${apiBase}/api/config`)).json()
  assert.ok(config.amapJsKey, '本机需要高德配置')
  browser = await chromium.launch({ channel: 'chrome' })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true })
  const errors = []
  const shaderErrors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (/THREE.WebGLProgram: Shader Error/.test(message.text())) shaderErrors.push(message.text()) })
  let requests = 0
  let lastMapScene
  let holdNext = false
  let failNext = false
  let heldReceived
  let heldDelivered
  const forward = async (route) => {
    try {
      const url = new URL(route.request().url())
      const isScene = url.pathname === '/api/map-scene'
      if (isScene) requests++
      if (isScene && failNext) {
        failNext = false
        return await route.fulfill({ status: 503, json: { error: '场景测试：一次临时失败' } })
      }
      const shouldHold = isScene && holdNext
      if (shouldHold) holdNext = false
      const response = await route.fetch({
        url: `${apiBase}${url.pathname}${url.search}`,
        headers: { ...route.request().headers(), cookie },
      })
      if (isScene && response.ok()) lastMapScene = await response.json()
      if (shouldHold) {
        await new Promise((resolve) => { releaseHeld = resolve; heldReceived() })
      }
      await route.fulfill({ response })
      if (shouldHold) heldDelivered()
    } catch (error) { if (!closing) throw error }
  }
  await page.route('**/api/**', forward)
  await page.route('**/_AMapService/**', forward)
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.evaluate(async (key) => {
    const { loadAmap } = await import('/src/map/amap.ts')
    const { createAmapLifeMap } = await import('/src/map/amapScene.ts')
    const { wgs84ToGcj02 } = await import('/src/lib/geo.js')
    const AMap = await loadAmap(key)
    const host = document.createElement('div')
    host.id = 'region-test'
    host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:white'
    document.body.append(host)
    const samples = [
      ['wuhan', 114.365, 30.54], ['wuhan-peer', 114.3652, 30.5402],
      ['hangzhou', 120.13, 30.259], ['xiangtan', 112.9447, 27.8297], ['shenzhen', 114.0579, 22.5431],
    ]
    const photos = samples.map(([id, lng, lat]) => {
      const p = wgs84ToGcj02({ lng, lat })
      return { id, name: id, gcj: [p.lng, p.lat], precision: 'point', inferred: false,
        preview: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="%23ffc98a"/></svg>' }
    })
    // A nearby coarse location must not prevent the precise group from activating.
    photos.push({ ...photos[0], id: 'city-only', precision: 'city' })
    const data = { places: [], bases: [], story: [], selectedCity: null, highlightedEventId: null, photos }
    const test = window.regionTest = { data, photos, host }
    const namespace = Object.create(AMap)
    namespace.Map = function (...args) { test.map = new AMap.Map(...args); return test.map }
    test.api = createAmapLifeMap(host, { onSelectCity() {}, onOpenEvent() {} }, namespace)
    test.api.update(data)
    // Exercise a focus request made before the map's asynchronous complete event.
    test.api.focusPhoto(photos[0])
  }, config.amapJsKey)
  const ready = () => page.waitForFunction(() => document.querySelector('#region-test').dataset.sceneState === 'ready', null, { timeout: 45000 })
  const state = () => page.locator('#region-test').evaluate((el) => ({ ...el.dataset }))
  const focus = (index) => page.evaluate((i) => regionTest.api.focusPhoto(regionTest.photos[i]), index)
  const snapshot = async (name) => {
    await ready()
    await page.waitForTimeout(1800) // native AMap tiles finish after our scene is ready
    await page.screenshot({ path: join(temporary, `${name}.png`) })
    return state()
  }
  const wuhan = await snapshot('wuhan')
  assert.ok(Number(wuhan.sceneBuildings) > 100, '武汉完整楼群')
  const builds = wuhan.sceneBuilds
  const firstRequests = requests
  await focus(1)
  await page.evaluate(() => {
    regionTest.data.photos = regionTest.photos.map((p) => ({ ...p, sceneCard: { title: '信息卡更新', scene: '阅读', tags: ['绘本'], createdAt: 'new' } }))
    regionTest.api.update(regionTest.data)
  })
  await page.waitForTimeout(700)
  assert.equal((await state()).sceneBuilds, builds, '同组照片和卡片更新不重建街区')
  assert.equal(requests, firstRequests, '同组照片不重复请求地图资料')
  await focus(2)
  const hangzhou = await snapshot('hangzhou')
  assert.ok(Number(hangzhou.sceneBuildings) > 100, '无信息卡主题时也生成杭州完整楼群')
  await page.evaluate(() => regionTest.map.setZoom(14, true))
  await page.waitForFunction(() => regionTest.host.dataset.sceneState === 'idle')
  await page.evaluate(() => regionTest.map.setZoom(18, true))
  await ready()
  assert.equal((await state()).sceneBuildings, hangzhou.sceneBuildings, '缩放返回恢复全部楼体')
  const restoredBuilds = (await state()).sceneBuilds
  await page.evaluate(() => regionTest.api.setSceneEnabled(false))
  assert.equal(await page.locator('#region-test .map-scene-source').isVisible(), false)
  await page.evaluate(() => regionTest.api.setSceneEnabled(true))
  assert.equal(await page.locator('#region-test .map-scene-source').isVisible(), true)
  assert.equal((await state()).sceneBuilds, restoredBuilds, '开关只改变可见性')

  holdNext = true
  const received = new Promise((resolve) => { heldReceived = resolve })
  const delivered = new Promise((resolve) => { heldDelivered = resolve })
  await focus(3)
  await received
  assert.equal((await state()).sceneState, 'loading')
  assert.equal((await state()).sceneBuildings, hangzhou.sceneBuildings, '加载下一地区时保留完整的上一场景')
  await focus(0)
  await ready()
  const beforeLateResponse = await state()
  releaseHeld()
  await delivered
  await page.waitForTimeout(500)
  assert.deepEqual(await state(), beforeLateResponse, '晚到的旧地区响应不能覆盖当前地区')
  await focus(3)
  const xiangtan = await snapshot('xiangtan')

  failNext = true
  await focus(4)
  await page.locator('#region-test[data-scene-state="error"]').waitFor()
  await page.getByRole('button', { name: '重新加载场景' }).click()
  const shenzhen = await snapshot('shenzhen')
  assert.equal(shenzhen.sceneState, 'ready', '失败后通过真实接口重试成功')

  // One actual public park, with photos near opposite ends (well beyond 450 m).
  // No venue names or AI cards are supplied: membership comes from the OSM boundary.
  await page.evaluate(async () => {
    const { wgs84ToGcj02 } = await import('/src/lib/geo.js')
    const park = [[120.0978, 30.3182], [120.1008, 30.3138]].map(([lng, lat], i) => {
      const p = wgs84ToGcj02({ lng, lat })
      return { ...regionTest.photos[0], id: `park-${i}`, name: `Park ${i}`, gcj: [p.lng, p.lat] }
    })
    regionTest.park = park
    regionTest.data.photos = [...regionTest.photos, ...park]
    regionTest.api.update(regionTest.data)
    regionTest.api.focusPhoto(park[0])
  })
  const gongshu = await snapshot('gongshu-whole-park')
  assert.equal(gongshu.sceneVenue, 'osm:way:615060920', '真实公园边界被识别')
  assert.equal(Number(gongshu.scenePhotos), 2, '同一园区的南北照片共同展示')
  assert.equal(Number(gongshu.sceneSpecialBuildings), 2, '南体育馆和北体育场采用分类造型')
  assert.ok(Number(gongshu.sceneWater) >= 2 && Number(gongshu.sceneWaterways) > 0, '湖面与独立河道均被提取')
  const parkRequests = requests
  await page.evaluate(() => regionTest.api.focusPhoto(regionTest.park[1]))
  await page.waitForTimeout(800)
  assert.equal((await state()).sceneBuilds, gongshu.sceneBuilds, '同一公园不同位置共享整个场景')
  assert.equal(requests, parkRequests, '同一公园另一组照片不再请求独立街区')
  const frameBounds = () => page.evaluate(async (venue) => {
    const { wgs84ToGcj02 } = await import('/src/lib/geo.js')
    const pixels = venue.polygons.flat(2).map(([lng, lat]) => {
      const p = wgs84ToGcj02({ lng, lat })
      const pixel = regionTest.map.lngLatToContainer([p.lng, p.lat])
      return [pixel.x, pixel.y]
    })
    return { zoom: regionTest.map.getZoom(), photos: Number(regionTest.host.dataset.scenePhotos), bounds: [Math.min(...pixels.map((p) => p[0])), Math.min(...pixels.map((p) => p[1])), Math.max(...pixels.map((p) => p[0])), Math.max(...pixels.map((p) => p[1]))] }
  }, lastMapScene.venue)
  const parkFrame = await frameBounds()
  assert.equal(parkFrame.photos, 2)
  assert.ok(parkFrame.bounds[0] >= 0 && parkFrame.bounds[1] >= 0 && parkFrame.bounds[2] <= 1440 && parkFrame.bounds[3] <= 900, '完整公园而非单个拍摄点位于视窗')
  await page.screenshot({ path: join(temporary, 'gongshu-shared-park.png') })
  await page.setViewportSize({ width: 430, height: 900 })
  await page.evaluate(() => regionTest.api.focusPhoto(regionTest.park[0]))
  await page.waitForTimeout(1200)
  assert.equal((await state()).sceneBuilds, gongshu.sceneBuilds, '窄屏进入公园仍复用同一场景')
  assert.equal(await page.locator('#region-test .map-scene-source').isVisible(), true, `完整园区取景在窄屏也显示材质: ${JSON.stringify({ state: await state(), frame: await frameBounds() })}`)
  const mobileFrame = await frameBounds()
  assert.ok(mobileFrame.bounds[0] >= -2 && mobileFrame.bounds[2] <= 432 && mobileFrame.bounds[1] >= -2 && mobileFrame.bounds[3] <= 902, `窄屏不能裁掉半个公园: ${JSON.stringify(mobileFrame)}`)
  await page.screenshot({ path: join(temporary, 'gongshu-shared-park-mobile.png') })
  for (const width of [820, 390, 430]) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(() => regionTest.api.focusPhoto(regionTest.park[0]))
    await page.waitForTimeout(1000)
    const fit = await frameBounds()
    assert.ok(fit.bounds[0] >= -2 && fit.bounds[2] <= width + 2, `反复缩放窗口仍需完整取景: ${JSON.stringify(fit)}`)
    assert.equal(await page.locator('#region-test .map-scene-source').isVisible(), true)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.evaluate(() => {
    regionTest.data.photos = regionTest.photos
    regionTest.api.update(regionTest.data)
  })
  await page.waitForFunction(() => regionTest.host.dataset.sceneState === 'idle')
  assert.equal((await state()).sceneVenue, '', '移除该地点全部照片后不保留孤立园区场景')

  // City memories are always accessible, but default and overview have no story line.
  await page.evaluate(() => {
    const base = { assetIds: [], timeSource: 'exif', title: '回忆', summary: '', type: '日常', place: '', city: '杭州', people: [], visibleText: '', tags: [], questions: [], status: 'confirmed' }
    const story = [{ ...base, id: 'visit-a', occurredAt: '2026-09-20T02:00:00Z', lat: 30.3182, lng: 120.0978 }, { ...base, id: 'visit-b', occurredAt: '2026-09-20T04:00:00Z', lat: 30.3138, lng: 120.1008 }]
    regionTest.data = { ...regionTest.data, places: [{ city: '杭州', lat: 30.316, lng: 120.099, eventIds: ['visit-a', 'visit-b'], firstAt: story[0].occurredAt, lastAt: story[1].occurredAt, role: 'travel', isBase: false }], selectedCity: '杭州', story }
    regionTest.api.update(regionTest.data)
  })
  assert.equal((await state()).storyLinesVisible, 'false', '城市故事默认不机械连线')
  await page.evaluate(() => {
    regionTest.data.routeEventIds = ['visit-a', 'visit-b']
    regionTest.api.update(regionTest.data)
    regionTest.map.setZoom(14, true)
  })
  await page.waitForFunction(() => regionTest.host.dataset.storyLinesVisible === 'true')
  assert.equal((await state()).storySegments, '1')
  await page.evaluate(() => regionTest.map.setZoom(10, true))
  await page.waitForFunction(() => regionTest.host.dataset.storyLinesVisible === 'false')

  const sparse = await page.evaluate(async () => {
    const { createStyledDistrict } = await import('/src/map/styledDistrict.ts')
    const { photoRegions, metresApart, rememberSceneVenues } = await import('/src/map/regionScene.ts')
    const { wgs84ToGcj02 } = await import('/src/lib/geo.js')
    const center = wgs84ToGcj02({ lng: 121.5, lat: 31.2 })
    const convert = (points) => points.map(([lng, lat]) => [(lng - center.lng) * 96000, (lat - center.lat) * 111000])
    const ring = [[121.4998, 31.1998], [121.5002, 31.1998], [121.5002, 31.2002], [121.4998, 31.2002], [121.4998, 31.1998]]
    const data = { source: 'OpenStreetMap contributors', license: 'ODbL-1.0', bbox: [121.49, 31.19, 121.51, 31.21], buildings: [{ id: 'tower', rings: [ring], height: '226' }], roads: [], water: [], green: [], sand: [], landuse: [{ id: 'land', kind: 'residential', rings: [ring] }], plazas: [], treeRows: [] }
    const district = createStyledDistrict(convert, [center.lng, center.lat], 0, data)
    const walls = district.group.children.filter((child) => child.material?.map?.isCanvasTexture)
    const maxHeight = Math.max(...walls.map((mesh) => { mesh.geometry.computeBoundingBox(); return mesh.geometry.boundingBox.max.z }))
    let mean = 0
    const chain = Array.from({ length: 12 }, (_, i) => {
      const x = i ? mean + 440 : 0
      mean = (mean * i + x) / (i + 1)
      return { id: String(i).padStart(2, '0'), gcj: [114 + x / (111320 * Math.cos(30 * Math.PI / 180)), 30], precision: 'point' }
    })
    const groups = photoRegions(chain)
    const boundedGroups = groups.every((group) => group.photoIds.every((id) => metresApart(group.center, chain.find((p) => p.id === id).gcj) <= 450.01))
    const mallRing = [[115, 30], [115.02, 30], [115.02, 30.01], [115, 30.01], [115, 30]]
    rememberSceneVenues({ venues: [{ id: 'test-mall', kind: 'mall', name: 'Test mall', polygons: [[mallRing]], bbox: [115, 30, 115.02, 30.01], center: [115.01, 30.005] }] })
    const mallPhotos = [115.002, 115.018].map((lng, i) => {
      const p = wgs84ToGcj02({ lng, lat: 30.005 })
      return { id: `mall-${i}`, precision: 'point', gcj: [p.lng, p.lat] }
    })
    const mallGroups = photoRegions(mallPhotos)
    const mallShared = mallGroups.length === 1 && mallGroups[0].photoIds.length === 2 && mallGroups[0].key === 'venue:test-mall'
    const named = photoRegions([{ id: 'a', gcj: [116, 30], venueName: '示例购物中心' }, { id: 'b', gcj: [116.007, 30], venueName: '示例购物中心' }, { id: 'branch', gcj: [117, 31], venueName: '示例购物中心' }])
    const separateBranches = named.length === 2 && named.some((r) => r.photoIds.includes('a') && r.photoIds.includes('b'))
    const result = { buildings: district.buildingCount, texturedWalls: walls.length, maxHeight, broadSurface: district.completeSurface, hiddenFootprints: district.hideNativePaths.length, boundedGroups, mallShared, separateBranches }
    district.group.traverse((child) => { child.geometry?.dispose(); child.material?.map?.dispose(); child.material?.dispose() })
    return result
  })
  assert.ok(sparse.texturedWalls > 0, '少于 100 栋也使用同一窗格材质')
  assert.equal(sparse.buildings, 1)
  assert.equal(sparse.maxHeight, 226, '有楼高数据的高楼不能变成矮小估算楼')
  assert.equal(sparse.broadSurface, false, '稀疏资料不铺盖住原生楼块的整片用地面')
  assert.equal(sparse.hiddenFootprints, 1, '只隐藏实际已替换的足迹')
  assert.equal(sparse.boundedGroups, true, '一串照片不能让组中心漂移而遗漏早先的照片地点')
  assert.equal(sparse.mallShared, true, '同一商场边界内的不同入口共用场景')
  assert.equal(sparse.separateBranches, true, '同名异地商场不能因名称相同被合并')
  assert.deepEqual(errors, [])
  assert.deepEqual(shaderErrors, [])
  console.log(JSON.stringify({ screenshots: temporary, wuhan, hangzhou, xiangtan, shenzhen, gongshu, parkFrame, mobileFrame, sparse, requests, errors }))
} finally {
  closing = true
  releaseHeld?.()
  await browser?.close()
  api.kill()
}

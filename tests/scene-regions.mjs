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

  const sparse = await page.evaluate(async () => {
    const { createStyledDistrict } = await import('/src/map/styledDistrict.ts')
    const { photoRegions, metresApart } = await import('/src/map/regionScene.ts')
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
    const result = { buildings: district.buildingCount, texturedWalls: walls.length, maxHeight, broadSurface: district.completeSurface, hiddenFootprints: district.hideNativePaths.length, boundedGroups }
    district.group.traverse((child) => { child.geometry?.dispose(); child.material?.map?.dispose(); child.material?.dispose() })
    return result
  })
  assert.ok(sparse.texturedWalls > 0, '少于 100 栋也使用同一窗格材质')
  assert.equal(sparse.buildings, 1)
  assert.equal(sparse.maxHeight, 226, '有楼高数据的高楼不能变成矮小估算楼')
  assert.equal(sparse.broadSurface, false, '稀疏资料不铺盖住原生楼块的整片用地面')
  assert.equal(sparse.hiddenFootprints, 1, '只隐藏实际已替换的足迹')
  assert.equal(sparse.boundedGroups, true, '一串照片不能让组中心漂移而遗漏早先的照片地点')
  assert.deepEqual(errors, [])
  assert.deepEqual(shaderErrors, [])
  console.log(JSON.stringify({ screenshots: temporary, wuhan, hangzhou, xiangtan, shenzhen, sparse, requests, errors }))
} finally {
  closing = true
  releaseHeld?.()
  await browser?.close()
  api.kill()
}

// Visual regression check for regional map scenery, using public fixture coordinates by default.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mapSceneForPoint } from '../server/mapScene.mjs'

process.loadEnvFile(new URL('../.env', import.meta.url))
const key = process.env.AMAP_JS_KEY
const code = process.env.AMAP_JS_SECURITY_CODE
const sceneLng = Number(process.env.SCENE_LNG || 114.365)
const sceneLat = Number(process.env.SCENE_LAT || 30.54)
if (!key || !code) throw new Error('AMap keys are required')
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
await page.route('**/api/map-scene', async (route) => {
  const { lng, lat } = route.request().postDataJSON()
  try { await route.fulfill({ json: await mapSceneForPoint(lng, lat) }) }
  catch (error) { await route.fulfill({ status: 503, json: { error: error.message } }) }
})
await page.route('**/_AMapService/**', async (route) => {
  const url = new URL(route.request().url())
  const targets = [['/_AMapService/v4/map/styles', 'https://webapi.amap.com/v4/map/styles'], ['/_AMapService/v3/vectormap', 'https://fmap01.amap.com/v3/vectormap'], ['/_AMapService/', 'https://restapi.amap.com/']]
  const [prefix, target] = targets.find(([path]) => url.pathname.startsWith(path))
  url.searchParams.set('jscode', code)
  const upstream = await fetch(`${target}${url.pathname.slice(prefix.length)}?${url.searchParams}`)
  await route.fulfill({ status: upstream.status, contentType: upstream.headers.get('content-type') || undefined, body: Buffer.from(await upstream.arrayBuffer()) })
})
try {
  await page.goto(process.env.BASE_URL || 'http://localhost:5183/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(async ({ amapKey, sceneLng, sceneLat }) => {
    const host = document.createElement('div')
    host.id = 'region-preview'
    host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:white'
    document.body.append(host)
    const { loadAmap } = await import('/src/map/amap.ts')
    const { createAmapLifeMap } = await import('/src/map/amapScene.ts')
    const { wgs84ToGcj02 } = await import('/src/lib/geo.js')
    const AMap = await loadAmap(amapKey)
    const at = wgs84ToGcj02({ lng: sceneLng, lat: sceneLat })
    const photo = { id: 'scene-example', name: '场景样例', gcj: [at.lng, at.lat], preview: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="%23ffc98a"/></svg>', inferred: false, precision: 'point' }
    let map
    const namespace = Object.create(AMap)
    namespace.Map = function (...args) { map = new AMap.Map(...args); return map }
    const api = createAmapLifeMap(host, { onSelectCity() {}, onOpenEvent() {} }, namespace)
    api.update({ places: [], bases: [], story: [], selectedCity: null, highlightedEventId: null, photos: [photo] })
    window.sparseScene = { api, photo, map }
  }, { amapKey: key, sceneLng, sceneLat })
  await page.waitForTimeout(2000)
  await page.evaluate(() => window.sparseScene.api.focusPhoto(window.sparseScene.photo))
  await page.waitForFunction(() => document.querySelector('#region-preview')?.dataset.sceneState === 'ready', null, { timeout: 45000 })
  await page.waitForTimeout(2000)
  if (process.env.SCENE_ZOOM) {
    await page.evaluate(zoom => { sparseScene.map.setZoom(zoom, true) }, Number(process.env.SCENE_ZOOM))
    await page.waitForTimeout(1200)
  }
  await page.screenshot({ path: join(tmpdir(), `pw-amap-region-${sceneLng.toFixed(2)}-${sceneLat.toFixed(2)}.png`) })
  if (process.env.SCENE_CLOSEUPS === 'gongshu') {
    for (const [name, lng, lat, rotation] of [['umbrella',120.09662,30.31910,85],['jade',120.10155,30.31292,25]]) {
      await page.evaluate(async ({lng,lat,rotation}) => {
        const { wgs84ToGcj02 } = await import('/src/lib/geo.js')
        const p = wgs84ToGcj02({lng,lat})
        sparseScene.map.setPitch(62); sparseScene.map.setRotation(rotation)
        sparseScene.map.setZoomAndCenter(19.0,[p.lng,p.lat])
      }, {lng,lat,rotation})
      await page.waitForTimeout(2400)
      await page.screenshot({path:join(tmpdir(),`pw-gongshu-${name}-close.png`)})
    }
  }
  const sceneSource = await page.locator('.map-scene-source').last().isVisible()
  const sceneInfo = await page.locator('#region-preview').evaluate(el => ({ ...el.dataset }))
  if (process.env.SCENE_EXPECT_LANDMARK) assert.ok(sceneInfo.sceneLandmarks?.includes(process.env.SCENE_EXPECT_LANDMARK), 'registered landmark must exist in the actual map scene')
  assert.equal(sceneSource, true, '普通照片区域应加载场景数据')
  assert.deepEqual(errors, [], '地图预览不能出现浏览器运行时错误')
  console.log(JSON.stringify({ sceneSource, sceneInfo, errors }))
} finally { await browser.close() }

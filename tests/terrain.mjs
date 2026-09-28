// Live terrain check at the public Huangshan mountain coordinate. Requires npm run dev and AMap keys.
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

process.loadEnvFile(new URL('../.env', import.meta.url))
const key = process.env.AMAP_JS_KEY
const code = process.env.AMAP_JS_SECURITY_CODE
if (!key || !code) { console.log('跳过：.env 中没有高德 Key'); process.exit(0) }

const browser = await chromium.launch({ channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
  const dem = []
  async function fetchTile(url) {
    try { return await fetch(url, { signal: AbortSignal.timeout(12000) }) }
    catch { return fetch(url, { signal: AbortSignal.timeout(12000) }) }
  }
  await page.route('**/_AMapService/**', async (route) => {
    const url = new URL(route.request().url())
    const targets = [
      ['/_AMapService/v4/map/styles', 'https://webapi.amap.com/v4/map/styles'],
      ['/_AMapService/v3/vectormap', 'https://fmap01.amap.com/v3/vectormap'],
      ['/_AMapService/', 'https://restapi.amap.com/'],
    ]
    const [prefix, target] = targets.find(([path]) => url.pathname.startsWith(path))
    url.searchParams.set('jscode', code)
    try {
      const response = await fetchTile(`${target}${url.pathname.slice(prefix.length)}?${url.searchParams}`)
      if (url.pathname.includes('/rest/lbs/dem/')) dem.push(response.status)
      await route.fulfill({ status: response.status, contentType: response.headers.get('content-type') || undefined, body: Buffer.from(await response.arrayBuffer()) })
    } catch {
      if (url.pathname.includes('/rest/lbs/dem/')) dem.push(502)
      await route.fulfill({ status: 502, body: '' }).catch(() => {})
    }
  })
  await page.goto(process.env.BASE_URL || 'http://localhost:5183/', { waitUntil: 'load' })
  await page.evaluate(async (jsKey) => {
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;inset:0;z-index:99999'
    document.body.append(host)
    const { loadAmap } = await import('/src/map/amap.ts')
    const AMap = await loadAmap(jsKey)
    window.terrainMap = new AMap.Map(host, { viewMode: '3D', terrain: true, zoom: 11, pitch: 55, center: [118.17, 30.13] })
  }, key)
  await page.waitForFunction(() => window.terrainMap?.getAltitude?.([118.17, 30.13]) > 100, null, { timeout: 45000 }).catch(() => {})
  const altitude = await page.evaluate(() => window.terrainMap.getAltitude([118.17, 30.13]))
  if (!(altitude > 100)) await page.screenshot({ path: join(tmpdir(), 'pw-terrain-failed.png') })
  assert.ok(altitude > 100, `黄山高程未加载：${altitude} m；DEM HTTP: ${dem.join(',')}`)
  assert.ok(dem.includes(200), `地形瓦片应成功返回：${dem.join(',')}`)
  console.log(`Terrain check passed: altitude ${Math.round(altitude)} m, DEM responses ${dem.length}`)
} finally {
  await browser.close()
}

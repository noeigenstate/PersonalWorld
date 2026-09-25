// Checks that what the amap-threejs skill documents is still true.
import assert from 'node:assert/strict'
import http from 'node:http'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkSkillFile, importRoot, live } from '../../../tests/skill-kit.mjs'

const dir = fileURLToPath(new URL('.', import.meta.url))
const { wgs84ToGcj02 } = await importRoot('src/lib/geo.js')

test('SKILL.md 格式完整，记录了关键结论', () => {
  const { body } = checkSkillFile(dir)
  for (const fact of ['WebGL 1', 'GCJ-02', '1113.19', '156543.034 / 2 ** zoom', '[top, bottom, left, right]', '/_AMapService/', "'amap://styles/macaron'"]) assert.ok(body.includes(fact), `缺少 ${fact}`)
})

test('WGS-84 → GCJ-02 与公开参考值一致（天安门）', () => {
  const p = wgs84ToGcj02({ lat: 39.908823, lng: 116.39747 })
  assert.ok(Math.abs(p.lat - 39.910226) < 1e-5 && Math.abs(p.lng - 116.403713) < 1e-5, JSON.stringify(p))
})

test('每像素米数公式：11 级约 76.44 米', () => {
  assert.ok(Math.abs(156543.034 / 2 ** 11 - 76.437) < 0.01)
})

// Measured in a real browser with the keys in .env
test('真实高德：WebGL 1、坐标单位、相机同步、留白顺序、浏览器端地理编码', { skip: (!live || !process.env.AMAP_JS_KEY) && '设置 LIVE=1 且 .env 有高德 Key 才运行' }, async () => {
  const { createRequire } = await import('node:module')
  const { chromium } = createRequire(import.meta.url)('playwright')
  const html = `<!doctype html><meta charset=utf-8><style>html,body,#m{margin:0;width:1000px;height:800px}</style><div id=m></div>
<script>window._AMapSecurityConfig={securityJsCode:${JSON.stringify(process.env.AMAP_JS_SECURITY_CODE)}}</script>
<script src="https://webapi.amap.com/maps?v=2.0&key=${process.env.AMAP_JS_KEY}&plugin=AMap.Geocoder"></script>
<script>
window.probe = new Promise((resolve) => {
  const out = {}
  const map = new AMap.Map('m', { viewMode: '3D', pitch: 50, zoom: 11, center: [121.47, 31.23] })
  map.add(new AMap.GLCustomLayer({ init(gl) { out.webgl = gl.getParameter(gl.VERSION) }, render() {
    const cc = map.customCoords; cc.setCenter([121.47, 31.23])
    const [a, b] = cc.lngLatsToCoords([[121.47, 31.23], [121.48, 31.23]])
    out.units = b[0] - a[0]
    const p = cc.getCameraParams(); const dist = Math.hypot(...p.position)
    out.mppCamera = 2 * dist * Math.tan(p.fov * Math.PI / 360) / 800; out.zoom = map.getZoom()
  } }))
  map.on('complete', () => {
    const bounds = new AMap.Bounds([121.46, 31.22], [121.48, 31.24])
    map.setBounds(bounds, true, [400, 0, 0, 0]); const top = map.lngLatToContainer([121.47, 31.23])
    map.setBounds(bounds, true, [0, 0, 400, 0]); const left = map.lngLatToContainer([121.47, 31.23])
    out.avoidTopPushesDown = top.y > 450; out.avoidThirdIsLeft = left.x > 550
    map.setZoomAndCenter(11, [121.47, 31.23], true)
    new AMap.Geocoder({ city: '全国' }).getAddress([121.4781, 31.2284], (status, result) => { out.geocode = result?.regeocode?.addressComponent?.province; setTimeout(() => resolve(out), 800) })
  })
})
</script>`
  const server = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(html) })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const browser = await chromium.launch({ channel: 'chrome' })
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
    await page.goto(`http://127.0.0.1:${server.address().port}/`)
    const out = await page.evaluate(() => window.probe)
    assert.match(out.webgl, /^WebGL 1\.0/, '高德仍给 WebGL 1 上下文')
    assert.ok(Math.abs(out.units - 1113.19) < 0.5, `0.01° 经度应为 1113.19 单位，实际 ${out.units}`)
    assert.ok(Math.abs(out.mppCamera - 156543.034 / 2 ** out.zoom) / out.mppCamera < 0.01, '公式与相机一致')
    assert.ok(out.avoidTopPushesDown && out.avoidThirdIsLeft, 'avoid 顺序为 [上, 下, 左, 右]')
    assert.equal(out.geocode, '上海市')
  } finally {
    await browser.close()
    server.close()
  }
})

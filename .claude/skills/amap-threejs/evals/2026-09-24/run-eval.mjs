// Loads each variant's page with the real AMap keys and measures the red box:
// is it on the Bund (GCJ-02 position from AMap itself), and does it keep ~40 px when zooming?
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const root = here('../../../../../')
const { chromium } = createRequire(root + 'package.json')('playwright')
const { wgs84ToGcj02 } = await import(pathToFileURL(root + 'src/lib/geo.ts').href)
process.loadEnvFile(root + '.env')
const bund = wgs84ToGcj02({ lat: 31.2397, lng: 121.4998 })

async function measure(page, browser) {
  const expected = await page.evaluate(([lng, lat]) => { const p = window.map.lngLatToContainer([lng, lat]); return [p.x, p.y] }, [bund.lng, bund.lat])
  const png = (await page.screenshot()).toString('base64')
  const probe = await browser.newPage()
  // Only red pixels near the expected point count (AMap's own red road labels would inflate
  // a bounding box); size is measured as sqrt(area) so stray pixels barely matter.
  const box = await probe.evaluate(async ([src, ex, ey]) => {
    const img = new Image(); img.src = src; await img.decode()
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
    const g = c.getContext('2d'); g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, c.width, c.height).data
    let sx = 0, sy = 0, n = 0
    for (let y = Math.max(0, ey - 160); y < Math.min(c.height, ey + 160); y++) for (let x = Math.max(0, ex - 160); x < Math.min(c.width, ex + 160); x++) {
      const i = (y * c.width + x) * 4
      if (d[i] > 200 && d[i + 1] < 70 && d[i + 2] < 70) { n++; sx += x; sy += y }
    }
    return n < 30 ? null : { cx: sx / n, cy: sy / n, size: Math.round(Math.sqrt(n)), n }
  }, ['data:image/png;base64,' + png, Math.round(expected[0]), Math.round(expected[1])])
  await probe.close()
  return { expected: expected.map(Math.round), box, offsetPx: box ? Math.round(Math.hypot(box.cx - expected[0], box.cy - expected[1])) : null }
}

const browser = await chromium.launch({ channel: 'chrome' })
for (const variant of ['with', 'without']) {
  const html = readFileSync(here(`./${variant}-skill/index.html`), 'utf8').replaceAll('__AMAP_KEY__', process.env.AMAP_JS_KEY).replaceAll('__AMAP_CODE__', process.env.AMAP_JS_SECURITY_CODE)
  const server = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(html) })
  await new Promise((r) => server.listen(5199, '127.0.0.1', r))
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)) })
  await page.goto('http://127.0.0.1:5199/')
  await page.waitForTimeout(7000)
  const row = { variant, hasMap: await page.evaluate(() => Boolean(window.map)) }
  if (row.hasMap) {
    row.zoom13 = await measure(page, browser)
    await page.evaluate(() => window.map.setZoom(15, true))
    await page.waitForTimeout(2500)
    row.zoom15 = await measure(page, browser)
    const [a, b] = [row.zoom13.box, row.zoom15.box]
    row.sizeRatio = a && b ? +(b.size / a.size).toFixed(2) : null
  }
  row.errors = [...new Set(errors)].slice(0, 3)
  console.log(JSON.stringify(row))
  await page.close()
  await new Promise((r) => server.close(r))
}
await browser.close()

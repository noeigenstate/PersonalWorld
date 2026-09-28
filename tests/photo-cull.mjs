import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import piexif from 'piexifjs'
import { chromium } from 'playwright'

// 整理重复照片: a burst of 8 similar photos (2 blurred) among 4 unrelated ones is stacked,
// the best 2 are kept, the rest pre-selected, and only what the user confirms is deleted.
const BASE = process.env.BASE_URL || 'http://localhost:5183/'
const shots = process.env.SMOKE_SHOTS || tmpdir()
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

let signedIn = false
const cullRequests = []
const deleted = []
const user = { user: { id: 'cull-user-1', username: '小丁', createdAt: '2026-09-28T00:00:00Z', privacyAccepted: true } }
await context.route('**/api/auth/**', (route) => {
  const path = new URL(route.request().url()).pathname
  if (path.endsWith('/me')) return signedIn ? route.fulfill({ json: user }) : route.fulfill({ status: 401, json: {} })
  signedIn = true
  return route.fulfill({ status: 201, json: user })
})
await context.route('**/api/config', (route) => route.fulfill({ json: { available: true, mode: 'model', message: '模拟', geocode: true } }))
await context.route('**/api/photo-card', (route) => route.fulfill({ status: 503, json: { error: '测试中不生成信息卡' } }))
await context.route('**/api/vault/**', (route) => {
  const request = route.request()
  if (request.method() === 'DELETE') deleted.push(new URL(request.url()).pathname.split('/').pop())
  if (request.method() === 'GET' && request.url().endsWith('/assets')) return route.fulfill({ json: { previews: [], originals: [] } })
  if (request.method() === 'GET') return route.fulfill({ json: { memory: null, extras: {} } })
  return route.fulfill({ json: { ok: true } })
})
// The model: keeps the first two photos it was sent, says the third has someone blinking
await context.route('**/api/photo-cull', (route) => {
  const body = route.request().postDataJSON()
  cullRequests.push(body)
  const ids = body.photos.map((p) => p.id)
  return route.fulfill({ json: {
    reviews: Object.fromEntries(ids.map((id, i) => [id, { eyesClosed: i === 2, blurry: false, issues: [], score: i < 2 ? 9 : 6, note: i === 2 ? '左边的人闭眼' : '' }])),
    keep: ids.slice(0, 2),
    summary: '留下两张都睁眼的',
  } })
})

async function makePhotos(dir) {
  const specs = [
    ...Array.from({ length: 8 }, (_, i) => ({ scene: 'burst', dx: i * 3, blur: i === 5 || i === 7 ? 7 : 0, when: `2021-10-07 10:55:${String(10 + i * 4).padStart(2, '0')}` })),
    ...['#d9534f', '#3b73b9', '#7a5cc4', '#2e9e6a'].map((color, i) => ({ scene: color, when: `2021-10-0${i + 1} 0${i + 2}:00:00` })),
  ]
  const files = []
  for (const [index, spec] of specs.entries()) {
    const dataUrl = await page.evaluate((spec) => {
      const canvas = document.createElement('canvas')
      canvas.width = 800; canvas.height = 600
      const g = canvas.getContext('2d')
      const draw = (ctx) => {
        if (spec.scene === 'burst') {
          const sky = ctx.createLinearGradient(0, 0, 0, 600)
          sky.addColorStop(0, '#8ec9f0'); sky.addColorStop(0.6, '#e2f1f9'); sky.addColorStop(0.61, '#6aa55a'); sky.addColorStop(1, '#4f8a42')
          ctx.fillStyle = sky; ctx.fillRect(0, 0, 800, 600)
          ctx.fillStyle = '#3f7d3a'; for (const x of [120, 640]) { ctx.beginPath(); ctx.arc(x + spec.dx, 280, 90, 0, Math.PI * 2); ctx.fill() }
          ctx.fillStyle = '#d9534f'; ctx.fillRect(300 + spec.dx, 300, 90, 220)
          ctx.fillStyle = '#3b73b9'; ctx.fillRect(420 + spec.dx, 300, 90, 220)
          ctx.fillStyle = '#f1c7a3'; for (const x of [345, 465]) { ctx.beginPath(); ctx.arc(x + spec.dx, 250, 50, 0, Math.PI * 2); ctx.fill() }
          ctx.fillStyle = '#1d1d1f'; ctx.font = 'bold 36px sans-serif'; ctx.fillText('WEST LAKE', 280 + spec.dx, 110)
        } else {
          ctx.fillStyle = '#f5f5f7'; ctx.fillRect(0, 0, 800, 600)
          ctx.fillStyle = spec.scene
          for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(((i * 137 + spec.scene.charCodeAt(2) * 7) % 700) + 50, ((i * 211 + spec.scene.charCodeAt(4) * 5) % 500) + 50, 30 + i * 12, 0, Math.PI * 2); ctx.fill() }
        }
      }
      if (spec.blur) {
        const sharp = document.createElement('canvas'); sharp.width = 800; sharp.height = 600
        draw(sharp.getContext('2d'))
        g.filter = `blur(${spec.blur}px)`; g.drawImage(sharp, 0, 0)
      } else draw(g)
      return canvas.toDataURL('image/jpeg', 0.9)
    }, spec)
    const exif = { '0th': {}, Exif: { [piexif.ExifIFD.DateTimeOriginal]: spec.when.replace(/-/g, ':') }, GPS: {} }
    const file = join(dir, `DSCF${3350 + index}.jpg`)
    writeFileSync(file, Buffer.from(piexif.insert(piexif.dump(exif), atob(dataUrl.split(',')[1])), 'binary'))
    files.push(file)
  }
  return files
}

try {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.locator('#auth-username').fill('小丁')
  await page.locator('#auth-password').fill('secret12')
  await page.locator('#auth-consent').check()
  await page.locator('.auth-submit').click()
  const files = await makePhotos(mkdtempSync(join(tmpdir(), 'pw-cull-')))
  await page.getByRole('button', { name: '导入第一批影像' }).click()
  await page.locator('input[type="file"]').setInputFiles(files)

  // One stack: the burst; the four unrelated photos are left alone
  const entry = page.locator('.cull-entry')
  await entry.waitFor({ timeout: 30_000 })
  assert.equal(await entry.locator('b').innerText(), '1')
  await entry.click()
  assert.equal(await page.locator('.cull-pile').count(), 1)
  assert.equal(await page.locator('.cull-pile-photos b').innerText(), '8')
  assert.match(await page.locator('.cull-lead').innerText(), /约可删除 6 张/)
  assert.equal(await page.locator('.cull-pile-text strong').innerText(), '2021-10-07 10:55', '显示拍摄地的本地时间')
  const pile = await page.locator('.cull-pile-photos').boundingBox()
  await page.waitForTimeout(600)
  assert.deepEqual(await page.locator('.cull-pile-photos').boundingBox(), pile, '叠放的照片保持静止')

  await page.screenshot({ path: join(shots, 'pw-cull-1-stacks.png') })
  // Spread the stack: the model sees the photos once, the best two are kept, the rest pre-selected
  await page.locator('.cull-pile').click()
  await page.getByText('留下两张都睁眼的').waitFor()
  assert.equal(cullRequests.length, 1)
  assert.equal(cullRequests[0].keep, 2, '8 张连拍建议保留 2 张')
  assert.equal(cullRequests[0].photos.length, 8)
  assert.ok(cullRequests[0].photos.every((p) => p.dataUrl.startsWith('data:image/jpeg') && Number.isFinite(p.sharpness)))
  assert.equal(await page.locator('.cull-grid li.keep').count(), 2)
  assert.equal(await page.locator('.cull-grid li.marked').count(), 6)
  assert.equal(await page.locator('.cull-grid li em', { hasText: '闭眼' }).count(), 1)
  assert.ok(await page.locator('.cull-grid li em', { hasText: '模糊' }).count() >= 2, '两张模糊的照片被本地测出')
  const order = await page.locator('.cull-grid li').evaluateAll((items) => items.map((li) => (li.querySelector('em') ? li.textContent.includes('模糊') ? 'blur' : 'issue' : 'clean')))
  assert.ok(order.lastIndexOf('clean') < order.indexOf('blur'), `没问题的照片排在模糊照片前面：${order}`)

  await page.screenshot({ path: join(shots, 'pw-cull-2-choose.png') })
  // The user keeps one more, then confirms deleting the other five
  await page.locator('.cull-grid li.marked .cull-photo').first().click()
  assert.equal(await page.locator('.cull-grid li.marked').count(), 5)
  page.once('dialog', (dialog) => { assert.match(dialog.message(), /删除选中的 5 张照片/); void dialog.accept() })
  await page.locator('.cull-delete').click()
  await page.getByText('已删除 5 张照片').waitFor()
  assert.equal(deleted.length, 5, '服务电脑上的副本同步删除')
  assert.equal(await page.locator('.cull-entry').count(), 0, '看过的这组不再提示')
  assert.equal(cullRequests.length, 1, '没有重复请求模型')
  assert.deepEqual(errors, [])
  console.log('Photo cull test passed: 8-photo burst stacked apart from 4 unrelated photos, 2 kept, blurred ranked below clean ones, blink flagged, 5 deleted after confirmation.')
} finally {
  await browser.close()
}

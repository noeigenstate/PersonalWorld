// Metadata on import: an iPhone HEIC original shows device, capture time and GPS;
// a chat-app image without EXIF says so and explains how to get the original.
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

// npm run dev → http://localhost:5183/; npm run dev:lan → BASE_URL=https://localhost:5183/
const BASE = process.env.BASE_URL || 'http://localhost:5183/'
const shots = process.env.SMOKE_SHOTS || tmpdir()
const heic = fileURLToPath(new URL('./fixtures/heic-iphone7.heic', import.meta.url))
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
await page.route('**/api/auth/me', (route) => route.fulfill({ json: { user: { id: 'meta-test', username: '测试', createdAt: '2026-09-24T00:00:00Z', privacyAccepted: true } } }))
await page.route('**/api/config', (route) => route.fulfill({ json: { available: false, mode: 'unconfigured', message: '测试', geocode: false } }))

async function openOnlyPhoto(title) {
  await page.locator('.tray-chip').click()
  await page.locator('.tray li').filter({ hasText: title }).first().click()
  await page.locator('.photo-open').first().click()
  await page.locator('.pc-facts').waitFor()
}

try {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  const dir = mkdtempSync(join(tmpdir(), 'pw-meta-'))
  const wechat = join(dir, '微信图片_20260924133611_301_56.jpg')
  const dataUrl = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 400; c.height = 600; const g = c.getContext('2d'); g.fillStyle = '#cfd8dc'; g.fillRect(0, 0, 400, 600); return c.toDataURL('image/jpeg', 0.8) })
  writeFileSync(wechat, Buffer.from(dataUrl.split(',')[1], 'base64'))

  await page.getByRole('button', { name: '导入第一批影像' }).click()
  assert.match(await page.locator('.import-notes').innerText(), /微信发送的图片会丢失拍摄时间、定位和设备/)
  await page.locator('input[type="file"]').setInputFiles([heic, wechat])
  await page.locator('.tray-chip').waitFor({ timeout: 60000 })

  // HEIC original: converted for preview, all metadata kept
  await openOnlyPhoto('2019')
  const facts = await page.locator('.pc-facts').innerText()
  assert.match(facts, /Apple iPhone 7 · iPhone 7 back camera 3\.99mm f\/1\.8/, '读出设备与镜头')
  assert.match(facts, /拍摄时间，来自照片元数据/)
  assert.match(facts, /2019年10月20日/)
  assert.match(facts, /38\.0466, 12\.9944/, '读出 GPS')
  assert.equal(await page.locator('.pc-stripped').count(), 0)
  assert.ok(await page.locator('.lightbox-stage img').evaluate((img) => img.naturalWidth > 0), 'HEIC 预览能显示')
  await page.screenshot({ path: join(shots, 'pw-metadata-heic.png') })
  await page.getByRole('button', { name: '关闭影像' }).click()
  await page.getByRole('button', { name: '关闭事件详情' }).click()

  // Chat-app image: no EXIF, and the card says why
  await openOnlyPhoto('2026')
  assert.match(await page.locator('.pc-facts').innerText(), /设备\s*未知/)
  assert.match(await page.locator('.pc-stripped').innerText(), /常见于微信、QQ 发送的非原图/)
  await page.screenshot({ path: join(shots, 'pw-metadata-wechat.png') })
  assert.equal(errors.length, 0, `浏览器运行时不应报错：${errors.join('; ')}`)
  console.log('Metadata test passed: HEIC original (device, lens, time, GPS), stripped chat-app image explained.')
} finally {
  await browser.close()
}

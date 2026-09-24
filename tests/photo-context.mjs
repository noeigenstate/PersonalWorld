// Collaborative completion: an event without GPS gets its city from located photos,
// first as an unconfirmed (dashed) guess, then confirmed when the user adopts it.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { fakeGeocode, makeLifeFixtures } from './fixtures.mjs'

// npm run dev → http://localhost:5183/; npm run dev:lan → BASE_URL=https://localhost:5183/
const BASE = process.env.BASE_URL || 'http://localhost:5183/'
const shots = process.env.SMOKE_SHOTS || tmpdir()
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

const requests = []
await page.route('**/api/auth/me', (route) => route.fulfill({ json: { user: { id: 'context-test', username: '测试', createdAt: '2026-09-24T00:00:00Z', privacyAccepted: true } } }))
await page.route('**/api/config', (route) => route.fulfill({ json: { available: true, mode: 'model', message: '模拟', geocode: true } }))
await page.route('**/api/geocode', (route) => route.fulfill({ json: { results: route.request().postDataJSON().points.map(fakeGeocode) } }))
await page.route('**/api/photo-context', (route) => {
  const body = route.request().postDataJSON()
  requests.push(body)
  const ref = body.refs[0].id
  return route.fulfill({ json: {
    matches: body.refs.map((r, i) => ({ refId: r.id, relation: i === 0 ? '同一场景' : '无关', evidence: i === 0 ? '同一张办公桌和窗外的楼' : '', confidence: i === 0 ? 0.88 : 0.2 })),
    fills: { city: { value: '上海市', fromRefIds: [ref], reason: '与这张照片是同一间办公室，它有 GPS 定位', confidence: 0.86 }, place: null, time: null, event: null },
    conflicts: [],
  } })
})

try {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  const files = await makeLifeFixtures(page, mkdtempSync(join(tmpdir(), 'pw-context-')))
  await page.getByRole('button', { name: '导入第一批影像' }).click()
  await page.locator('input[type="file"]').setInputFiles(files)
  await page.locator('.map-label.place').nth(3).waitFor()

  // Batch: the one photo without GPS is compared with located photos
  await page.locator('.tray-chip').click()
  await page.getByRole('button', { name: /用其他照片补全位置（1 件）/ }).click()
  await page.getByRole('status').getByText(/1 件事从其他照片补全了城市/).waitFor()
  const request = requests.at(-1)
  assert.ok(request.refs.length >= 1 && request.refs.length <= 4, '最多 4 张参考照片')
  assert.ok(request.refs.every((r) => r.known.city && ['GPS 定位', '用户确认'].includes(r.known.citySource)), '参考照片都有可靠的地点来源')
  assert.ok(!request.target.known.city, '目标照片本身没有城市')
  assert.match(request.target.known.timeSource, /拍摄时间/)

  await page.keyboard.press('Escape')
  await page.locator('.map-label.place').filter({ hasText: '上海' }).click()
  await page.locator('.butler').waitFor()
  await page.waitForTimeout(900)
  assert.equal(await page.locator('.map-label.event.unsure').count(), 1, '补全的城市未确认，故事线上显示为虚线')

  // Open that event's photo: the card shows where the city came from, and adopting confirms it
  await page.locator('.map-label.event.unsure').click()
  await page.locator('.photo-open').first().click()
  const fill = page.locator('.pc-fills li').first()
  await fill.waitFor()
  assert.match(await fill.innerText(), /上海市/)
  assert.match(await fill.innerText(), /同一间办公室/)
  assert.equal(await fill.locator('.pc-sources img').count(), 1, '依据的参考照片以缩略图显示')
  assert.match(await page.locator('.pc-matches').innerText(), /同一场景/)
  await page.screenshot({ path: join(shots, 'pw-photo-context.png') })
  await fill.getByRole('button', { name: '采用' }).click()
  await page.getByRole('status').getByText(/已把这件事放到上海/).waitFor()
  await page.getByRole('button', { name: '关闭影像' }).click()
  await page.getByRole('button', { name: '关闭事件详情' }).click()
  await page.waitForTimeout(300)
  assert.equal(await page.locator('.map-label.event.unsure').count(), 0, '采用后成为确认的地点')
  assert.equal(errors.length, 0, `浏览器运行时不应报错：${errors.join('; ')}`)
  console.log('Photo context test passed: batch completion from located photos, dashed until adopted, sources shown.')
} finally {
  await browser.close()
}

// Photo card: a chat-app image without EXIF gets its save time from the file name,
// facts and inferences are shown apart, and the card is kept with the photo.
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

// npm run dev → http://localhost:5183/; npm run dev:lan → BASE_URL=https://localhost:5183/
const BASE = process.env.BASE_URL || 'http://localhost:5183/'
const shots = process.env.SMOKE_SHOTS || tmpdir()
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

const card = {
  title: '新居装修验收',
  caption: '房间灯具已装好，窗户还贴着保护膜，〔可能是在杭州验收新房〕。',
  scene: '天花板中央装着一盏圆形风扇灯，窗户玻璃贴着印有文字的保护膜。',
  visibleText: '恒彩家装 0571-****',
  clues: [
    { kind: '事件', evidence: '窗户贴着装修公司的保护膜，房间里没有家具', inference: '装修刚完工，还没入住', confidence: 0.85 },
    { kind: '地点', evidence: '保护膜上的电话区号 0571', inference: '装修公司在杭州，照片可能也在杭州；广告电话只说明商家所在地', confidence: 0.6 },
  ],
  eventGuess: { type: '搬家装修', reason: '灯具已装、保护膜未撕、没有家具' },
  tags: ['装修', '新家'],
  questions: ['这是你在杭州的新家吗？'],
}
let cardRequest = null
let cardCalls = 0
await page.route('**/api/auth/me', (route) => route.fulfill({ json: { user: { id: 'card-test', username: '测试', createdAt: '2026-09-24T00:00:00Z', privacyAccepted: true } } }))
await page.route('**/api/config', (route) => route.fulfill({ json: { available: true, mode: 'model', message: '模拟', geocode: false } }))
await page.route('**/api/photo-card', (route) => { cardCalls++; cardRequest = route.request().postDataJSON(); return route.fulfill({ json: card }) })

try {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  // A JPEG with no EXIF, named the way WeChat saves images
  const dir = mkdtempSync(join(tmpdir(), 'pw-card-'))
  const file = join(dir, '微信图片_20260924133610_300_56.jpg')
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 540; c.height = 960
    const g = c.getContext('2d'); g.fillStyle = '#e9e6df'; g.fillRect(0, 0, 540, 960)
    g.fillStyle = '#9aa3ad'; g.fillRect(40, 620, 460, 300); g.fillStyle = '#fff'; g.beginPath(); g.ellipse(270, 470, 90, 26, 0, 0, 7); g.fill()
    return c.toDataURL('image/jpeg', 0.8)
  })
  writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'))
  await page.getByRole('button', { name: '导入第一批影像' }).click()
  await page.locator('input[type="file"]').setInputFiles(file)
  await page.locator('.tray-chip').click()
  await page.locator('.tray li').first().click()
  await page.locator('.photo-open').first().click()

  const facts = page.locator('.pc-facts')
  await facts.waitFor()
  assert.match(await facts.innerText(), /2026年9月24日 13:36/, '时间应来自文件名')
  assert.match(await facts.innerText(), /保存时间，来自文件名；拍摄可能更早/)
  assert.match(await facts.innerText(), /没有定位信息/)
  assert.match(await facts.innerText(), /540 × 960/)
  assert.match(await page.locator('.lightbox-caption').innerText(), /文件名中的保存时间/)

  // Import now starts the information-card queue without a manual click.
  await page.locator('.photo-card h2').filter({ hasText: '新居装修验收' }).waitFor()
  assert.equal(cardRequest.facts.timeSource, 'filename', '模型应被告知时间来源')
  assert.ok(cardRequest.image.dataUrl.startsWith('data:image/jpeg;base64,'))
  assert.equal(await page.locator('.pc-caption .inferred').innerText(), '可能是在杭州验收新房', '推断部分应标出')
  assert.equal(await page.locator('.pc-clues li').count(), 2)
  assert.match(await page.locator('.pc-clues li').nth(1).innerText(), /60%/)
  assert.match(await page.locator('.pc-text').innerText(), /0571-\*\*\*\*/)
  assert.match(await page.locator('.pc-questions').innerText(), /杭州的新家/)
  await page.screenshot({ path: join(shots, 'pw-photo-card.png') })

  // The card is saved with the photo
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.tray-chip').click()
  await page.locator('.tray li').first().click()
  await page.locator('.photo-open').first().click()
  await page.locator('.photo-card h2').filter({ hasText: '新居装修验收' }).waitFor()
  assert.equal(await page.getByRole('button', { name: '重新生成' }).count(), 1)

  // A legacy card can exist without any visual observation. It must be repaired
  // once, then retained on subsequent loads instead of running indefinitely.
  const beforeRepair = cardCalls
  await page.evaluate(async () => {
    const { openDB } = await import('/node_modules/.vite/deps/idb.js')
    const db = await openDB('personal-world-card-test', 1)
    const saved = await db.get('state', 'current')
    saved.assets[0].card.scene = ''
    await db.put('state', saved, 'current'); db.close()
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(async () => {
    const { openDB } = await import('/node_modules/.vite/deps/idb.js')
    const db = await openDB('personal-world-card-test', 1)
    const saved = await db.get('state', 'current'); db.close()
    return Boolean(saved.assets[0].card.scene)
  })
  assert.equal(cardCalls, beforeRepair + 1, '空观察旧卡片应自动补分析一次')
  await page.reload({ waitUntil: 'networkidle' })
  assert.equal(cardCalls, beforeRepair + 1, '有效卡片不应重复调用模型')

  await page.setViewportSize({ width: 390, height: 844 })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  assert.ok(overflow <= 1, `手机宽度不应横向溢出，实际 ${overflow}px`)
  assert.equal(errors.length, 0, `浏览器运行时不应报错：${errors.join('; ')}`)
  console.log('Photo card test passed: filename time, facts vs inference, masked number, saved with the photo.')
} finally {
  await browser.close()
}

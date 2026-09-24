import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
await page.route('**/api/config', (route) => route.fulfill({
  contentType: 'application/json',
  body: JSON.stringify({ available: false, mode: 'unconfigured', message: '本地测试模式' }),
}))

try {
  await page.goto('http://localhost:5183/', { waitUntil: 'networkidle' })
  assert.equal(await page.title(), 'Personal World · 人生地图')
  assert.equal(errors.length, 0, '浏览器运行时不应报错')
  assert.equal(await page.getByRole('heading', { name: '还没有事件' }).count(), 1)
  const stillFrame = await page.screenshot()
  await page.waitForTimeout(900)
  assert.ok(stillFrame.equals(await page.screenshot()), '页面不应自行漂浮或抖动')

  await page.getByRole('button', { name: '导入第一批影像' }).click()
  await page.locator('input[type="file"]').setInputFiles('需求.png')
  await page.locator('.timeline-entry').waitFor()
  assert.equal(await page.locator('.timeline-entry').count(), 1, '导入后应生成一个事件')
  await page.screenshot({ path: join(tmpdir(), 'memory-events.png'), fullPage: true })

  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.timeline-entry').waitFor()
  assert.equal(await page.locator('.timeline-entry').count(), 1, '刷新后应保留本地影像')
  await page.locator('.timeline-entry').click()
  await page.getByRole('button', { name: '手动完善' }).click()
  await page.getByLabel('事件标题').fill('黑客松准备日')
  await page.getByLabel('这段记忆').fill('整理了项目需求和原型方向。')
  await page.getByLabel('地点').fill('上海')
  await page.getByLabel('人物（用逗号分隔）').fill('小丁')
  await page.getByRole('button', { name: '确认并保存' }).click()
  await page.getByRole('button', { name: '关闭事件详情' }).click()
  assert.match(await page.locator('.timeline-entry').innerText(), /黑客松准备日/)

  await page.getByRole('button', { name: '导入影像' }).click()
  await page.locator('input[type="file"]').setInputFiles('需求.png')
  await page.getByRole('status').getByText(/跳过 1 个重复文件/).waitFor()
  await page.getByRole('button', { name: '关闭导入窗口' }).click()
  assert.equal(await page.locator('.timeline-entry').count(), 1, '重复文件不应创建新事件')

  await page.unroute('**/api/config')
  await page.route('**/api/config', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ available: true, mode: 'model', message: 'StepFun 模拟测试' }),
  }))
  await page.route('**/api/analyze', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ title: '准备原型', summary: '整理产品需求。', type: '工作', place: '', people: [], visibleText: '人生地图', tags: ['原型'], questions: ['和谁一起准备？'], confidence: 0.8 }),
  }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.timeline-entry').click()
  await page.getByRole('button', { name: '用 StepFun 分析' }).click()
  await page.getByText('影像中的文字').waitFor()
  assert.match(await page.locator('.ocr-block').innerText(), /人生地图/)
  await page.screenshot({ path: join(tmpdir(), 'memory-mobile-detail.png') })
  await page.getByRole('button', { name: '关闭事件详情' }).click()
  for (const width of [320, 390, 600, 760, 768, 900, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    assert.ok(overflow <= 1, `${width}px 布局不应横向溢出，实际溢出 ${overflow}px`)
  }
  assert.equal(errors.length, 0, `浏览器运行时不应报错：${errors.join('; ')}`)
  console.log('Smoke test passed: import, persistence, edit, duplicate skip, AI analysis UI, mobile layout.')
} finally {
  await browser.close()
}

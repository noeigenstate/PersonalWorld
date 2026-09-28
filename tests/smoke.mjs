import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { fakeGeocode, makeLifeFixtures } from './fixtures.mjs'

// npm run dev → http://localhost:5183/; npm run dev:lan → BASE_URL=https://localhost:5183/
const BASE = process.env.BASE_URL || 'http://localhost:5183/'
const shots = process.env.SMOKE_SHOTS || tmpdir()
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] })
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 }, permissions: ['microphone'] })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

// A silent WAV stands in for StepFun speech
const silentWav = (() => {
  const b = Buffer.alloc(44 + 3200)
  b.write('RIFF', 0); b.writeUInt32LE(36 + 3200, 4); b.write('WAVE', 8); b.write('fmt ', 12)
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28)
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(3200, 40)
  return b
})()

// Accounts are mocked here; tests/api.mjs covers the real server side
const accounts = new Map([['老用户', 'oldpass1']])
const consented = new Set()
let signedIn = null
await page.route('**/api/auth/**', (route) => {
  const path = new URL(route.request().url()).pathname
  const body = route.request().method() === 'POST' ? route.request().postDataJSON() : {}
  const user = (name) => ({ user: { id: `id-${encodeURIComponent(name)}`, username: name, createdAt: '2026-09-24T00:00:00Z', privacyAccepted: consented.has(name) } })
  if (path.endsWith('/me')) return signedIn ? route.fulfill({ json: user(signedIn) }) : route.fulfill({ status: 401, json: { error: '请先登录' } })
  if (path.endsWith('/logout')) { signedIn = null; return route.fulfill({ json: { ok: true } }) }
  if (path.endsWith('/privacy')) { consented.add(signedIn); return route.fulfill({ json: user(signedIn) }) }
  if (path.endsWith('/register')) {
    if (body.acceptPrivacy !== true) return route.fulfill({ status: 400, json: { error: '请先阅读并同意隐私声明' } })
    if (accounts.has(body.username)) return route.fulfill({ status: 409, json: { error: '这个用户名已被注册' } })
    accounts.set(body.username, body.password); consented.add(body.username); signedIn = body.username
    return route.fulfill({ status: 201, json: user(body.username) })
  }
  if (accounts.get(body.username) !== body.password) return route.fulfill({ status: 401, json: { error: '用户名或密码不正确' } })
  signedIn = body.username
  return route.fulfill({ json: user(body.username) })
})
async function register(name, password) {
  await page.locator('#auth-username').fill(name)
  await page.locator('#auth-password').fill(password)
  if (!(await page.locator('#auth-consent').isChecked())) await page.locator('#auth-consent').check()
  await page.getByRole('button', { name: '注册' }).first().click()
}

const butlerCalls = []
let asrBytes = 0
await page.route('**/api/config', (route) => route.fulfill({ json: { available: true, mode: 'model', message: '模拟 StepFun', geocode: true } }))
await page.route('**/api/geocode', (route) => route.fulfill({ json: { results: route.request().postDataJSON().points.map(fakeGeocode) } }))
await page.route('**/api/analyze', (route) => route.fulfill({ json: { title: '加班的夜晚', summary: '在办公室加班。', type: '工作', place: '', city: '上海市', people: [], visibleText: '', tags: [], questions: ['这是在公司吗？'], confidence: 0.6 } }))
await page.route('**/api/photo-card', (route) => route.fulfill({ json: { title: '测试照片', caption: '', scene: '测试画面', visibleText: '', clues: [], landmark: null, placeQuery: null, eventGuess: { type: '', reason: '' }, tags: [], questions: [] } }))
await page.route('**/api/asr', (route) => { asrBytes = route.request().postDataBuffer()?.length || 0; return route.fulfill({ json: { text: '2019 年国庆那会儿发生了什么？' } }) })
await page.route('**/api/tts', (route) => route.fulfill({ contentType: 'audio/wav', body: silentWav }))
await page.route('**/api/butler', (route) => {
  const body = route.request().postDataJSON()
  butlerCalls.push(body)
  const event = body.memory.events.find((e) => e.start === '2019-10-02')
  return route.fulfill({ json: { answer: '那是爸妈照片记录中第一次来上海看你，你们去了〔外滩〕。', eventIds: [event.id] } })
})

// Globe and street map are both mounted; only the one on screen counts
const placeLabel = (name) => page.locator('.map-label.place:visible').filter({ hasText: name })
async function chooseGlobeCity(name) {
  const single = page.locator('.globe-place').filter({ hasText: name })
  if (await single.count()) return single.first().click()
  await page.locator('.globe-cluster').filter({ hasText: name }).first().click()
  await page.getByRole('dialog', { name: '选择地点' }).getByRole('button', { name: new RegExp(name) }).click()
}

try {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  assert.equal(await page.title(), 'Personal World · 人生地图')
  // Registration: username and password only
  await page.getByRole('heading', { name: '创建你的账户' }).waitFor()
  assert.equal(await page.locator('.auth input:not([type="checkbox"])').count(), 2, '注册只需要用户名和密码')
  // Without ticking the privacy statement, registration is refused
  await page.locator('#auth-username').fill('小丁')
  await page.locator('#auth-password').fill('secret12')
  await page.getByRole('button', { name: '注册' }).first().click()
  await page.getByRole('alert').getByText('请先阅读并同意隐私声明').waitFor()
  await page.getByRole('button', { name: '隐私声明' }).click()
  await page.getByRole('dialog', { name: '隐私声明' }).getByText('照片里的敏感文字').waitFor()
  await page.getByRole('dialog', { name: '隐私声明' }).getByRole('button', { name: '同意' }).click()
  assert.ok(await page.locator('#auth-consent').isChecked(), '在声明里点同意会勾选')
  await page.screenshot({ path: join(shots, 'pw-0-register.png') })
  await register('小丁', 'secret12')
  await page.locator('.account').filter({ hasText: '小丁' }).waitFor()
  // The empty map appears once the account vault has been checked for photos to restore
  await page.getByRole('heading', { name: '从照片开始，画出你的人生地图' }).waitFor()
  assert.equal(await page.locator('.app-bar nav').count(), 0, '顶栏不放导航：人生管家随地点自动弹出')
  // The globe's drawing loads asynchronously; compare only once it is on screen
  await page.locator('.life-globe[data-texture]').waitFor()
  await page.waitForTimeout(300)
  const still = await page.screenshot()
  await page.waitForTimeout(900)
  assert.ok(still.equals(await page.screenshot()), '页面不应自行漂浮或抖动')

  // Import a whole life
  const files = await makeLifeFixtures(page, mkdtempSync(join(tmpdir(), 'pw-life-')))
  await page.getByRole('button', { name: '导入第一批影像' }).click()
  await page.locator('input[type="file"]').setInputFiles(files)
  await page.locator('.life-globe[data-place-count="4"]').waitFor()
  assert.deepEqual((await page.locator('.life-globe').getAttribute('data-place-names')).split('|').sort(), ['上海', '杭州', '武汉', '湘潭'], '湘潭、武汉、上海、杭州四个地点')
  assert.equal(await page.locator('.map-label.lifted').count(), 0, '标签不再抬高拉竖线')
  assert.deepEqual([...new Set(await page.locator('.map-label.place').evaluateAll((els) => els.map((el) => Boolean(el.dataset.side))))], [true], '地点是带尖角的气泡')
  assert.equal(await page.locator('.timebar .dot').count(), 16, '35 张照片应整理为 16 件事')
  assert.ok((await page.locator('.timebar .years span').count()) >= 5, '时间线下方有时间刻度')
  assert.match(await page.locator('.timebar-head span').innerText(), /^2012\.\d\d – 2026\.\d\d · 16 件事$/, '时间线标出起止时间')
  assert.equal(await page.locator('.map-heading p, .map-heading .legend').count(), 0, '总览不再显示统计行和图例')
  await page.locator('.globe-cluster').filter({ hasText: '杭州' }).first().click()
  assert.match(await page.getByRole('dialog', { name: '选择地点' }).getByRole('button', { name: /杭州/ }).innerText(), /1 件事/, '两天的杭州旅行应合并为一件事')
  await page.keyboard.press('Escape')
  assert.deepEqual(await page.locator('.band-name').allInnerTexts(), ['湘潭 · 生活过', '武汉 · 生活过', '上海 · 生活过'], '空间线按迁徙顺序')
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(shots, 'pw-1-overview.png') })
  const scrubber = page.getByRole('slider', { name: '拖动时间进度条' })
  assert.equal(await page.locator('.timebar').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', '时间线没有大背景')
  await scrubber.click({ position: { x: 320, y: 24 } })
  const scrubValue = Number(await scrubber.inputValue())
  assert.ok(scrubValue > 100 && scrubValue < 400, `点击时间轨道应移动进度：${scrubValue}`)
  assert.ok((await page.locator('.timebar-head span').innerText()).includes('·'), '拖动后显示所选时间')
  const scrubBox = await scrubber.boundingBox()
  await page.mouse.move(scrubBox.x + 320, scrubBox.y + 24)
  await page.mouse.down()
  await page.mouse.move(scrubBox.x + 650, scrubBox.y + 24, { steps: 8 })
  await page.mouse.up()
  assert.ok(Number(await scrubber.inputValue()) > scrubValue, '拖动滑块应连续推进时间')
  await scrubber.focus()
  await page.keyboard.press('End')
  assert.equal(Number(await scrubber.inputValue()), 1000, '键盘也可以移动时间进度')
  const overview = page.locator('.life-globe')
  const beforeRotation = await overview.getAttribute('data-orientation')
  await page.mouse.move(1040, 520)
  await page.mouse.down()
  await page.mouse.move(1120, 560, { steps: 6 })
  await page.mouse.up()
  assert.notEqual(await overview.getAttribute('data-orientation'), beforeRotation, '拖动应旋转地球')
  await page.getByRole('button', { name: '放大地球' }).click()
  // The zoom glides over a few frames
  await page.waitForFunction(() => Number(document.querySelector('.life-globe')?.dataset.zoom) > 1, null, { timeout: 3000 }).catch(() => {})
  assert.ok(Number(await overview.getAttribute('data-zoom')) > 1, '放大按钮应改变地球缩放')
  await page.getByRole('button', { name: '回到照片区域' }).click()
  assert.equal(await overview.getAttribute('data-orientation'), beforeRotation, '归位后照片地点应回到正面')
  assert.equal(await overview.getAttribute('data-zoom'), '1.000', '归位后恢复初始缩放')

  // Click a place: story line + butler
  await chooseGlobeCity('上海')
  await page.locator('.butler').waitFor()
  await page.waitForTimeout(900)
  assert.match(await page.locator('.map-heading h1').innerText(), /上海的故事线/)
  assert.equal(await page.locator('.map-label.event').count(), 6, '上海 5 件事加上从上海出发的杭州旅行')
  assert.equal(await page.locator('.map-label.event.has-photo').count(), 6, '备用卡通地图也把封面与日期放在同一张事件卡片里')
  assert.match(await page.locator('.bubble.bot').first().innerText(), /我记得这里的 6 件事/)
  await page.locator('.role-choices').getByRole('button', { name: '工作' }).click()
  assert.match(await page.locator('.bubble.bot').last().innerText(), /上海是你工作的地方/)
  assert.match(await placeLabel('上海').innerText(), /上海 · 工作/)

  // Hold to talk
  const hold = page.locator('.hold')
  const box = await hold.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.locator('.hold.recording').waitFor()
  await page.waitForTimeout(1200)
  await page.mouse.up()
  await page.locator('.bubble.me').filter({ hasText: '2019 年国庆' }).waitFor()
  await page.locator('.bubble.bot .inferred').waitFor()
  assert.ok(asrBytes > 1000, `录音应以 WAV 上传，实际 ${asrBytes} 字节`)
  assert.equal(await page.locator('.bubble.me .voice-tag').count(), 1)
  assert.equal(await page.locator('.bubble.bot .inferred').innerText(), '外滩', '推断内容应标出')
  assert.match(await page.locator('.bubble.bot').last().innerText(), /依据：1 个事件 · 3 张照片/)
  const call = butlerCalls.at(-1)
  assert.equal(call.focus.city, '上海市')
  assert.equal(call.memory.events.length, 16)
  assert.ok(!JSON.stringify(call).includes('data:image'), '管家请求不应包含图片')
  assert.equal(await page.locator('.timebar .dot.now').count(), 1, '时间线定位到被提到的事件')
  assert.match(await page.locator('.map-label.event.now').innerText(), /2019\.10/, '故事线上的事件高亮')
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(shots, 'pw-2-story.png') })

  // Story node opens the event
  await page.locator('.map-label.event').filter({ hasText: '2018.07' }).locator('.map-event-cover').click()
  await page.locator('.detail-panel').waitFor()
  assert.match(await page.locator('.first-tags').innerText(), /照片记录中第一次在上海/)
  assert.match(await page.locator('.detail-fields').innerText(), /由照片定位得出/)
  await page.getByRole('button', { name: '关闭事件详情' }).click()

  // The photo without GPS gets a city from the AI and shows as unconfirmed
  await page.locator('.tray-chip').click()
  await page.locator('.tray li').filter({ hasText: '未定位' }).click()
  await page.getByRole('button', { name: '用 StepFun 分析' }).click()
  await page.locator('.detail-fields').getByText('AI 推断，待你确认').waitFor()
  await page.getByRole('button', { name: '关闭事件详情' }).click()
  assert.equal(await page.locator('.map-label.event').count(), 7)
  assert.equal(await page.locator('.map-label.event.unsure').count(), 1, 'AI 推断的地点用虚线')

  // Persistence and duplicates
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.life-globe[data-place-count="4"]').waitFor()
  await page.locator('.globe-cluster').filter({ hasText: '上海' }).first().click()
  assert.match(await page.getByRole('dialog', { name: '选择地点' }).getByRole('button', { name: /上海/ }).innerText(), /上海 · 工作/, '确认的据点角色应保存')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '导入影像' }).click()
  await page.locator('input[type="file"]').setInputFiles(files)
  await page.getByRole('status').getByText(/跳过 35 个重复文件/).waitFor()
  await page.getByRole('button', { name: '关闭导入窗口' }).click()
  assert.equal(await page.locator('.timebar .dot').count(), 16)

  // Each account has its own local data
  await page.getByRole('button', { name: '退出登录' }).click()
  await page.getByRole('heading', { name: '欢迎回来' }).waitFor()
  await page.getByRole('button', { name: '注册' }).click()
  await register('小丁', 'another1')
  await page.getByRole('alert').getByText('这个用户名已被注册').waitFor()
  await register('阿杰', 'secret34')
  await page.getByRole('heading', { name: '从照片开始，画出你的人生地图' }).waitFor()
  assert.equal(await page.locator('.timebar .dot').count(), 0, '新账户看不到别人的照片')
  await page.getByRole('button', { name: '退出登录' }).click()
  await page.locator('#auth-username').fill('小丁')
  await page.locator('#auth-password').fill('wrong-pass')
  await page.getByRole('button', { name: '登录' }).click()
  await page.getByRole('alert').getByText('用户名或密码不正确').waitFor()
  await page.locator('#auth-password').fill('secret12')
  await page.getByRole('button', { name: '登录' }).click()
  await page.locator('.life-globe[data-place-count="4"]').waitFor()

  // An account from before the statement sees it once after signing in
  await page.getByRole('button', { name: '退出登录' }).click()
  await page.locator('#auth-username').fill('老用户')
  await page.locator('#auth-password').fill('oldpass1')
  await page.getByRole('button', { name: '登录' }).click()
  await page.getByRole('heading', { name: '请阅读隐私声明' }).waitFor()
  await page.getByRole('button', { name: '同意并继续' }).click()
  await page.getByRole('heading', { name: '从照片开始，画出你的人生地图' }).waitFor()
  await page.getByRole('button', { name: '退出登录' }).click()
  await page.locator('#auth-username').fill('小丁')
  await page.locator('#auth-password').fill('secret12')
  await page.getByRole('button', { name: '登录' }).click()
  await page.locator('.life-globe[data-place-count="4"]').waitFor()
  assert.equal(await page.locator('.timebar .dot').count(), 16, '登录回来数据还在')

  // Choosing a place opens the life butler by itself
  assert.equal(await page.locator('.butler').count(), 0, '没选地点时不显示对话框')
  await chooseGlobeCity('上海')
  await page.locator('.butler').waitFor()

  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 })
    await page.waitForTimeout(100)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    assert.ok(overflow <= 1, `${width}px 布局不应横向溢出，实际溢出 ${overflow}px`)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '关闭人生管家' }).click()
  await page.waitForTimeout(1000)
  await page.screenshot({ path: join(shots, 'pw-3-mobile.png') })
  assert.equal(errors.length, 0, `浏览器运行时不应报错：${errors.join('; ')}`)
  console.log('Smoke test passed: register/login, per-account data, import → places, story line, butler (voice), inferred marks, AI city, persistence, layout.')
} finally {
  await browser.close()
}

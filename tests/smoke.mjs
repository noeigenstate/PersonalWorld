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
const storyTtsCalls = [], storyNotes = []
let latestStory = null, ttsFails = false
let asrBytes = 0
let asrCalls = 0
// What StepFun "hears" for the next hold-to-talk
let asrText = ''
await page.route('**/api/config', (route) => route.fulfill({ json: { available: true, mode: 'model', message: '模拟 StepFun', geocode: true } }))
await page.route('**/api/geocode', (route) => route.fulfill({ json: { results: route.request().postDataJSON().points.map(fakeGeocode) } }))
// Events analyze themselves after import; every event gets this answer (GPS cities are kept)
await page.route('**/api/analyze', (route) => route.fulfill({ json: { title: '加班的夜晚', summary: '在办公室加班。', type: '工作', place: '', city: '上海市', people: [], visibleText: '', tags: [], questions: ['这是在公司吗？'], confidence: 0.6 } }))
// A little slower than instant, so the loading gate can be seen working
await page.route('**/api/photo-card', async (route) => { await new Promise((resolve) => setTimeout(resolve, 150)); return route.fulfill({ json: { title: '测试照片', caption: '', scene: '测试画面', visibleText: '', clues: [], landmark: null, placeQuery: null, eventGuess: { type: '', reason: '' }, tags: [], questions: [] } }) })
await page.route('**/api/asr', (route) => { asrCalls++; asrBytes = route.request().postDataBuffer()?.length || 0; return route.fulfill({ json: { text: asrText } }) })
await page.route('**/api/tts', (route) => {
  const text = route.request().postDataJSON().text
  storyTtsCalls.push(text)
  if (ttsFails) return route.fulfill({ status: 503, json: { error: '测试语音暂不可用' } })
  return route.fulfill({ contentType: 'audio/wav', body: silentWav })
})
await page.route('**/api/storytelling/list', route => route.fulfill({ json: { stories: latestStory ? [latestStory] : [] } }))
await page.route('**/api/storytelling/note', route => { storyNotes.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } }) })
// The butler answers with actions that drive the map: a role, a narrated slideshow, a photo search
await page.route('**/api/butler', (route) => {
  const body = route.request().postDataJSON()
  butlerCalls.push(body)
  const question = body.question
  if (body.intent === 'story') {
    const selected = body.memory.photos.filter(p => p.city === '上海市').slice(0, 3)
    const ids = selected.map(p => p.id)
    latestStory = { id: `test-story-${butlerCalls.length}`, title: '灯亮的时候', premise: '同一座城市，不同日子的画面互相呼应。', format: 'revisit', tone: 'quiet', assetIds: ids, createdAt: '2026-09-28', sourceRevision: 'test', reflection: null,
      evidence: selected.map(p => ({ ...p, timeSource: 'exif', observed: p.scene })),
      beats: [
        { id: 'a', assetIds: ids.slice(0, 2), evidenceIds: ids.slice(0, 2), layout: 'sequence', text: '先看看两个不同日子的灯光，照片之间留着一段时间。', leadInMs: 0, holdMs: 1200 },
        { id: 'b', assetIds: ids.slice(0, 2), evidenceIds: ids.slice(0, 2), layout: 'compare', text: '把这两个日子放在一起，看看镜头里留下了什么。', leadInMs: 0, holdMs: 6000 },
        { id: 'c', assetIds: [ids[2]], evidenceIds: [ids[2]], layout: 'single', text: '', leadInMs: 0, holdMs: 3000 },
        { id: 'd', assetIds: [ids[0]], evidenceIds: [ids[0]], layout: 'single', text: '回到开头这一张，先不急着翻过去。', leadInMs: 500, holdMs: 800 },
      ] }
    return route.fulfill({ json: { answer: '', eventIds: [], assetIds: ids, actions: [{ type: 'story', story: latestStory }] } })
  }
  if (question === '工作') return route.fulfill({ json: { answer: '记下了，上海是你工作的地方。', eventIds: [], assetIds: [], actions: [{ type: 'set_place_role', city: body.state.pendingRoleCity, role: 'work' }] } })
  if (question.includes('杭州')) {
    const ids = body.memory.photos.filter((p) => p.city === '杭州市').map((p) => p.id)
    return route.fulfill({ json: { answer: `找到 ${ids.length} 张杭州的照片。`, eventIds: [], assetIds: [], actions: [{ type: 'show_photos', assetIds: ids }] } })
  }
  const event = body.memory.events.find((e) => e.start === '2019-10-02')
  const ids = body.memory.photos.filter((p) => p.eventId === event.id).map((p) => p.id)
  if (question.includes('短片')) return route.fulfill({ json: { answer: '好，我把这次的照片剪成一段短片，需要一两分钟。', eventIds: [event.id], assetIds: [], actions: [{ type: 'make_film', assetIds: ids }] } })
  if (question.includes('第一次')) {
    // A guided story from the record's firsts, lasts and moves: first time in Shanghai, last time in Wuhan
    const firstShanghai = body.memory.events.find((e) => e.start === '2018-07-02')
    const lastWuhan = body.memory.events.find((e) => e.start === '2018-06-20')
    const photoOf = (e) => body.memory.photos.find((p) => p.eventId === e.id).id
    return route.fulfill({ json: { answer: '这段要从 2018 年夏天说起。', eventIds: [firstShanghai.id, lastWuhan.id], assetIds: [], actions: [{ type: 'story', steps: [
      { assetId: photoOf(firstShanghai), text: `2018 年 7 月，${firstShanghai.firsts[0]}。` },
      { assetId: photoOf(lastWuhan), text: `那之前，${lastWuhan.lasts[0]}，〔毕业〕后你就去了上海。` },
    ] }] } })
  }
  return route.fulfill({ json: { answer: '那是爸妈照片记录中第一次来上海看你，你们去了〔外滩〕。', eventIds: [event.id], assetIds: [], actions: [{ type: 'slideshow', assetIds: ids }] } })
})
// Hold the microphone, say `text`, release
async function holdToTalk(text) {
  asrText = text
  const hold = page.locator('.hold')
  const box = await hold.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.locator('.hold.recording').waitFor()
  await page.locator('.subtitle.me.live').waitFor()
  await page.waitForTimeout(1200)
  await page.mouse.up()
}

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
  // The globe's drawing loads asynchronously; compare only once it is on screen. The sky behind
  // the globe (shooting stars, a saucer, a space station) is the one layer meant to move.
  await page.locator('.life-globe[data-texture]').waitFor()
  await page.addStyleTag({ content: '.globe-sky{visibility:hidden}' })
  await page.waitForTimeout(300)
  const still = await page.screenshot()
  await page.waitForTimeout(900)
  assert.ok(still.equals(await page.screenshot()), '页面不应自行漂浮或抖动')
  assert.equal(await page.locator('.globe-sky').count(), 1, '星空有自己的一层动画')

  // Import a whole life
  const files = await makeLifeFixtures(page, mkdtempSync(join(tmpdir(), 'pw-life-')))
  await page.getByRole('button', { name: '导入第一批影像' }).click()
  await page.locator('input[type="file"]').setInputFiles(files)
  // The analysis runs in the background with its progress shown, and the map stays usable
  const progress = page.getByRole('status', { name: '后台分析进度' })
  await progress.waitFor({ timeout: 10_000 })
  await progress.locator('[data-step="cards"] [role="progressbar"]').waitFor()
  assert.match(await progress.locator('[data-step="cards"]').innerText(), /照片信息卡[\s\S]*\d+%/, '后台进度显示照片信息卡的进度')
  assert.equal(await page.locator('.load-gate').count(), 0, '分析期间不遮挡地图')
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

  // Analysis is automatic: photo cards first, then every event, without a button
  assert.equal(await page.locator('.voice-butler .hold').count(), 1, '话筒按钮始终在地图上')
  assert.equal(await page.locator('.subtitle').count(), 0, '没选地点、没说话时没有字幕')
  await page.locator('.locating-chip').filter({ hasText: '事件已自动分析' }).waitFor({ timeout: 40_000 })
  await progress.waitFor({ state: 'detached', timeout: 10_000 })
  assert.equal(await page.locator('.tray-chip').count(), 0, '分析后没有待整理的事件')

  // Click a place: story line + the butler speaks first, as a subtitle over the map
  await chooseGlobeCity('上海')
  await page.locator('.subtitle.bot').waitFor()
  await page.waitForTimeout(900)
  assert.match(await page.locator('.map-heading h1').innerText(), /上海的故事线/)
  assert.equal(await page.locator('.map-label.event').count(), 7, '上海 5 件事、从上海出发的杭州旅行，和自动分析认到上海的那张截图')
  assert.equal(await page.locator('.map-label.event.has-photo').count(), 7, '备用卡通地图也把封面与日期放在同一张事件卡片里')
  assert.equal(await page.locator('.map-label.event.unsure').count(), 1, 'AI 推断的地点用虚线')
  assert.equal(await page.locator('.map-heading .button').count(), 0, '人物与故事、时空场景、回忆短片不做按钮，由管家在对话中打开')
  assert.match(await page.locator('.subtitle.bot').innerText(), /我记得这里的 7 件事/)
  assert.match(await page.locator('.subtitle.bot').innerText(), /老家、求学、工作还是居住/, '据点角色由管家用语音问')

  // Answer the role by voice
  await holdToTalk('工作')
  await page.locator('.subtitle.bot').filter({ hasText: '上海是你工作的地方' }).waitFor()
  assert.equal(butlerCalls.at(-1).state.pendingRoleCity, '上海市', '管家知道自己刚问过哪个城市')
  assert.match(await placeLabel('上海').innerText(), /上海 · 工作/)

  // Ask about a time: the answer is narrated over a slideshow of that event's photos
  await holdToTalk('2019 年国庆那会儿发生了什么？')
  await page.locator('.subtitle.bot .inferred').waitFor()
  assert.ok(asrBytes > 1000, `录音应以 WAV 上传，实际 ${asrBytes} 字节`)
  assert.equal(await page.locator('.subtitle.bot .inferred').innerText(), '外滩', '推断内容应标出')
  await page.locator('.showcase.slideshow[data-count="3"]').waitFor()
  assert.equal(await page.locator('.showcase-strip button').count(), 3, '这件事的 3 张照片进入幻灯片')
  const call = butlerCalls.at(-1)
  assert.equal(call.focus.city, '上海市')
  assert.equal(call.state.city, '上海市')
  assert.equal(call.memory.events.length, 16)
  assert.equal(call.memory.photos.length, 35, '每张照片的信息卡都给管家做语义搜索')
  assert.ok(!JSON.stringify(call).includes('data:image'), '管家请求不应包含图片')
  assert.equal(await page.locator('.timebar .dot.now').count(), 1, '时间线定位到被提到的事件')
  assert.match(await page.locator('.map-label.event.now').innerText(), /2019\.10/, '故事线上的事件高亮')
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(shots, 'pw-2-story.png') })

  // Find photos by meaning: the butler picks them and puts them on the stage
  await holdToTalk('找找杭州的照片')
  await page.locator('.subtitle.bot').filter({ hasText: '找到 3 张杭州的照片' }).waitFor()
  await page.locator('.showcase.gallery[data-count="3"]').waitFor()
  await page.getByRole('button', { name: '收起照片' }).click()
  assert.equal(await page.locator('.showcase').count(), 0)

  // Ask for a memory film: the butler opens the film window and starts cutting (here the window
  // explains that this test browser has no film service behind it)
  await holdToTalk('把国庆那次剪成回忆短片')
  await page.getByRole('dialog', { name: '你的回忆，自己成片' }).waitFor()
  assert.equal(await page.locator('.map-heading .film-entry').count(), 0, '回忆短片没有按钮，靠管家打开')
  await page.getByRole('button', { name: '关闭回忆短片' }).click()

  // First time, last time: a guided story — one photo and one spoken sentence per step
  await holdToTalk('我第一次来上海是什么时候？')
  await page.locator('.showcase.slideshow[data-count="2"]').waitFor()
  await page.locator('.subtitle.bot').filter({ hasText: '第一次在上海' }).waitFor()
  await page.locator('.subtitle.bot').filter({ hasText: '最后一次在武汉' }).waitFor({ timeout: 15_000 })
  assert.equal(await page.locator('.showcase-strip button.on').getAttribute('aria-label'), '第 2 张', '故事讲到第二步，舞台也翻到第二张')
  assert.equal(await page.locator('.subtitle.bot .inferred').innerText(), '毕业', '离开的原因是推断，标出来')
  const storyCall = butlerCalls.at(-1)
  assert.deepEqual(storyCall.memory.moves.map((m) => `${m.from}→${m.to}`), ['湘潭市→武汉市', '武汉市→上海市'], '据点迁徙给管家')
  assert.match(storyCall.memory.events.find((e) => e.start === '2018-06-20').lasts[0], /^照片记录中最后一次在武汉，之后你去了上海$/, '没再回过武汉：照片记录中的最后一次')
  assert.match(storyCall.memory.events.find((e) => e.start === '2014-08-30').lasts[0], /^离开湘潭去武汉前，照片记录中最后一次在湘潭$/, '后来又回过湘潭：只是离开前的最后一次')
  await page.getByRole('button', { name: '收起照片' }).click()
  await page.getByRole('button', { name: '收起字幕' }).click()

  // Remote use: a prefilled text command waits for Send, then runs the same guided story
  // without recording audio or calling speech recognition.
  const callsBeforeText = butlerCalls.length, asrBeforeText = asrCalls
  const textPrompt = '我第一次来上海是什么时候？边看照片边讲，每张配一句解说。'
  await page.evaluate((text) => { window.location.hash = `tell=${encodeURIComponent(text)}` }, textPrompt)
  const textInput = page.getByRole('textbox', { name: '想回忆什么' })
  await textInput.waitFor()
  assert.equal(await textInput.inputValue(), textPrompt)
  assert.equal(butlerCalls.length, callsBeforeText, '预填链接不能自动调用管家')
  await textInput.press('Enter')
  await page.locator('.showcase.slideshow[data-count="2"]').waitFor()
  await page.locator('.subtitle.bot').filter({ hasText: '最后一次在武汉' }).waitFor({ timeout: 15_000 })
  assert.equal(butlerCalls.length, callsBeforeText + 1)
  assert.equal(butlerCalls.at(-1).question, textPrompt)
  assert.equal(asrCalls, asrBeforeText, '文字演绎不依赖麦克风或 ASR')
  assert.equal(new URL(page.url()).hash, '', '发送后清除预填链接')
  assert.equal(await page.locator('.showcase-strip button.on').getAttribute('aria-label'), '第 2 张')
  await page.screenshot({ path: join(shots, 'pw-text-story.png') })
  await page.getByRole('button', { name: '收起照片' }).click()
  await page.getByRole('button', { name: '收起字幕' }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  const formBounds = await page.getByRole('form', { name: '文字询问人生管家' }).boundingBox()
  assert.ok(formBounds && formBounds.x >= 0 && formBounds.x + formBounds.width <= 390, '手机上的文字入口不溢出')
  await page.screenshot({ path: join(shots, 'pw-text-mobile.png') })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: '收起文字输入' }).click()
  await page.getByRole('button', { name: '打字和管家说话' }).click()
  await textInput.waitFor()
  await textInput.press('Escape')

  // New narrative player: a paragraph spans photos, comparisons retain dates, silence is real,
  // pause/seek/close cancel work, and a user's optional memory stays linked to its photos.
  await page.getByRole('button', { name: '听回忆故事', exact: true }).click()
  await page.getByRole('button', { name: '自动挑选，讲一段新故事' }).click()
  await page.locator('.story-stage[data-beat="0"]').waitFor()
  await page.getByRole('button', { name: '暂停故事' }).click()
  const pausedBeat = await page.locator('.story-stage').getAttribute('data-beat')
  await page.waitForTimeout(1500)
  assert.equal(await page.locator('.story-stage').getAttribute('data-beat'), pausedBeat, '暂停后不会继续翻页')
  await page.getByRole('button', { name: '继续故事' }).click()
  await page.getByRole('button', { name: '第 2 段故事', exact: true }).click()
  await page.locator('.story-stage[data-beat="1"][data-layout="compare"]').waitFor()
  await page.getByRole('button', { name: '暂停故事' }).click()
  assert.equal(await page.locator('.story-pictures img').count(), 2)
  assert.equal(await page.locator('.story-pictures time').count(), 2, '对照照片各有自己的真实日期')
  await page.screenshot({ path: join(shots, 'pw-narrative-compare.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  const storyBounds = await page.locator('.story-stage').boundingBox()
  const inputBounds = await page.locator('.butler-input-controls').boundingBox()
  assert.ok(storyBounds.x >= 0 && storyBounds.x + storyBounds.width <= 390)
  assert.ok(storyBounds.y + storyBounds.height <= inputBounds.y, '故事不盖住手机输入入口')
  await page.screenshot({ path: join(shots, 'pw-narrative-mobile.png') })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: '第 3 段故事，留白', exact: true }).click()
  await page.locator('.story-stage[data-beat="2"][data-phase="hold"]').waitFor()
  assert.equal(await page.locator('.story-narration p').count(), 0, '留白段不显示上一段旁白')
  assert.ok(!storyTtsCalls.includes(''), '留白不请求空语音')
  await page.getByRole('button', { name: '第 4 段故事', exact: true }).click()
  await page.locator('.story-stage[data-phase="ended"]').waitFor()
  await page.locator('.story-afterword summary').click()
  await page.getByRole('textbox', { name: '补充这段回忆' }).fill('那天我们特意等到灯亮。')
  await page.getByRole('button', { name: '记住这件事' }).click()
  await page.getByRole('status').filter({ hasText: '已记住' }).waitFor()
  assert.equal(storyNotes.at(-1).storyId, latestStory.id)
  assert.deepEqual(storyNotes.at(-1).assetIds, latestStory.beats[3].assetIds)
  await page.getByRole('button', { name: '收起故事', exact: true }).click()
  await page.waitForTimeout(800)
  assert.equal(await page.locator('.story-stage').count(), 0, '收起后旧回调不能重新打开故事')
  ttsFails = true
  await page.getByRole('button', { name: '听回忆故事', exact: true }).click()
  await page.getByRole('button', { name: '自动挑选，讲一段新故事' }).click()
  await page.locator('.story-audio-note').waitFor()
  assert.equal(await page.locator('.story-stage').getAttribute('data-beat'), '0', '语音失败时保留字幕阅读时间，不瞬间跳完')
  await page.getByRole('button', { name: '收起故事', exact: true }).click()
  ttsFails = false

  // Story node opens the event
  await page.locator('.map-label.event').filter({ hasText: '2018.07' }).locator('.map-event-cover').click()
  await page.locator('.detail-panel').waitFor()
  assert.match(await page.locator('.first-tags').innerText(), /照片记录中第一次在上海/)
  assert.match(await page.locator('.detail-fields').innerText(), /由照片定位得出/)
  await page.getByRole('button', { name: '关闭事件详情' }).click()

  // The photo without GPS got its city from the automatic analysis and shows as unconfirmed
  await page.locator('.map-label.event.unsure .map-event-cover').click()
  await page.locator('.detail-panel').waitFor()
  await page.locator('.detail-fields').getByText('AI 推断，待你确认').waitFor()
  assert.match(await page.locator('.detail-auto').innerText(), /已自动分析/)
  assert.equal(await page.getByRole('button', { name: '用 StepFun 分析' }).count(), 0, '分析是自动的，没有手动按钮')
  await page.getByRole('button', { name: '关闭事件详情' }).click()

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

  // Choosing a place makes the life butler speak by itself
  assert.equal(await page.locator('.subtitle').count(), 0, '没选地点时没有字幕')
  await chooseGlobeCity('上海')
  await page.locator('.subtitle.bot').waitFor()

  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 })
    await page.waitForTimeout(100)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    assert.ok(overflow <= 1, `${width}px 布局不应横向溢出，实际溢出 ${overflow}px`)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  if (await page.locator('.subtitle').count()) await page.getByRole('button', { name: '收起字幕' }).click()
  await page.waitForTimeout(1000)
  await page.screenshot({ path: join(shots, 'pw-3-mobile.png') })
  assert.equal(errors.length, 0, `浏览器运行时不应报错：${errors.join('; ')}`)
  console.log('Smoke test passed: register/login, per-account data, import → places, automatic analysis, story line, voice butler (subtitles, role, slideshow, photo search), inferred marks, AI city, persistence, layout.')
} finally {
  await browser.close()
}

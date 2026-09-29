// 4D spacetime scene on a story line: an isolated account, the life butler asked by voice how the
// place changed (it opens the scene; there is no button), a mocked StepFun that splits the place's
// photos into two epochs, and (when this computer's ComfyUI has the Depth Anything 3
// model) the real reconstruction of the key photo, shown in the viewer. Needs `npm run dev`.
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { reliefCapability } from '../server/spacetimeScene.mjs'

const dir = mkdtempSync(join(tmpdir(), 'pw-spacetime-'))
const shots = process.env.SMOKE_SHOTS || dir
// SPACETIME_PHOTO: any photo to reconstruct (default: a cartoon fixture)
const photo = 'data:image/jpeg;base64,' + readFileSync(process.env.SPACETIME_PHOTO || new URL('../skills/photo-cull/evals/2026-09-28/images/all-a.jpg', import.meta.url)).toString('base64')
const capability = await reliefCapability()

let calls = 0
const mock = http.createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk)
  const payload = JSON.parse(Buffer.concat(chunks).toString() || '{}')
  // Other StepFun work (automatic analysis, speech) is not what this test is about
  if (!String(payload.messages?.[0]?.content || '').includes('4D 时空场景的分段与证据')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }] }))
  }
  assert.match(payload.messages[1].content, /共 4 张照片/)
  assert.ok(!JSON.stringify(payload).includes('data:image'), '分段只用信息卡文字，不发图片')
  calls++
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
    place: '示例公园',
    epochs: [
      { ref: 'E1', from: '2020-10-03', to: '2020-10-03', title: '秋天的公园', photoRefs: ['P1', 'P2'], keyPhoto: 'P1', layers: { season: { value: '秋', evidence: 'observed', basis: 'P1 落叶' }, timeOfDay: { value: '白天', evidence: 'inferred', basis: '光线' }, weather: { value: null, evidence: 'unknown', basis: '' }, buildings: [{ name: '公园的凉亭', state: '已建成', evidence: 'observed', basis: 'P2' }], sound: { value: null, evidence: 'unknown', basis: '' }, traffic: { value: null, evidence: 'unknown', basis: '' } }, changes: '', caption: '公园里的秋天' },
      { ref: 'E2', from: '2023-04-16', to: '2023-04-16', title: '春天再来', photoRefs: ['P3', 'P4'], keyPhoto: 'P3', layers: { season: { value: '春', evidence: 'inferred', basis: '4 月' }, timeOfDay: { value: null, evidence: 'unknown', basis: '' }, weather: { value: null, evidence: 'unknown', basis: '' }, buildings: [], sound: { value: null, evidence: 'unknown', basis: '' }, traffic: { value: null, evidence: 'unknown', basis: '' } }, changes: '', caption: '两年半后' },
    ],
    undated: [],
    summary: '两个时段',
  }) } }] }))
})
await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve))
const api = spawn(process.execPath, ['server/index.mjs'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PORT: '0', STORY_UNDERSTANDING_DISABLED: '1', USERS_FILE: join(dir, 'users.json'), STEPFUN_BASE_URL: `http://127.0.0.1:${mock.address().port}`, STEPFUN_API_KEY: 'fixture', STEPFUN_MODEL: 'fixture' } })
api.stderr.on('data', (chunk) => process.stderr.write(chunk))
let browser
try {
  const port = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('API startup timeout')), 10000); api.stdout.on('data', (chunk) => { const hit = String(chunk).match(/127\.0\.0\.1:(\d+)/); if (hit) { clearTimeout(timer); resolve(hit[1]) } }); api.on('exit', () => { clearTimeout(timer); reject(new Error('API exited')) }) })
  const base = `http://127.0.0.1:${port}`
  const headers = { 'Content-Type': 'application/json', 'X-Memory-Agent': 'web' }
  const registration = await fetch(`${base}/api/auth/register`, { method: 'POST', headers, body: JSON.stringify({ username: 'spacetime-fixture', password: 'spacetime-123', acceptPrivacy: true }) })
  assert.equal(registration.status, 201)
  const { user } = await registration.json()
  const cookie = registration.headers.get('set-cookie').split(';')[0]
  assert.equal((await fetch(`${base}/api/spacetime-scene/models/photo-0001`)).status, 401, '模型文件需要登录')

  browser = await chromium.launch({ channel: 'chrome', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] })
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  if (process.env.DEBUG_SPACETIME) page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console:', m.text().slice(0, 300)) })
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/config') return route.fulfill({ json: { available: true, mode: 'model', message: 'fixture', geocode: false } })
    const response = await route.fetch({ url: `${base}${url.pathname}${url.search}`, headers: { ...route.request().headers(), cookie } })
    await route.fulfill({ response })
  })
  // The butler (registered after the pass-through, so it wins): asked about change over time, it
  // opens the spacetime scene; anything else gets a plain answer
  let heard = ''
  await page.route('**/api/asr', (route) => route.fulfill({ json: { text: heard } }))
  await page.route('**/api/tts', (route) => route.fulfill({ status: 503, json: { error: '测试中不朗读' } }))
  await page.route('**/api/butler', (route) => {
    const question = String(route.request().postDataJSON()?.question || '')
    const opens = /变化|时空/.test(question)
    return route.fulfill({ json: { answer: opens ? '我按时间把这里的照片排一排。' : '杭州这里有两段回忆。', eventIds: [], assetIds: [], actions: opens ? [{ type: 'open_spacetime' }] : [] } })
  })
  const holdToTalk = async (text) => {
    heard = text
    const box = await page.locator('.voice-butler .hold').boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.locator('.hold.recording').waitFor()
    await page.waitForTimeout(1200)
    await page.mouse.up()
  }
  await page.goto(process.env.BASE_URL || 'http://localhost:5183/')
  await page.evaluate(async ({ userId, photo }) => {
    const dates = ['2020-10-03', '2020-10-03', '2023-04-16', '2023-04-16']
    const assets = dates.map((date, index) => {
      let preview = photo
      if (index) {
        const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 720
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = ['#b8dce1', '#bfd9b8', '#f2cbd4', '#ddd4f2'][index]; ctx.fillRect(0, 0, 960, 720)
        ctx.fillStyle = '#655341'; ctx.font = 'bold 32px Microsoft YaHei'; ctx.textAlign = 'center'; ctx.fillText(`时空场景测试素材 ${index + 1}`, 480, 360)
        preview = canvas.toDataURL('image/jpeg', .9)
      }
      return { id: `spacetime-${index + 1}`, name: `spacetime-${index + 1}.jpg`, kind: 'image', mimeType: 'image/jpeg', size: 1000, capturedAt: `${date}T10:00:00+08:00`, dateSource: 'exif', width: 960, height: 720, hash: `spacetime-hash-${index}`, preview, card: { title: '公园', caption: '', scene: ['公园小路，树叶落了一地', '公园的凉亭', '公园里樱花开了', '草地上的野餐'][index], tags: ['公园'], clues: [], questions: [], visibleText: '', eventGuess: { type: '游玩', reason: '测试' }, createdAt: new Date().toISOString() } }
    })
    const event = (id, ids, at, title) => ({ id, assetIds: ids, occurredAt: at, timeSource: 'exif', title, summary: '', type: '游玩', place: '示例公园', city: '杭州市', citySource: 'user', lat: 30.25, lng: 120.15, people: [], visibleText: '', tags: [], questions: [], status: 'confirmed' })
    const { openAccountStorage, saveMemory } = await import('/src/lib/storage.ts')
    await openAccountStorage(userId)
    await saveMemory({ assets, events: [event('story-autumn', ['spacetime-1', 'spacetime-2'], assets[0].capturedAt, '秋天逛公园'), event('story-spring', ['spacetime-3', 'spacetime-4'], assets[2].capturedAt, '春天再来')], placeRoles: {}, autoPhotoCards: false })
  }, { userId: user.id, photo })
  await page.reload()

  // No button: on the city's story line, the butler opens the scene when asked
  // Two labels can overlap on the globe (place and photo stack): the click must reach this one
  await page.locator('.globe-place, .globe-cluster, .map-label.place:visible').first().click({ force: true })
  if (await page.getByRole('dialog', { name: '选择地点' }).count()) await page.getByRole('dialog', { name: '选择地点' }).getByRole('button').first().click()
  assert.equal(await page.getByRole('button', { name: '时空场景', exact: true }).count(), 0, '时空场景没有单独的按钮')
  await page.locator('.voice-butler .hold:not([disabled])').waitFor({ timeout: 20000 })
  await holdToTalk('这里这些年有什么变化？')
  const dialog = page.locator('.spacetime-modal')
  await dialog.waitFor()
  await page.waitForTimeout(3000)
  if (process.env.DEBUG_SPACETIME) console.log('dialog:', (await dialog.evaluate((el) => el.innerHTML)).slice(0, 900), 'errors:', errors, 'calls:', calls)
  await dialog.locator('.spacetime-epochs button').nth(1).waitFor({ timeout: 20000 })
  assert.equal(calls, 1, '打开时空场景时向模型请求一次分段')
  assert.deepEqual(await dialog.locator('.spacetime-epochs button b').allTextContents(), ['2020-10-03', '2023-04-16'])
  assert.deepEqual(await dialog.locator('.spacetime-layers li em').allTextContents(), ['照片可见', '推断', '无依据', '无依据', '无依据', '照片可见'], '每一层都标出证据等级')
  assert.equal(await dialog.locator('.spacetime-photos button').count(), 2)
  await page.screenshot({ path: join(shots, 'pw-spacetime-1-epochs.png') })

  if (capability.available) {
    await dialog.getByRole('button', { name: '重建这一刻的三维场景' }).click()
    await dialog.locator('.spacetime-viewer[data-status="ready"]').waitFor({ timeout: 180000 })
    assert.equal(await dialog.locator('.film-error').count(), 0, await dialog.locator('.film-error').allTextContents())
    await page.waitForTimeout(800)
    await page.screenshot({ path: join(shots, 'pw-spacetime-2-relief.png') })
    // The widest sway the viewer allows: the relief must still hold together (no torn sheets, no dolly in)
    const stage = await dialog.locator('.spacetime-stage').boundingBox()
    await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2)
    await page.mouse.down()
    await page.mouse.move(stage.x + stage.width / 2 - 600, stage.y + stage.height / 2 - 300, { steps: 20 })
    await page.waitForTimeout(700)
    await page.screenshot({ path: join(shots, 'pw-spacetime-3-sway-left.png') })
    await page.mouse.move(stage.x + stage.width / 2 + 600, stage.y + stage.height / 2 + 300, { steps: 30 })
    await page.waitForTimeout(700)
    await page.screenshot({ path: join(shots, 'pw-spacetime-4-sway-right.png') })
    await page.mouse.up()
    // Kept with the account: the model streams back without another reconstruction
    const model = await fetch(`${base}/api/spacetime-scene/models/spacetime-1`, { headers: { cookie } })
    assert.equal(model.status, 200)
    assert.equal(model.headers.get('content-type'), 'model/gltf-binary')
    assert.ok((await model.arrayBuffer()).byteLength > 50000)
    // The other epoch has no model yet: its own key photo waits to be reconstructed
    await dialog.locator('.spacetime-epochs button').nth(1).click()
    await dialog.getByRole('button', { name: '重建这一刻的三维场景' }).waitFor()
    await dialog.locator('.spacetime-epochs button').nth(0).click()
    await dialog.locator('.spacetime-viewer[data-status="ready"]').waitFor({ timeout: 20000 })
  } else {
    console.log(`本机没有三维重建能力（${capability.reason}），只检查分段界面`)
    await dialog.locator('.spacetime-build small').waitFor()
  }
  assert.deepEqual(errors, [])
  console.log(`Spacetime scene test passed: 2 epochs with evidence per layer${capability.available ? ', key photo reconstructed on this computer and shown in the viewer' : ' (no local reconstruction)'}; shots in ${shots}`)
} finally {
  await browser?.close()
  api.kill()
  mock.close()
}

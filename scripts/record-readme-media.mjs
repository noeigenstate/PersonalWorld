// Records the README's GIFs and screenshots (docs/media/) from the running app.
//
// The album is fictional: fixture EXIF/GPS in four cities, painted with AI-generated demo photos
// (scripts/assets/make-demo-photos.mjs), in an isolated account on a throw-away API server, so
// no private photo is ever on screen. Map, timeline, globe/street zoom and the 3D relief
// reconstruction are the real thing; speech recognition, the butler's answers and the spacetime
// plan are fixed scripts (repeatable recordings), which the README says.
//
//   npm run dev                                   (the web app on :5183; the AMap keys in .env)
//   node scripts/record-readme-media.mjs [hero story butler spacetime]
//
// Needs Chrome, FFmpeg (PATH or FFMPEG_PATH) and the demo photos.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { cities, fakeGeocode, makeLifeFixtures } from '../tests/fixtures.mjs'
import { reliefCapability } from '../server/spacetimeScene.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
process.loadEnvFile(join(root, '.env'))
const BASE = process.env.BASE_URL || 'http://localhost:5183/'
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'
const media = join(root, 'docs/media')
const photosDir = join(root, 'world-data/sources/demo-photos')
const key = process.env.AMAP_JS_KEY
if (!key) throw new Error('.env 里没有 AMAP_JS_KEY')
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : ['hero', 'story', 'butler', 'spacetime']

const work = mkdtempSync(join(tmpdir(), 'pw-readme-'))
mkdirSync(media, { recursive: true })
const profile = join(work, 'profile')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ---- fictional album ------------------------------------------------------------------------
const pictures = {}
for (const [city, prefix] of [['湘潭市', 'xiangtan'], ['武汉市', 'wuhan'], ['上海市', 'shanghai'], ['杭州市', 'hangzhou']]) {
  const names = readdirSync(photosDir).filter((n) => n.startsWith(prefix) && n.endsWith('.jpg')).sort()
  assert.ok(names.length, `缺少 ${prefix} 的示例照片：node scripts/assets/make-demo-photos.mjs`)
  pictures[city] = names.map((n) => 'data:image/jpeg;base64,' + readFileSync(join(photosDir, n)).toString('base64'))
}
// Hangzhou seen twice: an autumn trip (fixtures) and a spring visit (added here) — two epochs
const extraShots = [['杭州市', '2023-04-16 10:30', 0.001, -0.001], ['杭州市', '2023-04-16 15:10', 0.003, 0.002]]
// hangzhou-1 and -3 are autumn, hangzhou-2 the spring park: the fixtures' three autumn shots come first
{ const [autumn, spring, canal] = pictures['杭州市']; pictures['杭州市'] = [autumn, canal, autumn, spring, spring] }

const titles = {
  湘潭市: ['老家的春节', '夏天回老家', '回家看看', '爸妈做的年夜饭'],
  武汉市: ['开学第一天', '珞珈山的樱花', '国庆去江边', '毕业前的合影', '实习的夏天'],
  上海市: ['第一次来上海', '国庆逛外滩', '搬进新家', '周末的咖啡店', '加班的夜晚'],
  杭州市: ['西湖秋游', '运河边散步', '樱花时节'],
}
const nearestCity = (lat, lng) => Object.entries(cities).sort(([, p], [, q]) => Math.hypot(p.lat - lat, p.lng - lng) - Math.hypot(q.lat - lat, q.lng - lng))[0][0]
let asrText = ''
let butlerScript = () => ({ answer: '我在。', eventIds: [], assetIds: [], actions: [] })
let spacetimePlan = () => null

// A silent WAV stands in for StepFun speech
const silentWav = (() => {
  const b = Buffer.alloc(44 + 3200)
  b.write('RIFF', 0); b.writeUInt32LE(36 + 3200, 4); b.write('WAVE', 8); b.write('fmt ', 12)
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28)
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(3200, 40)
  return b
})()

// ---- isolated API server ----------------------------------------------------------------------
const api = spawn(process.execPath, ['server/index.mjs'], {
  cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: '0', STORY_UNDERSTANDING_DISABLED: '1', SKIP_WORLD_DATA: '1', USERS_FILE: join(work, 'users.json'), MEMORY_FILMS_DIR: join(work, 'films'), STEPFUN_BASE_URL: 'http://127.0.0.1:9', STEPFUN_API_KEY: 'demo', STEPFUN_MODEL: 'demo' },
})
const port = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('API 启动超时')), 15000)
  api.stdout.on('data', (chunk) => { const hit = String(chunk).match(/127\.0\.0\.1:(\d+)/); if (hit) { clearTimeout(timer); resolve(hit[1]) } })
  api.on('exit', () => { clearTimeout(timer); reject(new Error('API 退出')) })
})
const base = `http://127.0.0.1:${port}`
const registration = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Memory-Agent': 'web' }, body: JSON.stringify({ username: '小满', password: 'demo-pass-1', acceptPrivacy: true }) })
assert.equal(registration.status, 201)
const cookie = registration.headers.get('set-cookie').split(';')[0]

// ---- browser ---------------------------------------------------------------------------------
async function launch(record) {
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chrome', headless: true, viewport: { width: 1280, height: 800 }, serviceWorkers: 'block',
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    ...(record ? { recordVideo: { dir: join(work, 'video'), size: { width: 1280, height: 800 } } } : {}),
  })
  const page = context.pages()[0] || await context.newPage()
  const startedAt = Date.now()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  // Everything goes to the isolated server with its session, then the fixed scripts on top
  const pass = async (route) => {
    const url = new URL(route.request().url())
    try {
      const response = await route.fetch({ url: `${base}${url.pathname}${url.search}`, headers: { ...route.request().headers(), cookie } })
      await route.fulfill({ response })
    } catch { /* the page closed with the request in flight */ }
  }
  await page.route('**/api/**', pass)
  await page.route('**/_AMapService/**', pass)
  await page.route('**/api/config', (route) => route.fulfill({ json: { available: true, mode: 'model', message: '演示', geocode: true, amapJsKey: key } }))
  await page.route('**/api/geocode', (route) => route.fulfill({ json: { results: route.request().postDataJSON().points.map(fakeGeocode) } }))
  await page.route('**/api/analyze', (route) => {
    const { images = [] } = route.request().postDataJSON()
    const at = images.find((i) => i.latitude)
    const city = at ? nearestCity(Number(at.latitude), Number(at.longitude)) : '上海市'
    const list = titles[city]
    const title = list[Math.abs([...String(images[0]?.capturedAt || '')].reduce((n, c) => n * 31 + c.charCodeAt(0), 7)) % list.length]
    return route.fulfill({ json: { title, summary: `${title}。`, type: '日常', place: '', city, people: [], visibleText: '', tags: [], questions: [], confidence: 0.8 } })
  })
  await page.route('**/api/photo-card', (route) => route.fulfill({ json: { title: '示例照片', caption: '', scene: '一张示例照片', visibleText: '', clues: [], landmark: null, placeQuery: null, eventGuess: { type: '', reason: '' }, tags: [], questions: [] } }))
  await page.route('**/api/asr', (route) => route.fulfill({ json: { text: asrText } }))
  await page.route('**/api/tts', (route) => route.fulfill({ contentType: 'audio/wav', body: silentWav }))
  await page.route('**/api/storytelling/list', (route) => route.fulfill({ json: { stories: [] } }))
  await page.route('**/api/butler', (route) => route.fulfill({ json: butlerScript(route.request().postDataJSON()) }))
  await page.route('**/api/spacetime-scene', async (route) => {
    const body = route.request().postDataJSON()
    const plan = spacetimePlan(body)
    if (!plan) return route.fallback()
    return route.fulfill({ json: { plan, capability: await reliefCapability(), scenes: [] } })
  })
  return { context, page, errors, startedAt, mark: () => (Date.now() - startedAt) / 1000 }
}

async function importAlbum() {
  const { context, page, errors } = await launch(false)
  await page.goto(BASE, { waitUntil: 'load' })
  await page.locator('.life-globe-canvas').waitFor({ timeout: 30000 })
  const files = await makeLifeFixtures(page, join(work, 'album'), { pictures, extraShots })
  await page.getByRole('button', { name: '导入第一批影像' }).click()
  await page.locator('input[type="file"]').setInputFiles(files)
  await page.locator('.life-globe[data-place-count="4"]').waitFor({ timeout: 60000 })
  await page.locator('.locating-chip').filter({ hasText: '事件已自动分析' }).waitFor({ timeout: 60000 }).catch(() => {})
  await sleep(3000) // the browser backs the album up to the account before we leave
  await context.close()
  assert.deepEqual(errors, [])
}

async function openScene() {
  const scene = await launch(true)
  const { page } = scene
  await page.goto(BASE, { waitUntil: 'load' })
  await page.locator('.life-globe-canvas').waitFor({ timeout: 30000 })
  await page.locator('.life-globe[data-place-count="4"]').waitFor({ timeout: 60000 })
  await sleep(2500)
  return scene
}

// The cartoon ground reports what it has drawn in data-cartoon ("… buildings:24 trees:7176 …"; buildings = tiles with buildings)
async function waitForBuildings(page, min = 6, timeout = 40000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const text = (await page.locator('.life-map').first().getAttribute('data-cartoon')) || ''
    if (process.env.RECORD_DEBUG) console.log('data-cartoon:', text, await page.evaluate(() => { const m = window.__amap; return m ? `zoom ${m.getZoom()} pitch ${m.getPitch()} center ${m.getCenter()}` : 'no map' }))
    if (Number((text.match(/buildings:(\d+)/) || [])[1] || 0) >= min) return
    await sleep(500)
  }
}

async function chooseGlobeCity(page, name) {
  const single = page.locator('.globe-place').filter({ hasText: name })
  if (await single.count()) return single.first().click({ force: true })
  await page.locator('.globe-cluster').filter({ hasText: name }).first().click({ force: true })
  await page.getByRole('dialog', { name: '选择地点' }).getByRole('button', { name: new RegExp(name) }).click()
}

async function holdToTalk(page, text, hold = 1400) {
  asrText = text
  const box = await page.locator('.voice-butler .hold').boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.locator('.hold.recording').waitFor()
  await page.locator('.subtitle.me.live').waitFor()
  await sleep(hold)
  await page.mouse.up()
}

// ---- output ------------------------------------------------------------------------------------
const ffmpeg = (...args) => execFileSync(FFMPEG, ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' })
// video → GIF: `parts` are [from, to] seconds of the recording, joined in order
function toGif(video, name, parts, { width = 720, fps = 8, colors = 64, dither = 'none' } = {}) {
  const cuts = parts.map(([a, b], i) => `[0:v]trim=start=${a.toFixed(2)}:end=${b.toFixed(2)},setpts=PTS-STARTPTS[c${i}]`).join(';')
  const joined = parts.map((_, i) => `[c${i}]`).join('') + `concat=n=${parts.length}:v=1:a=0[j]`
  const graph = `${cuts};${joined};[j]fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=${colors}:stats_mode=diff[p];[s1][p]paletteuse=dither=${dither}:diff_mode=rectangle`
  ffmpeg('-i', video, '-filter_complex', graph, '-loop', '0', join(media, `${name}.gif`))
  console.log(`${name}.gif  ${(statSync(join(media, `${name}.gif`)).size / 1048576).toFixed(1)} MB`)
}
async function shot(page, name) {
  const png = join(work, `${name}.png`)
  await page.screenshot({ path: png })
  ffmpeg('-i', png, '-c:v', 'libwebp', '-quality', '84', join(media, `${name}.webp`))
  console.log(`${name}.webp  ${(statSync(join(media, `${name}.webp`)).size / 1024).toFixed(0)} KB`)
}
async function finish(scene, name, parts, options) {
  const { context, page, errors } = scene
  const video = page.video()
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await context.close()
  const path = await video.path()
  const cuts = parts()
  // RECORD_KEEP=<dir>: keep the raw recording and the cuts, to try other GIF settings without recording again
  if (process.env.RECORD_KEEP) { mkdirSync(process.env.RECORD_KEEP, { recursive: true }); copyFileSync(path, join(process.env.RECORD_KEEP, `${name}.webm`)); writeFileSync(join(process.env.RECORD_KEEP, `${name}.json`), JSON.stringify({ cuts, options })) }
  toGif(path, name, cuts, options)
  assert.deepEqual(errors, [])
}

// ---- scenes ------------------------------------------------------------------------------------
const scenes = {
  // Globe → country → city → street, one continuous zoom into the cartoon world
  async hero() {
    const scene = await openScene()
    const { page, mark } = scene
    const box = await page.locator('.life-globe-canvas').boundingBox()
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2
    await shot(page, 'globe')
    const from = mark()
    // A little turn of the globe, then in
    await page.mouse.move(cx + 160, cy - 40)
    await page.mouse.down()
    await page.mouse.move(cx + 40, cy - 40, { steps: 14 })
    await page.mouse.up()
    await sleep(500)
    await page.mouse.move(cx, cy)
    for (let i = 0; i < 40 && !(await page.locator('.life-map-globe.away').count()); i++) { await page.mouse.wheel(0, -120); await sleep(130) }
    await page.locator('.life-map-globe.away').waitFor({ state: 'attached', timeout: 8000 })
    await sleep(1200)
    const fly = async (zoom, lng, lat, pitch, wait) => { await page.evaluate(([z, x, y, p]) => { const m = window.__amap; m.setPitch(p, true); m.setZoomAndCenter(z, [x, y], false) }, [zoom, lng, lat, pitch]); await sleep(wait) }
    // Down into central Hangzhou (Wulin Square): dense streets and buildings
    await fly(9, 120.165, 30.275, 0, 1700)
    await fly(12.4, 120.165, 30.275, 25, 1700)
    await fly(15, 120.1652, 30.2752, 45, 1500)
    await fly(16.9, 120.1652, 30.2752, 58, 1200)
    await waitForBuildings(page)
    await sleep(1400)
    await shot(page, 'street')
    await fly(17.4, 120.1656, 30.2755, 62, 1600)
    const to = mark()
    await finish(scene, 'hero', () => [[from + 0.3, to - 0.2]])
  },

  // Click a place: the story line, then back through time on the timeline
  async story() {
    const scene = await openScene()
    const { page, mark } = scene
    const from = mark()
    await chooseGlobeCity(page, '上海')
    await page.locator('.subtitle.bot').waitFor({ timeout: 20000 })
    await page.locator('.map-label.event.has-photo:visible').first().waitFor({ timeout: 30000 }).catch(async (error) => { await page.screenshot({ path: join(process.env.RECORD_KEEP || work, 'failed.png') }); throw error })
    await sleep(3200)
    await shot(page, 'story')
    const slider = page.getByRole('slider', { name: '拖动时间进度条' })
    const at = await slider.boundingBox()
    await page.mouse.move(at.x + at.width - 6, at.y + 24)
    await page.mouse.down()
    await page.mouse.move(at.x + at.width * 0.55, at.y + 24, { steps: 22 })
    await sleep(700)
    await page.mouse.move(at.x + at.width * 0.18, at.y + 24, { steps: 22 })
    await sleep(1000)
    await page.mouse.move(at.x + at.width - 6, at.y + 24, { steps: 30 })
    await page.mouse.up()
    await sleep(1400)
    const to = mark()
    await finish(scene, 'story', () => [[from + 0.3, to - 0.1]], { colors: 96, dither: 'bayer:bayer_scale=5' })
  },

  // Ask the butler by voice: subtitle, inferred wording underlined, the photos on the stage
  async butler() {
    const scene = await openScene()
    const { page, mark } = scene
    butlerScript = (body) => {
      const event = body.memory.events.find((e) => e.start === '2020-10-03')
      const ids = body.memory.photos.filter((p) => p.eventId === event.id).map((p) => p.id)
      return { answer: '2020 年国庆，你去了西湖：银杏正黄，湖上的石拱桥在雾里。〔应该是和家人一起〕', eventIds: [event.id], assetIds: [], actions: [{ type: 'slideshow', assetIds: ids }] }
    }
    await chooseGlobeCity(page, '杭州')
    await page.locator('.subtitle.bot').waitFor({ timeout: 20000 })
    await page.locator('.map-label.event.has-photo:visible').first().waitFor({ timeout: 30000 }).catch(async (error) => { await page.screenshot({ path: join(process.env.RECORD_KEEP || work, 'failed.png') }); throw error })
    await sleep(2500)
    const from = mark()
    await sleep(600)
    await holdToTalk(page, '2020 年国庆那会儿发生了什么？')
    await page.locator('.subtitle.bot .inferred').waitFor({ timeout: 20000 })
    await page.locator('.showcase.slideshow').waitFor({ timeout: 20000 })
    await sleep(1600)
    await shot(page, 'butler')
    await sleep(2800)
    const to = mark()
    await finish(scene, 'butler', () => [[from, to - 0.1]], { colors: 128, dither: 'bayer:bayer_scale=5' })
  },

  // "How has this place changed?": epochs with evidence per layer, then a photo rebuilt as a 3D relief
  async spacetime() {
    const capability = await reliefCapability()
    assert.ok(capability.available, `需要本机 ComfyUI + Depth Anything 3：${capability.reason}`)
    const scene = await openScene()
    const { page, mark } = scene
    butlerScript = (body) => body.question.includes('变化')
      ? { answer: '我按时间把这里的照片排一排。', eventIds: [], assetIds: [], actions: [{ type: 'open_spacetime' }] }
      : { answer: '杭州这里有两段回忆。', eventIds: [], assetIds: [], actions: [] }
    spacetimePlan = ({ photos }) => {
      const sorted = [...photos].sort((a, b) => a.date.localeCompare(b.date))
      const autumn = sorted.filter((p) => p.date < '2022'), spring = sorted.filter((p) => p.date >= '2022')
      const none = { value: null, evidence: 'unknown', basis: '' }
      // What the server would return after reading the skill's answer (server/spacetimeScene.mjs readScenePlan)
      const epoch = (list, extra) => ({ id: `epoch-${list[0].date}-${list[0].id}`, from: list[0].date, to: list.at(-1).date, photoIds: list.map((p) => p.id), keyPhoto: list[0].id, changes: '', ...extra })
      return { place: '杭州', undated: [], summary: `${photos.length} 张照片分成两个可回看的时段。`, epochs: [
        epoch(autumn, { title: '西湖的秋天', caption: '银杏正黄，湖面有薄雾', layers: { season: { value: '深秋', evidence: 'observed', basis: 'P1 银杏叶全黄' }, timeOfDay: { value: '清晨', evidence: 'inferred', basis: '光线偏冷、湖面有雾' }, weather: { value: '多云', evidence: 'observed', basis: 'P1 天空灰白' }, buildings: [{ name: '湖上的石拱桥', state: '完好', evidence: 'observed', basis: 'P1 桥身完整' }], sound: none, traffic: none } }),
        epoch(spring, { title: '樱花时节', caption: '石板路两侧樱花盛开', layers: { season: { value: '春', evidence: 'observed', basis: '樱花盛开' }, timeOfDay: { value: '白天', evidence: 'inferred', basis: '光线明亮' }, weather: { value: '晴', evidence: 'observed', basis: '阴影清晰' }, buildings: [{ name: '公园里的亭子', state: '已建成', evidence: 'observed', basis: '亭子完整可见' }], sound: none, traffic: none }, changes: '同一处湖岸，两年半里从银杏变成了樱花' }),
      ] }
    }
    await chooseGlobeCity(page, '杭州')
    await page.locator('.subtitle.bot').waitFor({ timeout: 20000 })
    await sleep(1800)
    const from = mark()
    await holdToTalk(page, '这里这些年有什么变化？')
    const dialog = page.locator('.spacetime-modal')
    await dialog.locator('.spacetime-epochs button').nth(1).waitFor({ timeout: 30000 }).catch(async (error) => { await page.screenshot({ path: join(process.env.RECORD_KEEP || work, 'failed.png') }); throw error })
    await sleep(2200)
    await shot(page, 'spacetime-epochs')
    await dialog.locator('.spacetime-epochs button').nth(1).click()
    await sleep(1400)
    await dialog.locator('.spacetime-epochs button').nth(0).click()
    await sleep(1200)
    await dialog.getByRole('button', { name: '重建这张照片的三维场景' }).click()
    await sleep(600)
    const waitFrom = mark()
    await dialog.locator('.spacetime-viewer[data-status="ready"]').waitFor({ timeout: 240000 })
    const waitTo = mark()
    await sleep(1200)
    const stage = await dialog.locator('.spacetime-stage').boundingBox()
    const sx = stage.x + stage.width / 2, sy = stage.y + stage.height / 2
    await page.mouse.move(sx, sy)
    await page.mouse.down()
    await page.mouse.move(sx - 150, sy - 20, { steps: 26 })
    await sleep(400)
    await page.mouse.move(sx + 150, sy + 10, { steps: 44 })
    await sleep(400)
    await page.mouse.move(sx, sy, { steps: 18 })
    await page.mouse.up()
    await shot(page, 'relief')
    await sleep(900)
    const to = mark()
    console.log(`重建等待 ${(waitTo - waitFrom).toFixed(1)} 秒（GIF 里剪掉）`)
    await finish(scene, 'spacetime', () => [[from, waitFrom + 1.6], [waitTo - 0.4, to - 0.1]], { colors: 128, dither: 'bayer:bayer_scale=5' })
  },
}

try {
  console.log('导入示例相册…')
  await importAlbum()
  for (const name of wanted) {
    if (!scenes[name]) throw new Error(`没有场景 ${name}，可选：${Object.keys(scenes).join(' ')}`)
    console.log(`录制 ${name}…`)
    await scenes[name]()
    // the next scene starts from a fresh page over the same profile
    try { rmSync(join(work, 'video'), { recursive: true, force: true, maxRetries: 8, retryDelay: 400 }) } catch { /* Windows may still hold the file; the temp dir goes at the end */ }
  }
} finally {
  api.kill()
  await sleep(300)
  try { rmSync(work, { recursive: true, force: true, maxRetries: 8, retryDelay: 400 }) } catch { /* left in the temp directory */ }
}

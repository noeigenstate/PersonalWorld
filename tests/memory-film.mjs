// An isolated account, actual browser automation and actual FFmpeg. No private
// library is read. MEMORY_FILM_LIVE=1 also exercises the configured StepFun model.
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { fallbackFilm, readFilmSources, validateFilmPlan } from '../server/memoryFilmPlan.mjs'
import { runMedia } from '../server/memoryFilmRender.mjs'

// Films live on a story line (not in the top bar): open the city, then the films entry
async function openFilms(page) {
  if (!(await page.locator('.story-apps .film-entry').count())) {
    await page.locator('.globe-place, .globe-cluster, .map-label.place:visible').first().click()
    if (await page.getByRole('dialog', { name: '选择地点' }).count()) await page.getByRole('dialog', { name: '选择地点' }).getByRole('button').first().click()
  }
  await page.getByRole('button', { name: '回忆短片', exact: true }).click()
}

const dir = mkdtempSync(join(tmpdir(), 'pw-memory-film-'))
const sources = readFilmSources(Array.from({ length: 8 }, (_, i) => ({ id: `film-fixture-${i}`, date: `2026-0${Math.floor(i / 2) + 1}-15`, observed: ['插画中的湖边小路', '插画中的绿树与长椅', '插画中的粉色花朵', '插画中的风筝', '插画中的冰淇淋', '插画中的落叶', '插画中的蓝色小船', '插画中的橙色夕阳'][i], confirmed: '', place: '示例公园', tags: ['公园', '插画'] })))
assert.equal(readFilmSources([...sources, sources[0], { id: '../invalid' }]).length, 8)
const plan = validateFilmPlan(fallbackFilm(sources), sources)
assert.equal(plan.shots.length, 8)
assert.equal(validateFilmPlan({ ...plan, title: '女儿第一次走路', shots: [...plan.shots].reverse() }, sources).title, '把这些小日子留住')
assert.throws(() => validateFilmPlan({ shots: [{ assetId: 'invented' }] }, sources))

let calls = 0
let plannedSources = []
const mock = http.createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk)
  const payload = JSON.parse(Buffer.concat(chunks).toString())
  assert.ok(payload.messages[0].content.includes('自动回忆短片导演'))
  assert.ok(!JSON.stringify(payload).includes('data:image'))
  plannedSources = JSON.parse(payload.messages[1].content).sources
  const personal = plannedSources.every((s) => s.story === '这是我画的公园插画')
  calls++
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ ...plan, title: personal ? '我画的四季公园' : '公园里的四季片段', reason: '不同月份的公园插画组成一份时间相册。' }) } }] }))
})
await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve))
const api = spawn(process.execPath, ['server/index.mjs'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PORT: '0', STORY_UNDERSTANDING_DISABLED:'1', USERS_FILE: join(dir, 'users.json'), MEMORY_FILMS_DIR: join(dir, 'jobs'), ...(process.env.MEMORY_FILM_LIVE === '1' ? {} : { STEPFUN_BASE_URL: `http://127.0.0.1:${mock.address().port}`, STEPFUN_API_KEY: 'fixture', STEPFUN_MODEL: 'fixture' }) } })
let browser
try {
  const port = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('API startup timeout')), 10000); api.stdout.on('data', (chunk) => { const hit = String(chunk).match(/127\.0\.0\.1:(\d+)/); if (hit) { clearTimeout(timer); resolve(hit[1]) } }); api.on('exit', () => { clearTimeout(timer); reject(new Error('API exited')) }) })
  const base = `http://127.0.0.1:${port}`
  const headers = { 'Content-Type': 'application/json', 'X-Memory-Agent': 'web' }
  const registration = await fetch(`${base}/api/auth/register`, { method: 'POST', headers, body: JSON.stringify({ username: 'film-fixture', password: 'film-fixture-123', acceptPrivacy: true }) })
  assert.equal(registration.status, 201)
  const { user } = await registration.json()
  const cookie = registration.headers.get('set-cookie').split(';')[0]
  assert.equal((await fetch(`${base}/api/memory-films`)).status, 401)
  browser = await chromium.launch({ channel: 'chrome' })
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/config') return route.fulfill({ json: { available: true, mode: 'model', message: 'fixture', geocode: false } })
    const response = await route.fetch({ url: `${base}${url.pathname}${url.search}`, headers: { ...route.request().headers(), cookie } })
    await route.fulfill({ response })
  })
  await page.goto(process.env.BASE_URL || 'http://localhost:5183/')
  await page.evaluate(async ({ userId, sources }) => {
    const assets = sources.map((source, index) => {
      const canvas = document.createElement('canvas'); canvas.width = index % 2 ? 720 : 960; canvas.height = index % 2 ? 960 : 720
      const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height
      const colors = ['#b8dce1', '#bfd9b8', '#f2cbd4', '#ddd4f2', '#f6d5aa', '#e6bc96', '#a8cfda', '#eccba8']
      ctx.fillStyle = colors[index]; ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = '#eef0d5'; ctx.beginPath(); ctx.ellipse(w * .5, h * 1.02, w * .8, h * .38, 0, 0, 7); ctx.fill()
      ctx.fillStyle = '#fff4cf'; ctx.beginPath(); ctx.arc(w * .76, h * .25, 60, 0, 7); ctx.fill()
      ctx.fillStyle = '#8da878'; ctx.beginPath(); ctx.arc(w * .25, h * .65, 80, 0, 7); ctx.fill()
      ctx.fillStyle = '#a99772'; ctx.fillRect(w * .25 - 7, h * .67, 14, 90)
      ctx.font = 'bold 28px Microsoft YaHei'; ctx.fillStyle = '#655341'; ctx.textAlign = 'center'; ctx.fillText('自动短片 · 渲染测试素材', w / 2, h * .42)
      ctx.font = '22px Microsoft YaHei'; ctx.fillText(source.observed, w / 2, h * .5)
      return { id: source.id, name: `${source.id}.jpg`, kind: 'image', mimeType: 'image/jpeg', size: 1000, capturedAt: source.date + 'T10:00:00+08:00', dateSource: 'exif', width: w, height: h, hash: `unique-${index}`, preview: canvas.toDataURL('image/jpeg', .9), card: { title: source.observed, caption: '', scene: source.observed, tags: source.tags, clues: [], questions: [], visibleText: '', eventGuess: { type: '插画', reason: '测试' }, createdAt: new Date().toISOString() } }
    })
    const { openAccountStorage, saveMemory } = await import('/src/lib/storage.ts')
    await openAccountStorage(userId); await saveMemory({ assets, events: [{ id: 'story-e1', assetIds: assets.map((a) => a.id), occurredAt: assets[0].capturedAt, timeSource: 'exif', title: '测试故事', summary: '', type: '日常', place: '', city: '杭州市', citySource: 'user', lat: 30.25, lng: 120.15, people: [], visibleText: '', tags: [], questions: [], status: 'confirmed' }], placeRoles: {}, autoPhotoCards: false })
  }, { userId: user.id, sources })
  await page.reload()
  await openFilms(page)
  // Deliberately don't press Generate or supply a prompt. The default automation
  // must create the job, choose sources, upload and render on its own.
  await page.waitForFunction(() => document.querySelector('.film-screen video') || document.querySelector('.film-error'), null, { timeout: 240000 })
  assert.equal(await page.locator('.film-error').count(), 0, await page.locator('.film-error').allTextContents())
  await page.locator('.film-screen video').evaluate(async (video) => { await video.play(); await new Promise((r) => setTimeout(r, 1500)); video.pause() })
  await page.screenshot({ path: join(dir, 'film-desktop.png') })
  const state = await (await fetch(`${base}/api/memory-films`, { headers: { cookie } })).json()
  const completed = state.jobs.find((job) => job.status === 'complete')
  assert.ok(completed)
  assert.equal(completed.planner, 'stepfun', completed.warning)
  assert.ok(completed.plan.shots.length >= 6)
  const movie = await fetch(`${base}${completed.url}`, { headers: { cookie } })
  assert.equal(movie.status, 200)
  const movieFile = join(dir, 'automatic-memory-demo.mp4'); writeFileSync(movieFile, Buffer.from(await movie.arrayBuffer()))
  const media = JSON.parse(await runMedia(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', movieFile]))
  assert.equal(media.streams.find((s) => s.codec_type === 'video').width, 720)
  assert.equal(media.streams.find((s) => s.codec_type === 'video').height, 960)
  assert.equal(media.streams.find((s) => s.codec_type === 'audio').codec_name, 'aac')
  assert.ok(Math.abs(Number(media.format.duration) - completed.duration) < .15)
  assert.equal((await fetch(`${base}${completed.url}`, { headers: { cookie, range: 'bytes=0-1023' } })).status, 206)
  assert.equal((await fetch(`${base}${completed.url}`, { headers: { cookie, range: 'bytes=99999999999-' } })).status, 416)
  assert.ok(!readdirSync(join(dir, 'jobs', completed.id)).some((f) => /^image-|^clip-|music\.wav|font\.ttf/.test(f)), 'temporary source images must be removed')
  const another = await fetch(`${base}/api/auth/register`, { method: 'POST', headers, body: JSON.stringify({ username: 'film-stranger', password: 'film-fixture-456', acceptPrivacy: true }) })
  const otherCookie = another.headers.get('set-cookie').split(';')[0]
  assert.equal((await fetch(`${base}${completed.url}`, { headers: { cookie: otherCookie } })).status, 404)
  assert.equal((await fetch(`${base}/api/memory-films/${completed.id}/context`, { method: 'POST', headers: { ...headers, cookie: otherCookie }, body: JSON.stringify({ text: '错误账户的补充' }) })).status, 404)
  assert.equal((await fetch(`${base}/api/memory-films`, { method: 'POST', headers: { ...headers, cookie: otherCookie }, body: JSON.stringify({ fromJob: completed.id }) })).status, 404)
  await page.reload(); await page.waitForTimeout(12000)
  const after = await (await fetch(`${base}/api/memory-films`, { headers: { cookie } })).json()
  assert.equal(after.jobs.length, 1, 'reload must not regenerate same collection')
  await openFilms(page)
  await page.setViewportSize({ width: 430, height: 900 }); await page.screenshot({ path: join(dir, 'film-mobile.png') })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  assert.deepEqual(errors, [])
  if (process.env.MEMORY_FILM_LIVE !== '1') assert.equal(calls, 1)
  if (process.env.MEMORY_FILM_LIVE !== '1') {
    // A factual note is optional. Saving it should automatically re-edit just
    // this film, then stop: no creative brief and no repeated background loop.
    await page.locator('.film-context summary').click()
    await page.getByLabel('这段回忆的已知事实').fill('这是我画的公园插画')
    await page.getByRole('button', { name: '保存补充', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.film-notes h3')?.textContent === '我画的四季公园', null, { timeout: 45000 })
    await page.waitForFunction((oldUrl) => {
      const video = document.querySelector('.film-screen video')
      return video && !video.getAttribute('src').includes(oldUrl)
    }, completed.id, { timeout: 240000 })
    assert.equal(calls, 2)
    assert.ok(plannedSources.every((s) => s.story === '这是我画的公园插画'))
    const revisedState = await (await fetch(`${base}/api/memory-films`, { headers: { cookie } })).json()
    assert.equal(revisedState.jobs[0].storyContext.changed, false)
    assert.equal(revisedState.jobs[0].storyContext.text, '这是我画的公园插画')
    assert.deepEqual(revisedState.jobs[0].plan.shots.map((s) => s.assetId).sort(), completed.plan.shots.map((s) => s.assetId).sort())
    await page.screenshot({ path: join(dir, 'film-story-context.png') })
    await page.reload(); await page.waitForTimeout(23000)
    assert.equal(calls, 2, 'a saved correction must not regenerate repeatedly')
    await openFilms(page)
    await page.getByRole('button', { name: '重新编排一版', exact: true }).click()
    await page.getByRole('button', { name: '暂停', exact: true }).click()
    await page.waitForTimeout(1200)
    const paused = await (await fetch(`${base}/api/memory-films`, { headers: { cookie } })).json()
    assert.equal(paused.jobs[0].status, 'cancelled', 'pause must stop even an in-flight start request')
    assert.equal(paused.jobs.filter((j) => j.status === 'complete').length, 2)
  }
  console.log(JSON.stringify({ directory: dir, planner: completed.planner, shots: completed.plan.shots.length, duration: completed.duration, bytes: completed.bytes, automatic: true, errors }))
} finally { await browser?.close(); api.kill(); mock.close() }

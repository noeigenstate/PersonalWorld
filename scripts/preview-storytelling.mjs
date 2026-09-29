// Read-only visual/audio QA of the real StoryStage with local account photos.
// No app account is logged in and every /api request is intercepted. Exports stay in ignored data/.
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
import { chromium } from 'playwright'
import { speak, stepfunConfig } from '../server/stepfun.mjs'

process.loadEnvFile('.env')
const args = Object.fromEntries(process.argv.slice(2).map(value => { const at = value.indexOf('='); return [value.slice(0, at), value.slice(at + 1)] }))
if (!/^[a-zA-Z0-9-]{8,64}$/.test(args['--account'] || '')) throw new Error('Use --account=<local account ID> --manifest=<private manifest.json>')
const manifestFile = resolve(args['--manifest']), output = resolve(manifestFile, '..', 'preview')
await mkdir(output, { recursive: true })
const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
const stories = await Promise.all(manifest.map(s => readFile(resolve(manifestFile, '..', s.id + '.json'), 'utf8').then(JSON.parse)))
const account = resolve('server/data/accounts', args['--account'])
const { memory } = JSON.parse(await readFile(join(account, 'state.json'), 'utf8'))
const selected = new Set(stories.flatMap(s => s.assetIds))
const assets = await Promise.all(memory.assets.filter(a => selected.has(a.id)).map(async a => ({ ...a,
  preview: 'data:image/jpeg;base64,' + (await readFile(join(account, 'previews', a.id + '.jpg'))).toString('base64') })))
const config = stepfunConfig(), clips = new Map()
for (const text of new Set(stories.flatMap(s => s.beats.map(b => b.text)).filter(Boolean))) {
  const file = join(output, createHash('sha256').update(text + config.ttsVoice + config.ttsModel).digest('hex').slice(0, 20) + '.mp3')
  let clip = await readFile(file).catch(error => { if (error.code !== 'ENOENT') throw error })
  if (!clip) { clip = await speak(config, text); await writeFile(file, clip) }
  clips.set(text, clip)
}
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.addInitScript(() => {
    const NativeAudio = window.Audio
    window.Audio = function (...args) { const player = new NativeAudio(...args); window.previewAudio = player; return player }
    window.Audio.prototype = NativeAudio.prototype
  })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/api/**', route => {
    if (new URL(route.request().url()).pathname === '/api/tts') {
      const clip = clips.get(route.request().postDataJSON().text)
      return route.fulfill(clip ? { contentType: 'audio/mpeg', body: clip } : { status: 404, json: { error: 'Unprepared clip' } })
    }
    return route.fulfill({ status: 503, json: { error: 'Read-only isolated preview' } })
  })
  await page.route('**/__storytelling-preview', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/app.css"><div id="root"></div><script type="module">
    import '/@vite/client';
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
    const {default:React} = await import('/node_modules/.vite/deps/react.js');
    const {default:ReactDOM} = await import('/node_modules/.vite/deps/react-dom_client.js');
    const {StoryStage} = await import('/src/components/StoryStage.tsx');
    const root = ReactDOM.createRoot(document.getElementById('root'));
    document.body.style.background = '#cedcd4';
    window.renderStory = (story, assets) => root.render(React.createElement(StoryStage,{key:story.id,story,assets,onFocus:()=>{},onClose:()=>root.render(null),onOpen:()=>{},onAnother:()=>{},onRetell:()=>{},onRemembered:()=>{}}));
  </script>` }))
  await page.goto('http://localhost:5183/__storytelling-preview')
  await page.waitForFunction(() => typeof window.renderStory === 'function').catch(error => { throw new Error(error.message + '; ' + errors.join('; ')) })
  const results = []
  for (const story of stories) {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.evaluate(({story, assets}) => window.renderStory(story, assets), { story, assets })
    await page.locator('.story-stage[data-phase="speaking"]').waitFor()
    await page.waitForFunction(() => window.previewAudio?.currentTime > .15 && window.previewAudio?.duration > 1)
    await page.waitForFunction(() => [...document.querySelectorAll('.story-pictures img')].every(i => i.naturalWidth > 0))
    await page.getByRole('button', {name:'暂停故事', exact:true}).click()
    await page.screenshot({ path: join(output, story.id + '-opening.png') })
    const compare = story.beats.findIndex(b => b.layout === 'compare')
    if (compare >= 0) {
      await page.getByRole('button', {name:`第 ${compare + 1} 段故事`, exact:true}).click()
      await page.locator('.story-stage[data-phase="speaking"]').waitFor()
      await page.getByRole('button', {name:'暂停故事', exact:true}).click()
      await page.screenshot({ path: join(output, story.id + '-compare.png') })
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: join(output, story.id + '-mobile.png') })
    assert.equal(await page.locator('.story-audio-note').count(), 0, 'real TTS loads and plays')
    results.push({ id: story.id, title: story.title, photos: story.assetIds.length, beats: story.beats.length, realSpeech: true, checkedClipDuration: await page.evaluate(() => window.previewAudio.duration) })
  }
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'verification.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results))
} finally { await browser.close() }

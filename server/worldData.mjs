// The cartoon world's map data (world-data/*.mbtiles) is too large for git. It lives on the project's
// Seafile; world-data/manifest.json (in git) lists each file with its size, SHA-256 and download
// link (a Seafile file share with ?dl=1). When the service starts, missing or outdated files are
// downloaded in the background. A file without a link falls back to WORLD_DATA_URL, a template
// with {name}, e.g. a Seafile folder share:
//   WORLD_DATA_URL=https://seafile.example.com/d/<share-token>/files/?p=/{name}&dl=1
// Until a file is in place the map keeps working from the online source, and the page shows the
// progress (worldDataStatus → GET /api/world-data/status) and holds the map back.
//
// The download is fast and survives interruptions: the file is cut into chunks fetched over
// several connections with Range requests (servers without Range fall back to one stream), and the
// finished chunks are recorded next to the partial file, so a restart resumes instead of starting over.
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

export const worldDataDir = fileURLToPath(new URL('../world-data/', import.meta.url))
const manifestPath = join(worldDataDir, 'manifest.json')

const CHUNK = 16 * 1048576
const CONNECTIONS = 4
const CHUNK_TRIES = 5

export async function readManifest() {
  try { return JSON.parse(await readFile(manifestPath, 'utf8')) } catch { return { files: [] } }
}

export async function sha256(path) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

// Size first (cheap); the hash only when the size matches but the content is in question
async function upToDate(file) {
  const info = await stat(join(worldDataDir, file.name)).catch(() => null)
  return Boolean(info && info.size === file.size)
}

export async function missingWorldData() {
  const { files = [] } = await readManifest()
  const missing = []
  for (const file of files) if (!(await upToDate(file))) missing.push(file)
  return missing
}

const linkFor = (file, template) => file.url || (template ? template.replace('{name}', encodeURIComponent(file.name)) : '')

// ---- What the page shows ----------------------------------------------------------------------
// state: checking → downloading → verifying → ready, or unavailable (nothing to download from) /
// error (retry is offered). `ready` also covers "nothing is missing".
const progress = { state: 'checking', file: '', received: 0, total: 0, done: 0, count: 0, speed: 0, error: '', message: '' }
let running = null

export async function worldDataStatus() {
  if (progress.state === 'checking') {
    const missing = await missingWorldData()
    if (!missing.length) return { ...progress, state: 'ready' }
    if (process.env.SKIP_WORLD_DATA) return { ...progress, state: 'unavailable', message: '已设置 SKIP_WORLD_DATA，不下载地图数据，地图使用在线数据' }
  }
  return { ...progress }
}

function trackSpeed() {
  const samples = []
  return (received) => {
    const now = Date.now()
    samples.push([now, received])
    while (samples.length > 2 && now - samples[0][0] > 5000) samples.shift()
    const [t0, r0] = samples[0]
    progress.speed = now > t0 ? Math.round((received - r0) / ((now - t0) / 1000)) : 0
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function readSidecar(path, file) {
  try {
    const saved = JSON.parse(await readFile(path, 'utf8'))
    if (saved.size === file.size && saved.chunk === CHUNK && Array.isArray(saved.done)) return new Set(saved.done)
  } catch { /* no record: start from the first chunk */ }
  return new Set()
}

async function fetchRange(url, start, end) {
  const response = await fetch(url, { redirect: 'follow', headers: { Range: `bytes=${start}-${end}` } })
  if (response.status !== 206 || !response.body) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status })
  return response
}

async function download(file, template, onBytes) {
  const url = linkFor(file, template)
  const target = join(worldDataDir, file.name)
  const partial = `${target}.download`
  const sidecar = `${partial}.json`
  await mkdir(worldDataDir, { recursive: true })

  const probe = await fetch(url, { redirect: 'follow', headers: { Range: 'bytes=0-0' } })
  await probe.body?.cancel().catch(() => {})
  if (!probe.ok) throw new Error(`下载 ${file.name} 失败：HTTP ${probe.status}`)
  const ranged = probe.status === 206

  if (!ranged) {
    // No Range support: one stream from the start
    await rm(sidecar, { force: true })
    const response = await fetch(url, { redirect: 'follow' })
    if (!response.ok || !response.body) throw new Error(`下载 ${file.name} 失败：HTTP ${response.status}`)
    const handle = await open(partial, 'w')
    try {
      let at = 0
      for await (const piece of response.body) { await handle.write(piece, 0, piece.byteLength, at); at += piece.byteLength; onBytes(piece.byteLength) }
    } finally { await handle.close() }
    return { partial, target }
  }

  const chunks = Math.ceil(file.size / CHUNK)
  const done = await readSidecar(sidecar, file)
  const handle = await open(partial, (await stat(partial).catch(() => null)) ? 'r+' : 'w+')
  try {
    await handle.truncate(file.size)
    for (const index of done) onBytes(Math.min(CHUNK, file.size - index * CHUNK))
    let next = 0
    let failure = null
    let saved = Date.now()
    const worker = async () => {
      while (!failure) {
        const index = next++
        if (index >= chunks) return
        if (done.has(index)) continue
        const start = index * CHUNK
        const end = Math.min(start + CHUNK, file.size) - 1
        let counted = 0
        for (let attempt = 1; ; attempt++) {
          try {
            const response = await fetchRange(url, start, end)
            let at = start
            for await (const piece of response.body) {
              await handle.write(piece, 0, piece.byteLength, at)
              at += piece.byteLength
              counted += piece.byteLength
              onBytes(piece.byteLength)
            }
            if (at !== end + 1) throw new Error('数据不完整')
            break
          } catch (error) {
            onBytes(-counted); counted = 0
            if (failure) return
            if (attempt >= CHUNK_TRIES) { failure = error; return }
            await wait(1000 * attempt)
          }
        }
        done.add(index)
        if (Date.now() - saved > 3000) { saved = Date.now(); await writeFile(sidecar, JSON.stringify({ size: file.size, chunk: CHUNK, done: [...done] })).catch(() => {}) }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONNECTIONS, chunks) }, worker))
    await writeFile(sidecar, JSON.stringify({ size: file.size, chunk: CHUNK, done: [...done] })).catch(() => {})
    if (failure) throw new Error(`下载 ${file.name} 中断：${failure.message}，已保留进度，重试会从断点继续`)
  } finally { await handle.close() }
  return { partial, target, sidecar }
}

async function sync(template, log) {
  const missing = await missingWorldData()
  if (!missing.length) { Object.assign(progress, { state: 'ready', error: '', message: '', speed: 0 }); return [] }
  const downloadable = missing.filter((file) => linkFor(file, template))
  for (const file of missing) if (!linkFor(file, template)) log(`地图数据缺少 ${file.name}：manifest 里没有下载链接，也没有在 .env 设置 WORLD_DATA_URL；在此之前地图使用在线数据`)
  if (!downloadable.length) {
    Object.assign(progress, { state: 'unavailable', error: '', message: '没有可用的地图数据下载地址（manifest.json 没有链接，.env 也没有 WORLD_DATA_URL），地图使用在线数据', speed: 0 })
    return []
  }
  const total = downloadable.reduce((sum, file) => sum + file.size, 0)
  Object.assign(progress, { state: 'downloading', file: '', received: 0, total, done: 0, count: downloadable.length, speed: 0, error: '', message: '' })
  const finished = []
  let base = 0
  for (const file of downloadable) {
    log(`下载地图数据 ${file.name}（${Math.round(file.size / 1048576)} MB）…`)
    progress.file = file.name
    const sample = trackSpeed()
    let received = 0
    let logged = 0
    const onBytes = (n) => {
      received += n
      progress.received = base + received
      sample(progress.received)
      if (received - logged > 200 * 1048576) { logged = received; log(`${file.name}：${Math.round(received / 1048576)}/${Math.round(file.size / 1048576)} MB`) }
    }
    try {
      const { partial, target, sidecar } = await download(file, template, onBytes)
      progress.state = 'verifying'
      const digest = await sha256(partial)
      if (file.sha256 && digest !== file.sha256) {
        await rm(partial, { force: true }); await rm(sidecar || '', { force: true })
        throw new Error(`${file.name} 校验失败，已丢弃，请重试`)
      }
      await rename(partial, target)
      if (sidecar) await rm(sidecar, { force: true })
      finished.push(file.name)
      base += file.size
      progress.done += 1
      progress.state = 'downloading'
      log(`${file.name} 已就绪`)
    } catch (error) {
      log(error.message)
      Object.assign(progress, { state: 'error', error: error.message, speed: 0 })
      return finished
    }
  }
  Object.assign(progress, { state: 'ready', speed: 0, received: total })
  return finished
}

/** Downloads what the manifest lists and this computer lacks; returns the names now in place.
 *  One run at a time: a second call while one is running gets the same promise. */
export function syncWorldData({ template = process.env.WORLD_DATA_URL, log = console.log } = {}) {
  if (!running) running = sync(template, log).finally(() => { running = null })
  return running
}

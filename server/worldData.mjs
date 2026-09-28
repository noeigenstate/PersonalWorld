// The cartoon world's map data (world-data/*.mbtiles) is too large for git. It lives on the project's
// Seafile; world-data/manifest.json (in git) lists each file with its size, SHA-256 and download
// link (a Seafile file share with ?dl=1). When the service starts, missing or outdated files are
// downloaded in the background. A file without a link falls back to WORLD_DATA_URL, a template
// with {name}, e.g. a Seafile folder share:
//   WORLD_DATA_URL=https://seafile.example.com/d/<share-token>/files/?p=/{name}&dl=1
// Until a file is in place the map keeps working from the online source.
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

export const worldDataDir = fileURLToPath(new URL('../world-data/', import.meta.url))
const manifestPath = join(worldDataDir, 'manifest.json')

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

async function download(file, template, log) {
  const url = linkFor(file, template)
  const target = join(worldDataDir, file.name)
  const partial = `${target}.download`
  await mkdir(worldDataDir, { recursive: true })
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`下载 ${file.name} 失败：HTTP ${response.status}`)
  let received = 0, reported = 0
  const counter = new TransformStream({
    transform(chunk, controller) {
      received += chunk.byteLength
      if (received - reported > 200 * 1048576) { reported = received; log(`${file.name}：${Math.round(received / 1048576)}/${Math.round(file.size / 1048576)} MB`) }
      controller.enqueue(chunk)
    },
  })
  await pipeline(Readable.fromWeb(response.body.pipeThrough(counter)), createWriteStream(partial))
  const digest = await sha256(partial)
  if (file.sha256 && digest !== file.sha256) { await rm(partial, { force: true }); throw new Error(`${file.name} 校验失败，已丢弃`) }
  await rename(partial, target)
}

/** Downloads what the manifest lists and this computer lacks; returns the names now in place */
export async function syncWorldData({ template = process.env.WORLD_DATA_URL, log = console.log } = {}) {
  const missing = await missingWorldData()
  if (!missing.length) return []
  const done = []
  for (const file of missing) {
    if (!linkFor(file, template)) { log(`地图数据缺少 ${file.name}：manifest 里没有下载链接，也没有在 .env 设置 WORLD_DATA_URL；在此之前地图使用在线数据`); continue }
    log(`下载地图数据 ${file.name}（${Math.round(file.size / 1048576)} MB）…`)
    try { await download(file, template, log); done.push(file.name); log(`${file.name} 已就绪`) } catch (error) { log(error.message) }
  }
  return done
}

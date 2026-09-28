// Builds the cartoon world ahead of time so the map opens from local files (server/data/cartoon-tiles):
// China at country scale (zoom 2–7), and every photo place in the accounts on this computer from city
// to street scale (zoom 8–14). Tiles already built are skipped; re-running only fills gaps.
// node scripts/build-cartoon-world.mjs [--china-only] [--places-only]
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cartoonTile, isCartoonTileSaved } from '../server/cartoonTiles.mjs'

const accounts = fileURLToPath(new URL('../server/data/accounts/', import.meta.url))
const lngTile = (lng, z) => Math.floor(((lng + 180) / 360) * 2 ** z)
const latTile = (lat, z) => Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z)
const args = new Set(process.argv.slice(2))

const jobs = new Set()
const area = (z, west, south, east, north) => {
  for (let x = lngTile(west, z); x <= lngTile(east, z); x++) for (let y = latTile(north, z); y <= latTile(south, z); y++) jobs.add(`${z}/${x}/${y}`)
}
const around = (z, lng, lat, radius) => {
  const cx = lngTile(lng, z), cy = latTile(lat, z)
  for (let dx = -radius; dx <= radius; dx++) for (let dy = -radius; dy <= radius; dy++) jobs.add(`${z}/${cx + dx}/${cy + dy}`)
}

if (!args.has('--places-only')) for (let z = 2; z <= 7; z++) area(z, 73, 18, 135, 54)

// Photo places, read from the account vaults (coordinates only; nothing leaves this computer
// except the tile numbers requested from the public map)
const places = []
if (!args.has('--china-only')) {
  for (const id of await readdir(accounts).catch(() => [])) {
    const state = JSON.parse(await readFile(join(accounts, id, 'state.json'), 'utf8').catch(() => '{}'))
    for (const asset of state.memory?.assets || []) {
      if (Number.isFinite(asset.latitude) && Number.isFinite(asset.longitude)) places.push([asset.longitude, asset.latitude])
      else if (asset.location?.gcj) places.push(asset.location.gcj) // close enough for choosing tiles
    }
  }
  // One entry per ~1 km so a burst of photos does not repeat work
  const seen = new Set()
  for (const [lng, lat] of places) {
    const key = `${lng.toFixed(2)},${lat.toFixed(2)}`
    if (seen.has(key)) continue
    seen.add(key)
    for (let z = 8; z <= 11; z++) around(z, lng, lat, 2)
    for (let z = 12; z <= 14; z++) around(z, lng, lat, 3)
  }
}

const list = [...jobs].map((key) => key.split('/').map(Number))
let done = 0, built = 0, failed = 0
const started = Date.now()
const queue = [...list]
async function worker() {
  for (let job = queue.shift(); job; job = queue.shift()) {
    const [z, x, y] = job
    try {
      if (!(await isCartoonTileSaved(z, x, y))) { await cartoonTile(z, x, y); built++ }
    } catch { failed++ }
    done++
    if (done % 50 === 0 || done === list.length) console.log(`${done}/${list.length} tiles (built ${built}, failed ${failed}, ${Math.round((Date.now() - started) / 1000)}s)`)
  }
}
console.log(`Cartoon world: ${list.length} tiles for China and ${places.length} photos`)
await Promise.all(Array.from({ length: 4 }, worker))
console.log(failed ? `${failed} tiles failed (source unreachable); run again to fill them` : 'All tiles built.')

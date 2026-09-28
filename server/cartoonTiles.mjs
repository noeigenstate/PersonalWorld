// The cartoon world: real geography (OpenStreetMap via OpenFreeMap vector tiles) reduced to what a
// cartoon map draws — water, woods, grass, parks, towns, sand, ice, rivers, roads, borders, building
// footprints with heights, and mountain peaks. Each tile is built once and kept on this computer
// (server/data/cartoon-tiles); a tile older than REFRESH_AGE is compared with the online map in the
// background and replaced only when it changed. The browser keeps its own copy too (map-cache-sw.js).
import { VectorTile } from '@mapbox/vector-tile'
import Pbf from 'pbf'
import polygonClipping from 'polygon-clipping'
import { mkdir, readdir, readFile, stat, utimes, writeFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const CARTOON_VERSION = 3
export const MIN_ZOOM = 2
export const MAX_ZOOM = 14
const tileTemplate = process.env.MAP_SCENE_TILE_URL || 'https://tiles.openfreemap.org/planet/latest/{z}/{x}/{y}.pbf'
const root = process.env.CARTOON_TILE_DIR || fileURLToPath(new URL('./data/cartoon-tiles/', import.meta.url))
const REFRESH_AGE = 30 * 24 * 60 * 60 * 1000
const GRID = 10000 // coordinates are integers in 0…GRID across the tile
const inFlight = new Map()

// OpenMapTiles classes → cartoon kinds
const LANDCOVER = { wood: 'forest', forest: 'forest', grass: 'grass', farmland: 'grass', wetland: 'grass', sand: 'sand', beach: 'sand', ice: 'ice', glacier: 'ice', rock: 'rock' }
const LANDUSE = { residential: 'town', suburb: 'town', neighbourhood: 'town', commercial: 'town', industrial: 'town', retail: 'town', school: 'town', university: 'town', college: 'town', hospital: 'town', stadium: 'park', pitch: 'park', playground: 'park', cemetery: 'grass', zoo: 'park', theme_park: 'park' }
const ROAD_RANK = { motorway: 5, trunk: 5, primary: 4, secondary: 3, tertiary: 3, minor: 2, service: 1, track: 1, path: 0, rail: 2 }

export const validTile = (z, x, y) => [z, x, y].every(Number.isInteger) && z >= MIN_ZOOM && z <= MAX_ZOOM && x >= 0 && y >= 0 && x < 2 ** z && y < 2 ** z
const tilePath = (z, x, y) => join(root, `v${CARTOON_VERSION}`, String(z), String(x), `${y}.json`)

// Douglas–Peucker on a flat [x0, y0, x1, y1, …] list
function simplify(points, tolerance) {
  if (points.length <= 4) return points
  const keep = new Uint8Array(points.length / 2)
  keep[0] = keep[keep.length - 1] = 1
  const stack = [[0, keep.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    const ax = points[a * 2], ay = points[a * 2 + 1], bx = points[b * 2], by = points[b * 2 + 1]
    const dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy) || 1
    let far = -1, farthest = tolerance
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * points[i * 2] - dx * points[i * 2 + 1] + bx * ay - by * ax) / length
      if (d > farthest) { farthest = d; far = i }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]) }
  }
  const out = []
  for (let i = 0; i < keep.length; i++) if (keep[i]) out.push(points[i * 2], points[i * 2 + 1])
  return out
}

// A closed ring starts and ends on the same point, which would make every distance zero:
// simplify its two halves separately
function simplifyRing(points, tolerance) {
  const n = points.length / 2
  if (n <= 8) return points
  const mid = Math.floor(n / 2)
  const first = simplify(points.slice(0, (mid + 1) * 2), tolerance)
  const second = simplify(points.slice(mid * 2), tolerance)
  return first.concat(second.slice(2))
}

const flat = (ring, scale) => ring.flatMap((p) => [Math.round(p.x * scale), Math.round(p.y * scale)])
const signedArea = (ring) => { let sum = 0; for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) sum += (ring[i] - ring[j]) * (ring[i + 1] + ring[j + 1]); return sum }

// Vector-tile polygons: an exterior ring followed by its holes (winding tells them apart)
function polygons(rings, scale, tolerance) {
  const out = []
  let ccw
  for (const raw of rings) {
    const ring = simplifyRing(flat(raw, scale), tolerance)
    if (ring.length < 6) continue
    const area = signedArea(ring)
    if (!area) continue
    if (ccw === undefined) ccw = area < 0
    if ((area < 0) === ccw || !out.length) out.push([ring])
    else out.at(-1).push(ring)
  }
  return out
}

export function buildCartoonTile(buffer, z) {
  const tile = new VectorTile(new Pbf(buffer))
  const tolerance = z < 8 ? 30 : z < 11 ? 18 : z < 13 ? 10 : 5 // in GRID units
  const out = { v: CARTOON_VERSION, z, land: [], water: [], forest: [], grass: [], park: [], town: [], sand: [], ice: [], rock: [], rivers: [], roads: [], borders: [], buildings: [], peaks: [] }
  const each = (name, visit) => {
    const layer = tile.layers[name]
    if (!layer) return
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i)
      visit(feature, feature.properties, GRID / layer.extent)
    }
  }
  each('water', (f, p, s) => { if (f.type === 3 && p.brunnel !== 'tunnel') out.water.push(...polygons(f.loadGeometry(), s, tolerance)) })
  each('landcover', (f, p, s) => { const kind = LANDCOVER[p.class] || LANDCOVER[p.subclass]; if (kind && f.type === 3) out[kind].push(...polygons(f.loadGeometry(), s, tolerance)) })
  each('landuse', (f, p, s) => { const kind = LANDUSE[p.class]; if (kind && f.type === 3) out[kind].push(...polygons(f.loadGeometry(), s, tolerance)) })
  // Parks and gardens only: reserves and protected areas cover whole mountain ranges
  each('park', (f, p, s) => { if (f.type === 3 && !/reserve|protected|conservation|national_park/.test(p.class || '')) out.park.push(...polygons(f.loadGeometry(), s, tolerance)) })
  each('waterway', (f, p, s) => {
    if (f.type !== 2 || p.brunnel === 'tunnel') return
    const width = p.class === 'river' ? 3 : p.class === 'canal' ? 2 : 1
    for (const line of f.loadGeometry()) { const pts = simplify(flat(line, s), tolerance); if (pts.length >= 4) out.rivers.push({ w: width, pts }) }
  })
  each('transportation', (f, p, s) => {
    if (f.type !== 2 || p.brunnel === 'tunnel' || p.class === 'ferry' || p.class === 'transit') return
    const rank = ROAD_RANK[p.class]
    // Country scale: motorways only; then main roads; streets from zoom 12
    if (rank === undefined || (z < 7 && rank < 5) || (z < 9 && rank < 4) || (z < 12 && rank < 2)) return
    for (const line of f.loadGeometry()) { const pts = simplify(flat(line, s), tolerance); if (pts.length >= 4) out.roads.push({ r: rank, rail: p.class === 'rail' ? 1 : 0, pts }) }
  })
  each('boundary', (f, p, s) => {
    if (f.type !== 2 || p.maritime || !(p.admin_level <= 4)) return
    for (const line of f.loadGeometry()) { const pts = simplify(flat(line, s), tolerance * 2); if (pts.length >= 4) out.borders.push({ l: p.admin_level, pts }) }
  })
  each('building', (f, p, s) => {
    if (f.type !== 3 || p.hide_3d) return
    const height = Math.max(3, Math.min(600, Number(p.render_height) || 6))
    const base = Math.max(0, Math.min(height - 1, Number(p.render_min_height) || 0))
    for (const polygon of polygons(f.loadGeometry(), s, 2)) out.buildings.push({ h: Math.round(height), b: Math.round(base), ring: polygon[0] })
  })
  each('mountain_peak', (f, p, s) => {
    if (f.type !== 1) return
    const [[point]] = f.loadGeometry()
    const ele = Number(p.ele)
    if (Number.isFinite(ele) && ele > 300) out.peaks.push({ x: Math.round(point.x * s), y: Math.round(point.y * s), e: Math.round(ele) })
  })
  // Land and water as exact complements inside the tile, so land can stand above the water with
  // cliffs along the real shoreline (the client draws water lower and walls at every land edge)
  const square = [[[0, 0], [GRID, 0], [GRID, GRID], [0, GRID], [0, 0]]]
  const pairsOf = (ring) => { const out = []; for (let i = 0; i < ring.length; i += 2) out.push([ring[i], ring[i + 1]]); if (out.length && (out[0][0] !== out.at(-1)[0] || out[0][1] !== out.at(-1)[1])) out.push(out[0]); return out }
  const flatOf = (ring) => ring.slice(0, -1).flatMap(([x, y]) => [Math.round(x), Math.round(y)])
  try {
    const water = out.water.map((polygon) => polygon.map(pairsOf))
    const wet = water.length ? polygonClipping.intersection(polygonClipping.union(...water), square) : []
    out.water = wet.map((polygon) => polygon.map(flatOf))
    out.land = polygonClipping.difference(square, ...(wet.length ? [wet] : [])).map((polygon) => polygon.map(flatOf))
  } catch {
    out.land = [[[0, 0, GRID, 0, GRID, GRID, 0, GRID]]]
  }
  // Keep the file small: drop empty kinds
  for (const [key, value] of Object.entries(out)) if (Array.isArray(value) && !value.length) delete out[key]
  return out
}

// The source data: OpenStreetMap vector tiles (OpenMapTiles schema), kept on disk as fetched so the
// cartoon tiles can be rebuilt locally whenever their format changes (world-data/osm/z/x/y.pbf)
export const sourceRoot = process.env.OSM_TILE_DIR || fileURLToPath(new URL('../world-data/osm/', import.meta.url))
const sourcePath = (z, x, y) => join(sourceRoot, String(z), String(x), `${y}.pbf`)
export const isSourceSaved = (z, x, y) => stat(sourcePath(z, x, y)).then(() => true, () => false)

// Regions built locally from OpenStreetMap (scripts/build-osm-region.mjs → world-data/*.mbtiles).
// MBTiles is SQLite with gzipped vector tiles, rows counted from the south (TMS).
const archives = []
let archivesReady = null
function openArchives() {
  archivesReady ||= (async () => {
    const { DatabaseSync } = await import('node:sqlite')
    const dir = dirname(sourceRoot)
    for (const name of (await readdir(dir).catch(() => [])).filter((n) => n.endsWith('.mbtiles'))) {
      try {
        const db = new DatabaseSync(join(dir, name), { readOnly: true })
        const meta = Object.fromEntries(db.prepare('SELECT name, value FROM metadata').all().map((row) => [row.name, row.value]))
        const [west, south, east, north] = String(meta.bounds || '-180,-85,180,85').split(',').map(Number)
        archives.push({ name, db, query: db.prepare('SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?'), bounds: { west, south, east, north }, minzoom: Number(meta.minzoom ?? 0), maxzoom: Number(meta.maxzoom ?? 14) })
      } catch (error) { console.warn(`无法打开 ${name}`, error.message) }
    }
  })()
  return archivesReady
}
const tileWest = (x, z) => (x / 2 ** z) * 360 - 180
const tileNorth = (y, z) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI

/** Forget opened archives so newly downloaded ones are used */
export function reloadArchives() {
  for (const archive of archives) { try { archive.db.close() } catch {} }
  archives.length = 0
  archivesReady = null
}

async function archiveTile(z, x, y) {
  await openArchives()
  const west = tileWest(x, z), east = tileWest(x + 1, z), north = tileNorth(y, z), south = tileNorth(y + 1, z)
  for (const archive of archives) {
    const b = archive.bounds
    if (z < archive.minzoom || z > archive.maxzoom || east < b.west || west > b.east || north < b.south || south > b.north) continue
    const row = archive.query.get(z, x, 2 ** z - 1 - y)
    if (row) { const data = Buffer.from(row.tile_data); return new Uint8Array(data[0] === 0x1f && data[1] === 0x8b ? gunzipSync(data) : data) }
    // Inside a local region but no row: nothing there (open sea)
    if (west >= b.west && east <= b.east && south >= b.south && north <= b.north) return new Uint8Array()
  }
  return null
}

export async function sourceTile(z, x, y, { refresh = false } = {}) {
  const local = await archiveTile(z, x, y)
  if (local) return local
  const path = sourcePath(z, x, y)
  if (!refresh) {
    try { return new Uint8Array(await readFile(path)) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  const url = tileTemplate.replace('{z}', z).replace('{x}', x).replace('{y}', y)
  const response = await fetch(url, { headers: { 'User-Agent': 'PersonalWorldHackathon/0.4 (cartoon world)' }, signal: AbortSignal.timeout(20000) })
  let bytes
  if (response.status === 404 || response.status === 204) bytes = new Uint8Array() // nothing there (open sea)
  else if (!response.ok) throw new Error(`地图瓦片 HTTP ${response.status}`)
  else bytes = new Uint8Array(await response.arrayBuffer())
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes)
  return bytes
}
const fetchTile = (z, x, y, refresh) => sourceTile(z, x, y, { refresh })

async function buildAndSave(z, x, y, saved, refresh = false) {
  const key = `${z}/${x}/${y}`
  if (inFlight.has(key)) return inFlight.get(key)
  const path = tilePath(z, x, y)
  const task = (async () => {
    const bytes = await fetchTile(z, x, y, refresh)
    const json = JSON.stringify(bytes.length ? buildCartoonTile(bytes, z) : { v: CARTOON_VERSION, z })
    await mkdir(dirname(path), { recursive: true })
    if (saved === json) await utimes(path, new Date(), new Date()).catch(() => {})
    else await writeFile(path, json, 'utf8')
    return json
  })()
  inFlight.set(key, task)
  try { return await task } finally { inFlight.delete(key) }
}

/** The tile as JSON text: local first; built from the online map only when missing */
export async function cartoonTile(z, x, y) {
  if (!validTile(z, x, y)) throw new Error('瓦片编号无效')
  const path = tilePath(z, x, y)
  try {
    const [json, info] = await Promise.all([readFile(path, 'utf8'), stat(path)])
    if (Date.now() - info.mtimeMs > REFRESH_AGE) buildAndSave(z, x, y, json, true).catch(() => {})
    return json
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  return buildAndSave(z, x, y)
}

export const isCartoonTileSaved = async (z, x, y) => stat(tilePath(z, x, y)).then(() => true, () => false)

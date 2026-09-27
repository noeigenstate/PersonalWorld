// Optional, bounded OSM detail for a visited park or shopping complex. Vector tiles
// generalise away building categories and AOI names; this preserves the source tags.
// Only a geographic box is requested, never a photo, person or private place label.
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const cacheDir = fileURLToPath(new URL('./data/map-scenes/details-v4/', import.meta.url))
const inFlight = new Map()
const age = 7 * 86400000

export function containsPoint(point, rings) {
  const inside = (ring) => {
    let result = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j]
      if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result
    }
    return result
  }
  return Boolean(rings[0]?.length >= 4 && inside(rings[0]) && !rings.slice(1).some(inside))
}

export function ringsBounds(rings) {
  const points = rings.flat()
  return [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1])), Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))]
}

function stitch(paths) {
  const remaining = paths.map((path) => [...path])
  const closed = []
  while (remaining.length) {
    let chain = remaining.shift()
    while (chain[0] !== chain.at(-1)) {
      const index = remaining.findIndex((path) => path[0] === chain.at(-1) || path.at(-1) === chain.at(-1))
      if (index < 0) break
      let part = remaining.splice(index, 1)[0]
      if (part.at(-1) === chain.at(-1)) part = part.reverse()
      chain = chain.concat(part.slice(1))
    }
    if (chain.length >= 4 && chain[0] === chain.at(-1)) closed.push(chain)
  }
  return closed
}

export function extractDetails(elements) {
  const nodes = new Map(elements.filter((item) => item.type === 'node').map((item) => [item.id, [item.lon, item.lat]]))
  const ways = new Map(elements.filter((item) => item.type === 'way').map((item) => [item.id, item]))
  const points = (ids) => ids?.every((id) => nodes.has(id)) ? ids.map((id) => nodes.get(id)) : []
  const polygons = (item) => {
    if (item.type === 'way') {
      const ring = points(item.nodes)
      return item.nodes?.[0] === item.nodes?.at(-1) && ring.length >= 4 ? [[ring]] : []
    }
    if (item.type !== 'relation' || item.tags?.type !== 'multipolygon') return []
    const members = (role) => item.members.filter((m) => m.type === 'way' && (m.role || 'outer') === role).map((m) => ways.get(m.ref)?.nodes).filter(Boolean)
    const outer = stitch(members('outer')).map(points).filter((ring) => ring.length >= 4)
    const inner = stitch(members('inner')).map(points).filter((ring) => ring.length >= 4)
    return outer.map((ring) => [ring, ...inner.filter((hole) => containsPoint(hole[0], [ring]))])
  }
  const result = { venues: [], buildings: [], grounds: [], water: [], green: [], treeRows: [] }
  for (const item of elements) {
    const tags = item.tags || {}
    if (tags.natural === 'tree_row' && item.type === 'way') {
      const path = points(item.nodes)
      if (path.length > 1) result.treeRows.push({ id: `osm:way:${item.id}`, path })
    }
    const ringsList = polygons(item)
    if (!ringsList.length) continue
    const id = `osm:${item.type}:${item.id}`
    const kind = tags.shop === 'mall' ? 'mall' : /^(park|garden|sports_centre)$/.test(tags.leisure || '') ? 'park' : null
    if (kind && tags.name) {
      const bbox = ringsBounds(ringsList.flat())
      // Large reserves need tiled streaming; never turn a whole mountain into one mesh.
      const width = (bbox[2] - bbox[0]) * 111320 * Math.cos(bbox[1] * Math.PI / 180)
      const height = (bbox[3] - bbox[1]) * 111320
      if (width <= 3000 && height <= 3000) result.venues.push({ id, name: tags.name, kind, polygons: ringsList, bbox, center: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2] })
    }
    for (const [part, rings] of ringsList.entries()) {
      const base = { id: `${id}:${part}`, rings }
      const buildingKind = tags.building === 'stadium' || tags.leisure === 'stadium' ? 'stadium' : tags.leisure === 'sports_hall' || tags.building === 'sports_hall' ? 'sports_hall'
        : tags.shop === 'mall' || /^(retail|commercial)$/.test(tags.building || '') ? 'commercial'
          : /^(school|kindergarten|college|university)$/.test(tags.amenity || tags.building || '') ? 'school' : tags.building || ''
      if (tags.building && tags.building !== 'no' && !tags['building:part'] && !tags.min_height) result.buildings.push({ ...base, kind: buildingKind, name: tags.name, height: tags.height || null, levels: tags['building:levels'] || null })
      if (tags.leisure === 'pitch' || tags.leisure === 'track') result.grounds.push({ ...base, kind: tags.leisure, sport: tags.sport || '' })
      if (tags.natural === 'water' || tags.waterway === 'riverbank') result.water.push(base)
      if (/^(wood|scrub|grassland)$/.test(tags.natural || '') || /^(grass|forest|meadow)$/.test(tags.landuse || '') || /^(park|garden)$/.test(tags.leisure || '')) result.green.push(base)
    }
  }
  return result
}

export async function loadSceneDetails(bbox) {
  const key = bbox.map((v) => v.toFixed(4)).join('_')
  const path = join(cacheDir, `${key}.json`)
  try {
    if (Date.now() - (await stat(path)).mtimeMs < age) return JSON.parse(await readFile(path, 'utf8'))
  } catch { /* Optional enrichment cannot make the base map unavailable. */ }
  if (inFlight.has(key)) return inFlight.get(key)
  const task = (async () => {
    const response = await fetch(`https://api.openstreetmap.org/api/0.6/map.json?bbox=${bbox.join(',')}`, {
      headers: { 'User-Agent': 'PersonalWorldHackathon/0.4 (on-demand cached venue detail)' },
      signal: AbortSignal.timeout(9000),
    })
    if (!response.ok) throw new Error(`OSM detail HTTP ${response.status}`)
    const body = await response.text()
    if (body.length > 12 * 1024 * 1024) throw new Error('OSM detail exceeds scene budget')
    const data = JSON.parse(body)
    const details = extractDetails(data.elements || [])
    await mkdir(cacheDir, { recursive: true })
    await writeFile(path, JSON.stringify(details), 'utf8')
    return details
  })()
  inFlight.set(key, task)
  try { return await task }
  finally { inFlight.delete(key) }
}

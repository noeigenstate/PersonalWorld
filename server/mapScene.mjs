// Build a photo neighbourhood from the vector tiles needed for the current view.
// Only a coordinate leaves this server; photo pixels and story text stay local.
import { VectorTile } from '@mapbox/vector-tile'
import Pbf from 'pbf'
import polygonClipping from 'polygon-clipping'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { containsPoint, loadSceneDetails } from './mapSceneDetails.mjs'

const cacheDir = fileURLToPath(new URL('./data/map-scenes/', import.meta.url))
const tileTemplate = process.env.MAP_SCENE_TILE_URL || 'https://tiles.openfreemap.org/planet/latest/{z}/{x}/{y}.pbf'
const zoom = 14
const cacheAge = 7 * 24 * 60 * 60 * 1000
// Invalidate older extracts that lack venue boundaries, waterways and source building
// categories (v1 also treated the default 5 m height as a measurement).
const sceneVersion = 3
const inFlight = new Map()

function bboxFor(lng, lat, radius = 900) {
  const halfLat = radius / 111320
  const halfLng = radius / (111320 * Math.cos(lat * Math.PI / 180))
  return [lng - halfLng, lat - halfLat, lng + halfLng, lat + halfLat].map((value) => Number(value.toFixed(6)))
}

function tileAt(lng, lat) {
  const scale = 2 ** zoom
  return [Math.floor((lng + 180) / 360 * scale), Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * scale)]
}

function tileUrl(x, y) {
  return tileTemplate.replace('{z}', zoom).replace('{x}', x).replace('{y}', y)
}

async function loadTile(x, y) {
  const response = await fetch(tileUrl(x, y), {
    headers: { 'User-Agent': 'PersonalWorldHackathon/0.3 (local map scene)' },
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`地图瓦片 HTTP ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (!bytes.length || bytes.length > 4 * 1024 * 1024) throw new Error('地图瓦片为空或过大')
  return new VectorTile(new Pbf(bytes))
}

const rounded = ([lng, lat]) => [Number(lng.toFixed(6)), Number(lat.toFixed(6))]

function clipPolygons(geometry, bbox) {
  const [west, south, east, north] = bbox
  const rectangle = [[[[west, south], [east, south], [east, north], [west, north], [west, south]]]]
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : []
  if (!polygons.length) return []
  try {
    return polygonClipping.intersection(polygons, rectangle)
      .filter((polygon) => polygon[0]?.length >= 4)
      .map((polygon) => polygon.map((ring) => ring.map(rounded)))
  } catch { return [] }
}

function clipSegment(a, b, bbox) {
  const [west, south, east, north] = bbox
  const dx = b[0] - a[0], dy = b[1] - a[1]
  let start = 0, end = 1
  for (const [p, q] of [[-dx, a[0] - west], [dx, east - a[0]], [-dy, a[1] - south], [dy, north - a[1]]]) {
    if (p === 0 && q < 0) return null
    if (p < 0) start = Math.max(start, q / p)
    if (p > 0) end = Math.min(end, q / p)
  }
  if (start >= end) return null
  return [rounded([a[0] + start * dx, a[1] + start * dy]), rounded([a[0] + end * dx, a[1] + end * dy])]
}

function clipLines(geometry, bbox) {
  const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.type === 'MultiLineString' ? geometry.coordinates : []
  const pieces = []
  for (const line of lines) {
    let path = []
    for (let i = 1; i < line.length; i++) {
      const segment = clipSegment(line[i - 1], line[i], bbox)
      if (!segment) {
        if (path.length > 1) pieces.push(path)
        path = []
      } else if (path.length && path.at(-1)[0] === segment[0][0] && path.at(-1)[1] === segment[0][1]) path.push(segment[1])
      else {
        if (path.length > 1) pieces.push(path)
        path = segment
      }
    }
    if (path.length > 1) pieces.push(path)
  }
  return pieces
}

export function appendTile(scene, tile, x, y) {
  const layers = ['building', 'transportation', 'water', 'waterway', 'landcover', 'landuse', 'poi']
  for (const layerName of layers) {
    const layer = tile.layers[layerName]
    if (!layer) continue
    for (let index = 0; index < layer.length; index++) {
      const feature = layer.feature(index)
      const properties = feature.properties
      const geometry = feature.toGeoJSON(x, y, zoom).geometry
      const id = `${zoom}:${x}:${y}:${layerName}:${feature.id ?? index}`
      if (layerName === 'poi') {
        if (geometry.type === 'Point' && properties.name && /^(park|mall|stadium|sports_centre|sports_hall)$/.test(properties.subclass || properties.class)) {
          const [lng, lat] = geometry.coordinates
          if (lng >= scene.bbox[0] && lat >= scene.bbox[1] && lng <= scene.bbox[2] && lat <= scene.bbox[3]) scene.venueCandidates.push({ name: properties.name, point: [lng, lat] })
        }
        continue
      }
      if (layerName === 'waterway' && feature.type === 2) {
        if (properties.brunnel === 'tunnel') continue
        for (const [part, path] of clipLines(geometry, scene.bbox).entries()) scene.waterways.push({ id: `${id}:${part}`, class: properties.class, path })
        continue
      }
      if (layerName === 'transportation' && feature.type === 2) {
        if (properties.brunnel === 'tunnel' || properties.class === 'transit' || properties.class === 'ferry') continue
        const roadClass = properties.subclass || properties.class
        for (const [part, path] of clipLines(geometry, scene.bbox).entries()) scene.roads.push({ id: `${id}:${part}`, class: roadClass === 'minor' ? 'residential' : roadClass, path })
        continue
      }
      if (feature.type !== 3) continue
      const polygons = clipPolygons(geometry, scene.bbox)
      for (const [part, rings] of polygons.entries()) {
        const entry = { id: `${id}:${part}`, rings }
        if (layerName === 'building') {
          if (properties.hide_3d || properties.render_min_height > 0) continue
          scene.buildings.push({ ...entry, height: properties.render_height > 5 ? String(properties.render_height) : null, levels: null })
        } else if (layerName === 'water') {
          scene.water.push(entry)
          if (properties.class === 'ocean') scene.coast = true
        } else if (layerName === 'landcover') {
          if (['wood', 'grass', 'scrub'].includes(properties.class)) scene.green.push(entry)
          if (['sand', 'beach'].includes(properties.class)) scene.sand.push(entry)
        } else if (layerName === 'landuse') {
          if (['park', 'garden', 'recreation_ground'].includes(properties.class)) scene.green.push(entry)
          else if (properties.class === 'pitch') scene.grounds.push({ ...entry, kind: 'pitch', sport: '' })
          else if (['commercial', 'retail', 'residential', 'brownfield', 'school', 'college', 'university', 'hospital'].includes(properties.class)) scene.landuse.push({ ...entry, kind: properties.class })
        } else if (layerName === 'transportation' && properties.subclass === 'pedestrian') scene.plazas.push(entry)
      }
    }
  }
}

function emptyScene(bbox) {
  return { version: sceneVersion, source: 'OpenStreetMap contributors', license: 'ODbL-1.0', provider: 'OpenMapTiles / OpenFreeMap', bbox, buildings: [], roads: [], water: [], waterways: [], green: [], sand: [], landuse: [], plazas: [], treeRows: [], grounds: [], venues: [], venueCandidates: [], coast: false }
}

async function fillTiles(scene, loaded) {
  const bbox = scene.bbox
  const [west, south, east, north] = bbox
  const [firstX, firstY] = tileAt(west, north)
  const [lastX, lastY] = tileAt(east, south)
  const tasks = []
  for (let x = firstX; x <= lastX; x++) for (let y = firstY; y <= lastY; y++) tasks.push([x, y])
  const tiles = await Promise.all(tasks.map(([x, y]) => {
    const key = `${x}:${y}`
    if (!loaded.has(key)) loaded.set(key, loadTile(x, y))
    return loaded.get(key)
  }))
  tasks.forEach(([x, y], index) => appendTile(scene, tiles[index], x, y))
}

async function buildScene(lng, lat, radius) {
  let scene = emptyScene(bboxFor(lng, lat, radius))
  const loaded = new Map()
  await fillTiles(scene, loaded)
  // Enrich only neighbourhoods with a named public venue; ordinary districts keep
  // their fast vector-only path. The source request is bounded, cached and optional.
  if (scene.venueCandidates.length) {
    try {
      const details = await loadSceneDetails(scene.bbox)
      const venue = details.venues.filter((v) => v.polygons.some((rings) => containsPoint([lng, lat], rings)))
        .sort((a, b) => (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]) - (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1]))[0]
      if (venue) {
        const padding = bboxFor(venue.center[0], venue.center[1], 240)
        const dx = (padding[2] - padding[0]) / 2, dy = (padding[3] - padding[1]) / 2
        const box = venue.bbox
        // The entire AOI, rather than a radius around the latest photo, is the scene.
        const bbox = [Math.min(scene.bbox[0], box[0] - dx), Math.min(scene.bbox[1], box[1] - dy), Math.max(scene.bbox[2], box[2] + dx), Math.max(scene.bbox[3], box[3] + dy)]
        scene = emptyScene(bbox)
        await fillTiles(scene, loaded)
        scene.venue = venue
      }
      scene.venues = details.venues
      const clip = (items) => items.flatMap((item) => clipPolygons({ type: 'Polygon', coordinates: item.rings }, scene.bbox).map((rings, part) => ({ ...item, id: `${item.id}:${part}`, rings })))
      const specialised = clip(details.buildings)
      const overlapping = (a, b) => {
        const points = a.rings[0]
        const middle = [(Math.min(...points.map((p) => p[0])) + Math.max(...points.map((p) => p[0]))) / 2, (Math.min(...points.map((p) => p[1])) + Math.max(...points.map((p) => p[1]))) / 2]
        return containsPoint(middle, b.rings) || points.filter((p) => containsPoint(p, b.rings)).length > points.length / 2
      }
      scene.buildings = scene.buildings.filter((item) => !specialised.some((detail) => overlapping(item, detail))).concat(specialised)
      const grounds = clip(details.grounds)
      scene.grounds = scene.grounds.filter((item) => !grounds.some((detail) => overlapping(item, detail))).concat(grounds)
      scene.water.push(...clip(details.water))
      scene.treeRows = details.treeRows.flatMap((item) => clipLines({ type: 'LineString', coordinates: item.path }, scene.bbox).map((path) => ({ ...item, path })))
      scene.detailStatus = 'ready'
    } catch { scene.detailStatus = 'unavailable' }
  }
  // Tile seams and detailed water polygons must not produce duplicate shorelines.
  if (scene.water.length) {
    try { scene.water = polygonClipping.union(...scene.water.map((p) => [p.rings])).map((rings, index) => ({ id: `water:${index}`, rings })) }
    catch { /* Keep valid source polygons if topology is imperfect. */ }
  }
  delete scene.venueCandidates
  return scene
}

export async function mapSceneForPoint(lng, lat, radius = 900) {
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 85) throw new Error('地点坐标无效')
  // Nearby photos share one neighbourhood, and revisits reuse the same local extract.
  const centerLng = Number(lng.toFixed(3)), centerLat = Number(lat.toFixed(3))
  radius = Number.isFinite(radius) ? Math.max(900, Math.min(1800, Math.ceil(radius / 100) * 100)) : 900
  const key = `${centerLng.toFixed(3)}_${centerLat.toFixed(3)}_${radius}`
  const path = join(cacheDir, `v${sceneVersion}_${key}.json`)
  try {
    const cached = JSON.parse(await readFile(path, 'utf8'))
    if (Date.now() - (await stat(path)).mtimeMs < (cached.detailStatus === 'unavailable' ? 5 * 60000 : cacheAge)) return cached
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (inFlight.has(key)) return inFlight.get(key)
  const task = buildScene(centerLng, centerLat, radius).then(async (scene) => {
    await mkdir(cacheDir, { recursive: true })
    await writeFile(path, JSON.stringify(scene), 'utf8')
    return scene
  })
  inFlight.set(key, task)
  try { return await task }
  finally { inFlight.delete(key) }
}

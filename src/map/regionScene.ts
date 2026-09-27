import { gcj02ToWgs84, wgs84ToGcj02 } from '../lib/geo'
import type { MapPhoto } from './scene'
import type { SceneData, SceneVenue } from './styledDistrict'

type Point = [number, number]
export interface PhotoRegion { center: Point; photoIds: string[]; key?: string; radius?: number; venue?: SceneVenue }
const sceneCache = new Map<string, Promise<SceneData>>()
const knownVenues = new Map<string, SceneVenue>()

function contains(point: Point, rings: Point[][]) {
  const inside = (ring: Point[]) => {
    let hit = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j]
      if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit
    }
    return hit
  }
  return rings.length > 0 && inside(rings[0]) && !rings.slice(1).some(inside)
}

export function rememberSceneVenues(data: SceneData) {
  for (const venue of data.venues || []) knownVenues.set(venue.id, venue)
  if (data.venue) knownVenues.set(data.venue.id, data.venue)
}

// Only geocoder AOI/POI names participate, never guessed photo-card descriptions.
export function venueName(value?: string) {
  return value?.match(/^(.{2,}?(?:公园|购物中心|购物城|万象城|大悦城|银泰城|商场|商城|商业中心|体育中心|活动中心|景区|游乐园|动物园|博物馆|广场|未来谷))(?:[-·（(A-Za-z0-9].*)?$/)?.[1] || ''
}

export function metresApart(a: Point, b: Point) {
  return Math.hypot((a[0] - b[0]) * 111320 * Math.cos(((a[1] + b[1]) * Math.PI) / 360), (a[1] - b[1]) * 111320)
}

export function hasStreetLocation(photo: MapPhoto) {
  return photo.gcj.every(Number.isFinite) && Math.abs(photo.gcj[0]) <= 180 && Math.abs(photo.gcj[1]) <= 85
    && (!photo.precision || ['point', 'poi', 'street'].includes(photo.precision))
}

// A scene is selected by a neighbourhood of photos, never one random photo ID.
// The 450 m merge radius stays well inside the 1.8 km OSM extract.
export function photoRegions(photos: MapPhoto[]): PhotoRegion[] {
  const regions: PhotoRegion[] = []
  const located = photos.filter(hasStreetLocation).sort((a, b) => a.id.localeCompare(b.id))
  const positions = new Map(located.map((photo) => [photo.id, photo.gcj]))
  for (const photo of located) {
    const wgs = gcj02ToWgs84({ lng: photo.gcj[0], lat: photo.gcj[1] })
    const venue = [...knownVenues.values()].filter((v) => v.polygons.some((rings) => contains([wgs.lng, wgs.lat], rings)))
      .sort((a, b) => (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]) - (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1]))[0]
    if (venue) {
      const existing = regions.find((r) => r.venue?.id === venue.id)
      if (existing) existing.photoIds.push(photo.id)
      else {
        const p = wgs84ToGcj02({ lng: venue.center[0], lat: venue.center[1] })
        const radius = Math.min(1800, Math.max(900, metresApart([venue.bbox[0], venue.bbox[1]], [venue.bbox[2], venue.bbox[3]]) / 2 + 240))
        regions.push({ center: [p.lng, p.lat], photoIds: [photo.id], key: `venue:${venue.id}`, radius, venue })
      }
      continue
    }
    const name = venueName(photo.venueName)
    const region = regions.find((candidate) => {
      if (candidate.venue) return false
      const first = located.find((p) => p.id === candidate.photoIds[0])!
      const sameVenue = name && name === venueName(first.venueName)
      // A park or mall can span several photo clusters. A name alone is never
      // allowed to join branches in different neighbourhoods or different cities.
      const limit = sameVenue ? 1300 : 450
      if (metresApart(candidate.center, photo.gcj) > limit) return false
      if (name && venueName(first.venueName) && !sameVenue) return false
      const count = candidate.photoIds.length
      const center: Point = [(candidate.center[0] * count + photo.gcj[0]) / (count + 1), (candidate.center[1] * count + photo.gcj[1]) / (count + 1)]
      // A chain of nearby photos must not move the group's center so far that its
      // earliest photos fall outside the extracted neighbourhood.
      return candidate.photoIds.every((id) => metresApart(positions.get(id)!, center) <= limit)
    })
    if (region) {
      const count = region.photoIds.length
      region.center = [(region.center[0] * count + photo.gcj[0]) / (count + 1), (region.center[1] * count + photo.gcj[1]) / (count + 1)]
      region.photoIds.push(photo.id)
      region.radius = Math.max(900, ...region.photoIds.map((id) => metresApart(positions.get(id)!, region.center) + 350))
    } else regions.push({ center: [...photo.gcj], photoIds: [photo.id] })
  }
  return regions
}

export function regionForPhoto(photos: MapPhoto[], photo: MapPhoto) {
  return photoRegions(photos).find((region) => region.photoIds.includes(photo.id))
}

// Geometry belongs to a geographic group, not its selected photo or AI card revision.
// Every photo in the same group must reuse the same district while analysis runs.
export function photoSceneKey(photos: MapPhoto[], photo: MapPhoto) {
  const region = regionForPhoto(photos, photo)
  return region ? region.key || `region:${region.center.map((value) => value.toFixed(5)).join(',')}` : ''
}

export async function fetchRegionScene(region: PhotoRegion, refresh = false): Promise<SceneData> {
  // Match the server's derived geometry revision. A renderer hot update must
  // not keep an older, pre-landmark district alive in the browser cache.
  const revision = 'v6:'
  const key = revision + (region.key || region.center.map((value) => value.toFixed(5)).join(',') + `:${region.radius || 900}`)
  if (refresh) sceneCache.delete(key)
  const cached = sceneCache.get(key)
  if (cached) return cached
  const request = requestRegionScene(region).then((data) => {
    rememberSceneVenues(data)
    if (data.venue) sceneCache.set(`${revision}venue:${data.venue.id}`, Promise.resolve(data))
    return data
  }).catch((error) => { sceneCache.delete(key); throw error })
  sceneCache.set(key, request)
  if (sceneCache.size > 6) sceneCache.delete(sceneCache.keys().next().value!)
  return request
}

async function requestRegionScene({ center, radius = 900 }: PhotoRegion): Promise<SceneData> {
  const wgs = gcj02ToWgs84({ lng: center[0], lat: center[1] })
  const response = await fetch('/api/map-scene', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-memory-agent': 'web' },
    body: JSON.stringify({ lng: wgs.lng, lat: wgs.lat, radius }),
    signal: AbortSignal.timeout(45000),
  })
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || '区域场景暂时不可用')
  const scene = await response.json() as SceneData
  if (scene.source !== 'OpenStreetMap contributors' || scene.license !== 'ODbL-1.0' || !Array.isArray(scene.bbox) || !Array.isArray(scene.buildings) || !Array.isArray(scene.roads)) throw new Error('区域场景数据无效')
  return scene
}

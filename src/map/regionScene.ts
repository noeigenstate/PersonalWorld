import { gcj02ToWgs84 } from '../lib/geo'
import type { MapPhoto } from './scene'
import type { SceneData } from './styledDistrict'

type Point = [number, number]
export interface PhotoRegion { center: Point; photoIds: string[] }
const sceneCache = new Map<string, Promise<SceneData>>()

export function metresApart(a: Point, b: Point) {
  return Math.hypot((a[0] - b[0]) * 111320 * Math.cos(((a[1] + b[1]) * Math.PI) / 360), (a[1] - b[1]) * 111320)
}

export function hasStreetLocation(photo: MapPhoto) {
  return !photo.precision || ['point', 'poi', 'street'].includes(photo.precision)
}

// A scene is selected by a neighbourhood of photos, never one random photo ID.
// The 450 m merge radius stays well inside the 1.8 km OSM extract.
export function photoRegions(photos: MapPhoto[]): PhotoRegion[] {
  const regions: PhotoRegion[] = []
  for (const photo of [...photos].filter(hasStreetLocation).sort((a, b) => a.id.localeCompare(b.id))) {
    const region = regions.find((candidate) => metresApart(candidate.center, photo.gcj) <= 450)
    if (region) {
      const count = region.photoIds.length
      region.center = [(region.center[0] * count + photo.gcj[0]) / (count + 1), (region.center[1] * count + photo.gcj[1]) / (count + 1)]
      region.photoIds.push(photo.id)
    } else regions.push({ center: [...photo.gcj], photoIds: [photo.id] })
  }
  return regions
}

export function regionForPhoto(photos: MapPhoto[], photo: MapPhoto) {
  return photoRegions(photos).find((region) => region.photoIds.includes(photo.id))
}

export async function fetchRegionScene(center: Point): Promise<SceneData> {
  const key = center.map((value) => value.toFixed(5)).join(',')
  const cached = sceneCache.get(key)
  if (cached) return cached
  const request = requestRegionScene(center).catch((error) => { sceneCache.delete(key); throw error })
  sceneCache.set(key, request)
  if (sceneCache.size > 6) sceneCache.delete(sceneCache.keys().next().value!)
  return request
}

async function requestRegionScene(center: Point): Promise<SceneData> {
  const wgs = gcj02ToWgs84({ lng: center[0], lat: center[1] })
  const response = await fetch('/api/map-scene', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-memory-agent': 'web' },
    body: JSON.stringify({ lng: wgs.lng, lat: wgs.lat }),
  })
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || '区域场景暂时不可用')
  const scene = await response.json() as SceneData
  if (scene.source !== 'OpenStreetMap contributors' || scene.license !== 'ODbL-1.0' || !Array.isArray(scene.bbox) || !Array.isArray(scene.buildings) || !Array.isArray(scene.roads)) throw new Error('区域场景数据无效')
  return scene
}

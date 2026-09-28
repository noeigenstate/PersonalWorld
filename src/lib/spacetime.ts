// 4D spacetime scenes: one place at different times. The plan comes from the spacetime-scene
// skill (server/spacetimeScene.mjs); each epoch's relief model is reconstructed from its key
// photo on the computer that runs the service and kept in the account vault.
import type { MemoryAsset, MemoryEvent } from '../types'
import { cityLabel } from './memory'

export type Evidence = 'observed' | 'inferred' | 'unknown'
export interface SceneLayer { value: string | null; evidence: Evidence; basis: string }
export interface SceneBuilding { name: string; state: string; evidence: Evidence; basis: string }
export interface SceneEpoch {
  id: string
  from: string
  to: string
  title: string
  photoIds: string[]
  keyPhoto: string | null
  layers: { season: SceneLayer; timeOfDay: SceneLayer; weather: SceneLayer; sound: SceneLayer; traffic: SceneLayer; buildings: SceneBuilding[] }
  changes: string
  caption: string
}
export interface ScenePlan { place: string; epochs: SceneEpoch[]; undated: string[]; summary: string }
export interface ScenePhoto { id: string; date: string; scene: string; tags: string[]; event: string; confirmed: boolean }
export interface ReliefCapability { available: boolean; model: string | null; reason?: string }
export interface ReliefResult { id: string; url: string; bytes: number; cached: boolean }

export const EVIDENCE_LABEL: Record<Evidence, string> = { observed: '照片可见', inferred: '推断', unknown: '无依据' }
export const LAYER_LABEL: Record<'season' | 'timeOfDay' | 'weather' | 'sound' | 'traffic', string> = { season: '季节', timeOfDay: '时段', weather: '天气', sound: '声音', traffic: '交通' }

const dateOf = (asset: MemoryAsset) => {
  if (asset.dateSource === 'file') return ''
  const date = new Date(asset.capturedAt).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : ''
}

/** The photos of a city's events, as the skill wants them (photo-card observations, no pictures) */
export function scenePhotos(assets: MemoryAsset[], events: MemoryEvent[], city: string): ScenePhoto[] {
  const seen = new Set<string>()
  return events.filter((event) => event.city === city).flatMap((event) => event.assetIds.flatMap((id) => {
    const asset = assets.find((a) => a.id === id)
    if (!asset || asset.kind !== 'image' || !asset.preview || seen.has(asset.hash || asset.id)) return []
    seen.add(asset.hash || asset.id)
    return [{ id: asset.id, date: dateOf(asset), scene: asset.card?.scene || '', tags: asset.card?.tags || [], event: event.title, confirmed: event.status === 'confirmed' }]
  })).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'))
}

/** The place's name: the venue most of its photos share, else the city */
export function scenePlaceName(assets: MemoryAsset[], photos: ScenePhoto[], city: string) {
  const counts = new Map<string, number>()
  for (const photo of photos) {
    const asset = assets.find((a) => a.id === photo.id)
    const name = asset?.location?.aoi || asset?.location?.poi?.name
    if (name) counts.set(name, (counts.get(name) || 0) + 1)
  }
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1])
  return best && best[1] >= Math.max(2, photos.length / 3) ? `${cityLabel(city)} · ${best[0]}` : cityLabel(city)
}

/** The epoch a moment falls in, else the latest one before it, else the first */
export function epochAt(plan: ScenePlan | null, time: string | number): SceneEpoch | null {
  if (!plan?.epochs.length) return null
  const day = new Date(time).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
  return plan.epochs.find((e) => e.from <= day && day <= e.to) || [...plan.epochs].reverse().find((e) => e.to <= day) || plan.epochs[0]
}

const headers = { 'Content-Type': 'application/json', 'X-Memory-Agent': 'web' }
async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(json.error || `请求失败（${response.status}）`)
  return json as T
}

export const requestScenePlan = (place: string, photos: ScenePhoto[]) => post<{ plan: ScenePlan; capability: ReliefCapability; scenes: string[] }>('/api/spacetime-scene', { place, photos })
export const requestRelief = (id: string, dataUrl: string, force = false) => post<ReliefResult>('/api/spacetime-scene/relief', { id, dataUrl, force })

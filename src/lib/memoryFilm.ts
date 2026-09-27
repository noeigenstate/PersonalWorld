import type { MemoryAsset, MemoryEvent } from '../types'
import { getFile } from './storage'
import { heicAsJpeg, isHeic } from './import'

export interface FilmSource { id: string; date: string; observed: string; confirmed: string; place: string; tags: string[] }
export interface FilmPlan {
  treatment?: 'snow-journal' | 'sweet-moments' | 'little-makers' | 'warm-album'
  kind: 'outing' | 'revisit' | 'season'; title: string; closing: string; reason: string
  shots: { assetId: string; caption: string; seconds: number; evidence: string; date: string; beat?: string; motion?: string }[]
}
export interface FilmJob {
  id: string; batch: string; createdAt: number; expiresAt: number; version?: string
  status: 'planning' | 'awaiting-images' | 'queued' | 'rendering' | 'complete' | 'failed' | 'cancelled'
  progress: number; uploaded: string[]; plan?: FilmPlan; planner?: 'stepfun' | 'local'; warning?: string; error?: string
  duration?: number; bytes?: number; url?: string
  exportedAt?: string; exportError?: string
  storyContext?: { text: string; notes: { text: string; count: number }[]; revision: string; changed: boolean }
}
export const filmActive = (job?: FilmJob) => Boolean(job && ['planning', 'awaiting-images', 'queued', 'rendering'].includes(job.status))

export function filmSources(assets: MemoryAsset[], events: MemoryEvent[]): FilmSource[] {
  const hashes = new Set<string>()
  const sorted = [...assets].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt) || a.id.localeCompare(b.id))
  const all = sorted.flatMap((asset) => {
    if (asset.kind !== 'image' || !asset.preview || !asset.card || (asset.width && asset.height && Math.min(asset.width, asset.height) < 240)) return []
    const hash = asset.hash || asset.id
    if (hashes.has(hash)) return []
    hashes.add(hash)
    const event = events.find((e) => e.assetIds.includes(asset.id))
    const date = asset.dateSource === 'file' ? '' : new Date(asset.capturedAt).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
    return [{ id: asset.id, date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '', observed: asset.card.scene, confirmed: event?.status === 'confirmed' ? `${event.title}。${event.summary}` : '', place: asset.location?.aoi || asset.location?.poi?.name || event?.city || '', tags: asset.card.tags }]
  })
  // Discover stories across the entire library first. Global sampling before
  // grouping can erase a small outing when the library grows.
  return all
}

export const boundedFilmSources = (sources: FilmSource[]) => sources.length <= 80 ? sources
  : Array.from({ length: 80 }, (_, i) => sources[Math.round(i * (sources.length - 1) / 79)])

export async function filmBatch(assets: MemoryAsset[]) {
  const source = assets.filter((a) => a.kind === 'image' && a.preview).map((a) => `${a.id}:${a.hash}`).sort().join('|')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`film-v1|${source}`))
  return [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('')
}

export async function filmImage(asset: MemoryAsset) {
  const file = await getFile(asset.id).catch(() => undefined)
  let blob: Blob
  try { blob = file ? isHeic(file) ? await heicAsJpeg(file) : file : await (await fetch(asset.preview)).blob() }
  catch { blob = await (await fetch(asset.preview)).blob() }
  let image: ImageBitmap
  try { image = await createImageBitmap(blob) }
  catch { image = await createImageBitmap(await (await fetch(asset.preview)).blob()) }
  const scale = Math.min(1, 1800 / Math.max(image.width, image.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale))
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height); image.close()
  return canvas.toDataURL('image/jpeg', .9)
}

export async function filmRequest<T>(path = '', body?: unknown): Promise<T> {
  const response = await fetch(`/api/memory-films${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Memory-Agent': 'web' }, body: JSON.stringify(body) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || '回忆短片服务暂不可用')
  return result as T
}

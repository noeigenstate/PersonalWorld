import type { AiConfig, AnalysisResult, GeocodeResult, MemoryAsset, MemoryEvent, PhotoCard, PhotoContext, Place, PlaceRole } from '../types'
import type { Reference } from './peers'
import type { CullReview } from './cull'
import { getFile } from './storage'
import { heicAsJpeg, isHeic } from './import'
import { formatDate } from './memory'

// The stored preview (1200 px) is too small to read plates and signs; the card gets a sharper
// copy made from the original file, falling back to the preview
async function detailImage(asset: MemoryAsset, maxSide = 2560): Promise<string> {
  const original = await getFile(asset.id).catch(() => undefined)
  if (!original || asset.kind === 'video') return asset.preview
  try {
    const source = isHeic(original) ? await heicAsJpeg(original) : original
    const bitmap = await createImageBitmap(source)
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    return canvas.toDataURL('image/jpeg', 0.9)
  } catch {
    return asset.preview
  }
}
import type { PhotoFacts } from './photoFacts'

const headers = { 'Content-Type': 'application/json', 'X-Memory-Agent': 'web' }

export const SIGNED_OUT_EVENT = 'pw:signed-out'

async function jsonResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}))
  if (response.status === 401 && !response.url.includes('/api/auth/')) window.dispatchEvent(new Event(SIGNED_OUT_EVENT))
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`)
  return data as T
}

const post = (path: string, body: unknown) => fetch(path, { method: 'POST', headers, body: JSON.stringify(body) })

export interface Account { id: string; username: string; createdAt: string; privacyAccepted: boolean }

export async function fetchAccount(): Promise<Account | null> {
  const response = await fetch('/api/auth/me')
  if (response.status === 401) return null
  return (await jsonResponse<{ user: Account }>(response)).user
}

export async function signUp(username: string, password: string): Promise<Account> {
  // Only called after the user ticked the privacy statement box
  return (await jsonResponse<{ user: Account }>(await post('/api/auth/register', { username, password, acceptPrivacy: true }))).user
}

export async function signIn(username: string, password: string): Promise<Account> {
  return (await jsonResponse<{ user: Account }>(await post('/api/auth/login', { username, password }))).user
}

export async function acceptPrivacy(): Promise<Account> {
  return (await jsonResponse<{ user: Account }>(await post('/api/auth/privacy', {}))).user
}

export async function signOut(): Promise<void> {
  await post('/api/auth/logout', {})
}

export async function fetchAiConfig(): Promise<AiConfig> {
  return jsonResponse<AiConfig>(await fetch('/api/config'))
}

export async function analyzeEvent(event: MemoryEvent, assets: MemoryAsset[]): Promise<AnalysisResult> {
  const images = event.assetIds
    .map((id) => assets.find((asset) => asset.id === id))
    .filter((asset): asset is MemoryAsset => Boolean(asset?.preview))
    .slice(0, 6)
    .map((asset) => ({
      id: asset.id,
      name: asset.name,
      capturedAt: asset.capturedAt,
      latitude: asset.latitude,
      longitude: asset.longitude,
      dataUrl: asset.preview,
    }))
  if (!images.length) throw new Error('这个事件还没有可分析的图片预览')
  return jsonResponse<AnalysisResult>(await post('/api/analyze', { images, context: { city: event.city, address: event.place } }))
}

export async function generatePhotoCard(asset: MemoryAsset, facts: PhotoFacts): Promise<Omit<PhotoCard, 'createdAt'>> {
  if (!asset.preview) throw new Error('这张照片没有可用的预览图')
  return jsonResponse(await post('/api/photo-card', {
    image: { id: asset.id, dataUrl: await detailImage(asset) },
    // Local wall-clock time as the camera recorded it; an ISO/UTC string made the model convert time zones
    facts: { fileName: facts.fileName, time: formatDate(asset.capturedAt, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }), timeSource: facts.timeSource, latitude: facts.latitude, longitude: facts.longitude, city: facts.city, address: facts.address, size: facts.size, device: facts.device, metaPlace: facts.metaPlace },
  }))
}

export async function inferFromPeers(target: MemoryAsset, targetKnown: Reference['known'], refs: Reference[]): Promise<Omit<PhotoContext, 'createdAt'>> {
  return jsonResponse(await post('/api/photo-context', {
    target: { dataUrl: target.preview, known: targetKnown },
    refs: refs.map((r) => ({ id: r.asset.id, dataUrl: r.asset.preview, known: r.known })),
  }))
}

// Which photos of a near-duplicate stack to keep (skills/photo-cull); images are small review copies
export async function reviewStack(photos: { id: string; dataUrl: string; time?: string; sharpness?: number }[], keep: number): Promise<{ reviews: Record<string, CullReview>; keep: string[]; summary: string }> {
  return jsonResponse(await post('/api/photo-cull', { photos, keep }))
}

export async function geocode(points: { id: string; lat: number; lng: number }[]): Promise<GeocodeResult[]> {
  return (await jsonResponse<{ results: GeocodeResult[] }>(await post('/api/geocode', { points }))).results
}

export interface ButlerTurn { role: 'user' | 'assistant'; content: string }
export interface ButlerFocus { city: string; from: string; to: string }
export interface ButlerMemoryEvent {
  id: string; title: string; summary: string; type: string; start: string; end: string
  city: string; place: string; people: string[]; tags: string[]; status: string
  visibleText: string; firsts: string[]; lasts: string[]; photoCount: number
}
// A move between life bases (src/lib/firstsLasts.ts)
export interface ButlerMove { from: string; fromRole: string; to: string; toRole: string; at: string }
// A photo's information card without the picture: what the butler searches by meaning
export interface ButlerMemoryPhoto {
  id: string; eventId: string; date: string; city: string; place: string
  title: string; caption: string; scene: string; tags: string[]; people: string[]
}
// What the page shows, so "this photo" and "here" mean something, and which capabilities exist
export interface ButlerState {
  view: 'globe' | 'city' | 'street'
  city: string
  openEventId: string
  focusedPhotoId: string
  showing: string[]
  pendingRoleCity: string
  features: { people: number; stories: number; spacetime: boolean; films: { id: string; title: string }[]; filmCapable: boolean }
}
// The butler drives the map with these (validated on the server, see server/butler.mjs)
export type ButlerAction =
  | { type: 'focus_city'; city: string }
  | { type: 'overview' }
  | { type: 'focus_photo'; assetId: string }
  | { type: 'show_photos'; assetIds: string[] }
  | { type: 'slideshow'; assetIds: string[] }
  // A guided story: one photo and one spoken sentence per step, the map moving along
  | { type: 'story'; steps: { assetId: string; text: string }[] }
  | { type: 'open_event'; eventId: string }
  | { type: 'set_place_role'; city: string; role: PlaceRole }
  | { type: 'timeline'; date: string }
  | { type: 'open_stories' }
  | { type: 'open_spacetime' }
  | { type: 'play_film'; filmId?: string }
  | { type: 'make_film'; assetIds?: string[] }
  | { type: 'close' }
export interface ButlerReply { answer: string; eventIds: string[]; assetIds: string[]; actions: ButlerAction[] }

export async function askButler(
  question: string,
  history: ButlerTurn[],
  memory: { events: ButlerMemoryEvent[]; places: (Pick<Place, 'city' | 'role' | 'roleConfirmed' | 'firstAt' | 'lastAt'> & { eventCount: number })[]; moves: ButlerMove[]; photos: ButlerMemoryPhoto[] },
  focus: ButlerFocus | undefined,
  state: ButlerState,
): Promise<ButlerReply> {
  const reply = await jsonResponse<Partial<ButlerReply>>(await post('/api/butler', { question, history, memory, focus, state }))
  return { answer: reply.answer || '', eventIds: reply.eventIds || [], assetIds: reply.assetIds || [], actions: reply.actions || [] }
}

export async function transcribe(wav: Blob): Promise<string> {
  const response = await fetch('/api/asr', { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-Memory-Agent': 'web' }, body: wav })
  return (await jsonResponse<{ text: string }>(response)).text
}

export async function speak(text: string): Promise<Blob> {
  const response = await post('/api/tts', { text })
  if (!response.ok) await jsonResponse(response)
  return response.blob()
}

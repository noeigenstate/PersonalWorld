import type { AiConfig, AnalysisResult, GeocodeResult, MemoryAsset, MemoryEvent, Place } from '../types'

const headers = { 'Content-Type': 'application/json', 'X-Memory-Agent': 'web' }

export const SIGNED_OUT_EVENT = 'pw:signed-out'

async function jsonResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}))
  if (response.status === 401 && !response.url.includes('/api/auth/')) window.dispatchEvent(new Event(SIGNED_OUT_EVENT))
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`)
  return data as T
}

const post = (path: string, body: unknown) => fetch(path, { method: 'POST', headers, body: JSON.stringify(body) })

export interface Account { id: string; username: string; createdAt: string }

export async function fetchAccount(): Promise<Account | null> {
  const response = await fetch('/api/auth/me')
  if (response.status === 401) return null
  return (await jsonResponse<{ user: Account }>(response)).user
}

export async function signUp(username: string, password: string): Promise<Account> {
  return (await jsonResponse<{ user: Account }>(await post('/api/auth/register', { username, password }))).user
}

export async function signIn(username: string, password: string): Promise<Account> {
  return (await jsonResponse<{ user: Account }>(await post('/api/auth/login', { username, password }))).user
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
      name: asset.name,
      capturedAt: asset.capturedAt,
      latitude: asset.latitude,
      longitude: asset.longitude,
      dataUrl: asset.preview,
    }))
  if (!images.length) throw new Error('这个事件还没有可分析的图片预览')
  return jsonResponse<AnalysisResult>(await post('/api/analyze', { images, context: { city: event.city, address: event.place } }))
}

export async function geocode(points: { id: string; lat: number; lng: number }[]): Promise<GeocodeResult[]> {
  return (await jsonResponse<{ results: GeocodeResult[] }>(await post('/api/geocode', { points }))).results
}

export interface ButlerTurn { role: 'user' | 'assistant'; content: string }
export interface ButlerFocus { city: string; from: string; to: string }
export interface ButlerMemoryEvent {
  id: string; title: string; summary: string; type: string; start: string; end: string
  city: string; place: string; people: string[]; tags: string[]; status: string
  visibleText: string; firsts: string[]; photoCount: number
}

export async function askButler(
  question: string,
  history: ButlerTurn[],
  memory: { events: ButlerMemoryEvent[]; places: (Pick<Place, 'city' | 'role' | 'roleConfirmed' | 'firstAt' | 'lastAt'> & { eventCount: number })[] },
  focus?: ButlerFocus,
): Promise<{ answer: string; eventIds: string[] }> {
  return jsonResponse(await post('/api/butler', { question, history, memory, focus }))
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

import type { MemoryState } from '../types'

// The account's copy on the disk of the computer running Personal World (server/accountVault.mjs).
// Clearing the browser's site data empties IndexedDB; this copy is what signing in again restores from.
const headers = { 'X-Memory-Agent': 'web' }

export interface VaultState { memory: MemoryState | null; extras: Record<string, unknown>; savedAt: string | null }

async function ok(response: Response) {
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || `照片库请求失败（${response.status}）`)
  }
  return response
}

const assetPath = (id: string, part?: 'preview' | 'original') => `/api/vault/assets/${encodeURIComponent(id)}${part ? `/${part}` : ''}`

export async function readVaultState(): Promise<VaultState> {
  return (await ok(await fetch('/api/vault/state', { headers }))).json()
}

export async function writeVaultState(memory: MemoryState, extras: Record<string, unknown>): Promise<void> {
  await ok(await fetch('/api/vault/state', { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ memory, extras }) }))
}

export async function listVaultAssets(): Promise<{ previews: string[]; originals: string[] }> {
  return (await ok(await fetch('/api/vault/assets', { headers }))).json()
}

export async function uploadPreview(id: string, dataUrl: string): Promise<void> {
  const blob = await (await fetch(dataUrl)).blob()
  await ok(await fetch(assetPath(id, 'preview'), { method: 'PUT', headers: { ...headers, 'Content-Type': 'image/jpeg' }, body: blob }))
}

export async function uploadOriginal(id: string, file: File): Promise<void> {
  await ok(await fetch(assetPath(id, 'original'), {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name), 'X-Last-Modified': String(file.lastModified) },
    body: file,
  }))
}

export async function downloadPreview(id: string): Promise<string | undefined> {
  const response = await fetch(assetPath(id, 'preview'), { headers })
  if (response.status === 404) return undefined
  const blob = await (await ok(response)).blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^;,]*/, 'data:image/jpeg'))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export async function downloadOriginal(id: string): Promise<File | undefined> {
  const response = await fetch(assetPath(id, 'original'), { headers })
  if (response.status === 404) return undefined
  await ok(response)
  const name = decodeURIComponent(response.headers.get('X-File-Name') || id)
  const lastModified = Number(response.headers.get('X-Last-Modified')) || Date.now()
  return new File([await response.blob()], name, { type: response.headers.get('Content-Type') || '', lastModified })
}

export async function deleteVaultAsset(id: string): Promise<void> {
  await ok(await fetch(assetPath(id), { method: 'DELETE', headers }))
}

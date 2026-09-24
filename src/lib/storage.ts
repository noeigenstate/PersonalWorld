import { openDB } from 'idb'
import type { MemoryState } from '../types'

const database = openDB('memory-agent-local', 1, {
  upgrade(db) {
    db.createObjectStore('state')
    db.createObjectStore('files')
  },
})

export async function loadMemory(): Promise<MemoryState> {
  const db = await database
  const state = (await db.get('state', 'current')) as MemoryState | undefined
  if (!state) return { assets: [], events: [], placeRoles: {} }
  // Older saves lack the fields added with places
  const assets = state.assets.map(({ favorite: _favorite, ...asset }: MemoryState['assets'][number] & { favorite?: boolean }) => asset)
  return {
    assets,
    placeRoles: state.placeRoles || {},
    events: state.events.map((event) => {
      const photos = assets.filter((asset) => event.assetIds.includes(asset.id) && asset.latitude !== undefined && asset.longitude !== undefined)
      return {
        ...event,
        visibleText: event.visibleText || '',
        timeSource: event.timeSource || assets.find((asset) => asset.id === event.assetIds[0])?.dateSource || 'file',
        lat: event.lat ?? (photos.length ? photos.reduce((sum, asset) => sum + asset.latitude!, 0) / photos.length : undefined),
        lng: event.lng ?? (photos.length ? photos.reduce((sum, asset) => sum + asset.longitude!, 0) / photos.length : undefined),
      }
    }),
  }
}

export async function saveMemory(state: MemoryState): Promise<void> {
  const db = await database
  await db.put('state', state, 'current')
}

export async function saveFile(id: string, file: File): Promise<void> {
  const db = await database
  await db.put('files', file, id)
}

export async function getFile(id: string): Promise<File | undefined> {
  const db = await database
  return db.get('files', id)
}

export async function removeFile(id: string): Promise<void> {
  const db = await database
  await db.delete('files', id)
}


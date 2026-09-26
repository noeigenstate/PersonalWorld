import { openDB, type IDBPDatabase } from 'idb'
import type { MemoryState } from '../types'

// Every account gets its own database in this browser; nothing is uploaded.
const LEGACY_DB = 'memory-agent-local'

const open = (name: string) => openDB(name, 1, {
  upgrade(db) {
    db.createObjectStore('state')
    db.createObjectStore('files')
  },
})

let database: Promise<IDBPDatabase> | null = null
let opening: { userId: string; ready: Promise<void> } | null = null

function current() {
  if (!database) throw new Error('请先登录')
  return database
}

export function openAccountStorage(userId: string): Promise<void> {
  // Opening twice for the same account (React dev double effects) must not migrate twice
  if (opening?.userId === userId) return opening.ready
  const db = open(`personal-world-${userId}`)
  database = db
  opening = { userId, ready: db.then(adoptLegacyData) }
  return opening.ready
}

export function closeAccountStorage() {
  database?.then((db) => db.close())
  database = null
  opening = null
}

// Memories saved before accounts existed go to the first account that signs in here
async function adoptLegacyData(db: IDBPDatabase) {
  const existing = await indexedDB.databases?.().catch(() => [])
  if (existing && !existing.some((info) => info.name === LEGACY_DB)) return
  if (await db.get('state', 'current')) return
  const legacy = await open(LEGACY_DB)
  const state = await legacy.get('state', 'current')
  if (state) {
    // Read everything first: awaiting another database mid-transaction would let it auto-commit
    const keys = await legacy.getAllKeys('files')
    const files = await Promise.all(keys.map(async (key) => [key, await legacy.get('files', key)] as const))
    const tx = db.transaction(['state', 'files'], 'readwrite')
    await Promise.all([...files.map(([key, file]) => tx.objectStore('files').put(file, key)), tx.objectStore('state').put(state, 'current'), tx.done])
  }
  legacy.close()
  await new Promise((resolve) => { const request = indexedDB.deleteDatabase(LEGACY_DB); request.onsuccess = request.onerror = request.onblocked = resolve })
}

export async function loadMemory(): Promise<MemoryState> {
  const db = await current()
  const state = (await db.get('state', 'current')) as MemoryState | undefined
  if (!state) return { assets: [], events: [], placeRoles: {}, autoPhotoCards: true }
  // Older saves lack the fields added with places
  const assets = state.assets.map(({ favorite: _favorite, ...asset }: MemoryState['assets'][number] & { favorite?: boolean }) => asset)
  return {
    assets,
    placeRoles: state.placeRoles || {},
    autoPhotoCards: state.autoPhotoCards !== false,
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
  const db = await current()
  await db.put('state', state, 'current')
}

export async function saveFile(id: string, file: File): Promise<void> {
  const db = await current()
  await db.put('files', file, id)
}

export async function getFile(id: string): Promise<File | undefined> {
  const db = await current()
  return db.get('files', id)
}

export async function removeFile(id: string): Promise<void> {
  const db = await current()
  await db.delete('files', id)
}


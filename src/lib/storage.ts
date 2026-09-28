import { openDB, type IDBPDatabase } from 'idb'
import type { MemoryState } from '../types'
import { deleteVaultAsset, downloadOriginal, downloadPreview, listVaultAssets, readVaultState, uploadOriginal, uploadPreview, writeVaultState } from './vault'

// Every account gets its own browser database as the working copy. Each change is also backed up to
// the account's vault on the computer running Personal World (./vault.ts), so clearing the browser's
// site data loses nothing: the next sign-in restores from there.
const LEGACY_DB = 'memory-agent-local'
const EMPTY: MemoryState = { assets: [], events: [], placeRoles: {}, autoPhotoCards: true }

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
  const db = database
  // Send what is still waiting before the database closes
  if (backupTimer !== undefined) {
    window.clearTimeout(backupTimer)
    backupTimer = undefined
    if (db) backingUp = backingUp.then(() => backUp(db))
  }
  backingUp = backingUp.then(() => db?.then((open) => open.close()))
  database = null
  opening = null
  vault = null
  restoredCount = 0
  removedByUser = false
  startedEmpty = false
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

// ---- Vault backup ----------------------------------------------------------------------------
// `vault` stays null until this session has read the vault once. Backups wait for that read, so an
// empty browser (site data just cleared, or the vault unreachable at start) never overwrites it.
let vault: { previews: Set<string>; originals: Set<string>; assets: number } | null = null
let backupTimer: number | undefined
let backingUp: Promise<unknown> = Promise.resolve()
let restoredCount = 0
let removedByUser = false
// Set when this browser started empty and the vault could not be read: backing up then could replace
// the stored photos with only the new ones, so this session leaves the vault alone
let startedEmpty = false

/** Photos brought back from the vault because this browser had none (0 when nothing was restored) */
export const restoredFromVault = () => restoredCount

function scheduleBackup(delay = 800) {
  const db = database
  if (!db) return
  window.clearTimeout(backupTimer)
  backupTimer = window.setTimeout(() => {
    backupTimer = undefined
    backingUp = backingUp.then(() => backUp(db))
  }, delay)
}

async function connectVault() {
  if (vault) return vault
  const [state, listed] = await Promise.all([readVaultState(), listVaultAssets()])
  vault = { previews: new Set(listed.previews), originals: new Set(listed.originals), assets: state.memory?.assets.length ?? 0 }
  if (startedEmpty && vault.assets) {
    vault = null
    throw new Error('照片库里已有照片，但这次启动没能恢复；请刷新页面')
  }
  return vault
}

async function backUp(dbPromise: Promise<IDBPDatabase>) {
  try {
    const db = await dbPromise
    const memory = ((await db.get('state', 'current')) as MemoryState | undefined) || EMPTY
    const known = await connectVault()
    // Losing every photo at once only happens when the user removed them one by one
    if (!memory.assets.length && known.assets && !removedByUser) return
    const extras: Record<string, unknown> = {}
    for (const key of await db.getAllKeys('state')) if (key !== 'current') extras[String(key)] = await db.get('state', key)
    await writeVaultState(memory, extras)
    known.assets = memory.assets.length
    for (const asset of memory.assets) {
      if (!known.previews.has(asset.id) && asset.preview) {
        await uploadPreview(asset.id, asset.preview)
        known.previews.add(asset.id)
      }
      if (!known.originals.has(asset.id)) {
        const file = (await db.get('files', asset.id)) as File | undefined
        if (file) {
          await uploadOriginal(asset.id, file)
          known.originals.add(asset.id)
        }
      }
    }
  } catch (error) {
    console.warn('照片库备份未完成，下次保存时重试', error)
  }
}

// Previews are what the map and cards show, so they come back at once; originals come back on demand
async function restore(db: IDBPDatabase): Promise<MemoryState | undefined> {
  const saved = await readVaultState()
  if (!saved.memory?.assets.length) return undefined
  const previews = new Map<string, string>()
  const queue = saved.memory.assets.map((asset) => asset.id)
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      const preview = await downloadPreview(id).catch(() => undefined)
      if (preview) previews.set(id, preview)
    }
  }))
  const assets = saved.memory.assets.filter((asset) => previews.has(asset.id)).map((asset) => ({ ...asset, preview: previews.get(asset.id)! }))
  const memory = { ...saved.memory, assets }
  const tx = db.transaction('state', 'readwrite')
  await Promise.all([...Object.entries(saved.extras || {}).map(([key, value]) => tx.store.put(value, key)), tx.store.put(memory, 'current'), tx.done])
  restoredCount = assets.length
  return memory
}

export async function loadMemory(): Promise<MemoryState> {
  const db = await current()
  let state = (await db.get('state', 'current')) as MemoryState | undefined
  if (!state?.assets.length) {
    const restored = await restore(db).catch((error) => { console.warn('照片库暂时无法读取', error); startedEmpty = true; return undefined })
    state = restored || state
  }
  // Photos that so far lived only in this browser are backed up now
  scheduleBackup(0)
  if (!state) return EMPTY
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
  scheduleBackup()
}

export async function saveFile(id: string, file: File): Promise<void> {
  const db = await current()
  await db.put('files', file, id)
  scheduleBackup()
}

export async function getFile(id: string): Promise<File | undefined> {
  const db = await current()
  const local = (await db.get('files', id)) as File | undefined
  if (local) return local
  // Site data was cleared: fetch the original from the vault once and keep it here again
  const file = await downloadOriginal(id).catch(() => undefined)
  if (file) await db.put('files', file, id)
  return file
}

export async function removeFile(id: string): Promise<void> {
  const db = await current()
  await db.delete('files', id)
  removedByUser = true
  await deleteVaultAsset(id).catch(() => undefined)
  vault?.previews.delete(id)
  vault?.originals.delete(id)
}

export async function loadFilmSettings(): Promise<{ enabled: boolean; attempted: string[] }> {
  const db = await current()
  return (await db.get('state', 'film-settings')) || { enabled: true, attempted: [] }
}

export async function saveFilmSettings(settings: { enabled: boolean; attempted: string[] }): Promise<void> {
  const db = await current()
  await db.put('state', settings, 'film-settings')
  scheduleBackup()
}

export async function loadPreference<T>(key: string, fallback: T): Promise<T> {
  return (await (await current()).get('state', key)) ?? fallback
}
export async function savePreference<T>(key: string, value: T): Promise<void> {
  await (await current()).put('state', value, key)
  scheduleBackup()
}

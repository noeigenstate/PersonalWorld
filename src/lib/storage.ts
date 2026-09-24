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
  if (!state) return { assets: [], events: [] }
  return { ...state, events: state.events.map((event) => ({ ...event, visibleText: event.visibleText || '' })) }
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


import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// User corrections belong to an account and explicit photo IDs, never to the
// shared director prompt. This small store outlives the 24-hour video cache.
export function createFilmContextStore(root) {
  const dir = path.resolve(root, 'context')
  mkdirSync(dir, { recursive: true })
  const file = (user) => path.join(dir, `${createHash('sha256').update(user.id).digest('hex')}.json`)
  const read = (user) => existsSync(file(user)) ? JSON.parse(readFileSync(file(user), 'utf8')) : Object.create(null)
  return {
    apply(user, sources) {
      const records = read(user)
      return sources.map((s) => ({ ...s, story: records[s.id]?.text || '', photoStory:records[s.id]?.text || '' }))
    },
    save(user, assetIds, value) {
      if (typeof value !== 'string' || value.length > 400) throw new Error('回忆补充请控制在 400 字以内')
      const text = value.replace(/[\x00-\x1f]/g, ' ').trim()
      const records = read(user)
      for (const id of assetIds) {
        if (!/^[\w-]+$/.test(id)) throw new Error('无效的照片 ID')
        if (text) records[id] = { text, updatedAt: Date.now() }
        else delete records[id]
      }
      const target = file(user)
      writeFileSync(`${target}.tmp`, JSON.stringify(records), 'utf8')
      renameSync(`${target}.tmp`, target)
    },
  }
}

export function filmContextSummary(sources) {
  sources=sources.map(s=>({...s,story:s.photoStory??s.story}))
  const groups = new Map()
  for (const s of sources) if (s.story) groups.set(s.story, (groups.get(s.story) || 0) + 1)
  const notes = [...groups].map(([text, count]) => ({ text, count }))
  const uniform = notes.length === 1 && notes[0].count === sources.length
  const values = sources.map((s) => [s.id, s.story || '']).sort((a, b) => a[0].localeCompare(b[0]))
  return { text: uniform ? notes[0].text : '', notes, revision: createHash('sha256').update(JSON.stringify(values)).digest('hex') }
}

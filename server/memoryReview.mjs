// Opt-in local development review. Account metadata only; never original images,
// previews, authentication tokens or an arbitrary filesystem path.
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'

const text = (v, n = 300) => typeof v === 'string' ? v.slice(0, n) : ''
const list = (v, n) => Array.isArray(v) ? v.slice(0, n) : []
const id = v => /^[\w-]{1,100}$/.test(v || '') ? v : ''
export function reviewSnapshot(input) {
  const assets = list(input.assets, 5000).filter(a => id(a?.id)).map(a => ({
    id: a.id, kind: text(a.kind, 20), capturedAt: text(a.capturedAt, 40), dateSource: text(a.dateSource, 20),
    location: a.location ? { source: text(a.location.source, 20), precision: text(a.location.precision, 20),
      gcj: Array.isArray(a.location.gcj) && a.location.gcj.length === 2 && a.location.gcj.every(Number.isFinite) ? a.location.gcj : undefined,
      aoi: text(a.location.aoi, 100), poi: text(a.location.poi?.name, 100), city: text(a.location.city, 80) } : undefined,
    gps: Number.isFinite(a.longitude) && Number.isFinite(a.latitude) ? [a.longitude, a.latitude] : undefined,
    card: a.card ? { title: text(a.card.title, 100), scene: text(a.card.scene, 1200), caption: text(a.card.caption, 500),
      visibleText: text(a.card.visibleText, 1000), tags: list(a.card.tags, 16).map(t => text(t, 40)),
      clues: list(a.card.clues, 10).map(c => ({kind: text(c.kind, 40), evidence: text(c.evidence), inference: text(c.inference), confidence: Number(c.confidence) || 0})),
      createdAt: text(a.card.createdAt, 40) } : undefined,
  }))
  const assetIds = new Set(assets.map(a => a.id))
  const regions = list(input.regions, 500).map(r => ({
    photoIds: list(r.photoIds, 5000).filter(v => assetIds.has(v)),
    center: list(r.center, 2).map(Number), radius: Number(r.radius) || 900,
    state: ['ready', 'failed'].includes(r.state) ? r.state : 'pending',
    coverage: ['no-buildings', 'partial', 'mapped'].includes(r.coverage) ? r.coverage : 'unchecked',
    buildings: Number(r.buildings) || 0, water: Number(r.water) || 0, waterways: Number(r.waterways) || 0,
    green: Number(r.green) || 0, grounds: Number(r.grounds) || 0,
    venue: text(r.venue, 100), detailStatus: text(r.detailStatus, 30), error: text(r.error, 180),
  }))
  return { version: 1, updatedAt: new Date().toISOString(), assets, regions }
}

export function createMemoryReview(root) {
  const pathFor = user => join(root, createHash('sha256').update(user.id).digest('hex') + '.json')
  return {
    async save(user, input) {
      const snapshot = reviewSnapshot(input)
      await mkdir(root, { recursive: true })
      const path = pathFor(user), temporary = path + '.' + randomUUID() + '.tmp'
      await writeFile(temporary, JSON.stringify(snapshot), 'utf8'); await rename(temporary, path)
      return { assets: snapshot.assets.length, regions: snapshot.regions.length }
    },
    async read(user) { try { return JSON.parse(await readFile(pathFor(user), 'utf8')) } catch (e) { if (e.code === 'ENOENT') return null; throw e } },
  }
}

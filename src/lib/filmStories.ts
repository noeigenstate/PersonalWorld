import type { FilmJob, FilmSource } from './memoryFilm'

export interface FilmStory { key: string; place: string; sources: FilmSource[] }

// A stable attempt key survives expired render files. It covers source identity,
// not model prose, so routine information-card edits don't create a render loop.
function storyKey(ids: string[]) {
  const text = ids.sort().join('|')
  let a = 2166136261, b = 5381
  for (const char of text) { a = Math.imul(a ^ char.charCodeAt(0), 16777619); b = Math.imul(b, 33) ^ char.charCodeAt(0) }
  return `place-v1:${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`
}

export function discoverFilmStories(sources: FilmSource[]): FilmStory[] {
  const groups = new Map<string, FilmSource[]>()
  for (const source of sources) {
    const place = source.place.trim()
    // A city alone is not an outing; residential-address names should not become
    // automatic public-facing film titles. Their photos remain eligible for the
    // original general memory edit, whose captions omit addresses.
    if (!place || /[省市县区]$|(?:公寓|小区|华庭|花城|丽景湾|府)$/.test(place)) continue
    groups.set(place, [...(groups.get(place) || []), source])
  }
  return [...groups].filter(([, items]) => items.length >= 4)
    .sort(([a, x], [b, y]) => Math.min(y.length, 12) - Math.min(x.length, 12) || a.localeCompare(b, 'zh-CN'))
    .slice(0, 4)
    .map(([place, items]) => ({ key: storyKey(items.map(s => s.id)), place, sources: items }))
}

export function storyAlreadyMade(story: FilmStory, jobs: FilmJob[]) {
  const ids = new Set(story.sources.map(s => s.id))
  return jobs.some(job => job.status === 'complete' && job.plan &&
    job.plan.shots.filter(shot => ids.has(shot.assetId)).length >= Math.min(6, Math.ceil(ids.size * .7)))
}

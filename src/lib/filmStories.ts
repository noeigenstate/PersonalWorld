import type { FilmJob, FilmSource } from './memoryFilm'

export interface FilmStory { key: string; place: string; sources: FilmSource[]; kind?: 'activity' | 'place' }
export const storyAttempted = (attempted: string[], key: string) => attempted.some(value => value === key || value.endsWith(`:${key}`))

// A stable attempt key survives expired render files. It covers source identity,
// not model prose, so routine information-card edits don't create a render loop.
function storyKey(ids: string[]) {
  const text = ids.sort().join('|')
  let a = 2166136261, b = 5381
  for (const char of text) { a = Math.imul(a ^ char.charCodeAt(0), 16777619); b = Math.imul(b, 33) ^ char.charCodeAt(0) }
  return `place-v1:${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`
}

export function discoverFilmStories(sources: FilmSource[]): FilmStory[] {
  const activities = [
    {id:'snow',label:'雪地里的片刻',pattern:/积雪|雪地|滑雪|雪场/},
    {id:'icecream',label:'甜筒里的小快乐',pattern:/冰淇淋|冰激凌|甜筒|雪糕/},
    {id:'making',label:'小手忙着创作',pattern:/手工|画画|绘画|砂画|马克笔|涂鸦/},
  ].flatMap(({id,label,pattern}) => {
    const items = sources.filter(s => pattern.test(s.observed))
    return items.length < 3 ? [] : [{key:`activity-v1:${id}:${storyKey(items.map(s=>s.id))}`,place:label,sources:items,kind:'activity' as const}]
  })
  const groups = new Map<string, FilmSource[]>()
  for (const source of sources) {
    const place = source.place.trim()
    // A city alone is not an outing; residential-address names should not become
    // automatic public-facing film titles. Their photos remain eligible for the
    // original general memory edit, whose captions omit addresses.
    if (!place || /[省市县区]$|(?:公寓|小区|华庭|花城|丽景湾|府)$/.test(place)) continue
    groups.set(place, [...(groups.get(place) || []), source])
  }
  const places = [...groups].filter(([, items]) => items.length >= 2)
    .sort(([a, x], [b, y]) => Math.min(y.length, 12) - Math.min(x.length, 12) || a.localeCompare(b, 'zh-CN'))
    .slice(0, 24)
    .map(([place, items]) => ({ key: storyKey(items.map(s => s.id)), place, sources: items, kind:'place' as const }))
  return [...activities, ...places]
}

export function storyAlreadyMade(story: FilmStory, jobs: FilmJob[]) {
  const ids = new Set(story.sources.map(s => s.id))
  return jobs.some(job => job.status === 'complete' && job.plan &&
    job.plan.shots.filter(shot => ids.has(shot.assetId)).length >= Math.min(6, Math.ceil(ids.size * .7)))
}

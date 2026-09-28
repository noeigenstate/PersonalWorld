import type { MemoryAsset, MemoryEvent, MemoryState, Place, PlaceRole } from '../types'
import { centroid, distanceKm, type LatLng } from './geo'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
// Photos further apart than this belong to different places
const SAME_AREA_KM = 50
// Longest trip that can be merged into one event
const MAX_TRIP = 30 * DAY
// A city becomes a life base when events there span at least this long
const BASE_SPAN = 180 * DAY
const BASE_MIN_EVENTS = 3

export function formatDate(value: string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('zh-CN', options || { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(value))
}

export function formatMonth(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(new Date(value))
}

export function formatYearMonth(value: string) {
  const date = new Date(value)
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}`
}

const time = (value: string) => new Date(value).getTime()

function sameDay(a: string, b: string) {
  const first = new Date(a)
  const second = new Date(b)
  return first.getFullYear() === second.getFullYear() && first.getMonth() === second.getMonth() && first.getDate() === second.getDate()
}

function pointOf(asset: MemoryAsset): LatLng | undefined {
  return asset.latitude !== undefined && asset.longitude !== undefined ? { lat: asset.latitude, lng: asset.longitude } : undefined
}

// Greedy 50 km clusters over every photo with GPS. The cluster with the most photo-days
// around a moment is where the person lived then; days spent outside it can be a trip.
function homeClusterFinder(assets: MemoryAsset[]) {
  const clusters: { center: LatLng; days: number[] }[] = []
  const clusterOf = new Map<string, number>()
  for (const asset of assets) {
    const point = pointOf(asset)
    if (!point) continue
    let index = clusters.findIndex((cluster) => distanceKm(cluster.center, point) <= SAME_AREA_KM)
    if (index < 0) { clusters.push({ center: point, days: [] }); index = clusters.length - 1 }
    const day = Math.floor(time(asset.capturedAt) / DAY)
    if (!clusters[index].days.includes(day)) clusters[index].days.push(day)
    clusterOf.set(asset.id, index)
  }
  return {
    clusterOf: (asset: MemoryAsset) => clusterOf.get(asset.id),
    // Home is where photos exist both before and after this moment (within two years);
    // with sparse libraries a trip's own photos would otherwise outnumber home's.
    homeAt: (at: string) => {
      const day = Math.floor(time(at) / DAY)
      const pick = (score: (days: number[]) => number) => {
        let best = -1
        let bestScore = 0
        clusters.forEach((cluster, index) => {
          const value = score(cluster.days)
          if (value > bestScore) { best = index; bestScore = value }
        })
        return best
      }
      const spanning = pick((days) => {
        const near = days.filter((d) => Math.abs(d - day) <= 730)
        return near.some((d) => d < day - 3) && near.some((d) => d > day + 3) ? near.length : 0
      })
      return spanning >= 0 ? spanning : pick((days) => days.filter((d) => Math.abs(d - day) <= 90).length)
    },
  }
}

function belongsTogether(group: MemoryAsset[], asset: MemoryAsset, finder: ReturnType<typeof homeClusterFinder>) {
  const previous = group[group.length - 1]
  const gap = time(asset.capturedAt) - time(previous.capturedAt)
  const lastPoint = [...group].reverse().map(pointOf).find(Boolean)
  const point = pointOf(asset)
  const far = lastPoint && point ? distanceKm(lastPoint, point) > SAME_AREA_KM : false
  if (far) return false
  if (gap <= 6 * HOUR && sameDay(previous.capturedAt, asset.capturedAt)) return true
  // Overnight continuation is only allowed away from home, i.e. on a trip
  if (gap > 30 * HOUR || !lastPoint || !point) return false
  if (time(asset.capturedAt) - time(group[0].capturedAt) > MAX_TRIP) return false
  const cluster = finder.clusterOf(asset)
  return cluster !== undefined && cluster !== finder.homeAt(asset.capturedAt)
}

function eventFromGroup(group: MemoryAsset[]): MemoryEvent {
  const first = group[0]
  const last = group[group.length - 1]
  const date = new Date(first.capturedAt)
  const days = Math.round((time(last.capturedAt) - time(first.capturedAt)) / DAY)
  const center = centroid(group.map(pointOf).filter((point): point is LatLng => Boolean(point)))
  return {
    id: crypto.randomUUID(),
    assetIds: group.map((item) => item.id),
    occurredAt: first.capturedAt,
    endedAt: group.length > 1 ? last.capturedAt : undefined,
    timeSource: first.dateSource,
    title: `${date.getMonth() + 1}月${date.getDate()}日${days >= 1 ? `起 ${days + 1} 天` : ''}的片段`,
    summary: `${group.length} 个影像片段，等待你补充发生了什么。`,
    type: '待整理',
    place: '',
    lat: center?.lat,
    lng: center?.lng,
    people: [],
    visibleText: '',
    tags: [],
    questions: ['这组影像记录了什么事？'],
    status: 'draft',
  }
}

export function makeEvents(assets: MemoryAsset[], context: MemoryAsset[] = assets): MemoryEvent[] {
  const sorted = [...assets].sort((a, b) => time(a.capturedAt) - time(b.capturedAt))
  const finder = homeClusterFinder(context)
  const groups: MemoryAsset[][] = []
  for (const asset of sorted) {
    const group = groups[groups.length - 1]
    if (group && belongsTogether(group, asset, finder)) group.push(asset)
    else groups.push([asset])
  }
  return groups.map(eventFromGroup)
}

// Events the user or the AI has worked on stay as they are; every draft is regrouped
// together with the newly imported photos so grouping always sees the full picture.
export function regroupDrafts(state: MemoryState, imported: MemoryAsset[]): MemoryEvent[] {
  const kept = state.events.filter((event) => event.status !== 'draft')
  const keptIds = new Set(kept.flatMap((event) => event.assetIds))
  const assets = [...state.assets, ...imported]
  const loose = assets.filter((asset) => !keptIds.has(asset.id))
  const previous = state.events.filter((event) => event.status === 'draft')
  const drafts = makeEvents(loose, assets).map((event) => {
    // Keep the city of a draft that covered the same photos, so it isn't geocoded again
    const match = previous.find((old) => old.city && old.assetIds.some((id) => event.assetIds.includes(id)))
    return match ? { ...event, city: match.city, citySource: match.citySource, place: match.place } : event
  })
  return [...kept, ...drafts].sort((a, b) => time(b.occurredAt) - time(a.occurredAt))
}

export function eventCover(event: MemoryEvent, assets: MemoryAsset[]): MemoryAsset | undefined {
  const group = event.assetIds.map((id) => assets.find((asset) => asset.id === id)).filter((asset): asset is MemoryAsset => Boolean(asset))
  return group.find((asset) => Boolean(asset.preview)) || group[0]
}

/** A country name is what AMap returns for points at sea; it is not a place */
export const isCountryName = (name?: string) => /^(中华人民共和国|中国)$/.test(name || '')

export function cityLabel(city: string) {
  return city.replace(/(市|特别行政区)$/, '')
}

export const roleLabels: Record<PlaceRole, string> = {
  home: '老家',
  study: '求学',
  work: '工作',
  residence: '居住',
  travel: '旅行',
}

export function derivePlaces(events: MemoryEvent[], roles: Record<string, PlaceRole>): Place[] {
  const byCity = new Map<string, MemoryEvent[]>()
  for (const event of events) {
    if (!event.city) continue
    byCity.set(event.city, [...(byCity.get(event.city) || []), event])
  }
  return Array.from(byCity, ([city, list]) => {
    const sorted = [...list].sort((a, b) => time(a.occurredAt) - time(b.occurredAt))
    const firstAt = sorted[0].occurredAt
    const lastAt = sorted[sorted.length - 1].endedAt || sorted[sorted.length - 1].occurredAt
    const inferredBase = time(lastAt) - time(firstAt) >= BASE_SPAN && sorted.length >= BASE_MIN_EVENTS
    const confirmed = roles[city]
    const role: PlaceRole = confirmed || (inferredBase ? 'residence' : 'travel')
    const center = centroid(sorted.filter((event) => event.lat !== undefined && event.lng !== undefined).map((event) => ({ lat: event.lat!, lng: event.lng! })))
    return {
      city,
      eventIds: sorted.map((event) => event.id),
      firstAt,
      lastAt,
      lat: center?.lat,
      lng: center?.lng,
      role,
      roleConfirmed: Boolean(confirmed),
      isBase: role !== 'travel',
    }
  }).sort((a, b) => time(a.firstAt) - time(b.firstAt))
}

// Life bases in the order the person moved between them
export function spaceLine(places: Place[]): Place[] {
  return places.filter((place) => place.isBase)
}

export function baseAt(places: Place[], at: string): Place | undefined {
  const bases = spaceLine(places).filter((place) => time(place.firstAt) <= time(at))
  return bases[bases.length - 1]
}

// Events in a city, plus the trips taken while living there
export function storyLine(city: string, events: MemoryEvent[], places: Place[]): MemoryEvent[] {
  const place = places.find((item) => item.city === city)
  if (!place) return []
  return events
    .filter((event) => {
      if (event.city === city) return true
      if (!place.isBase || !event.city) return false
      const other = places.find((item) => item.city === event.city)
      return Boolean(other && !other.isBase && baseAt(places, event.occurredAt)?.city === city)
    })
    .sort((a, b) => time(a.occurredAt) - time(b.occurredAt))
}

// "First time" facts as far as the photo record goes
export function firstsOf(events: MemoryEvent[]): Map<string, string[]> {
  const sorted = [...events].sort((a, b) => time(a.occurredAt) - time(b.occurredAt))
  const seenCity = new Set<string>()
  const seenPerson = new Set<string>()
  const result = new Map<string, string[]>()
  for (const event of sorted) {
    const firsts: string[] = []
    if (event.city && !seenCity.has(event.city)) { seenCity.add(event.city); firsts.push(`照片记录中第一次在${cityLabel(event.city)}`) }
    for (const person of event.status === 'confirmed' ? event.people : []) {
      if (person === '我' || seenPerson.has(person)) continue
      seenPerson.add(person)
      firsts.push(`照片记录中第一次和${person}同框`)
    }
    if (firsts.length) result.set(event.id, firsts)
  }
  return result
}

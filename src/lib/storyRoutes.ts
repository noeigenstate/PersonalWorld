import type { MemoryEvent } from '../types'

export interface StoryRoute { id: string; label: string; eventIds: string[] }
const date = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })

// A long-term story belongs on the timeline. A map line is useful only for a
// deliberately selected, short visit with known locations and usable timestamps.
export function visitRoutes(events: MemoryEvent[]): StoryRoute[] {
  const visits: MemoryEvent[][] = []
  const sorted = [...events].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
  let current: MemoryEvent[] = []
  for (const event of sorted) {
    const at = Date.parse(event.occurredAt)
    if (!Number.isFinite(at) || event.timeSource === 'file' || !Number.isFinite(event.lat) || !Number.isFinite(event.lng)) {
      // Missing evidence is a break, not a licence to bridge two unrelated visits.
      current = []
      continue
    }
    const previous = current.at(-1)
    if (!previous || date.format(at) !== date.format(Date.parse(previous.occurredAt)) || at - Date.parse(previous.endedAt || previous.occurredAt) > 6 * 3600000 || current.length >= 12) {
      current = []
      visits.push(current)
    }
    current.push(event)
  }
  return visits.flatMap((visit) => {
    const distinct: MemoryEvent[] = []
    for (const event of visit) {
      const previous = distinct.at(-1)
      if (!previous) { distinct.push(event); continue }
      const metres = Math.hypot((event.lng! - previous.lng!) * 111320 * Math.cos(event.lat! * Math.PI / 180), (event.lat! - previous.lat!) * 111320)
      if (metres >= 40) distinct.push(event)
    }
    return distinct.length < 2 ? [] : [{ id: visit[0].id, label: `${date.format(Date.parse(visit[0].occurredAt))} · ${distinct.length} 个位置`, eventIds: distinct.map((e) => e.id) }]
  })
}

import type { MemoryEvent, Place } from '../types'
import { cityLabel, roleLabels } from './labels.ts'

// "First time" and "last time" as far as the photo record goes. The life butler says them only
// this way, and only from these fields (skills/life-butler), so every claim traces to an event.

const time = (value: string) => new Date(value).getTime()

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

// A move between life bases: the story changes chapter here
export interface Move { from: Place; to: Place; at: string }

export function movesOf(places: Place[]): Move[] {
  const bases = places.filter((p) => p.isBase).sort((a, b) => time(a.firstAt) - time(b.firstAt))
  return bases.slice(1).map((to, i) => ({ from: bases[i], to, at: to.firstAt }))
}

// Compact moves for the butler's memory
export const movesForButler = (places: Place[]) => movesOf(places).map((m) => ({
  from: m.from.city, fromRole: m.from.roleConfirmed ? m.from.role : '', to: m.to.city, toRole: m.to.roleConfirmed ? m.to.role : '', at: m.at.slice(0, 10),
}))

// Only "last times" the record can stand behind: the last event in a life base before the move to
// the next one. Places one came back to later get "the last time before leaving" instead. Nothing
// here is about people — those "last times" are never brought up unasked (see skills/life-butler).
export function lastsOf(events: MemoryEvent[], places: Place[]): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const move of movesOf(places)) {
    const inCity = events.filter((e) => e.city === move.from.city).sort((a, b) => time(a.occurredAt) - time(b.occurredAt))
    const before = inCity.filter((e) => time(e.occurredAt) < time(move.at))
    const last = before[before.length - 1]
    if (!last) continue
    const from = cityLabel(move.from.city)
    const to = cityLabel(move.to.city)
    const role = move.from.roleConfirmed ? `（${roleLabels[move.from.role]}）` : ''
    const revisited = inCity.length > before.length
    const text = revisited ? `离开${from}${role}去${to}前，照片记录中最后一次在${from}` : `照片记录中最后一次在${from}${role}，之后你去了${to}`
    result.set(last.id, [...(result.get(last.id) || []), text])
  }
  return result
}

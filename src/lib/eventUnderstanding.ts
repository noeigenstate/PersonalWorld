import type { MemoryAsset, MemoryEvent } from '../types.ts'
import type { MemoryGraphState } from './memoryGraph.ts'

// Read the same versioned interpretation everywhere. Do not copy AI output
// into the source event store: that would become input to its own next run.
export function understoodEvents(events: MemoryEvent[], assets: MemoryAsset[], state: MemoryGraphState | null): MemoryEvent[] {
  if (!state?.graph) return events
  const people = new Map(state.people.filter(p => p.confirmed).map(p => [p.id, p]))
  return events.map(event => {
    const derived = state.graph.events.find(e => e.sourceEventId === event.id)
    const interpretation = derived?.interpretation
    const photoIds = event.assetIds.filter(id => assets.find(a => a.id === id)?.kind !== 'video')
    if (!derived || !interpretation || derived.assetIds.length !== photoIds.length || !derived.assetIds.every(id => photoIds.includes(id))) return event
    // A local card edit can arrive before its next server sync. Hide the old
    // projection during that window rather than displaying stale claims.
    if (event.assetIds.some(id => {
      const asset = assets.find(a => a.id === id)
      const observation = state.graph.facts.find(f => f.assetId === id && f.type === 'observation')
      return (asset?.card?.scene || '') !== (observation?.value || '')
    })) return event
    const names = derived.personIds.map(id => people.get(id)?.name).filter((name): name is string => Boolean(name))
    if (event.status === 'confirmed') return { ...event, understanding: interpretation }
    return { ...event, title: interpretation.title, summary: interpretation.summary, status: 'analyzed',
      people: names, tags: interpretation.motifs, questions: interpretation.openQuestions, understanding: interpretation }
  })
}

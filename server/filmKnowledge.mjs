import { createHash } from 'node:crypto'

// Deliberately independent of renderer versions, face boxes, timestamps of
// analysis runs and DB revisions. Only changed story inputs warrant a re-edit.
export function filmKnowledgeRevision(sources) {
  const values = sources.map(s => ({ id:s.id, available:s.sourceAvailable!==false,
    date:s.date||'', capturedAt:s.capturedAt||'', observed:s.observed||'', confirmed:s.confirmed||'',
    place:s.place||'', story:s.story||'',
    people:(s.people||[]).map(({id,name,relationship})=>({id,name,relationship})).sort((a,b)=>a.id.localeCompare(b.id)),
    tags:[...(s.tags||[])].sort(),
  })).sort((a,b)=>a.id.localeCompare(b.id))
  return createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0,24)
}

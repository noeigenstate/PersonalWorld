export interface StoryBeat {
  id: string
  assetIds: string[]
  evidenceIds: string[]
  layout: 'single' | 'sequence' | 'compare'
  text: string
  leadInMs: number
  holdMs: number
}

export interface NarratedStory {
  id: string
  key: string
  title: string
  premise: string
  format: 'motif' | 'relationship' | 'revisit' | 'details' | 'outing'
  tone: 'playful' | 'tender' | 'quiet' | 'bright'
  assetIds: string[]
  beats: StoryBeat[]
  reflection: { question: string; assetIds: string[] } | null
  sourceRevision: string
  createdAt: string
  evidence: { id: string; date: string; timeSource: string; city: string; place: string; observed: string }[]
}

export interface StorySummary { id: string; title: string; format: string; createdAt: string }

async function request<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch('/api/storytelling/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Memory-Agent': 'web' }, body: JSON.stringify(body) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '回忆讲述暂不可用')
  return data
}
export const recentStories = () => request<{ stories: StorySummary[] }>('list', {})
export const rememberStoryNote = (storyId: string, assetIds: string[], value: string) => request<{ ok: boolean }>('note', { storyId, assetIds, value })

// Frame changes follow real audio progress. A comparison stays still throughout a paragraph.
export function storyFrame(beat: StoryBeat, progress: number) {
  return beat.layout === 'sequence' ? Math.min(beat.assetIds.length - 1, Math.floor(Math.max(0, Math.min(1, progress)) * beat.assetIds.length)) : 0
}

export function shouldMoveStoryMap(previous: [number, number] | undefined, next: [number, number]) {
  if (!previous) return true
  const lat = (previous[1] + next[1]) / 2 * Math.PI / 180
  const dx = (previous[0] - next[0]) * Math.cos(lat) * 111320
  const dy = (previous[1] - next[1]) * 111320
  return Math.hypot(dx, dy) > 1800
}

import type { MemoryAsset, MemoryEvent } from '../types'

export function formatDate(value: string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('zh-CN', options || { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(value))
}

export function formatMonth(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(new Date(value))
}

function sameDay(a: string, b: string) {
  const first = new Date(a)
  const second = new Date(b)
  return first.getFullYear() === second.getFullYear() && first.getMonth() === second.getMonth() && first.getDate() === second.getDate()
}

export function makeEvents(assets: MemoryAsset[]): MemoryEvent[] {
  const sorted = [...assets].sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime())
  const groups: MemoryAsset[][] = []
  for (const asset of sorted) {
    const group = groups.at(-1)
    const previous = group?.at(-1)
    const gap = previous ? new Date(asset.capturedAt).getTime() - new Date(previous.capturedAt).getTime() : Infinity
    if (group && previous && sameDay(asset.capturedAt, previous.capturedAt) && gap <= 6 * 60 * 60 * 1000) {
      group.push(asset)
    } else {
      groups.push([asset])
    }
  }
  return groups.map((group) => {
    const first = group[0]
    const date = new Date(first.capturedAt)
    return {
      id: crypto.randomUUID(),
      assetIds: group.map((item) => item.id),
      occurredAt: first.capturedAt,
      title: `${date.getMonth() + 1}月${date.getDate()}日的片段`,
      summary: `${group.length} 个影像片段，等待你补充发生了什么。`,
      type: '待整理',
      place: '',
      people: [],
      visibleText: '',
      tags: [],
      questions: ['这组影像记录了什么事？'],
      status: 'draft' as const,
    }
  })
}

export function mergeImportedEvents(existing: MemoryEvent[], imported: MemoryEvent[]): MemoryEvent[] {
  const result = existing.map((event) => ({ ...event, assetIds: [...event.assetIds] }))
  for (const event of imported) {
    const target = result.find((current) => current.status === 'draft' && sameDay(current.occurredAt, event.occurredAt) && Math.abs(new Date(current.occurredAt).getTime() - new Date(event.occurredAt).getTime()) <= 6 * 60 * 60 * 1000)
    if (target) target.assetIds = [...target.assetIds, ...event.assetIds]
    else result.push(event)
  }
  return result.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
}

export function eventCover(event: MemoryEvent, assets: MemoryAsset[]): MemoryAsset | undefined {
  const group = event.assetIds.map((id) => assets.find((asset) => asset.id === id)).filter((asset): asset is MemoryAsset => Boolean(asset))
  return group.find((asset) => Boolean(asset.preview)) || group[0]
}


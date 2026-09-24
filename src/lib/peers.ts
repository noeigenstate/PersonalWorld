import type { MemoryAsset, MemoryEvent } from '../types'

// Picks the reference photos worth showing the model next to a photo that lacks information.
// The model makes the actual judgement (skills/photo-context); this only narrows the field.

// 4×4 grid of average colours from the preview: cheap, good enough to rank "looks like the same scene"
export async function colorSignature(dataUrl: string): Promise<number[]> {
  const image = new Image()
  image.src = dataUrl
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = 4
  canvas.height = 4
  const g = canvas.getContext('2d', { willReadFrequently: true })!
  g.drawImage(image, 0, 0, 4, 4)
  return Array.from(g.getImageData(0, 0, 4, 4).data).filter((_, i) => i % 4 !== 3).map((v) => +(v / 255).toFixed(3))
}

export function visualSimilarity(a: number[], b: number[]) {
  if (a.length !== b.length || !a.length) return 0
  const rms = Math.sqrt(a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0) / a.length)
  return Math.max(0, 1 - rms * 2)
}

const DAY = 86400000

export interface Reference {
  asset: MemoryAsset
  event?: MemoryEvent
  score: number
  known: { city?: string; citySource?: string; place?: string; time?: string; timeSource?: string; title?: string; scene?: string }
}

const sourceLabel: Record<string, string> = { gps: 'GPS 定位', user: '用户确认', ai: '信息卡推断' }
const timeLabel: Record<string, string> = { exif: '拍摄时间', filename: '文件名中的保存时间', file: '文件时间' }

export function knownAbout(asset: MemoryAsset, event?: MemoryEvent): Reference['known'] {
  const city = event?.city || asset.card?.landmark?.city
  const citySource = event?.city ? sourceLabel[event.citySource || 'ai'] || '信息卡推断' : asset.card?.landmark ? '地标推断' : undefined
  return {
    city,
    citySource,
    place: event?.place || asset.card?.landmark?.name,
    time: asset.capturedAt.slice(0, 16).replace('T', ' '),
    timeSource: timeLabel[asset.dateSource],
    title: asset.card?.title,
    scene: asset.card?.scene,
  }
}

function words(asset: MemoryAsset, event?: MemoryEvent) {
  return new Set([...(asset.card?.tags || []), event?.type, event?.place, asset.card?.landmark?.name].filter((w): w is string => Boolean(w)))
}

export function pickReferences(target: MemoryAsset, assets: MemoryAsset[], events: MemoryEvent[], signatures: Map<string, number[]>, max = 4): Reference[] {
  const eventOf = (id: string) => events.find((e) => e.assetIds.includes(id))
  const targetEvent = eventOf(target.id)
  const targetWords = words(target, targetEvent)
  const targetSig = signatures.get(target.id) || []
  const scored = assets
    .filter((a) => a.id !== target.id && a.preview && a.kind !== 'video')
    .map((asset): Reference | null => {
      const event = eventOf(asset.id)
      // Only photos whose place is known from GPS or the user, or from a recognised landmark, can fill gaps
      const reliable = (event?.city && event.citySource !== 'ai') || (asset.card?.landmark?.confidence ?? 0) >= 0.7
      if (!reliable) return null
      const visual = visualSimilarity(targetSig, signatures.get(asset.id) || [])
      const time = Math.exp(-Math.abs(new Date(asset.capturedAt).getTime() - new Date(target.capturedAt).getTime()) / (3 * DAY))
      const shared = [...words(asset, event)].filter((w) => targetWords.has(w)).length
      const text = shared ? Math.min(1, shared / 2) : 0
      return { asset, event, score: 0.5 * visual + 0.3 * time + 0.2 * text, known: knownAbout(asset, event) }
    })
    .filter((r): r is Reference => Boolean(r))
    .sort((a, b) => b.score - a.score)
  // At most two from the same event, so one busy day doesn't crowd out everything else
  const perEvent = new Map<string, number>()
  const picked: Reference[] = []
  for (const ref of scored) {
    const key = ref.event?.id || ref.asset.id
    if ((perEvent.get(key) || 0) >= 2) continue
    perEvent.set(key, (perEvent.get(key) || 0) + 1)
    picked.push(ref)
    if (picked.length === max) break
  }
  return picked
}

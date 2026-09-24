import type { MemoryAsset, MemoryEvent, PhotoLocation } from '../types'

// Where a photo was taken, resolved in this order (first found wins):
//   1. the photo's own metadata: EXIF GPS → reverse geocoded down to street number / AOI;
//      IPTC/XMP place names → geocoded
//   2. the picture: a recognised landmark or readable place name → AMap place search
//   3. other photos (photo-context)
// Each result says where it came from and how fine it is.

export const precisionRank: Record<PhotoLocation['precision'], number> = { point: 6, poi: 5, street: 4, district: 3, city: 2, province: 1 }

export const sourceNotes: Record<PhotoLocation['source'], string> = {
  gps: '来自照片自带的 GPS',
  meta: '来自照片元数据里的地名',
  landmark: '画面中认出地标，经高德地点搜索定位',
  text: '画面中的地名文字，经高德地点搜索定位',
  peer: '从其他照片推断',
  user: '你填写的',
}

export const precisionNotes: Record<PhotoLocation['precision'], string> = {
  point: '精确到门牌',
  poi: '精确到地点',
  street: '精确到街道',
  district: '精确到区县',
  city: '精确到城市',
  province: '只到省份',
}

// Finest first: "外滩观景台 · 中山东一路285号 · 黄浦区 · 上海市"
export function locationLabel(parts: Pick<PhotoLocation, 'poi' | 'aoi' | 'street' | 'number' | 'township' | 'district' | 'city' | 'province'>) {
  const near = parts.poi?.name || parts.aoi
  const street = parts.street ? `${parts.street}${parts.number || ''}` : ''
  const seen = new Set<string>()
  return [near, street, parts.district, parts.city || parts.province]
    .filter((p): p is string => Boolean(p))
    .filter((p) => (seen.has(p) ? false : (seen.add(p), true)))
    .join(' · ')
}

export function precisionOf(parts: Pick<PhotoLocation, 'poi' | 'aoi' | 'street' | 'number' | 'district' | 'city'>, hasPoint: boolean): PhotoLocation['precision'] {
  if (hasPoint && parts.number) return 'point'
  if (parts.poi || parts.aoi) return 'poi'
  if (parts.street) return 'street'
  if (parts.district) return 'district'
  if (parts.city) return 'city'
  return 'province'
}

// Photos of one event without a place of their own take the place of a located photo from the
// same event. Events without GPS are grouped by time (same day, gaps under 6 hours), so this is
// "taken during the same outing", which is why the precision drops to district level at best.
export function inheritFromEvent(assets: MemoryAsset[], events: MemoryEvent[]): Map<string, PhotoLocation> {
  const out = new Map<string, PhotoLocation>()
  for (const event of events) {
    const members = event.assetIds.map((id) => assets.find((a) => a.id === id)).filter((a): a is MemoryAsset => Boolean(a))
    const anchor = members
      .filter((a) => a.location && a.location.source !== 'peer')
      .sort((a, b) => precisionRank[b.location!.precision] - precisionRank[a.location!.precision] || b.location!.confidence - a.location!.confidence)[0]
    if (!anchor) continue
    const from = anchor.location!
    const coarse = precisionRank[from.precision] > precisionRank.district ? 'district' : from.precision
    for (const member of members) {
      if (member.location || member.id === anchor.id) continue
      out.set(member.id, {
        source: 'peer',
        precision: coarse,
        gcj: from.gcj,
        province: from.province,
        city: from.city,
        district: from.district,
        // Only as fine as the precision claims: the sibling's exact spot is not this photo's
        label: [from.district, from.city].filter(Boolean).join(' · ') || from.city || from.label,
        evidence: `与同一事件中的「${anchor.name}」同一时段拍摄`,
        confidence: Math.min(0.6, from.confidence),
      })
    }
  }
  return out
}

// Keep the finer of two answers; a GPS answer is never replaced by an inferred one
export function better(current: PhotoLocation | undefined, next: PhotoLocation | undefined) {
  if (!next) return current
  if (!current) return next
  if (current.source === 'gps' || current.source === 'user') return current
  return precisionRank[next.precision] > precisionRank[current.precision] ? next : current
}

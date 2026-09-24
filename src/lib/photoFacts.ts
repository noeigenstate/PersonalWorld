import type { MemoryAsset, MemoryEvent } from '../types'
import { cityLabel, formatDate } from './memory'
import { precisionNotes, sourceNotes } from './location'

// What the app itself knows about a photo. These are facts; the photo card's AI part is not.
export interface PhotoFacts {
  fileName: string
  device: string
  stripped: boolean
  time: string
  timeNote: string
  timeSource: MemoryAsset['dateSource']
  place: string
  placeNote: string
  placeInferred: boolean
  metaPlace?: string
  size: string
  latitude?: number
  longitude?: number
  city?: string
  address?: string
}

const timeNotes: Record<MemoryAsset['dateSource'], string> = {
  exif: '拍摄时间，来自照片元数据',
  filename: '保存时间，来自文件名；拍摄可能更早',
  file: '文件时间，可能是复制或下载的时间',
}

function bytes(size: number) {
  return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`
}

export function photoFacts(asset: MemoryAsset, event?: MemoryEvent, dimensions?: { width: number; height: number }): PhotoFacts {
  const hasGps = asset.latitude !== undefined && asset.longitude !== undefined
  const city = event?.city && event.citySource !== 'ai' ? event.city : undefined
  const dims = dimensions || (asset.width && asset.height ? { width: asset.width, height: asset.height } : undefined)
  const device = [asset.camera?.make, asset.camera?.model].filter(Boolean).join(' ')
  return {
    fileName: asset.name,
    device: [device, asset.camera?.lens].filter(Boolean).join(' · '),
    stripped: asset.metadata === 'none',
    time: formatDate(asset.capturedAt, { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    timeNote: timeNotes[asset.dateSource] || timeNotes.file,
    timeSource: asset.dateSource,
    // The photo's own location first (see lib/location.ts), then the event's city
    place: asset.location ? asset.location.label : city ? [cityLabel(city), event?.place].filter(Boolean).join(' · ') : hasGps ? '有定位，地址待识别' : '没有定位信息',
    placeNote: asset.location
      ? [sourceNotes[asset.location.source], precisionNotes[asset.location.precision], asset.location.poi?.distance !== undefined ? `距离约 ${asset.location.poi.distance} 米` : ''].filter(Boolean).join(' · ')
      : city ? (event?.citySource === 'user' ? '你填写的' : '来自照片定位') : hasGps ? `${asset.latitude!.toFixed(5)}, ${asset.longitude!.toFixed(5)}` : '照片里没有 GPS；可以从画面内容推断',
    placeInferred: Boolean(asset.location && !['gps', 'meta', 'user'].includes(asset.location.source)),
    metaPlace: asset.metaPlace,
    size: [dims ? `${dims.width} × ${dims.height}` : '', bytes(asset.size)].filter(Boolean).join(' · '),
    latitude: asset.latitude,
    longitude: asset.longitude,
    city: asset.location?.city || city,
    address: asset.location?.label || (city ? event?.place : undefined),
  }
}

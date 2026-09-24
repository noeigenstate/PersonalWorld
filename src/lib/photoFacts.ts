import type { MemoryAsset, MemoryEvent } from '../types'
import { cityLabel, formatDate } from './memory'

// What the app itself knows about a photo. These are facts; the photo card's AI part is not.
export interface PhotoFacts {
  fileName: string
  time: string
  timeNote: string
  timeSource: MemoryAsset['dateSource']
  place: string
  placeNote: string
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
  return {
    fileName: asset.name,
    time: formatDate(asset.capturedAt, { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    timeNote: timeNotes[asset.dateSource] || timeNotes.file,
    timeSource: asset.dateSource,
    place: city ? [cityLabel(city), event?.place].filter(Boolean).join(' · ') : hasGps ? '有定位，城市待识别' : '没有定位信息',
    placeNote: city ? (event?.citySource === 'user' ? '你填写的' : '来自照片定位') : hasGps ? `${asset.latitude!.toFixed(4)}, ${asset.longitude!.toFixed(4)}` : '微信等应用保存的图片通常会去掉定位',
    size: [dims ? `${dims.width} × ${dims.height}` : '', bytes(asset.size)].filter(Boolean).join(' · '),
    latitude: asset.latitude,
    longitude: asset.longitude,
    city,
    address: city ? event?.place : undefined,
  }
}

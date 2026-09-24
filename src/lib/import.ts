import * as exifr from 'exifr'
import type { MemoryAsset } from '../types'
import { saveFile } from './storage'

const maxFileSize = 80 * 1024 * 1024

function imagePreview(file: File): Promise<string> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.78))
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      resolve('')
    }
    image.src = url
  })
}

function videoPreview(file: File): Promise<string> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    let settled = false
    const finish = (value: string) => {
      if (settled) return
      settled = true
      URL.revokeObjectURL(url)
      video.removeAttribute('src')
      video.load()
      resolve(value)
    }
    const timer = window.setTimeout(() => finish(''), 8000)
    video.onloadedmetadata = () => {
      if (!video.videoWidth || !video.videoHeight) return finish('')
      video.currentTime = Math.min(0.25, Math.max(0, video.duration / 2))
    }
    video.onseeked = () => {
      window.clearTimeout(timer)
      const scale = Math.min(1, 1200 / Math.max(video.videoWidth, video.videoHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
      finish(canvas.toDataURL('image/jpeg', 0.75))
    }
    video.onerror = () => {
      window.clearTimeout(timer)
      finish('')
    }
    video.preload = 'metadata'
    video.muted = true
    video.src = url
  })
}

function validDate(value: unknown): Date | undefined {
  if (!value) return undefined
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? undefined : date
}

async function hashFile(file: File): Promise<string> {
  const bytes = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export interface ImportResult {
  assets: MemoryAsset[]
  duplicates: number
  rejected: string[]
}

export async function importFiles(files: File[], existingHashes: string[]): Promise<ImportResult> {
  const hashes = new Set(existingHashes)
  const assets: MemoryAsset[] = []
  const rejected: string[] = []
  let duplicates = 0
  for (const file of files) {
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) && !file.type.startsWith('video/')) {
      rejected.push(`${file.name}：目前支持 JPG、PNG、WebP、GIF 和浏览器可播放的视频`)
      continue
    }
    if (file.size > maxFileSize) {
      rejected.push(`${file.name}：文件超过 80 MB`)
      continue
    }
    try {
      const hash = await hashFile(file)
      if (hashes.has(hash)) {
        duplicates += 1
        continue
      }
      const isVideo = file.type.startsWith('video/')
      let exif: Record<string, unknown> = {}
      let gps: { latitude?: number; longitude?: number } = {}
      if (!isVideo) {
        exif = (await exifr.parse(file).catch(() => null)) || {}
        gps = (await exifr.gps(file).catch(() => null)) || {}
      }
      const captureDate = validDate(exif.DateTimeOriginal) || validDate(exif.CreateDate) || validDate(exif.ModifyDate)
      const date = captureDate || new Date(file.lastModified || Date.now())
      const name = file.name.toLowerCase()
      const kind = isVideo ? 'video' : /screenshot|screen shot|截屏|截图|屏幕快照/.test(name) ? 'screenshot' : 'image'
      const preview = isVideo ? await videoPreview(file) : await imagePreview(file)
      if (!isVideo && !preview) {
        rejected.push(`${file.name}：浏览器无法预览这个图片格式`)
        continue
      }
      const asset: MemoryAsset = {
        id: crypto.randomUUID(),
        name: file.name,
        kind,
        mimeType: file.type,
        size: file.size,
        capturedAt: date.toISOString(),
        dateSource: captureDate ? 'exif' : 'file',
        latitude: gps.latitude,
        longitude: gps.longitude,
        preview,
        hash,
      }
      await saveFile(asset.id, file)
      hashes.add(hash)
      assets.push(asset)
    } catch {
      rejected.push(`${file.name}：读取失败`)
    }
  }
  return { assets, duplicates, rejected }
}

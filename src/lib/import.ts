import * as exifr from 'exifr'
import type { MemoryAsset } from '../types'
import { saveFile } from './storage'
import { colorSignature } from './peers'

const maxFileSize = 80 * 1024 * 1024

// Also reports the original pixel size, which the photo card shows
let lastSize: { width: number; height: number } | undefined

function imagePreview(file: File): Promise<string> {
  lastSize = undefined
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      lastSize = { width: image.naturalWidth, height: image.naturalHeight }
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

// Chat apps strip EXIF but keep a save time in the name: 微信图片_20260924133610,
// mmexport1695547890123, IMG_20260924_133610, Screenshot_2026-09-24-13-36-10 …
export function timeFromFileName(name: string): Date | undefined {
  const epoch = name.match(/(?:mmexport|wx_camera_)(\d{13})/)
  const date = epoch
    ? new Date(Number(epoch[1]))
    : (() => {
        const m = name.match(/(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})[-_ T]?(\d{2})[-_.:]?(\d{2})[-_.:]?(\d{2})/)
        return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) : undefined
      })()
  if (!date || Number.isNaN(date.getTime())) return undefined
  return date.getFullYear() >= 2000 && date.getTime() <= Date.now() + 86400000 ? date : undefined
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

const SUPPORTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const isHeic = (file: File) => /image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)

// Chrome can't decode HEIC (iPhone originals); convert only for the preview, keep the original file
async function heicAsJpeg(file: File): Promise<File> {
  const { default: heic2any } = await import('heic2any')
  const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 })
  return new File([Array.isArray(out) ? out[0] : out], file.name.replace(/\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg' })
}

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined)
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

export function cameraFrom(exif: Record<string, unknown>): MemoryAsset['camera'] {
  const make = text(exif.Make)
  let model = text(exif.Model)
  // "HUAWEI" + "HUAWEI P60" → show once
  if (make && model && model.toLowerCase().startsWith(make.toLowerCase())) model = model.slice(make.length).trim() || model
  const lens = text(exif.LensModel)
  return make || model || lens ? { make, model, lens } : undefined
}

export async function importFiles(files: File[], existingHashes: string[]): Promise<ImportResult> {
  const hashes = new Set(existingHashes)
  const assets: MemoryAsset[] = []
  const rejected: string[] = []
  let duplicates = 0
  for (const file of files) {
    if (!SUPPORTED.includes(file.type) && !isHeic(file) && !file.type.startsWith('video/')) {
      rejected.push(`${file.name}：目前支持 JPG、PNG、WebP、GIF、HEIC 和浏览器可播放的视频`)
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
        exif = (await exifr.parse(file, { tiff: true, exif: true, gps: true, xmp: true, mergeOutput: true }).catch(() => null)) || {}
        gps = (await exifr.gps(file).catch(() => null)) || {}
      }
      const hasExif = Boolean(exif.DateTimeOriginal || exif.CreateDate || exif.Make || exif.Model || gps.latitude !== undefined)
      const captureDate = validDate(exif.DateTimeOriginal) || validDate(exif.CreateDate) || validDate(exif.ModifyDate)
      const namedDate = captureDate ? undefined : timeFromFileName(file.name)
      const date = captureDate || namedDate || new Date(file.lastModified || Date.now())
      const name = file.name.toLowerCase()
      const kind = isVideo ? 'video' : /screenshot|screen shot|截屏|截图|屏幕快照/.test(name) ? 'screenshot' : 'image'
      const preview = isVideo ? await videoPreview(file) : await imagePreview(isHeic(file) ? await heicAsJpeg(file) : file)
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
        dateSource: captureDate ? 'exif' : namedDate ? 'filename' : 'file',
        signature: preview ? await colorSignature(preview).catch(() => undefined) : undefined,
        metadata: isVideo ? undefined : hasExif ? 'exif' : 'none',
        camera: cameraFrom(exif),
        altitude: num(exif.GPSAltitude),
        direction: num(exif.GPSImgDirection),
        width: isVideo ? undefined : lastSize?.width,
        height: isVideo ? undefined : lastSize?.height,
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

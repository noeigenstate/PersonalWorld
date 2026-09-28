import type { MemoryAsset, PhotoLook } from '../types'

// Finding near-duplicate photos (bursts, the same shot taken again) and ranking each stack.
// Everything here runs in the browser on the stored previews; the model only adds what pixels
// statistics cannot tell (closed eyes, expressions) through skills/photo-cull.

const SIDE = 320

async function decode(dataUrl: string) {
  const image = new Image()
  image.src = dataUrl
  await image.decode()
  return image
}

function grey(image: HTMLImageElement, w: number, h: number) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const g = canvas.getContext('2d', { willReadFrequently: true })!
  g.drawImage(image, 0, 0, w, h)
  const rgba = g.getImageData(0, 0, w, h).data
  const out = new Float32Array(w * h)
  for (let i = 0; i < out.length; i++) out[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]
  return out
}

/** Difference hash (64 bits as 16 hex digits), sharpness (variance of the Laplacian) and exposure */
export async function photoLook(dataUrl: string): Promise<PhotoLook> {
  const image = await decode(dataUrl)
  const small = grey(image, 9, 8)
  let bits = ''
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += small[y * 9 + x] > small[y * 9 + x + 1] ? '1' : '0'
  const dhash = Array.from({ length: 16 }, (_, i) => parseInt(bits.slice(i * 4, i * 4 + 4), 2).toString(16)).join('')

  const scale = SIDE / Math.max(image.naturalWidth, image.naturalHeight)
  const w = Math.max(8, Math.round(image.naturalWidth * scale)), h = Math.max(8, Math.round(image.naturalHeight * scale))
  const px = grey(image, w, h)
  let sum = 0, sumSq = 0, n = 0, bright = 0, clipped = 0
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x
    const lap = px[i - 1] + px[i + 1] + px[i - w] + px[i + w] - 4 * px[i]
    sum += lap; sumSq += lap * lap; n++
  }
  for (const v of px) { bright += v; if (v < 8 || v > 247) clipped++ }
  const mean = sum / n
  return { dhash, sharpness: Math.round(sumSq / n - mean * mean), brightness: Math.round(bright / px.length), clipped: +(clipped / px.length).toFixed(3) }
}

export function hamming(a: string, b: string) {
  let d = 0
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    while (x) { d += x & 1; x >>= 1 }
  }
  return d
}

const SECOND = 1000, MINUTE = 60 * SECOND

// Share of the 4×4 colour layout that matches (same measure as peers.visualSimilarity)
function colourLikeness(a?: number[], b?: number[]) {
  if (!a || !b || a.length !== b.length || !a.length) return 0
  return Math.max(0, 1 - 2 * Math.sqrt(a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0) / a.length))
}

// Same composition: almost identical hashes at any time; close hashes within 20 minutes; and within
// 30 seconds a reframed shot of the same scene (zoomed or moved a little) by its colour layout.
// Measured on real phone photos: reframed repeats taken 4–18 s apart had 22–33 differing bits and
// colour likeness 0.71–0.76; different scenes minutes apart reached 0.81, so colour alone needs the time limit.
export function sameShot(a: MemoryAsset, b: MemoryAsset) {
  // An empty hash means the preview could not be measured
  if (!a.look?.dhash || !b.look?.dhash) return false
  const distance = hamming(a.look.dhash, b.look.dhash)
  const apart = Math.abs(Date.parse(a.capturedAt) - Date.parse(b.capturedAt))
  if (distance <= 4 || (distance <= 12 && apart <= 20 * MINUTE)) return true
  return apart <= 30 * SECOND && (distance <= 24 || colourLikeness(a.signature, b.signature) >= 0.7)
}

export interface Stack { key: string; assets: MemoryAsset[] }

/** Groups of two or more similar photos, largest first; each stack sorted by time */
export function findStacks(assets: MemoryAsset[]): Stack[] {
  const photos = assets.filter((a) => a.kind === 'image' && a.look)
  const parent = photos.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < photos.length; i++) for (let j = i + 1; j < photos.length; j++) {
    if (sameShot(photos[i], photos[j])) parent[find(i)] = find(j)
  }
  const groups = new Map<number, MemoryAsset[]>()
  photos.forEach((asset, i) => groups.set(find(i), [...(groups.get(find(i)) || []), asset]))
  return [...groups.values()].filter((g) => g.length > 1)
    .map((g) => g.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)))
    .map((g) => ({ key: g.map((a) => a.id).sort().join(','), assets: g }))
    .sort((a, b) => b.assets.length - a.assets.length || a.assets[0].capturedAt.localeCompare(b.assets[0].capturedAt))
}

/** How many to keep: one of a few, two of a burst, three of a long series */
export const keepCount = (n: number) => (n <= 3 ? 1 : n <= 8 ? 2 : 3)

// What the model said about one photo (skills/photo-cull)
export interface CullReview { eyesClosed: boolean; blurry: boolean; issues: string[]; score: number; note: string }

export interface Ranked { asset: MemoryAsset; score: number; issues: string[]; keep: boolean }

// Local issues, judged against the sharpest photo of the same stack
function localIssues(look: PhotoLook, sharpest: number) {
  const issues: string[] = []
  if (look.sharpness < sharpest * 0.4 && look.sharpness < 400) issues.push('模糊')
  if (look.brightness < 45) issues.push('过暗')
  if (look.brightness > 215 || look.clipped > 0.3) issues.push('过曝')
  return issues
}

/** Scores 0–10, most keepable first. The model's picks are kept when it gave any, otherwise the best `keepCount` */
export function rankStack(stack: Stack, reviews: Record<string, CullReview> = {}, picks: string[] = []): Ranked[] {
  const sharpest = Math.max(...stack.assets.map((a) => a.look!.sharpness), 1)
  const pixels = Math.max(...stack.assets.map((a) => (a.width || 1) * (a.height || 1)), 1)
  const ranked = stack.assets.map((asset) => {
    const look = asset.look!
    const issues = localIssues(look, sharpest)
    let local = 7 * Math.min(1, look.sharpness / sharpest) + 2 * (((asset.width || 1) * (asset.height || 1)) / pixels) + 1
    if (issues.includes('过暗') || issues.includes('过曝')) local -= 2
    const review = reviews[asset.id]
    let score = local
    if (review) {
      score = 0.6 * review.score + 0.4 * local
      if (review.eyesClosed) { score -= 4; issues.push('闭眼') }
      if (review.blurry && !issues.includes('模糊')) issues.push('模糊')
      for (const issue of review.issues) if (!issues.includes(issue)) issues.push(issue)
    }
    return { asset, score: +Math.max(0, Math.min(10, score)).toFixed(1), issues, keep: false }
  }).sort((a, b) => b.score - a.score)
  const chosen = picks.filter((id) => stack.assets.some((a) => a.id === id)).slice(0, keepCount(ranked.length))
  if (chosen.length) ranked.forEach((r) => { r.keep = chosen.includes(r.asset.id) })
  else ranked.slice(0, keepCount(ranked.length)).forEach((r) => { r.keep = true })
  // Kept photos first, then by score
  return ranked.sort((a, b) => Number(b.keep) - Number(a.keep) || b.score - a.score)
}

/** A smaller JPEG of the preview for the model: 768 px is enough to see eyes in a portrait */
export async function reviewImage(dataUrl: string, side = 768) {
  const image = await decode(dataUrl)
  const scale = Math.min(1, side / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(image.naturalWidth * scale)
  canvas.height = Math.round(image.naturalHeight * scale)
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.82)
}

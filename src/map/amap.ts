// Loads the AMap JS API 2.0. The security code stays on our server: requests go through
// /_AMapService, which appends it (see server/amap.mjs).
import type { GeocodeResult, PhotoLocation } from '../types'
import { wgs84ToGcj02 } from '../lib/geo'
import { locationLabel, precisionOf } from '../lib/location'

/* eslint-disable @typescript-eslint/no-explicit-any */
export type AMapNS = any

declare global {
  interface Window { AMap?: AMapNS; _AMapSecurityConfig?: { serviceHost?: string; securityJsCode?: string } }
}

let loading: Promise<AMapNS> | null = null

export function loadAmap(key: string): Promise<AMapNS> {
  if (window.AMap) return Promise.resolve(window.AMap)
  if (loading) return loading
  window._AMapSecurityConfig = { serviceHost: `${location.origin}/_AMapService` }
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&plugin=AMap.Geocoder,AMap.PlaceSearch`
    script.async = true
    script.onload = () => (window.AMap ? resolve(window.AMap) : reject(new Error('高德地图加载失败')))
    script.onerror = () => { loading = null; reject(new Error('无法连接高德地图，请检查网络')) }
    document.head.append(script)
  })
  return loading
}

const text = (value: unknown) => (typeof value === 'string' ? value : '')

// Browser-side reverse geocoding with the JS API key, used when no web-service key is set
export async function geocodeInBrowser(key: string, points: { id: string; lat: number; lng: number }[]): Promise<GeocodeResult[]> {
  const AMap = await loadAmap(key)
  const geocoder = new AMap.Geocoder({ city: '全国', radius: 1000 })
  const results: GeocodeResult[] = []
  for (let start = 0; start < points.length; start += 20) {
    const batch = points.slice(start, start + 20)
    const locations = batch.map((p) => { const g = wgs84ToGcj02(p); return [g.lng, g.lat] })
    const regeocodes: any[] = await new Promise((resolve, reject) => {
      geocoder.getAddress(locations, (status: string, result: any) => {
        if (status === 'complete') resolve(result.regeocodes || [])
        else if (status === 'no_data') resolve([])
        else reject(new Error(`高德地名识别失败：${text(result?.info) || status}`))
      })
    })
    batch.forEach((point, index) => {
      const part = regeocodes[index]?.addressComponent || {}
      const city = text(part.city) || text(part.province)
      const district = text(part.district)
      const detail = [text(part.township), text(part.neighborhood) || text(part.building)].filter(Boolean).join(' ')
      if (city) results.push({ id: point.id, city, district, address: [district, detail].filter(Boolean).join(' ') })
    })
  }
  return results
}

const call = <T>(run: (done: (status: string, result: any) => void) => void, pick: (result: any) => T, empty: T) =>
  new Promise<T>((resolve, reject) => run((status, result) => {
    if (status === 'complete') resolve(pick(result))
    else if (status === 'no_data') resolve(empty)
    else reject(new Error(`高德查询失败：${text(result?.info) || status}`))
  }))

function fromRegeocode(regeo: any, gcj: [number, number], source: PhotoLocation['source'], confidence: number): PhotoLocation | undefined {
  const part = regeo?.addressComponent || {}
  const province = text(part.province)
  const city = text(part.city) || province
  if (!city) return undefined
  const nearest = (regeo.pois || []).slice().sort((a: any, b: any) => Number(a.distance) - Number(b.distance))[0]
  const parts = {
    province,
    city,
    district: text(part.district),
    township: text(part.township),
    street: text(part.streetNumber?.street) || text(part.street),
    number: text(part.streetNumber?.number) || text(part.streetNumber),
    aoi: text(regeo.aois?.[0]?.name) || text(part.neighborhood) || text(part.building) || undefined,
    // Only a POI close enough to plausibly be where the photo was taken
    poi: nearest && Number(nearest.distance) <= 150 ? { name: text(nearest.name), distance: Math.round(Number(nearest.distance)) } : undefined,
  }
  return { source, precision: precisionOf(parts, true), gcj, ...parts, label: locationLabel(parts), confidence }
}

// Level 1: EXIF GPS → the finest address AMap knows (street number, AOI, nearest POI)
export async function detailedAddresses(key: string, points: { id: string; lat: number; lng: number }[]): Promise<Map<string, PhotoLocation>> {
  const AMap = await loadAmap(key)
  const geocoder = new AMap.Geocoder({ extensions: 'all', radius: 200 })
  const out = new Map<string, PhotoLocation>()
  // Two lookups at a time with retries: one by one took ~20 s for 35 photos, while four at once
  // ran into AMap's per-second limit and silently lost some photos
  const queue = [...points]
  const failed: string[] = []
  const worker = async () => {
    for (let point = queue.shift(); point; point = queue.shift()) {
      const g = wgs84ToGcj02(point)
      const gcj: [number, number] = [g.lng, g.lat]
      let regeo: any = undefined
      for (let attempt = 0; attempt < 4 && regeo === undefined; attempt++) {
        if (attempt) await new Promise((resolve) => setTimeout(resolve, 500 * attempt))
        regeo = await call((done) => geocoder.getAddress(gcj, done), (r) => r.regeocode, null).catch(() => undefined)
      }
      if (regeo === undefined) { failed.push(point.id); continue }
      // null: AMap has no address there (e.g. abroad), which is an answer, not a failure
      const location = regeo && fromRegeocode(regeo, gcj, 'gps', 1)
      if (location) out.set(point.id, location)
    }
  }
  await Promise.all(Array.from({ length: 2 }, worker))
  if (failed.length && !out.size) throw new Error(`高德地址查询失败（${failed.length} 张照片），稍后会重试`)
  return out
}

// Level 1: a place name written into the photo's IPTC/XMP metadata → coordinates
export async function locateAddress(key: string, address: string): Promise<PhotoLocation | undefined> {
  const AMap = await loadAmap(key)
  const geocodes = await call((done) => new AMap.Geocoder({}).getLocation(address, done), (r) => r.geocodes || [], [])
  const g = geocodes[0]
  if (!g?.location) return undefined
  const parts = { province: text(g.addressComponent?.province), city: text(g.addressComponent?.city) || text(g.addressComponent?.province), district: text(g.addressComponent?.district), street: text(g.addressComponent?.street), number: text(g.addressComponent?.streetNumber) }
  return { source: 'meta', precision: precisionOf(parts, false), gcj: [g.location.lng, g.location.lat], ...parts, label: locationLabel(parts) || address, evidence: address, confidence: 0.9 }
}

// Level 2: a landmark or readable place name from the picture → AMap place search; text that only
// names a region (e.g. "青海公路" on a work jacket) is placed at that region, no finer
export async function searchPlace(key: string, query: { text: string; city: string; from: 'landmark' | 'text'; level?: 'poi' | 'district' | 'city' | 'province'; confidence: number }): Promise<PhotoLocation | undefined> {
  if (query.level && query.level !== 'poi') {
    const region = await locateAddress(key, [query.city, query.text].filter(Boolean).join(''))
    if (!region) return undefined
    return {
      ...region,
      source: query.from,
      precision: query.level,
      street: undefined,
      number: undefined,
      district: query.level === 'district' ? region.district : undefined,
      city: query.level === 'province' ? undefined : region.city,
      label: query.level === 'province' ? region.province || query.text : [query.level === 'district' ? region.district : '', region.city].filter(Boolean).join(' · ') || query.text,
      evidence: `画面中的文字「${query.text}」`,
      confidence: query.confidence,
    }
  }
  const AMap = await loadAmap(key)
  const search = new AMap.PlaceSearch({ city: query.city || '全国', citylimit: Boolean(query.city), pageSize: 3 })
  const pois = await call((done) => search.search(query.text, done), (r) => r.poiList?.pois || [], [])
  const poi = pois[0]
  if (!poi?.location) return undefined
  const parts = { province: text(poi.pname), city: text(poi.cityname) || query.city, district: text(poi.adname), poi: { name: text(poi.name) } }
  return {
    source: query.from,
    precision: 'poi',
    gcj: [poi.location.lng, poi.location.lat],
    ...parts,
    label: locationLabel(parts),
    evidence: query.from === 'landmark' ? `画面中认出「${query.text}」` : `画面中的文字「${query.text}」`,
    confidence: query.confidence,
  }
}

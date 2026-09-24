// Loads the AMap JS API 2.0. The security code stays on our server: requests go through
// /_AMapService, which appends it (see server/amap.mjs).
import type { GeocodeResult } from '../types'
import { wgs84ToGcj02 } from '../lib/geo'

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
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&plugin=AMap.Geocoder`
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

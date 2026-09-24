// Photo GPS is WGS-84; AMap (and every map service in mainland China) uses GCJ-02.
// This file is also imported by the Node API server, so it must stay free of browser APIs
// and use only erasable TypeScript syntax.

export interface LatLng { lat: number; lng: number }

const A = 6378245.0
const EE = 0.00669342162296594323

function outOfChina({ lat, lng }: LatLng) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271
}

function transformLat(x: number, y: number) {
  let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  r += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3
  r += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3
  r += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3
  return r
}

function transformLng(x: number, y: number) {
  let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  r += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3
  r += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3
  r += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3
  return r
}

export function wgs84ToGcj02(point: LatLng): LatLng {
  if (outOfChina(point)) return point
  const dLat = transformLat(point.lng - 105, point.lat - 35)
  const dLng = transformLng(point.lng - 105, point.lat - 35)
  const radLat = (point.lat / 180) * Math.PI
  const magic = 1 - EE * Math.sin(radLat) ** 2
  const sqrtMagic = Math.sqrt(magic)
  return {
    lat: point.lat + (dLat * 180) / (((A * (1 - EE)) / (magic * sqrtMagic)) * Math.PI),
    lng: point.lng + (dLng * 180) / ((A / sqrtMagic) * Math.cos(radLat) * Math.PI),
  }
}

export function distanceKm(a: LatLng, b: LatLng) {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(h))
}

export function centroid(points: LatLng[]): LatLng | undefined {
  if (!points.length) return undefined
  return {
    lat: points.reduce((sum, p) => sum + p.lat, 0) / points.length,
    lng: points.reduce((sum, p) => sum + p.lng, 0) / points.length,
  }
}

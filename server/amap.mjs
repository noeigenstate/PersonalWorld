// AMap (高德) Web service + JS API security proxy.
// Docs: https://lbs.amap.com/api/webservice/guide/api/georegeo
//       https://lbs.amap.com/api/javascript-api-v2/guide/abc/jscode
import { wgs84ToGcj02 } from '../src/lib/geo.js'

export function amapConfig(env = process.env) {
  return {
    jsKey: env.AMAP_JS_KEY?.trim(),
    securityCode: env.AMAP_JS_SECURITY_CODE?.trim(),
    serviceKey: env.AMAP_WEB_SERVICE_KEY?.trim(),
    restBase: (env.AMAP_REST_BASE || 'https://restapi.amap.com').replace(/\/$/, ''),
  }
}

const text = (value) => (typeof value === 'string' ? value : '')

// points: [{ id, lat, lng }] in WGS-84 → [{ id, city, district, address }]
export async function reverseGeocode(config, points) {
  if (!config.serviceKey) throw new Error('未配置 AMAP_WEB_SERVICE_KEY，暂时无法识别地名')
  const results = []
  for (let start = 0; start < points.length; start += 20) {
    const batch = points.slice(start, start + 20)
    const location = batch.map(({ lat, lng }) => {
      const gcj = wgs84ToGcj02({ lat, lng })
      return `${gcj.lng.toFixed(6)},${gcj.lat.toFixed(6)}`
    }).join('|')
    const url = `${config.restBase}/v3/geocode/regeo?key=${encodeURIComponent(config.serviceKey)}&location=${location}&batch=true&radius=1000&extensions=base`
    const response = await fetch(url)
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.status !== '1') throw new Error(`高德逆地理编码失败：${text(data.info) || `HTTP ${response.status}`}`)
    batch.forEach((point, index) => {
      const regeo = data.regeocodes?.[index] || {}
      const part = regeo.addressComponent || {}
      // Municipalities (上海、北京…) return an empty city; the province is the city
      // Over the sea AMap names only the country; that is no place on a life map
      const region = (value) => (/^(中华人民共和国|中国)$/.test(text(value)) ? '' : text(value))
      const city = region(part.city) || region(part.province)
      const district = text(part.district)
      const detail = [text(part.township), text(part.neighborhood?.name) || text(part.building?.name)].filter(Boolean).join(' ')
      results.push({ id: point.id, city, district, address: [district, detail].filter(Boolean).join(' ') })
    })
  }
  return results
}

// The JS API sends requests to /_AMapService/*; the security code is appended here
// so it never reaches the browser.
const proxyTargets = [
  ['/_AMapService/v4/map/styles', 'https://webapi.amap.com/v4/map/styles'],
  ['/_AMapService/v3/vectormap', 'https://fmap01.amap.com/v3/vectormap'],
  ['/_AMapService/', 'https://restapi.amap.com/'],
]

// Terrain (DEM) tiles never change and the map asks for many at once: keep the recent ones
const demCache = new Map()
const DEM_CACHE_SIZE = 1500
const DEM_CACHE_BYTES = 64 * 1024 * 1024
let demCacheBytes = 0

async function fetchWithRetry(url) {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(8000) })
  } catch {
    return fetch(url, { signal: AbortSignal.timeout(12000) })
  }
}

export async function proxyAmapService(config, req, res) {
  if (!config.securityCode) {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' })
    return res.end(JSON.stringify({ error: '未配置 AMAP_JS_SECURITY_CODE' }))
  }
  const url = new URL(req.url || '/', 'http://localhost')
  const [prefix, target] = proxyTargets.find(([p]) => url.pathname.startsWith(p))
  const dem = url.pathname.includes('/rest/lbs/dem/')
  const cacheKey = dem ? url.pathname + url.search : ''
  if (dem && demCache.has(cacheKey)) {
    const hit = demCache.get(cacheKey)
    demCache.delete(cacheKey)
    demCache.set(cacheKey, hit)
    res.writeHead(hit.status, { 'Content-Type': hit.type, 'Cache-Control': 'public, max-age=86400' })
    return res.end(hit.body)
  }
  url.searchParams.set('jscode', config.securityCode)
  let upstream, type, body
  try {
    upstream = await fetchWithRetry(`${target}${url.pathname.slice(prefix.length)}?${url.searchParams}`)
    type = upstream.headers.get('content-type') || 'application/octet-stream'
    body = Buffer.from(await upstream.arrayBuffer())
  } catch {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
    return res.end(JSON.stringify({ error: '高德服务暂时连不上' }))
  }
  if (dem && (upstream.ok || upstream.status === 404) && body.length <= DEM_CACHE_BYTES) {
    const previous = demCache.get(cacheKey)
    if (previous) demCacheBytes -= previous.body.length
    demCache.delete(cacheKey)
    demCache.set(cacheKey, { status: upstream.status, type, body })
    demCacheBytes += body.length
    while (demCache.size > DEM_CACHE_SIZE || demCacheBytes > DEM_CACHE_BYTES) {
      const oldestKey = demCache.keys().next().value
      demCacheBytes -= demCache.get(oldestKey).body.length
      demCache.delete(oldestKey)
    }
  }
  res.writeHead(upstream.status, { 'Content-Type': type })
  res.end(body)
}

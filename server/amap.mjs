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
      const city = text(part.city) || text(part.province)
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

export async function proxyAmapService(config, req, res) {
  if (!config.securityCode) {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' })
    return res.end(JSON.stringify({ error: '未配置 AMAP_JS_SECURITY_CODE' }))
  }
  const url = new URL(req.url || '/', 'http://localhost')
  const [prefix, target] = proxyTargets.find(([p]) => url.pathname.startsWith(p))
  url.searchParams.set('jscode', config.securityCode)
  const upstream = await fetch(`${target}${url.pathname.slice(prefix.length)}?${url.searchParams}`)
  res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream' })
  res.end(Buffer.from(await upstream.arrayBuffer()))
}

// Keeps the map in the browser: AMap base-map tiles, satellite imagery, terrain (DEM) and styles
// are served from Cache Storage when present, so a map already seen opens without loading.
// Entries older than MAX_AGE are fetched again in the background and replaced when the online
// map changed; the next visit shows the update. Nothing else of the app goes through here.
const CACHE = 'pw-map-v1'
const MAX_AGE = 7 * 24 * 60 * 60 * 1000
const SAVED_AT = 'x-pw-saved-at'

const mapHost = /(^|\.)(amap\.com|autonavi\.com)$/
// Logs, statistics and JSONP answers carry one-off parameters: never cache them
const oneOff = /\/(v3\/log|log\/|stat|count)|[?&](callback|jsonp)=/

function cacheable(request, url) {
  if (request.method !== 'GET') return false
  if (url.origin === self.location.origin) return url.pathname.startsWith('/_AMapService/rest/lbs/dem/') || url.pathname === '/earth-cartoon.svg'
  return mapHost.test(url.hostname) && !oneOff.test(url.pathname + url.search)
}

// The same tile comes from webst01…04 / vdata, vdata01…: one cache entry for all of them
function cacheKey(url) {
  const key = new URL(url)
  key.hostname = key.hostname.replace(/^(webst|webrd|wprd|vdata)\d*\./, '$1.')
  return key.href
}

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith('pw-map-') && name !== CACHE) await caches.delete(name)
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (!cacheable(event.request, url)) return
  event.respondWith(localFirst(event, url))
})

async function localFirst(event, url) {
  const cache = await caches.open(CACHE)
  const key = cacheKey(url)
  const saved = await cache.match(key)
  if (saved) {
    const age = Date.now() - Number(saved.headers.get(SAVED_AT) || 0)
    if (age > MAX_AGE) event.waitUntil(refresh(cache, key, event.request, saved).catch(() => {}))
    return saved
  }
  return refresh(cache, key, event.request)
}

// Fetch from the network and keep a copy; replace a saved copy only when the content changed
async function refresh(cache, key, request, saved) {
  let response
  try {
    response = await fetch(request)
  } catch (error) {
    if (saved) return saved
    throw error
  }
  // Opaque (no-CORS) answers cannot be checked and cost a lot of quota: pass them through
  if (!response.ok || response.type === 'opaque') return response
  const body = await response.clone().arrayBuffer()
  if (saved) {
    const old = await saved.clone().arrayBuffer()
    if (sameBytes(old, body)) {
      await cache.put(key, stamped(saved.headers, old, saved.status))
      return response
    }
  }
  await cache.put(key, stamped(response.headers, body, response.status))
  return response
}

function stamped(headers, body, status) {
  const copy = new Headers(headers)
  copy.set(SAVED_AT, String(Date.now()))
  return new Response(body, { status, headers: copy })
}

function sameBytes(a, b) {
  if (a.byteLength !== b.byteLength) return false
  const x = new Uint8Array(a), y = new Uint8Array(b)
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false
  return true
}

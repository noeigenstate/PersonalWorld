import * as THREE from 'three'
import { gcj02ToWgs84 } from '../lib/geo'
import { cityLabel, roleLabels } from '../lib/memory'
import { clusterProjectedPhotos } from './photoClusters'
import type { LifeMapCallbacks, LifeMapData, MapPhoto } from './scene'
import type { Place } from '../types'

const RADIUS = 1.6
// Globe units: RADIUS is the Earth's 6371 km. Below this camera altitude the street map takes over.
export const GLOBE_KM_PER_UNIT = 6371 / RADIUS
// The globe stays a sphere all the way in (it used to unroll into the flat map, which read as a
// deformed Earth). The street map takes over only this close — the view is then about 500 km
// high, where the curve is imperceptible — and a detail patch (below) keeps the globe crisp
// down to there.
export const HANDOFF_ALTITUDE = 0.16
const CLOSEST_ALTITUDE = 0.15
const DEG = Math.PI / 180
// From this altitude down, the street map is kept on the same view underneath and fades in over
// the last part of the approach: at the hand-over there is nothing left to change.
const APPROACH_FROM = 0.5
// Below this altitude the globe is drawn again, larger, around the view (Natural Earth 50 m)
const DETAIL_FROM = 0.7
const smooth = (x: number) => { const t = THREE.MathUtils.clamp(x, 0, 1); return t * t * (3 - 2 * t) }
export const approachAt = (altitude: number) => smooth(Math.log(APPROACH_FROM / altitude) / Math.log(APPROACH_FROM / HANDOFF_ALTITUDE))
export const fadeAt = (altitude: number) => smooth((approachAt(altitude) - 0.5) / 0.45)

function onGlobe(lng: number, lat: number, radius = RADIUS) {
  const phi = lng * DEG
  const theta = lat * DEG
  return new THREE.Vector3(
    radius * Math.cos(theta) * Math.cos(phi),
    radius * Math.sin(theta),
    -radius * Math.cos(theta) * Math.sin(phi),
  )
}

// The globe is the life map's overview. It uses the same places and real photo coordinates as
// the street map; choosing a city hands the view back to the existing AMap scene.
export function createGlobeLifeMap(container: HTMLElement, callbacks: LifeMapCallbacks) {
  const host = document.createElement('div')
  host.className = 'life-globe'
  const stars = document.createElement('canvas')
  stars.className = 'globe-stars'
  // Over the still stars: shooting stars, a passing saucer, a drifting space station (behind the globe)
  const sky = document.createElement('canvas')
  sky.className = 'globe-sky'
  const canvas = document.createElement('canvas')
  canvas.className = 'life-globe-canvas'
  canvas.tabIndex = 0
  canvas.setAttribute('role', 'application')
  canvas.setAttribute('aria-label', '地球仪：拖动或方向键旋转，滚轮、双指或加减按钮缩放')
  const labelsLayer = document.createElement('div')
  labelsLayer.className = 'life-map-labels globe-labels'
  const placeMenu = document.createElement('div')
  placeMenu.className = 'globe-place-menu'
  placeMenu.setAttribute('role', 'dialog')
  placeMenu.setAttribute('aria-label', '选择地点')
  placeMenu.hidden = true
  const photoLayer = document.createElement('div')
  photoLayer.className = 'life-map-photos globe-photos'
  const menu = document.createElement('div')
  menu.className = 'map-photo-menu'
  menu.setAttribute('role', 'dialog')
  menu.setAttribute('aria-label', '选择照片')
  menu.hidden = true
  const controls = document.createElement('div')
  controls.className = 'globe-controls'
  const credit = document.createElement('a')
  credit.className = 'globe-credit'
  credit.href = 'https://www.naturalearthdata.com/'
  credit.target = '_blank'
  credit.rel = 'noopener noreferrer'
  credit.textContent = '地球轮廓：Natural Earth'
  host.append(stars, sky, canvas, labelsLayer, photoLayer, menu, placeMenu, controls, credit)
  container.append(host)

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100)
  camera.position.z = 6
  camera.lookAt(0, 0, 0)
  scene.add(new THREE.AmbientLight(0xffffff, 1.6))
  const sunlight = new THREE.DirectionalLight(0xffffff, 2.1)
  sunlight.position.set(-3, 4, 6)
  scene.add(sunlight)
  const globe = new THREE.Group()
  scene.add(globe)
  const sphereGeometry = new THREE.SphereGeometry(RADIUS, 96, 64)
  const sphereMaterial = new THREE.MeshStandardMaterial({ color: 0x83b6c7, roughness: 1 })
  // Shown once its drawing is ready: a plain blue ball first and continents popping in later looked broken
  const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial)
  sphere.visible = false
  globe.add(sphere)
  // (No atmosphere halo: the user found the grey ring around the Earth distracting.)
  let texture: THREE.Texture | undefined
  // The texture is a vector drawing: rasterise it large so coasts stay crisp until the street map takes over
  const art = new Image()
  art.src = '/earth-cartoon.svg'
  art.decode().then(() => {
    if (disposed) return
    const widthPx = Math.min(8192, renderer.capabilities.maxTextureSize)
    const board = document.createElement('canvas')
    board.width = widthPx
    board.height = widthPx / 2
    board.getContext('2d')!.drawImage(art, 0, 0, board.width, board.height)
    const loaded = new THREE.CanvasTexture(board)
    loaded.colorSpace = THREE.SRGBColorSpace
    loaded.anisotropy = renderer.capabilities.getMaxAnisotropy()
    texture = loaded
    sphere.visible = true
    host.dataset.texture = 'ready'
    sphereMaterial.map = loaded
    sphereMaterial.color.set(0xffffff)
    sphereMaterial.needsUpdate = true
    draw()
  }).catch(() => { sphere.visible = true; host.dataset.texture = 'plain'; draw() })

  const dotGeometry = new THREE.SphereGeometry(0.018, 12, 8)
  const dotMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff })
  let dots = new THREE.Group()
  globe.add(dots)
  let places: Place[] = []
  const placeButtons = new Map<string, HTMLButtonElement>()
  let photos: MapPhoto[] = []
  let shown = new Map<string, HTMLButtonElement>()
  let width = 1, height = 1
  let insets = { right: 0, bottom: 0, top: 0 }
  let zoom = 1
  let zoomTargetPhoto: MapPhoto | null = null
  let enteringScene = false
  let placeSignature = ''
  // The globe turns only in longitude and latitude, so north stays up like on a real globe
  let view = { lng: 105, lat: 34 }
  let home = { lng: 105, lat: 34 }
  function setView(lng: number, lat: number) {
    view = { lng: ((lng + 540) % 360) - 180, lat: THREE.MathUtils.clamp(lat, -80, 80) }
    // Bring (lng, lat) to face the camera (+z): turn about the axis, then tilt about x
    const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (-90 - view.lng) * DEG)
    const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), view.lat * DEG)
    globe.quaternion.copy(tilt.multiply(spin))
  }
  // Degrees the view moves per dragged pixel: less when zoomed in, so the ground follows the finger
  const degreesPerPixel = () => (2 * Math.atan(altitude() * Math.tan(21 * DEG) / RADIUS) / DEG) / Math.max(1, height)
  let disposed = false

  function drawStars() {
    const ratio = Math.min(window.devicePixelRatio, 2)
    stars.width = Math.round(width * ratio)
    stars.height = Math.round(height * ratio)
    const context = stars.getContext('2d')
    if (!context) return
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, width, height)
    let seed = 27
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    // A quiet, fixed Milky Way band; the only motion in this view comes from the user's drag.
    for (let i = 0; i < 13; i++) {
      const x = (i + 0.5) / 13 * width
      const y = height * 0.85 - x * 0.48
      const haze = context.createRadialGradient(x, y, 0, x, y, Math.max(100, width * 0.17))
      haze.addColorStop(0, 'rgba(133,121,226,.13)')
      haze.addColorStop(0.45, 'rgba(76,112,196,.07)')
      haze.addColorStop(1, 'rgba(76,112,196,0)')
      context.fillStyle = haze
      context.fillRect(x - width * 0.17, y - width * 0.17, width * 0.34, width * 0.34)
    }
    for (let i = 0; i < 1350; i++) {
      const x = random() * width
      const center = height * 0.85 - x * 0.48
      const y = center + (random() + random() + random() - 1.5) * height * 0.3
      if (y < 0 || y > height) continue
      const r = 0.25 + random() * 1.1
      context.fillStyle = `rgba(210,225,255,${0.1 + random() * 0.35})`
      context.beginPath()
      context.arc(x, y, r, 0, Math.PI * 2)
      context.fill()
    }
    for (let i = 0; i < Math.floor(width * height / 3100); i++) {
      const x = random() * width, y = random() * height
      const r = random() > 0.94 ? 1.9 : 0.45 + random() * 0.9
      context.fillStyle = `rgba(240,247,255,${0.3 + random() * 0.6})`
      context.beginPath()
      context.arc(x, y, r, 0, Math.PI * 2)
      context.fill()
      if (r > 1.5) {
        context.strokeStyle = 'rgba(228,242,255,.45)'
        context.lineWidth = 0.7
        context.beginPath()
        context.moveTo(x - 5, y); context.lineTo(x + 5, y)
        context.moveTo(x, y - 5); context.lineTo(x, y + 5)
        context.stroke()
      }
    }
  }

  // ---- The animated sky: the one thing on the page allowed to move on its own ----------------
  // Shooting stars now and then, a saucer with a small green pilot crossing every so often, and a
  // space station drifting across the top over a couple of minutes. Behind the globe, at ~30 fps,
  // only while this layer is on screen; none of it when the person prefers reduced motion.
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const skyState = {
    meteors: [] as { x: number; y: number; vx: number; vy: number; born: number; life: number }[],
    nextMeteor: 2500,
    saucer: null as { start: number; y: number; dir: number; span: number } | null,
    nextSaucer: 9000,
    stationStart: 0,
    last: 0,
  }
  let skyFrame = 0
  const skyRandom = () => Math.random()
  function drawSky(now: number) {
    const ratio = Math.min(window.devicePixelRatio, 2)
    if (sky.width !== Math.round(width * ratio) || sky.height !== Math.round(height * ratio)) { sky.width = Math.round(width * ratio); sky.height = Math.round(height * ratio) }
    const g = sky.getContext('2d')
    if (!g) return
    g.setTransform(ratio, 0, 0, ratio, 0, 0)
    g.clearRect(0, 0, width, height)
    // Space station: a slow arc across the upper sky, 150 s per crossing
    if (!skyState.stationStart) skyState.stationStart = now - 30000
    const stationT = ((now - skyState.stationStart) % 150000) / 150000
    const sx = -60 + (width + 120) * stationT, sy = height * 0.14 - Math.sin(stationT * Math.PI) * height * 0.05
    g.save()
    g.translate(sx, sy)
    g.rotate(Math.sin(stationT * Math.PI * 2) * 0.12 - 0.15)
    g.fillStyle = '#3f6fd8'
    for (const side of [-1, 1]) {
      g.fillRect(side > 0 ? 16 : -16 - 26, -5, 26, 10)
      g.strokeStyle = 'rgba(255,255,255,.45)'
      g.lineWidth = 0.8
      for (let i = 1; i < 4; i++) { const x = (side > 0 ? 16 : -42) + i * 6.5; g.beginPath(); g.moveTo(x, -5); g.lineTo(x, 5); g.stroke() }
      g.beginPath(); g.moveTo((side > 0 ? 16 : -42), 0); g.lineTo((side > 0 ? 42 : -16), 0); g.stroke()
    }
    g.fillStyle = '#e4ebf7'
    g.beginPath(); g.roundRect(-16, -6, 32, 12, 4); g.fill()
    g.fillStyle = '#b8c6dc'
    g.fillRect(-16, 2, 32, 3)
    g.fillStyle = '#ffd166'
    g.beginPath(); g.arc(9, -1, 2, 0, Math.PI * 2); g.fill()
    g.strokeStyle = '#e4ebf7'; g.lineWidth = 1.2
    g.beginPath(); g.moveTo(0, -6); g.lineTo(0, -14); g.stroke()
    g.fillStyle = `rgba(255,90,90,${0.5 + 0.5 * Math.sin(now / 400)})`
    g.beginPath(); g.arc(0, -15, 1.6, 0, Math.PI * 2); g.fill()
    g.restore()
    // Saucer with its pilot, crossing in about 8 s along a gentle wave
    if (!skyState.saucer && now > skyState.nextSaucer) skyState.saucer = { start: now, y: height * (0.18 + skyRandom() * 0.5), dir: skyRandom() > 0.5 ? 1 : -1, span: 8000 + skyRandom() * 3000 }
    if (skyState.saucer) {
      const s = skyState.saucer
      const t = (now - s.start) / s.span
      if (t > 1) { skyState.saucer = null; skyState.nextSaucer = now + 18000 + skyRandom() * 22000 }
      else {
        const x = s.dir > 0 ? -50 + (width + 100) * t : width + 50 - (width + 100) * t
        const y = s.y + Math.sin(t * Math.PI * 3) * 14
        g.save()
        g.translate(x, y)
        g.scale(s.dir, 1)
        // trail
        const trail = g.createLinearGradient(-22, 0, -90, 0)
        trail.addColorStop(0, 'rgba(160,220,255,.35)'); trail.addColorStop(1, 'rgba(160,220,255,0)')
        g.fillStyle = trail
        g.fillRect(-90, -2, 70, 4)
        // dome with the alien
        g.fillStyle = 'rgba(205,240,255,.85)'
        g.beginPath(); g.ellipse(0, -6, 11, 9, 0, Math.PI, 0); g.fill()
        g.fillStyle = '#8fe388'
        g.beginPath(); g.arc(0, -7, 4.2, 0, Math.PI * 2); g.fill()
        g.fillStyle = '#1d1d1f'
        g.beginPath(); g.arc(-1.6, -7.5, 0.9, 0, Math.PI * 2); g.arc(1.6, -7.5, 0.9, 0, Math.PI * 2); g.fill()
        g.strokeStyle = '#8fe388'; g.lineWidth = 1
        g.beginPath(); g.moveTo(-2, -10.5); g.lineTo(-3.5, -14); g.moveTo(2, -10.5); g.lineTo(3.5, -14); g.stroke()
        // body
        const body = g.createLinearGradient(0, -6, 0, 6)
        body.addColorStop(0, '#d8e3f3'); body.addColorStop(1, '#8fa5c6')
        g.fillStyle = body
        g.beginPath(); g.ellipse(0, 0, 24, 7, 0, 0, Math.PI * 2); g.fill()
        // lights
        for (const [i, color] of ['#ff7b7b', '#ffd166', '#7ee8fa', '#ffd166', '#ff7b7b'].entries()) {
          g.fillStyle = (Math.floor(now / 250) + i) % 3 === 0 ? color : 'rgba(255,255,255,.35)'
          g.beginPath(); g.arc(-16 + i * 8, 3, 1.6, 0, Math.PI * 2); g.fill()
        }
        g.restore()
      }
    }
    // Shooting stars: short bright streaks, gone in under a second
    if (now > skyState.nextMeteor) {
      const fromLeft = skyRandom() > 0.5
      const angle = (fromLeft ? 1 : -1) * (0.45 + skyRandom() * 0.3)
      const speed = 620 + skyRandom() * 380
      skyState.meteors.push({ x: skyRandom() * width, y: skyRandom() * height * 0.55, vx: Math.cos(angle) * speed * (fromLeft ? 1 : 1), vy: Math.abs(Math.sin(angle)) * speed, born: now, life: 550 + skyRandom() * 350 })
      skyState.nextMeteor = now + 3500 + skyRandom() * 6500
    }
    skyState.meteors = skyState.meteors.filter((m) => now - m.born < m.life)
    for (const m of skyState.meteors) {
      const age = (now - m.born) / 1000
      const fade = 1 - (now - m.born) / m.life
      const hx = m.x + m.vx * age, hy = m.y + m.vy * age
      const tail = 0.12
      const streak = g.createLinearGradient(hx, hy, hx - m.vx * tail, hy - m.vy * tail)
      streak.addColorStop(0, `rgba(255,255,255,${0.95 * fade})`)
      streak.addColorStop(1, 'rgba(255,255,255,0)')
      g.strokeStyle = streak
      g.lineWidth = 1.8
      g.lineCap = 'round'
      g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx - m.vx * tail, hy - m.vy * tail); g.stroke()
      g.fillStyle = `rgba(255,255,255,${fade})`
      g.beginPath(); g.arc(hx, hy, 1.6, 0, Math.PI * 2); g.fill()
    }
  }
  function animateSky(now: number) {
    if (disposed) return
    skyFrame = requestAnimationFrame(animateSky)
    if (now - skyState.last < 33) return
    if (document.visibilityState !== 'visible' || host.closest('.away')) return
    skyState.last = now
    drawSky(now)
  }
  if (!reduceMotion) skyFrame = requestAnimationFrame(animateSky)

  // ---- Detail patch: the same drawing as the texture, made again around the view when close ----
  // The whole-Earth texture is 8192 px for 40,000 km; zoomed in to a few hundred kilometres it blurs.
  // Below DETAIL_FROM a canvas of the region (Natural Earth 50 m: land, ice, lakes, rivers, borders)
  // is drawn on a slightly raised piece of sphere, fading out at its edges into the base texture.
  type Ring = [number, number][]
  type Bounded<T> = T & { bbox: [number, number, number, number] }
  interface EarthData { land: Bounded<{ rings: Ring[] }>[]; ice: Bounded<{ rings: Ring[] }>[]; lakes: Bounded<{ rings: Ring[] }>[]; rivers: Bounded<{ line: Ring; rank: number }>[]; borders: Bounded<{ line: Ring }>[] }
  let earthData: Promise<EarthData | null> | null = null
  let detail: { mesh: THREE.Mesh; texture: THREE.CanvasTexture; lng: number; lat: number; span: number } | null = null
  const boundsOf = (points: Ring): [number, number, number, number] => points.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity] as [number, number, number, number])
  function loadEarthData() {
    earthData ??= (async () => {
      try {
        const [land, ice, lakes, rivers, borders] = await Promise.all(['ne_50m_land', 'ne_50m_glaciated_areas', 'ne_50m_lakes', 'ne_50m_rivers_lake_centerlines', 'ne_50m_admin_0_boundary_lines_land'].map(async (name) => (await fetch(`/earth-data/${name}.geojson`)).json()))
        const polygons = (collection: { features: { geometry: { type: string; coordinates: unknown } }[] }) => collection.features.flatMap((f) => {
          const list = f.geometry.type === 'Polygon' ? [f.geometry.coordinates as Ring[]] : f.geometry.type === 'MultiPolygon' ? (f.geometry.coordinates as Ring[][]) : []
          return list.map((rings) => ({ rings, bbox: boundsOf(rings[0]) }))
        })
        const lines = (collection: { features: { properties?: { scalerank?: number }; geometry: { type: string; coordinates: unknown } }[] }) => collection.features.flatMap((f) => {
          const list = f.geometry.type === 'LineString' ? [f.geometry.coordinates as Ring] : f.geometry.type === 'MultiLineString' ? (f.geometry.coordinates as Ring[]) : []
          return list.map((line) => ({ line, rank: f.properties?.scalerank ?? 9, bbox: boundsOf(line) }))
        })
        return { land: polygons(land), ice: polygons(ice), lakes: polygons(lakes), rivers: lines(rivers), borders: lines(borders) }
      } catch { return null }
    })()
    return earthData
  }
  function drawDetail(data: EarthData, lng0: number, lat0: number, lngSpan: number, latSpan: number) {
    const W = 4096, H = 2048
    const board = document.createElement('canvas')
    board.width = W
    board.height = H
    const g = board.getContext('2d')!
    const lngMin = lng0 - lngSpan / 2, latMax = lat0 + latSpan / 2, latMin = lat0 - latSpan / 2
    const inView = (bbox: [number, number, number, number]) => bbox[2] >= lngMin && bbox[0] <= lngMin + lngSpan && bbox[3] >= latMin && bbox[1] <= latMax
    const px = (lng: number) => (lng - lngMin) / lngSpan * W
    const py = (lat: number) => (latMax - lat) / latSpan * H
    const trace = (points: Ring, close: boolean) => {
      points.forEach(([lng, lat], i) => (i ? g.lineTo(px(lng), py(lat)) : g.moveTo(px(lng), py(lat))))
      if (close) g.closePath()
    }
    const fillPolygons = (items: Bounded<{ rings: Ring[] }>[], style: string | CanvasGradient, dy = 0) => {
      g.save(); g.translate(0, dy); g.fillStyle = style; g.beginPath()
      for (const item of items) if (inView(item.bbox)) item.rings.forEach((ring) => trace(ring, true))
      g.fill('evenodd'); g.restore()
    }
    const strokePolygons = (items: Bounded<{ rings: Ring[] }>[]) => { g.beginPath(); for (const item of items) if (inView(item.bbox)) item.rings.forEach((ring) => trace(ring, true)); g.stroke() }
    const strokeLines = (items: Bounded<{ line: Ring }>[]) => { g.beginPath(); for (const item of items) if (inView(item.bbox)) trace(item.line, false); g.stroke() }
    const sea = g.createLinearGradient(0, 0, 0, H); sea.addColorStop(0, '#3dbdee'); sea.addColorStop(.52, '#33b6ea'); sea.addColorStop(1, '#3dbdee')
    const land = g.createLinearGradient(0, 0, 0, H); land.addColorStop(0, '#97d862'); land.addColorStop(.42, '#8fd35a'); land.addColorStop(.72, '#8ad056'); land.addColorStop(1, '#97d862')
    g.fillStyle = sea; g.fillRect(0, 0, W, H)
    // graticule every degree, faint
    g.strokeStyle = 'rgba(213,247,237,.12)'; g.lineWidth = 1; g.beginPath()
    for (let lng = Math.ceil(lngMin); lng <= lngMin + lngSpan; lng++) { g.moveTo(px(lng), 0); g.lineTo(px(lng), H) }
    for (let lat = Math.ceil(latMin); lat <= latMax; lat++) { g.moveTo(0, py(lat)); g.lineTo(W, py(lat)) }
    g.stroke()
    fillPolygons(data.land, 'rgba(31,149,216,.35)', 5)
    fillPolygons(data.land, land)
    fillPolygons(data.ice, 'rgba(244,248,255,.95)')
    fillPolygons(data.lakes, '#3dbdee')
    g.strokeStyle = 'rgba(95,208,242,.85)'; g.lineCap = 'round'; g.lineJoin = 'round'
    for (const [maxRank, width] of [[3, 3], [5, 2.2], [7, 1.5], [9, 1]] as const) { g.lineWidth = width; strokeLines(data.rivers.filter((r) => r.rank <= maxRank && r.rank > maxRank - 2)) }
    g.strokeStyle = 'rgba(255,255,255,.42)'; g.lineWidth = 1.4; g.setLineDash([8, 5]); strokeLines(data.borders); g.setLineDash([])
    g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 2; strokePolygons(data.land)
    // Fade to nothing towards the edges, so the patch melts into the base texture
    g.globalCompositeOperation = 'destination-in'
    g.save(); g.translate(W / 2, H / 2); g.scale(1, H / W)
    const fade = g.createRadialGradient(0, 0, 0, 0, 0, W / 2)
    fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(.72, 'rgba(0,0,0,1)'); fade.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = fade; g.fillRect(-W / 2, -W / 2, W, W)
    g.restore()
    g.globalCompositeOperation = 'source-over'
    return board
  }
  // A piece of sphere over the region, its uv running with the canvas above
  function patchGeometry(lng0: number, lat0: number, lngSpan: number, latSpan: number) {
    const cols = 64, rows = 32
    const positions: number[] = [], uvs: number[] = [], normals: number[] = [], indices: number[] = []
    for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
      const lng = lng0 - lngSpan / 2 + lngSpan * c / cols
      const lat = lat0 - latSpan / 2 + latSpan * r / rows
      const at = onGlobe(lng, lat, RADIUS * 1.0015)
      positions.push(at.x, at.y, at.z)
      const n = at.clone().normalize(); normals.push(n.x, n.y, n.z)
      uvs.push(c / cols, r / rows)
    }
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1
      indices.push(a, b, e, a, e, d)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.setIndex(indices)
    return geometry
  }
  function disposeDetail() {
    if (!detail) return
    globe.remove(detail.mesh)
    detail.mesh.geometry.dispose()
    ;(detail.mesh.material as THREE.Material).dispose()
    detail.texture.dispose()
    detail = null
  }
  let detailBuilding = false
  function updateDetail() {
    const alt = altitude()
    if (alt >= DETAIL_FROM || !texture) { if (detail) detail.mesh.visible = false; return }
    const center = centerLngLat()
    // Wide enough to fill the screen at this height; never so wide that 4096 px gets coarse
    const lngSpan = THREE.MathUtils.clamp(alt * 60, 20, 42)
    const latSpan = lngSpan / 2
    if (detail && Math.abs(center.lng - detail.lng) < lngSpan * 0.12 && Math.abs(center.lat - detail.lat) < latSpan * 0.12 && Math.abs(lngSpan - detail.span) / detail.span < 0.2) { detail.mesh.visible = true; return }
    if (detailBuilding) return
    detailBuilding = true
    void loadEarthData().then((data) => {
      detailBuilding = false
      if (disposed || !data || altitude() >= DETAIL_FROM) return
      const now = centerLngLat()
      const lat0 = THREE.MathUtils.clamp(now.lat, -84 + latSpan / 2, 84 - latSpan / 2)
      const board = drawDetail(data, now.lng, lat0, lngSpan, latSpan)
      const loaded = new THREE.CanvasTexture(board)
      loaded.colorSpace = THREE.SRGBColorSpace
      loaded.anisotropy = renderer.capabilities.getMaxAnisotropy()
      const mesh = new THREE.Mesh(patchGeometry(now.lng, lat0, lngSpan, latSpan), new THREE.MeshStandardMaterial({ map: loaded, roughness: 1, transparent: true, depthWrite: false }))
      mesh.renderOrder = 1
      disposeDetail()
      globe.add(mesh)
      detail = { mesh, texture: loaded, lng: now.lng, lat: lat0, span: lngSpan }
      draw()
    })
  }

  function fitDistance() {
    const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    const usable = Math.max(0.45, (height - insets.top - insets.bottom) / height)
    return Math.max(4.5, RADIUS / (tangent * usable * 0.86), RADIUS / (tangent * camera.aspect * 0.89))
  }
  function precise(photo: MapPhoto) { return !photo.precision || ['point', 'poi', 'street'].includes(photo.precision) }
  function nearestPhoto(x: number, y: number) {
    const candidate = photos.filter(precise).map((photo) => {
      const wgs = gcj02ToWgs84({ lng: photo.gcj[0], lat: photo.gcj[1] })
      return { photo, spot: projected(surface(wgs.lng, wgs.lat, RADIUS * 1.05)) }
    }).filter(({ spot }) => spot.front)
      .sort((a, b) => Math.hypot(a.spot.x - x, a.spot.y - y) - Math.hypot(b.spot.x - x, b.spot.y - y))[0]
    return candidate && Math.hypot(candidate.spot.x - x, candidate.spot.y - y) < Math.max(135, width * 0.11) ? candidate.photo : null
  }
  // One continuous zoom: past HANDOFF_ALTITUDE the street map carries on from the same point.
  // Wheel steps glide like the street map's own zoom instead of jumping.
  let zoomGoal = 1
  let gliding = 0
  let glideAt = 0
  function zoomBy(factor: number, point = { x: width / 2, y: (height + insets.top - insets.bottom) / 2 }) {
    if (enteringScene) return
    if (factor > 1 && !zoomTargetPhoto) zoomTargetPhoto = nearestPhoto(point.x, point.y)
    const closest = fitDistance() / (RADIUS + CLOSEST_ALTITUDE)
    zoomGoal = THREE.MathUtils.clamp(zoomGoal * factor, 0.55, closest)
    if (factor < 1 && zoomGoal < 1.2) zoomTargetPhoto = null
    if (!gliding) { glideAt = performance.now(); gliding = requestAnimationFrame(glide) }
  }
  function glide(now: number) {
    gliding = 0
    if (disposed || enteringScene) return
    const step = 1 - Math.exp(-Math.max(0, now - glideAt) / 90)
    glideAt = now
    const inward = zoomGoal > zoom
    zoom = Math.abs(Math.log(zoomGoal / zoom)) < 0.002 ? zoomGoal : zoom * (zoomGoal / zoom) ** step
    draw()
    if (inward && altitude() <= HANDOFF_ALTITUDE * 1.0001 && callbacks.onZoomIntoMap) {
      enteringScene = true
      zoomGoal = zoom
      callbacks.onZoomIntoMap({ ...centerLngLat(), altitude: altitude() })
      return
    }
    if (zoom !== zoomGoal) gliding = requestAnimationFrame(glide)
  }
  // Zoom set outright (framing, coming back): no glide
  function setZoom(value: number) {
    zoom = zoomGoal = value
    if (gliding) { cancelAnimationFrame(gliding); gliding = 0 }
  }
  const cameraDistance = () => Math.max(RADIUS + CLOSEST_ALTITUDE, fitDistance() / zoom)
  const altitude = () => cameraDistance() - RADIUS
  // The point of the globe facing the camera (WGS-84)
  function centerLngLat() {
    return { ...view }
  }
  function facePlaces(data: LifeMapData) {
    const visible = data.places.filter((place) => place.lng !== undefined && place.lat !== undefined)
    const center = visible.reduce((sum, place) => sum.add(onGlobe(place.lng!, place.lat!, 1)), new THREE.Vector3())
    if (center.lengthSq() < 0.01) center.copy(onGlobe(105, 34, 1))
    const c = center.normalize()
    home = { lng: Math.atan2(-c.z, c.x) / DEG, lat: Math.asin(THREE.MathUtils.clamp(c.y, -1, 1)) / DEG }
    setView(home.lng, home.lat)
    setZoom(1)
    zoomTargetPhoto = null
  }
  function surface(lng: number, lat: number, radius: number): THREE.Vector3 | null {
    return onGlobe(lng, lat, radius)
  }
  function projected(at: THREE.Vector3 | null) {
    if (!at) return { front: false, x: 0, y: 0, z: 1 }
    const world = at.clone().applyMatrix4(globe.matrixWorld)
    const ndc = world.clone().project(camera)
    const x = (ndc.x + 1) * width / 2, y = (1 - ndc.y) * height / 2
    // Facing the camera, and not too far off screen
    const front = world.z > 0.06 && x > -width * 0.25 && x < width * 1.25 && y > -height * 0.25 && y < height * 1.25
    return { front, x, y, z: ndc.z }
  }
  function closeMenu() { menu.hidden = true; menu.replaceChildren() }
  function closePlaceMenu() { placeMenu.hidden = true; placeMenu.replaceChildren() }
  function openPlaceMenu(members: Place[], x: number, y: number) {
    closePlaceMenu()
    const title = document.createElement('strong')
    title.textContent = '选择地点'
    placeMenu.append(title)
    for (const place of members) {
      const item = document.createElement('button')
      item.type = 'button'
      item.textContent = `${cityLabel(place.city)}${place.roleConfirmed ? ` · ${roleLabels[place.role]}` : ''} · ${place.eventIds.length} 件事`
      item.addEventListener('click', () => { closePlaceMenu(); callbacks.onSelectCity(place.city) })
      placeMenu.append(item)
    }
    placeMenu.style.left = `${Math.max(8, Math.min(width - 220, x + 16))}px`
    placeMenu.style.top = `${Math.max(insets.top + 8, Math.min(height - insets.bottom - 54 - members.length * 39, y + 18))}px`
    placeMenu.hidden = false
  }
  function openMenu(members: MapPhoto[], x: number, y: number) {
    closeMenu()
    const heading = document.createElement('div')
    heading.className = 'map-photo-menu-heading'
    const title = document.createElement('strong')
    title.textContent = `这里有 ${members.length} 张照片`
    const close = document.createElement('button')
    close.type = 'button'
    close.textContent = '关闭'
    close.addEventListener('click', closeMenu)
    heading.append(title, close)
    const scenePhoto = members.find(precise)
    if (scenePhoto && callbacks.onFocusPhoto) {
      const enter = document.createElement('button')
      enter.type = 'button'
      enter.className = 'map-photo-menu-enter'
      enter.textContent = '放大到此处场景'
      enter.addEventListener('click', () => { enteringScene = true; callbacks.onFocusPhoto?.(scenePhoto) })
      menu.append(heading, enter)
    } else menu.append(heading)
    const list = document.createElement('div')
    list.className = 'map-photo-menu-list'
    let rendered = 0
    const appendRows = () => {
      list.querySelector('.map-photo-menu-more')?.remove()
      const end = Math.min(members.length, rendered + 36)
      for (let index = rendered; index < end; index++) {
        const photo = members[index]
        const item = document.createElement('button')
        item.type = 'button'
        item.className = 'map-photo-menu-item'
        item.setAttribute('aria-label', `打开照片 ${photo.name}`)
        const img = document.createElement('img')
        img.src = photo.preview
        img.alt = ''
        const name = document.createElement('span')
        name.textContent = photo.name
        const number = document.createElement('small')
        number.textContent = `${index + 1} / ${members.length}`
        item.append(img, name, number)
        item.addEventListener('click', (event) => { event.stopPropagation(); closeMenu(); callbacks.onOpenPhoto?.(photo.id) })
        list.append(item)
      }
      rendered = end
      if (rendered < members.length) {
        const more = document.createElement('button')
        more.type = 'button'
        more.className = 'map-photo-menu-more'
        more.textContent = `继续显示（剩余 ${members.length - rendered} 张）`
        more.addEventListener('click', appendRows)
        list.append(more)
      }
    }
    appendRows()
    menu.append(list)
    menu.style.width = `${Math.min(310, width - 16)}px`
    menu.style.left = `${Math.max(8, Math.min(width - 318, x + 18))}px`
    menu.style.top = `${Math.max(insets.top + 8, Math.min(height - insets.bottom - 220, y - 80))}px`
    menu.hidden = false
  }
  function photoButton(cover: MapPhoto, members: MapPhoto[]) {
    const el = document.createElement('button')
    el.type = 'button'
    el.className = `map-photo globe-photo${members.every((photo) => photo.inferred) ? ' inferred' : ''}`
    const img = document.createElement('img')
    img.src = cover.preview
    img.alt = ''
    el.append(img)
    if (members.length > 1) {
      const badge = document.createElement('b')
      badge.textContent = String(members.length)
      el.append(badge)
      el.setAttribute('aria-label', `这里有 ${members.length} 张照片，点击选择`)
      el.addEventListener('click', (event) => {
        event.stopPropagation()
        const rect = el.getBoundingClientRect()
        const hostRect = host.getBoundingClientRect()
        openMenu(members, rect.left - hostRect.left, rect.top - hostRect.top)
      })
    } else {
      el.setAttribute('aria-label', `打开照片 ${cover.name}`)
      el.addEventListener('click', (event) => { event.stopPropagation(); callbacks.onOpenPhoto?.(cover.id) })
    }
    if (precise(cover) && callbacks.onFocusPhoto) el.addEventListener('dblclick', (event) => {
      event.stopPropagation()
      enteringScene = true
      callbacks.onFocusPhoto?.(cover)
    })
    photoLayer.append(el)
    return el
  }
  function placePhotos() {
    const points = photos.flatMap((photo) => {
      const wgs = gcj02ToWgs84({ lng: photo.gcj[0], lat: photo.gcj[1] })
      const spot = projected(surface(wgs.lng, wgs.lat, RADIUS * 1.05))
      return spot.front && spot.z < 1 ? [{ photo, x: spot.x, y: spot.y }] : []
    })
    const used = new Set<string>()
    const taken: DOMRect[] = []
    for (const { x, y, members } of clusterProjectedPhotos(points)) {
      const cover = members.find((photo) => !photo.inferred) || members[0]
      const key = `${members.map((photo) => photo.id).sort().join('|')}|${cover.id}`
      used.add(key)
      let el = shown.get(key)
      if (!el) { el = photoButton(cover, members); shown.set(key, el) }
      const left = Math.round(Math.max(8, Math.min(width - el.offsetWidth - 8, x - 10)))
      const top = Math.round(Math.max(insets.top + 8, Math.min(height - insets.bottom - el.offsetHeight - 8, y - el.offsetHeight - 12)))
      el.style.transform = `translate(${left}px, ${top}px)`
      taken.push(new DOMRect(left, top, el.offsetWidth + 12, el.offsetHeight + 14))
    }
    for (const [key, el] of shown) if (!used.has(key)) { el.remove(); shown.delete(key) }
    return taken
  }
  function placeGroups() {
    const points = places.flatMap((place) => {
      if (place.lng === undefined || place.lat === undefined) return []
      const spot = projected(surface(place.lng, place.lat, RADIUS * 1.06))
      return spot.front && spot.z < 1 ? [{ place, x: spot.x, y: spot.y }] : []
    })
    const groups: { members: Place[]; x: number; y: number }[] = []
    for (const point of points) {
      const group = groups.find((item) => Math.hypot(item.x - point.x, item.y - point.y) < 94)
      if (group) {
        const count = group.members.length
        group.x = (group.x * count + point.x) / (count + 1)
        group.y = (group.y * count + point.y) / (count + 1)
        group.members.push(point.place)
      } else groups.push({ members: [point.place], x: point.x, y: point.y })
    }
    return groups
  }
  function placeButtonsAround(obstacles: DOMRect[]) {
    const used = new Set<string>()
    const occupied = [...obstacles]
    const heading = container.closest('.stage')?.querySelector<HTMLElement>('.map-heading')
    const bounds = heading?.getBoundingClientRect()
    const own = host.getBoundingClientRect()
    if (bounds) occupied.push(new DOMRect(bounds.left - own.left, bounds.top - own.top, bounds.width, bounds.height))
    for (const group of placeGroups()) {
      const key = group.members.map((place) => place.city).sort().join('|')
      used.add(key)
      let el = placeButtons.get(key)
      if (!el) {
        el = document.createElement('button')
        el.type = 'button'
        el.className = `map-label place ${group.members.length > 1 ? 'globe-cluster' : 'globe-place'}`
        const strong = document.createElement('strong')
        strong.textContent = group.members.length > 1 ? `${group.members.length} 处地点` : cityLabel(group.members[0].city)
        const small = document.createElement('small')
        small.textContent = group.members.length > 1 ? group.members.map((place) => cityLabel(place.city)).join(' · ') : `${group.members[0].eventIds.length} 件事`
        el.append(strong, small)
        el.addEventListener('click', (event) => {
          event.stopPropagation()
          if (group.members.length === 1) callbacks.onSelectCity(group.members[0].city)
          else {
            const rect = el!.getBoundingClientRect()
            const local = host.getBoundingClientRect()
            openPlaceMenu(group.members, rect.left - local.left, rect.top - local.top)
          }
        })
        labelsLayer.append(el)
        placeButtons.set(key, el)
      }
      const w = el.offsetWidth, h = el.offsetHeight
      const candidates = [
        { side: 'above', x: group.x - w / 2, y: group.y - h - 16 },
        { side: 'right', x: group.x + 16, y: group.y - h / 2 },
        { side: 'left', x: group.x - w - 16, y: group.y - h / 2 },
        { side: 'below', x: group.x - w / 2, y: group.y + 16 },
      ].map((item) => {
        const x = Math.max(8, Math.min(width - w - 8, item.x))
        const y = Math.max(insets.top + 8, Math.min(height - insets.bottom - h - 8, item.y))
        const overlap = occupied.reduce((sum, rect) => sum + Math.max(0, Math.min(x + w, rect.right) - Math.max(x, rect.left)) * Math.max(0, Math.min(y + h, rect.bottom) - Math.max(y, rect.top)), 0)
        return { ...item, x, y, overlap }
      }).sort((a, b) => a.overlap - b.overlap)
      const choice = candidates[0]
      el.dataset.side = choice.side
      el.style.transform = `translate(${Math.round(choice.x)}px, ${Math.round(choice.y)}px)`
      occupied.push(new DOMRect(choice.x, choice.y, w, h))
    }
    for (const [key, el] of placeButtons) if (!used.has(key)) { el.remove(); placeButtons.delete(key) }
  }
  function draw() {
    if (disposed) return
    camera.position.z = cameraDistance()
    camera.updateMatrixWorld()
    globe.position.y = (insets.bottom - insets.top) / height * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    globe.updateMatrixWorld(true)
    host.dataset.zoom = zoom.toFixed(3)
    host.dataset.altitude = altitude().toFixed(3)
    const center = centerLngLat()
    host.dataset.center = `${center.lng.toFixed(2)},${center.lat.toFixed(2)}`
    host.dataset.orientation = globe.quaternion.toArray().map((value) => value.toFixed(3)).join(',')
    const approach = approachAt(altitude())
    for (const dot of dots.children) {
      const at = surface(dot.userData.lng, dot.userData.lat, RADIUS * 1.012)
      dot.visible = Boolean(at)
      if (at) dot.position.copy(at)
    }
    host.dataset.approach = approach.toFixed(3)
    // The globe's own controls go as the street map comes through
    controls.style.opacity = credit.style.opacity = approach > 0 ? String(1 - approach) : ''
    updateDetail()
    host.dataset.detail = detail?.mesh.visible ? 'on' : 'off'
    renderer.render(scene, camera)
    if (!enteringScene) callbacks.onApproachMap?.({ ...center, altitude: altitude(), fade: fadeAt(altitude()) })
    const taken = placePhotos()
    placeButtonsAround([new DOMRect(0, 0, width, insets.top), new DOMRect(0, height - insets.bottom, width, insets.bottom), ...taken])
  }
  function resize() {
    width = Math.max(1, container.clientWidth)
    height = Math.max(1, container.clientHeight)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
    drawStars()
    draw()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(container)

  const pointers = new Map<number, { x: number; y: number }>()
  let pinch = 0
  canvas.addEventListener('pointerdown', (event) => {
    closeMenu()
    closePlaceMenu()
    canvas.setPointerCapture(event.pointerId)
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      pinch = Math.hypot(a.x - b.x, a.y - b.y)
    }
  })
  canvas.addEventListener('pointermove', (event) => {
    const previous = pointers.get(event.pointerId)
    if (!previous) return
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      const next = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinch > 0) zoomBy(next / pinch, { x: (a.x + b.x) / 2 - host.getBoundingClientRect().left, y: (a.y + b.y) / 2 - host.getBoundingClientRect().top })
      pinch = next
      return
    }
    const dx = event.clientX - previous.x
    const dy = event.clientY - previous.y
    zoomTargetPhoto = null
    const step = degreesPerPixel()
    setView(view.lng - dx * step / Math.max(0.2, Math.cos(view.lat * DEG)), view.lat + dy * step)
    draw()
  })
  const release = (event: PointerEvent) => { pointers.delete(event.pointerId); pinch = 0 }
  canvas.addEventListener('pointerup', release)
  canvas.addEventListener('pointercancel', release)
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault()
    const rect = canvas.getBoundingClientRect()
    zoomBy(Math.exp(-event.deltaY * 0.0012), { x: event.clientX - rect.left, y: event.clientY - rect.top })
  }, { passive: false })
  canvas.addEventListener('keydown', (event) => {
    const step = degreesPerPixel() * 60
    let moved = true
    if (event.key === 'ArrowLeft') setView(view.lng - step, view.lat)
    else if (event.key === 'ArrowRight') setView(view.lng + step, view.lat)
    else if (event.key === 'ArrowUp') setView(view.lng, view.lat + step)
    else if (event.key === 'ArrowDown') setView(view.lng, view.lat - step)
    else if (event.key === '+' || event.key === '=') { zoomBy(1.2); moved = false }
    else if (event.key === '-') { zoomBy(1 / 1.2); moved = false }
    else return
    event.preventDefault()
    if (moved) draw()
  })
  const button = (name: string, label: string, action: () => void) => {
    const el = document.createElement('button')
    el.type = 'button'
    el.textContent = label
    el.setAttribute('aria-label', name)
    el.title = name
    el.addEventListener('click', action)
    controls.append(el)
  }
  button('放大地球', '+', () => zoomBy(1.25))
  button('缩小地球', '−', () => zoomBy(0.8))
  button('回到照片区域', '◎', () => { setView(home.lng, home.lat); setZoom(1); zoomTargetPhoto = null; draw() })
  const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { closeMenu(); closePlaceMenu() } }
  window.addEventListener('keydown', onEscape)

  // Start facing China (with photos, facePlaces turns to them)
  setView(view.lng, view.lat)
  resize()
  return {
    update(data: LifeMapData) {
      const signature = data.places.map((place) => `${place.city}:${place.lng}:${place.lat}`).join('|')
      if (signature !== placeSignature) { placeSignature = signature; facePlaces(data) }
      dots.clear()
      labelsLayer.replaceChildren()
      placeButtons.clear()
      places = data.places
      host.dataset.placeCount = String(places.length)
      host.dataset.placeNames = places.map((place) => cityLabel(place.city)).join('|')
      for (const place of data.places) {
        if (place.lng === undefined || place.lat === undefined) continue
        const dot = new THREE.Mesh(dotGeometry, dotMaterial)
        dot.userData = { lng: place.lng, lat: place.lat }
        dots.add(dot)
      }
      photos = data.photos || []
      // The close-up data (~4.5 MB) is wanted the moment someone zooms in: start it now, quietly
      if (places.length && !earthData) window.setTimeout(() => { if (!disposed) void loadEarthData() }, 4000)
      draw()
    },
    setInsets(next: typeof insets) { insets = next; draw() },
    // Coming back from the street map: face the same point from the same height
    showAround(lng: number, lat: number, height: number) {
      enteringScene = false
      zoomTargetPhoto = null
      closeMenu()
      closePlaceMenu()
      setView(lng, lat)
      setZoom(THREE.MathUtils.clamp(fitDistance() / (RADIUS + Math.max(height, CLOSEST_ALTITUDE)), 0.55, fitDistance() / (RADIUS + CLOSEST_ALTITUDE)))
      draw()
    },
    // Shown again without a hand-over (e.g. "返回地球"): back above the approach, so it can be zoomed in again
    resume() {
      enteringScene = false
      if (altitude() < APPROACH_FROM) setZoom(fitDistance() / (RADIUS + APPROACH_FROM))
      draw()
    },
    dispose() {
      disposed = true
      if (gliding) cancelAnimationFrame(gliding)
      observer.disconnect()
      window.removeEventListener('keydown', onEscape)
      shown.clear()
      placeButtons.clear()
      cancelAnimationFrame(skyFrame)
      disposeDetail()
      texture?.dispose()
      sphereGeometry.dispose()
      sphereMaterial.dispose()
      dotGeometry.dispose()
      dotMaterial.dispose()
      renderer.dispose()
      host.remove()
    },
  }
}

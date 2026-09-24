import * as THREE from 'three'
import { MapControls } from 'three/examples/jsm/controls/MapControls.js'
import type { MemoryEvent, Place, PlaceRole } from '../types'
import { wgs84ToGcj02 } from '../lib/geo'
import { cityLabel, formatYearMonth, roleLabels } from '../lib/memory'

// Life map rendered as a cartoon diorama. Places sit at their real (projected) positions;
// a selected city's story line is laid out schematically around it, keeping each event's
// real direction from the city centre.

export interface LifeMapData {
  places: Place[]
  bases: Place[]
  story: MemoryEvent[]
  selectedCity: string | null
  highlightedEventId: string | null
}

export interface LifeMapCallbacks {
  onSelectCity: (city: string | null) => void
  onOpenEvent: (id: string) => void
}

const LAND = 0.45
const PY = LAND + 0.34
const SPAN = 18 // scene units covered by the bases' bounding box
const MIN_GAP = 3.2 // places closer than this are pushed apart

const roleColors: Record<PlaceRole, number> = {
  home: 0xf5b98b,
  study: 0x8fb8ea,
  work: 0x8fd3a8,
  residence: 0xc9b8ea,
  travel: 0xffc98a,
}

const tones = new Uint8Array([110, 185, 255])
const gradient = new THREE.DataTexture(tones, 3, 1, THREE.RedFormat)
gradient.minFilter = gradient.magFilter = THREE.NearestFilter
gradient.needsUpdate = true

const toon = (color: number) => new THREE.MeshToonMaterial({ color, gradientMap: gradient })
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d)

function mercator(lat: number, lng: number) {
  const gcj = wgs84ToGcj02({ lat, lng })
  const x = (gcj.lng * Math.PI) / 180
  const y = Math.log(Math.tan(Math.PI / 4 + (gcj.lat * Math.PI) / 360))
  return new THREE.Vector2(x, -y) // north is -z so the camera looks north
}

function seeded(seed: number) {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

interface AddOptions { outline?: boolean; shadow?: boolean; rot?: [number, number, number]; scale?: [number, number, number]; outlineScale?: number }

function adder(parent: THREE.Object3D) {
  return (geo: THREE.BufferGeometry, color: number, pos: [number, number, number], opts: AddOptions = {}) => {
    const { outline = true, shadow = true, rot, scale, outlineScale = 1.06 } = opts
    const mesh = new THREE.Mesh(geo, toon(color))
    mesh.position.set(...pos)
    if (rot) mesh.rotation.set(...rot)
    if (scale) mesh.scale.set(...scale)
    mesh.castShadow = shadow
    mesh.receiveShadow = true
    if (outline) {
      const line = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x3a3548, side: THREE.BackSide }))
      line.scale.setScalar(outlineScale)
      line.userData.outline = true
      mesh.add(line)
    }
    parent.add(mesh)
    return mesh
  }
}

function tree(add: ReturnType<typeof adder>, x: number, z: number, s: number, rnd: () => number) {
  add(new THREE.CylinderGeometry(0.05 * s, 0.07 * s, 0.3 * s, 6), 0x9a6b4f, [x, LAND + 0.15 * s, z], { outline: false })
  add(new THREE.ConeGeometry(0.28 * s, 0.75 * s, 7), rnd() > 0.5 ? 0x6fbf73 : 0x82c97d, [x, LAND + 0.62 * s, z])
}

function platform(add: ReturnType<typeof adder>, r: number, rim: number) {
  add(new THREE.CylinderGeometry(r, r * 1.05, 0.28, 48), rim, [0, LAND + 0.14, 0], { outlineScale: 1.04 })
  add(new THREE.CylinderGeometry(r * 0.86, r * 0.86, 0.04, 48), 0xfffaf0, [0, PY - 0.01, 0], { outline: false })
}

// One small building per life-base role; returns the height used for the label
function building(group: THREE.Group, role: PlaceRole, rnd: () => number): number {
  const add = adder(group)
  if (role === 'travel') {
    add(new THREE.CylinderGeometry(0.34, 0.36, 0.1, 28), 0xffffff, [0, LAND + 0.05, 0], { outlineScale: 1.05 })
    add(new THREE.CylinderGeometry(0.025, 0.025, 1.1, 6), 0x6a6a72, [0, LAND + 0.6, 0], { outline: false })
    const tri = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.5, -0.16), new THREE.Vector2(0, -0.34)])
    add(new THREE.ExtrudeGeometry(tri, { depth: 0.03, bevelEnabled: false }), 0xff8a65, [0.02, LAND + 1.12, 0], { outline: false })
    return LAND + 1.25
  }
  platform(add, 1.3, roleColors[role])
  if (role === 'home') {
    add(box(1.0, 0.72, 0.85), 0xfff1d6, [0.15, PY + 0.36, 0])
    add(new THREE.ConeGeometry(0.84, 0.6, 4), 0xe86f55, [0.15, PY + 1.02, 0], { rot: [0, Math.PI / 4, 0] })
    add(box(0.15, 0.32, 0.15), 0xc9624f, [0.42, PY + 1.12, -0.12])
    add(box(0.22, 0.38, 0.02), 0x8a5a44, [0.15, PY + 0.19, 0.43], { outline: false })
    for (const x of [-0.18, 0.48]) add(box(0.2, 0.18, 0.02), 0xbfe3f5, [x, PY + 0.44, 0.43], { outline: false })
    tree(add, -0.75, 0.2, 1.0, rnd)
    return PY + 1.6
  }
  if (role === 'study') {
    add(box(1.7, 0.8, 0.8), 0xf6e7c8, [0, PY + 0.4, 0.15])
    add(box(1.8, 0.12, 0.9), 0x5d8fd6, [0, PY + 0.86, 0.15])
    add(box(0.5, 1.7, 0.5), 0xf6e7c8, [0, PY + 0.85, -0.05])
    add(new THREE.ConeGeometry(0.42, 0.5, 4), 0x5d8fd6, [0, PY + 1.95, -0.05], { rot: [0, Math.PI / 4, 0] })
    add(new THREE.CylinderGeometry(0.16, 0.16, 0.04, 24), 0xffffff, [0, PY + 1.35, 0.21], { rot: [Math.PI / 2, 0, 0] })
    for (const x of [-0.65, -0.4, 0.4, 0.65]) add(box(0.17, 0.2, 0.02), 0xbfe3f5, [x, PY + 0.45, 0.56], { outline: false })
    return PY + 2.4
  }
  if (role === 'work') {
    for (const [dx, dz, w, h, c] of [[-0.35, 0.3, 0.55, 2.0, 0xbfd7f2], [0.3, -0.3, 0.66, 2.8, 0xd9d2f2], [0.75, 0.45, 0.5, 1.4, 0xf2ede4]] as const) {
      add(box(w, h, w), c, [dx, PY + h / 2, dz])
      add(box(w * 0.7, 0.14, w * 0.7), 0x8c95b8, [dx, PY + h + 0.07, dz])
      for (let y = 0.35; y < h - 0.2; y += 0.32) add(box(w * 0.78, 0.07, 0.01), 0x9fc3e6, [dx, PY + y, dz + w / 2 + 0.006], { outline: false, shadow: false })
    }
    return PY + 3.2
  }
  // residence: a pair of apartment blocks
  for (const [dx, h, c] of [[-0.35, 1.3, 0xf3e3f0], [0.4, 1.0, 0xe6ddf6]] as const) {
    add(box(0.62, h, 0.7), c, [dx, PY + h / 2, 0])
    add(new THREE.ConeGeometry(0.52, 0.34, 4), 0x9b86c9, [dx, PY + h + 0.17, 0], { rot: [0, Math.PI / 4, 0] })
    for (let y = 0.3; y < h - 0.1; y += 0.3) add(box(0.4, 0.1, 0.01), 0xbfe3f5, [dx, PY + y, 0.356], { outline: false, shadow: false })
  }
  return PY + 1.9
}

function tube(points: THREE.Vector3[], radius: number, color: number) {
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), Math.max(24, points.length * 4), radius, 10), toon(color))
  mesh.castShadow = true
  return mesh
}

function arrowHead(curve: THREE.Curve<THREE.Vector3>, at: number, radius: number, color: number) {
  const cone = new THREE.Mesh(new THREE.ConeGeometry(radius * 2.8, radius * 6, 16), toon(color))
  cone.position.copy(curve.getPointAt(at))
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangentAt(at).normalize())
  return cone
}

function dim(object: THREE.Object3D, amount: number) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.material) return
    const material = mesh.material as THREE.Material
    material.transparent = amount < 1
    material.opacity = amount
    material.depthWrite = amount >= 1
  })
}

interface Label { el: HTMLElement; anchor: THREE.Vector3 }

export function createLifeMap(container: HTMLElement, callbacks: LifeMapCallbacks) {
  const canvas = document.createElement('canvas')
  canvas.className = 'life-map-canvas'
  const labelLayer = document.createElement('div')
  labelLayer.className = 'life-map-labels'
  container.append(canvas, labelLayer)

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(33, 1, 0.1, 400)
  const controls = new MapControls(camera, canvas)
  controls.enableDamping = false
  controls.maxPolarAngle = Math.PI * 0.42
  controls.minDistance = 5
  controls.maxDistance = 90
  controls.addEventListener('change', () => render())

  scene.add(new THREE.HemisphereLight(0xffffff, 0xd7e8c8, 1.4))
  const sun = new THREE.DirectionalLight(0xffffff, 2.0)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.bias = -0.0006
  scene.add(sun, sun.target)

  const world = new THREE.Group()
  scene.add(world)

  let labels: Label[] = []
  let insets = { right: 0, bottom: 0 }
  let size = { w: 1, h: 1 }
  let positions = new Map<string, THREE.Vector3>()
  let lastSelected: string | null | undefined
  let lastSignature = ''
  let flight: number | null = null
  const raycaster = new THREE.Raycaster()
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  function label(className: string, anchor: THREE.Vector3, build: (el: HTMLElement) => void, onClick?: () => void) {
    const el = document.createElement(onClick ? 'button' : 'div')
    el.className = `map-label ${className}`
    build(el)
    if (onClick) el.addEventListener('click', (event) => { event.stopPropagation(); onClick() })
    labelLayer.append(el)
    labels.push({ el, anchor })
  }

  const line = (el: HTMLElement, tag: string, text: string, className = '') => {
    const child = document.createElement(tag)
    if (className) child.className = className
    child.textContent = text
    el.append(child)
    return child
  }

  function placeLayout(places: Place[]) {
    const raw = new Map(places.filter((p) => p.lat !== undefined && p.lng !== undefined).map((p) => [p.city, mercator(p.lat!, p.lng!)]))
    const pts = [...raw.values()]
    if (!pts.length) return new Map<string, THREE.Vector3>()
    const min = pts.reduce((a, p) => new THREE.Vector2(Math.min(a.x, p.x), Math.min(a.y, p.y)), pts[0].clone())
    const max = pts.reduce((a, p) => new THREE.Vector2(Math.max(a.x, p.x), Math.max(a.y, p.y)), pts[0].clone())
    const center = min.clone().add(max).multiplyScalar(0.5)
    const extent = Math.max(max.x - min.x, max.y - min.y, 1e-6)
    const scale = SPAN / extent
    const out = new Map([...raw].map(([city, p]) => [city, new THREE.Vector3((p.x - center.x) * scale, 0, (p.y - center.y) * scale)]))
    // Push apart places that would overlap
    const list = [...out.values()]
    for (let pass = 0; pass < 40; pass++) {
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const d = list[j].clone().sub(list[i])
        const len = d.length()
        if (len >= MIN_GAP) continue
        const push = (d.lengthSq() ? d.normalize() : new THREE.Vector3(1, 0, 0.3).normalize()).multiplyScalar((MIN_GAP - len) / 2)
        list[i].sub(push)
        list[j].add(push)
      }
    }
    return out
  }

  // Story nodes keep their real bearing from the city centre, on a ring around the platform
  function storyLayout(city: string, story: MemoryEvent[], cityPos: THREE.Vector3) {
    const place = placesCache.find((p) => p.city === city)
    const origin = place?.lat !== undefined ? mercator(place.lat, place.lng!) : null
    const nodes = story.map((event, index) => {
      let angle = -Math.PI / 2 + (index / Math.max(1, story.length)) * Math.PI * 2
      let radius = 3.2
      if (event.city !== city) {
        const target = positions.get(event.city || '')
        if (target) angle = Math.atan2(target.z - cityPos.z, target.x - cityPos.x)
        radius = 5.2
      } else if (origin && event.lat !== undefined && event.lng !== undefined) {
        const p = mercator(event.lat, event.lng!).sub(origin)
        if (p.lengthSq() > 1e-14) {
          angle = Math.atan2(p.y, p.x)
          radius = 3.0 + Math.min(1, p.length() / 0.004) * 1.2
        }
      }
      return { event, angle, radius }
    })
    // Keep neighbouring labels from colliding
    const sorted = [...nodes].sort((a, b) => a.angle - b.angle)
    for (let pass = 0; pass < 30; pass++) {
      for (let i = 0; i < sorted.length; i++) {
        const a = sorted[i]
        const b = sorted[(i + 1) % sorted.length]
        if (a === b) continue
        let gap = b.angle - a.angle
        if (i === sorted.length - 1) gap += Math.PI * 2
        const need = 0.5
        if (gap < need && Math.abs(a.radius - b.radius) < 1.2) { a.angle -= (need - gap) / 2; b.angle += (need - gap) / 2 }
      }
    }
    return nodes.map(({ event, angle, radius }) => ({ event, angle, radius, pos: new THREE.Vector3(cityPos.x + Math.cos(angle) * radius, LAND + 0.1, cityPos.z + Math.sin(angle) * radius) }))
  }

  let placesCache: Place[] = []

  function build(data: LifeMapData) {
    world.traverse((child) => {
      const mesh = child as THREE.Mesh
      mesh.geometry?.dispose()
      const material = mesh.material as THREE.Material | undefined
      material?.dispose()
    })
    world.clear()
    labelLayer.replaceChildren()
    labels = []
    focusPoints = []
    placesCache = data.places
    positions = placeLayout(data.places)
    const add = adder(world)
    const rnd = seeded(7)

    // Ground: a soft board under every place
    const pts = [...positions.values()]
    const minX = Math.min(-6, ...pts.map((p) => p.x)) - 7
    const maxX = Math.max(6, ...pts.map((p) => p.x)) + 7
    const minZ = Math.min(-5, ...pts.map((p) => p.z)) - 6
    const maxZ = Math.max(5, ...pts.map((p) => p.z)) + 6
    const w = maxX - minX
    const d = maxZ - minZ
    const shape = new THREE.Shape()
    const r = 3
    shape.moveTo(minX + r, minZ)
    shape.lineTo(maxX - r, minZ); shape.quadraticCurveTo(maxX, minZ, maxX, minZ + r)
    shape.lineTo(maxX, maxZ - r); shape.quadraticCurveTo(maxX, maxZ, maxX - r, maxZ)
    shape.lineTo(minX + r, maxZ); shape.quadraticCurveTo(minX, maxZ, minX, maxZ - r)
    shape.lineTo(minX, minZ + r); shape.quadraticCurveTo(minX, minZ, minX + r, minZ)
    const ground = new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.14, bevelSegments: 3 })
    ground.rotateX(Math.PI / 2)
    ground.translate(0, LAND - 0.02, 0)
    const groundMesh = add(ground, 0xe9f0cb, [0, 0, 0], { outline: false, shadow: false })
    groundMesh.userData.ground = true
    add(new THREE.PlaneGeometry(400, 400), 0x9fd5ea, [0, 0, 0], { rot: [-Math.PI / 2, 0, 0], outline: false, shadow: false })

    // Decoration stays clear of places and is seeded, so it never moves between renders
    for (let i = 0; i < Math.round((w * d) / 14); i++) {
      const x = minX + 1.5 + rnd() * (w - 3)
      const z = minZ + 1.5 + rnd() * (d - 3)
      if (pts.some((p) => Math.hypot(p.x - x, p.z - z) < 2.8)) continue
      if (rnd() < 0.12) add(new THREE.SphereGeometry(0.8 + rnd() * 0.7, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0xbcdca3, [x, LAND, z], { scale: [1, 0.72, 1] })
      else tree(add, x, z, 0.75 + rnd() * 0.45, rnd)
    }

    const selected = data.selectedCity
    const tops = new Map<string, number>()
    for (const place of data.places) {
      const pos = positions.get(place.city)
      if (!pos) continue
      const group = new THREE.Group()
      group.position.copy(pos)
      const s = place.isBase ? 0.85 + Math.min(0.45, place.eventIds.length * 0.03) : 1
      group.scale.setScalar(s)
      const top = building(group, place.role, rnd) * s
      group.traverse((child) => { child.userData.city = place.city })
      if (selected && selected !== place.city) dim(group, 0.35)
      world.add(group)
      tops.set(place.city, top)
      if (selected === place.city) {
        add(new THREE.TorusGeometry(1.75 * s, 0.05, 8, 64), 0x2fae76, [pos.x, LAND + 0.05, pos.z], { rot: [-Math.PI / 2, 0, 0], outline: false, shadow: false })
      }
    }

    // Space line: arcs between life bases in the order the person moved
    for (let i = 1; i < data.bases.length; i++) {
      const a = positions.get(data.bases[i - 1].city)
      const b = positions.get(data.bases[i].city)
      if (!a || !b) continue
      const A = new THREE.Vector3(a.x, PY + 0.25, a.z)
      const B = new THREE.Vector3(b.x, PY + 0.25, b.z)
      const mid = A.clone().add(B).multiplyScalar(0.5)
      mid.y += 1.2 + A.distanceTo(B) * 0.18
      const curve = new THREE.QuadraticBezierCurve3(A, mid, B)
      const points = Array.from({ length: 40 }, (_, k) => curve.getPointAt(0.08 + 0.8 * (k / 39)))
      const arc = new THREE.Group()
      arc.add(tube(points, 0.08, 0x2fae76), arrowHead(curve, 0.9, 0.08, 0x2fae76))
      if (selected) dim(arc, 0.45)
      world.add(arc)
    }

    for (const place of data.places) {
      const pos = positions.get(place.city)
      if (!pos) continue
      const isSelected = selected === place.city
      // While a city is open, trips from it appear on its story line instead
      if (selected && !isSelected && !place.isBase) continue
      const anchor = new THREE.Vector3(pos.x, (tops.get(place.city) || PY) + 0.2, pos.z)
      if (!selected || isSelected) focusPoints.push(anchor, pos.clone().setY(LAND))
      label(`place${place.isBase ? '' : ' small'}${isSelected ? ' selected' : ''}${selected && !isSelected ? ' faded' : ''}${place.roleConfirmed || !place.isBase ? '' : ' unsure'}`, anchor, (el) => {
        line(el, 'strong', `${cityLabel(place.city)}${place.isBase || place.roleConfirmed ? ` · ${place.roleConfirmed || place.role !== 'residence' ? roleLabels[place.role] : '生活过'}` : ''}`)
        line(el, 'small', `${formatYearMonth(place.firstAt)}${place.firstAt.slice(0, 7) !== place.lastAt.slice(0, 7) ? ` – ${formatYearMonth(place.lastAt)}` : ''} · ${place.eventIds.length} 件事`)
      }, () => callbacks.onSelectCity(place.city))
    }

    // Story line of the selected city
    const cityPos = selected ? positions.get(selected) : undefined
    if (selected && cityPos && data.story.length) {
      const nodes = storyLayout(selected, data.story, cityPos)
      if (nodes.length > 1) {
        const route: THREE.Vector3[] = [nodes[0].pos]
        for (let i = 1; i < nodes.length; i++) {
          const a = nodes[i - 1]
          const b = nodes[i]
          let delta = b.angle - a.angle
          while (delta > Math.PI) delta -= Math.PI * 2
          while (delta < -Math.PI) delta += Math.PI * 2
          const steps = Math.max(2, Math.ceil(Math.abs(delta) / 0.25))
          for (let k = 1; k <= steps; k++) {
            const t = k / steps
            const angle = a.angle + delta * t
            const radius = a.radius + (b.radius - a.radius) * t
            route.push(new THREE.Vector3(cityPos.x + Math.cos(angle) * radius, LAND + 0.1, cityPos.z + Math.sin(angle) * radius))
          }
        }
        const curve = new THREE.CatmullRomCurve3(route, false, 'centripetal')
        world.add(tube(curve.getSpacedPoints(Math.max(60, nodes.length * 30)), 0.07, 0xf08a24))
        const chevrons = Math.max(6, nodes.length * 3)
        for (let i = 1; i < chevrons; i++) {
          const u = i / chevrons
          const c = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 3), toon(0xffffff))
          c.position.copy(curve.getPointAt(u)).setY(LAND + 0.19)
          c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangentAt(u).normalize())
          world.add(c)
        }
      }
      for (const { event, pos } of nodes) {
        const now = event.id === data.highlightedEventId
        const unsure = event.citySource === 'ai'
        const disc = adder(world)
        const base = disc(new THREE.CylinderGeometry(now ? 0.36 : 0.26, now ? 0.38 : 0.28, 0.18, 32), 0xffffff, [pos.x, LAND + 0.1, pos.z], { outlineScale: 1.05 })
        disc(new THREE.CylinderGeometry(now ? 0.24 : 0.16, now ? 0.24 : 0.16, 0.06, 32), unsure ? 0xf0a14a : 0xf08a24, [pos.x, LAND + 0.21, pos.z], { outline: false })
        base.traverse((child) => { child.userData.eventId = event.id })
        if (now) disc(new THREE.TorusGeometry(0.6, 0.05, 8, 48), 0xf08a24, [pos.x, LAND + 0.06, pos.z], { rot: [-Math.PI / 2, 0, 0], outline: false, shadow: false })
        if (unsure) {
          for (let i = 0; i < 16; i++) {
            const a = (i / 16) * Math.PI * 2
            disc(box(0.14, 0.03, 0.05), 0xf0a14a, [pos.x + Math.cos(a) * 0.5, LAND + 0.03, pos.z + Math.sin(a) * 0.5], { rot: [0, -a + Math.PI / 2, 0], outline: false, shadow: false })
          }
        }
        focusPoints.push(pos.clone(), new THREE.Vector3(pos.x, LAND + 0.5, pos.z))
        label(`event${now ? ' now' : ''}${unsure ? ' unsure' : ''}${event.status === 'draft' ? ' draft' : ''}`, new THREE.Vector3(pos.x, LAND + 0.5, pos.z), (el) => {
          line(el, 'time', formatYearMonth(event.occurredAt))
          line(el, 'strong', event.title)
          el.dataset.eventId = event.id
        }, () => callbacks.onOpenEvent(event.id))
      }
    }

    // Light and shadows follow the content
    const center = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2)
    sun.position.set(center.x - 8, 26, center.z + 12)
    sun.target.position.copy(center)
    const half = Math.max(w, d) / 2 + 4
    Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, far: 90 })
    sun.shadow.camera.updateProjectionMatrix()
  }

  let focusPoints: THREE.Vector3[] = []

  // Smallest camera distance at which every focus point (label anchors included) lands
  // inside the area not covered by the heading, the time bar and the butler panel
  function fitDistance(target: THREE.Vector3, dir: THREE.Vector3, points: THREE.Vector3[], start: number) {
    const { w, h } = size
    const safe = { left: 90, right: w - insets.right - 90, top: 70, bottom: h - insets.bottom - 16 }
    camera.aspect = w / h
    camera.setViewOffset(w, h, insets.right / 2, insets.bottom / 2, w, h)
    camera.updateProjectionMatrix()
    const v = new THREE.Vector3()
    let d = start
    for (let i = 0; i < 40; i++, d *= 1.1) {
      camera.position.copy(target).addScaledVector(dir, d)
      camera.lookAt(target)
      camera.updateMatrixWorld()
      const fits = points.every((p) => {
        v.copy(p).project(camera)
        const x = ((v.x + 1) / 2) * w
        const y = ((1 - v.y) / 2) * h
        return x >= safe.left && x <= safe.right && y >= safe.top && y <= safe.bottom
      })
      if (fits) break
    }
    return d
  }

  function viewFor(selected: string | null) {
    const pos = selected ? positions.get(selected) : undefined
    const dir = new THREE.Vector3(0, selected ? 0.8 : 0.78, selected ? 0.6 : 0.63).normalize()
    if (pos) {
      const target = pos.clone()
      return { target, dir, dist: fitDistance(target, dir, focusPoints.length ? focusPoints : [pos], 8) }
    }
    const pts = [...positions.values()]
    const target = pts.length ? pts.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length) : new THREE.Vector3()
    return { target, dir, dist: fitDistance(target, dir, focusPoints.length ? focusPoints : [target], 10) }
  }

  function flyTo(selected: string | null, instant: boolean) {
    const saved = { position: camera.position.clone(), target: controls.target.clone() }
    const { target, dir, dist } = viewFor(selected)
    camera.position.copy(saved.position)
    const toPos = target.clone().addScaledVector(dir, dist)
    if (flight) cancelAnimationFrame(flight)
    if (instant || reduceMotion) {
      controls.target.copy(target)
      camera.position.copy(toPos)
      controls.update()
      render()
      return
    }
    const fromPos = camera.position.clone()
    const fromTarget = controls.target.clone()
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 750)
      const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
      camera.position.lerpVectors(fromPos, toPos, e)
      controls.target.lerpVectors(fromTarget, target, e)
      controls.update()
      render()
      flight = t < 1 ? requestAnimationFrame(step) : null
    }
    flight = requestAnimationFrame(step)
  }

  function render() {
    const { w, h } = size
    camera.aspect = w / h
    // Keep the subject centred in the area not covered by panels
    camera.setViewOffset(w, h, insets.right / 2, insets.bottom / 2, w, h)
    camera.updateProjectionMatrix()
    renderer.render(scene, camera)
    const v = new THREE.Vector3()
    for (const { el, anchor } of labels) {
      v.copy(anchor).project(camera)
      const hidden = v.z > 1
      el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%)`
      el.style.visibility = hidden ? 'hidden' : 'visible'
    }
  }

  function resize() {
    size = { w: Math.max(1, container.clientWidth), h: Math.max(1, container.clientHeight) }
    renderer.setSize(size.w, size.h, false)
    render()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(container)

  // Click on a building or story node (labels handle their own clicks)
  let down: { x: number; y: number } | null = null
  canvas.addEventListener('pointerdown', (event) => { down = { x: event.clientX, y: event.clientY } })
  canvas.addEventListener('pointerup', (event) => {
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return
    const rect = canvas.getBoundingClientRect()
    const pointer = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(pointer, camera)
    const hit = raycaster.intersectObjects(world.children, true).find((h) => h.object.userData.eventId || h.object.userData.city || h.object.userData.ground)
    if (hit?.object.userData.eventId) callbacks.onOpenEvent(hit.object.userData.eventId)
    else if (hit?.object.userData.city) callbacks.onSelectCity(hit.object.userData.city)
    else callbacks.onSelectCity(null)
  })

  return {
    update(data: LifeMapData) {
      build(data)
      // Re-frame when the selection or the framed content changes, not on highlight
      const signature = `${data.selectedCity}|${data.places.map((p) => p.city).join()}|${data.story.map((e) => e.id).join()}`
      if (signature !== lastSignature) {
        flyTo(data.selectedCity, lastSelected === undefined || (!lastSignature.includes('|') && !data.places.length))
        lastSelected = data.selectedCity
        lastSignature = signature
      } else render()
    },
    setInsets(next: { right: number; bottom: number }) {
      if (next.right === insets.right && next.bottom === insets.bottom) return
      insets = next
      if (lastSelected === undefined) render()
      else flyTo(lastSelected, false)
    },
    resetView() {
      flyTo(lastSelected ?? null, false)
    },
    dispose() {
      if (flight) cancelAnimationFrame(flight)
      observer.disconnect()
      controls.dispose()
      renderer.dispose()
      canvas.remove()
      labelLayer.remove()
    },
  }
}

export type LifeMap = ReturnType<typeof createLifeMap>

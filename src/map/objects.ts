// Cartoon objects shared by the offline board and the AMap overlay.
import * as THREE from 'three'
import type { MemoryEvent, Place, PlaceRole } from '../types'
import { cityLabel, formatYearMonth, roleLabels } from '../lib/memory'
import { cityStamp } from './cityStamp'

export const LAND = 0.45
export const PY = LAND + 0.34

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

export const toon = (color: number) => new THREE.MeshToonMaterial({ color, gradientMap: gradient })
export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d)

export function seeded(seed: number) {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

interface AddOptions { outline?: boolean; shadow?: boolean; rot?: [number, number, number]; scale?: [number, number, number]; outlineScale?: number }

export function adder(parent: THREE.Object3D) {
  return (geo: THREE.BufferGeometry, color: number, pos: [number, number, number], opts: AddOptions = {}) => {
    const { outline = true, shadow = true, rot, scale, outlineScale = 1.06 } = opts
    const mesh = new THREE.Mesh(geo, toon(color))
    mesh.position.set(...pos)
    if (rot) mesh.rotation.set(...rot)
    if (scale) mesh.scale.set(...scale)
    mesh.castShadow = shadow
    mesh.receiveShadow = true
    if (outline) {
      // Drawn first and without depth: seen from far away the shell sits a few metres from the
      // model, too close for the depth buffer, and would otherwise cover it in the outline colour
      const line = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x3a3548, side: THREE.BackSide, depthWrite: false }))
      line.scale.setScalar(outlineScale)
      line.renderOrder = -1
      line.userData.outline = true
      mesh.add(line)
    }
    parent.add(mesh)
    return mesh
  }
}

export function tree(add: ReturnType<typeof adder>, x: number, z: number, s: number, rnd: () => number) {
  add(new THREE.CylinderGeometry(0.05 * s, 0.07 * s, 0.3 * s, 6), 0x9a6b4f, [x, LAND + 0.15 * s, z], { outline: false })
  add(new THREE.ConeGeometry(0.28 * s, 0.75 * s, 7), rnd() > 0.5 ? 0x6fbf73 : 0x82c97d, [x, LAND + 0.62 * s, z])
}

export function platform(add: ReturnType<typeof adder>, r: number, rim: number) {
  add(new THREE.CylinderGeometry(r, r * 1.05, 0.28, 48), rim, [0, LAND + 0.14, 0], { outlineScale: 1.04 })
  add(new THREE.CylinderGeometry(r * 0.86, r * 0.86, 0.04, 48), 0xfffaf0, [0, PY - 0.01, 0], { outline: false })
}

// One small building per life-base role; returns the height used for the label
export function building(group: THREE.Group, role: PlaceRole, rnd: () => number): number {
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

export function tube(points: THREE.Vector3[], radius: number, color: number) {
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), Math.max(24, points.length * 4), radius, 10), toon(color))
  mesh.castShadow = true
  return mesh
}

export function arrowHead(curve: THREE.Curve<THREE.Vector3>, at: number, radius: number, color: number) {
  const cone = new THREE.Mesh(new THREE.ConeGeometry(radius * 2.8, radius * 6, 16), toon(color))
  cone.position.copy(curve.getPointAt(at))
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangentAt(at).normalize())
  return cone
}

export function dim(object: THREE.Object3D, amount: number) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.material) return
    const material = mesh.material as THREE.Material
    material.transparent = amount < 1
    material.opacity = amount
    material.depthWrite = amount >= 1
  })
}

export interface Label { el: HTMLElement; anchor: THREE.Vector3; priority: number }

// DOM labels projected from 3D anchors; overlapping labels of lower priority are hidden
export function createLabels(layer: HTMLElement) {
  let labels: Label[] = []
  const line = (el: HTMLElement, tag: string, text: string) => {
    const child = document.createElement(tag)
    child.textContent = text
    el.append(child)
  }
  return {
    clear() { layer.replaceChildren(); labels = [] },
    add(className: string, anchor: THREE.Vector3, lines: [string, string][], onClick?: () => void, priority = 0) {
      const el = document.createElement(onClick && !className.split(' ').includes('event') ? 'button' : 'div')
      el.className = `map-label ${className}`
      if (className.split(' ').includes('place')) {
        el.append(cityStamp(lines.find(([tag]) => tag === 'strong')?.[1] || ''))
        const hint = document.createElement('span'); hint.className = 'city-stamp-hint'; hint.textContent = '打开这座城的回忆'; el.append(hint)
      }
      for (const [tag, text] of lines) line(el, tag, text)
      if (onClick) el.addEventListener('click', (event) => { event.stopPropagation(); onClick() })
      layer.append(el)
      labels.push({ el, anchor, priority })
      return el
    },
    // `obstacles` are screen areas already taken (e.g. photo thumbnails) that labels step around.
    // Labels are speech bubbles whose tail points at their place: no leader lines. A crowded bubble
    // moves to another side of its point, then shrinks (less text) before it is hidden.
    // `detail` is the most a bubble may show at the current zoom: small map, small bubbles.
    place(camera: THREE.Camera, w: number, h: number, toScreen?: (anchor: THREE.Vector3) => THREE.Vector3, obstacles: DOMRect[] = [], detail: LabelDetail = 'full') {
      const v = new THREE.Vector3()
      const placed: DOMRect[] = [...obstacles]
      const order = [...labels].sort((a, b) => b.priority - a.priority)
      const clashes = (rect: DOMRect) => rect.left < 4 || rect.top < 4 || rect.right > w - 4 || rect.bottom > h - 4 ||
        placed.some((r) => rect.left < r.right && rect.right > r.left && rect.top < r.bottom && rect.bottom > r.top)
      const levels = DETAILS.slice(DETAILS.indexOf(detail))
      for (const { el, anchor, priority } of order) {
        if (el.hidden) { el.style.visibility = 'hidden'; continue }
        v.copy(toScreen ? toScreen(anchor) : anchor).project(camera)
        const x = ((v.x + 1) / 2) * w
        const y = ((1 - v.y) / 2) * h
        let choice: { level: LabelDetail; side: Side; rect: DOMRect } | null = null
        for (const level of levels) {
          const { width, height } = sizeOf(el, level)
          for (const side of SIDES) {
            const rect = bubbleRect(side, x, y, width, height)
            if (!clashes(rect)) { choice = { level, side, rect }; break }
          }
          if (choice) break
        }
        // Place names have a compact fallback; event cards must not cover one another.
        if (!choice && priority >= 3 && !el.classList.contains('event')) {
          const level = levels[levels.length - 1]
          const { width, height } = sizeOf(el, level)
          choice = { level, side: 'above', rect: bubbleRect('above', x, y, width, height) }
        }
        const visible = v.z <= 1 && Boolean(choice)
        // Write only what changed: this runs every frame while the map moves
        const visibility = visible ? 'visible' : 'hidden'
        if (el.style.visibility !== visibility) el.style.visibility = visibility
        if (!choice) continue
        if (el.dataset.detail !== choice.level) el.dataset.detail = choice.level
        if (el.dataset.side !== choice.side) el.dataset.side = choice.side
        const transform = `translate(${Math.round(choice.rect.left)}px, ${Math.round(choice.rect.top)}px)`
        if (el.style.transform !== transform) el.style.transform = transform
        if (visible) placed.push(choice.rect)
      }
    },
  }
}

export type LabelDetail = 'full' | 'brief' | 'name'
const DETAILS: LabelDetail[] = ['full', 'brief', 'name']
type Side = 'above' | 'below' | 'right' | 'left'
const SIDES: Side[] = ['above', 'below', 'right', 'left']
const TAIL = 10

// Where a bubble of this size sits when its tail points at (x, y) from the given side
function bubbleRect(side: Side, x: number, y: number, width: number, height: number) {
  if (side === 'above') return new DOMRect(x - width / 2, y - height - TAIL, width, height)
  if (side === 'below') return new DOMRect(x - width / 2, y + TAIL, width, height)
  if (side === 'right') return new DOMRect(x + TAIL, y - height / 2, width, height)
  return new DOMRect(x - TAIL - width, y - height / 2, width, height)
}

// Bubble sizes per level, measured once per label (labels are rebuilt when their text changes)
const sizes = new WeakMap<HTMLElement, Partial<Record<LabelDetail, { width: number; height: number }>>>()
export const invalidateLabelSize = (el: HTMLElement) => sizes.delete(el)
function sizeOf(el: HTMLElement, level: LabelDetail) {
  const known = sizes.get(el) || {}
  if (!known[level]) {
    const shown = el.dataset.detail
    el.dataset.detail = level
    known[level] = { width: el.offsetWidth, height: el.offsetHeight }
    sizes.set(el, known)
    if (shown) el.dataset.detail = shown
    else delete el.dataset.detail
  }
  return known[level]!
}

/** Most a bubble may show at a map zoom level: names only for a country, details for a city */
export const labelDetailForZoom = (zoom: number): LabelDetail => (zoom < 6 ? 'name' : zoom < 9 ? 'brief' : 'full')

type LabelSpec = { className: string; lines: [string, string][]; priority: number }

export function placeLabel(place: Place, selected: string | null): LabelSpec {
  const isSelected = selected === place.city
  const kind = place.isBase || place.roleConfirmed ? ` · ${place.roleConfirmed || place.role !== 'residence' ? roleLabels[place.role] : '生活过'}` : ''
  const span = `${formatYearMonth(place.firstAt)}${place.firstAt.slice(0, 7) !== place.lastAt.slice(0, 7) ? ` – ${formatYearMonth(place.lastAt)}` : ''}`
  return {
    className: `place${place.isBase ? '' : ' small'}${isSelected ? ' selected' : ''}${selected && !isSelected ? ' faded' : ''}${place.roleConfirmed || !place.isBase ? '' : ' unsure'}`,
    lines: [['strong', `${cityLabel(place.city)}${kind}`], ['small', `${span} · ${place.eventIds.length} 件事`]],
    priority: isSelected ? 5 : place.isBase ? 4 : 3,
  }
}

export function eventLabel(event: MemoryEvent, now: boolean, unsure: boolean): LabelSpec {
  return {
    className: `event${now ? ' now' : ''}${unsure ? ' unsure' : ''}${event.status === 'draft' ? ' draft' : ''}`,
    lines: [['time', formatYearMonth(event.occurredAt)], ['strong', event.title]],
    priority: now ? 6 : 2,
  }
}

// ---- Event markers: small static cartoon models chosen by what the event was ------------------
export type MarkerKind = 'cake' | 'balloons' | 'flag' | 'pin'

export function markerKind(event: Pick<MemoryEvent, 'type' | 'title' | 'summary'>): MarkerKind {
  const text = `${event.type || ''} ${event.title || ''} ${event.summary || ''}`
  if (/生日|蛋糕|寿|birthday/i.test(text)) return 'cake'
  if (/聚会|派对|庆祝|庆功|婚礼|结婚|订婚|周年|毕业|节日|春节|过年|中秋|圣诞|年会|party/i.test(text)) return 'balloons'
  if (/旅行|旅游|出游|度假|自驾|徒步|travel|trip/i.test(text)) return 'flag'
  return 'pin'
}

// y-up, about one unit tall like the other scaled objects; nothing animates
export function eventMarker(kind: MarkerKind, now: boolean): THREE.Group {
  const group = new THREE.Group()
  const add = adder(group)
  // Readable at city scale; the current event a little larger
  const s = now ? 2 : 1.6
  group.scale.setScalar(s)
  if (kind === 'cake') {
    add(new THREE.CylinderGeometry(0.42, 0.42, 0.03, 32), 0xffffff, [0, 0.015, 0], { outline: false })
    add(new THREE.CylinderGeometry(0.34, 0.34, 0.2, 32), 0xfff1d6, [0, 0.13, 0], { outlineScale: 1.04 })
    add(new THREE.CylinderGeometry(0.345, 0.345, 0.05, 32), 0xf7a8c0, [0, 0.21, 0], { outline: false })
    add(new THREE.CylinderGeometry(0.24, 0.24, 0.16, 32), 0xf7a8c0, [0, 0.31, 0], { outlineScale: 1.05 })
    add(new THREE.CylinderGeometry(0.245, 0.245, 0.04, 32), 0xffffff, [0, 0.38, 0], { outline: false })
    for (const [x, z, color] of [[-0.1, 0.04, 0x8fc9f5], [0.1, 0.04, 0xffd166], [0, -0.1, 0x9ee07a]] as const) {
      add(new THREE.CylinderGeometry(0.025, 0.025, 0.16, 8), color, [x, 0.47, z], { outline: false })
      add(new THREE.ConeGeometry(0.035, 0.08, 8), 0xffb02e, [x, 0.59, z], { outline: false, shadow: false })
    }
    add(new THREE.SphereGeometry(0.05, 12, 8), 0xe8403c, [0.17, 0.43, 0.12], { outline: false })
  } else if (kind === 'balloons') {
    add(new THREE.BoxGeometry(0.12, 0.08, 0.12), 0xb98cd8, [0, 0.04, 0], { outlineScale: 1.08 })
    const balloons: [number, number, number, number][] = [[-0.2, 0.86, 0.02, 0xff6b6b], [0.18, 0.95, -0.04, 0xffd166], [0.02, 1.12, 0.1, 0x6fb6ff]]
    for (const [x, y, z, color] of balloons) {
      const top = new THREE.Vector3(x, y - 0.2, z)
      const length = top.length()
      const string = add(new THREE.CylinderGeometry(0.008, 0.008, length, 5), 0x8a8a8a, [x / 2, (y - 0.2) / 2 + 0.04, z / 2], { outline: false, shadow: false })
      string.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().normalize())
      add(new THREE.SphereGeometry(0.17, 20, 16), color, [x, y, z], { scale: [1, 1.18, 1], outlineScale: 1.05 })
      add(new THREE.ConeGeometry(0.04, 0.06, 8), color, [x, y - 0.21, z], { rot: [Math.PI, 0, 0], outline: false })
      add(new THREE.SphereGeometry(0.045, 8, 6), 0xffffff, [x - 0.06, y + 0.07, z + 0.12], { outline: false, shadow: false })
    }
  } else if (kind === 'flag') {
    add(new THREE.CylinderGeometry(0.1, 0.12, 0.05, 16), 0xffffff, [0, 0.025, 0], { outlineScale: 1.08 })
    add(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 8), 0x7a6a5c, [0, 0.42, 0], { outline: false })
    const pennant = new THREE.Shape()
    pennant.moveTo(0, 0); pennant.lineTo(0.36, -0.1); pennant.lineTo(0, -0.22); pennant.lineTo(0, 0)
    add(new THREE.ShapeGeometry(pennant), 0xf08a24, [0.02, 0.8, 0], { outline: false })
  } else {
    add(new THREE.CylinderGeometry(0.12, 0.12, 0.02, 16), 0x3a3548, [0, 0.01, 0], { outline: false, shadow: false })
    add(new THREE.ConeGeometry(0.15, 0.4, 20), 0xf08a24, [0, 0.24, 0], { rot: [Math.PI, 0, 0], outlineScale: 1.05 })
    add(new THREE.SphereGeometry(0.2, 24, 16), 0xf08a24, [0, 0.52, 0], { outlineScale: 1.05 })
    add(new THREE.SphereGeometry(0.08, 16, 12), 0xffffff, [0, 0.52, 0.16], { outline: false })
  }
  if (now) add(new THREE.TorusGeometry(0.5, 0.04, 8, 48), 0xf08a24, [0, 0.02, 0], { rot: [-Math.PI / 2, 0, 0], outline: false, shadow: false })
  // Markers are tiny next to the scene's shadow map: in its stale shade they turned almost black
  group.traverse((item) => {
    item.receiveShadow = false
    // Flat, unlit colours: at city scale these few-pixel models fell into the darkest toon band
    const mesh = item as THREE.Mesh
    const material = mesh.material as THREE.MeshToonMaterial | undefined
    if (material?.isMeshToonMaterial) { mesh.material = new THREE.MeshBasicMaterial({ color: material.color }); material.dispose() }
  })
  return group
}

// One event, one button: the cover and the date/title share the same hit target.
// The cover is decoration; clicking it opens the event's complete photo group.
export function attachEventCover(el: HTMLElement, event: MemoryEvent, cover?: { preview: string; count: number }) {
  el.dataset.eventId = event.id
  el.setAttribute('role', 'group')
  const open = document.createElement('button')
  open.type = 'button'
  open.className = 'map-event-open'
  open.dataset.eventId = event.id
  open.setAttribute('aria-label', `打开事件：${event.title}${cover ? `，${cover.count} 张照片` : ''}`)
  const body = document.createElement('span')
  body.className = 'map-event-copy'
  body.append(...el.childNodes)
  if (!cover) { open.append(body); el.append(open); return }
  el.classList.add('has-photo')
  const media = document.createElement('span')
  media.className = 'map-event-cover'
  const img = document.createElement('img')
  img.src = cover.preview
  img.alt = ''
  img.draggable = false
  const count = document.createElement('span')
  count.className = 'map-event-count'
  count.textContent = `${cover.count} 张`
  media.append(img, count)
  open.append(media, body)
  el.append(open)
  el.title = `${formatYearMonth(event.occurredAt)} · ${event.title} · ${cover.count} 张照片`
}

// Repeated visits are independent rows in one place card, visible without a popup.
export function fillEventStack(el: HTMLElement, events: MemoryEvent[], covers: Record<string, { preview: string; count: number; place?: string }>, openEvent: (id: string) => void) {
  el.replaceChildren()
  el.classList.toggle('event-stack', events.length > 1)
  if (events.length === 1) {
    for (const [tag, text] of eventLabel(events[0], false, false).lines) {
      const line = document.createElement(tag); line.textContent = text; el.append(line)
    }
    attachEventCover(el, events[0], covers[events[0].id])
    return
  }
  const places = events.map(event => covers[event.id]?.place).filter(Boolean)
  const place = places.length === events.length && new Set(places).size === 1 ? places[0] : ''
  const heading = document.createElement('div')
  heading.className = 'map-event-stack-heading'
  const title = document.createElement('strong'); title.textContent = place || '附近的回忆'
  const count = document.createElement('span'); count.textContent = `${events.length} 段`
  heading.append(title, count)
  heading.addEventListener('click', e => e.stopPropagation())
  const rows = document.createElement('div'); rows.className = 'map-event-stack-rows'
  rows.setAttribute('aria-label', '各次回忆'); rows.tabIndex = 0
  rows.addEventListener('wheel', e => e.stopPropagation())
  rows.addEventListener('pointerdown', e => e.stopPropagation())
  rows.addEventListener('click', e => e.stopPropagation())
  for (const event of events) {
    const holder = document.createElement('div')
    for (const [tag, text] of eventLabel(event, false, false).lines) {
      const line = document.createElement(tag); line.textContent = tag === 'time' ? new Date(event.occurredAt).toLocaleDateString('zh-CN') : text; holder.append(line)
    }
    attachEventCover(holder, event, covers[event.id])
    const button = holder.querySelector<HTMLButtonElement>('.map-event-open')!
    button.addEventListener('click', e => { e.stopPropagation(); openEvent(event.id) })
    rows.append(button)
  }
  el.title = place || '每段回忆可单独打开'
  el.setAttribute('aria-label', `${place || '附近'}，${events.length} 段回忆`)
  el.append(heading, rows)
}

// Cartoon objects shared by the offline board and the AMap overlay.
import * as THREE from 'three'
import type { MemoryEvent, Place, PlaceRole } from '../types'
import { cityLabel, formatYearMonth, roleLabels } from '../lib/memory'

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
      const line = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x3a3548, side: THREE.BackSide }))
      line.scale.setScalar(outlineScale)
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
      const el = document.createElement(onClick ? 'button' : 'div')
      el.className = `map-label ${className}`
      for (const [tag, text] of lines) line(el, tag, text)
      if (onClick) el.addEventListener('click', (event) => { event.stopPropagation(); onClick() })
      layer.append(el)
      labels.push({ el, anchor, priority })
      return el
    },
    // `obstacles` are screen areas already taken (e.g. photo thumbnails) that labels step around
    place(camera: THREE.Camera, w: number, h: number, toScreen?: (anchor: THREE.Vector3) => THREE.Vector3, obstacles: DOMRect[] = []) {
      const v = new THREE.Vector3()
      const placed: DOMRect[] = [...obstacles]
      const order = [...labels].sort((a, b) => b.priority - a.priority)
      const clashes = (rect: DOMRect) => placed.some((r) => rect.left < r.right && rect.right > r.left && rect.top < r.bottom && rect.bottom > r.top)
      for (const { el, anchor, priority } of order) {
        v.copy(toScreen ? toScreen(anchor) : anchor).project(camera)
        const x = ((v.x + 1) / 2) * w
        const y = ((1 - v.y) / 2) * h
        const width = el.offsetWidth
        const height = el.offsetHeight
        // Crowded labels stack upwards with a leader line back to their point
        const steps = priority >= 3 ? 6 : 4
        let lift = -1
        for (let step = 0; step < steps && lift < 0; step++) {
          const up = step * (height + 6)
          if (!clashes(new DOMRect(x - width / 2, y - height - 8 - up, width, height + 8))) lift = up
        }
        // Place labels always show, even when every level is taken
        if (lift < 0 && priority >= 3) lift = (steps - 1) * (height + 6)
        const visible = v.z <= 1 && lift >= 0
        el.style.visibility = visible ? 'visible' : 'hidden'
        el.classList.toggle('lifted', lift > 0)
        el.style.setProperty('--lift', `${Math.max(0, lift)}px`)
        el.style.transform = `translate(${x}px, ${y - Math.max(0, lift)}px) translate(-50%, -100%)`
        if (visible) placed.push(new DOMRect(x - width / 2, y - height - 8 - lift, width, height + 8 + lift))
      }
    },
  }
}

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

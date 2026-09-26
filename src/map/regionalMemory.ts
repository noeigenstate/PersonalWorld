import * as THREE from 'three'
import { wgs84ToGcj02 } from '../lib/geo'
import type { SceneData } from './styledDistrict'
import type { SceneRecipe, SceneTheme } from './sceneRecipe'

type Point = [number, number]
type Convert = (points: Point[]) => Point[]

const colors: Record<SceneTheme, { wall: string; roof: string; glass: string; accent: string; secondary: string }> = {
  beach: { wall: '#ffecd0', roof: '#f4ca9d', glass: '#8bcbd2', accent: '#65bec9', secondary: '#ed9e7e' },
  icecream: { wall: '#ffe0de', roof: '#e9b2c9', glass: '#9dcdd3', accent: '#e786aa', secondary: '#f4bd7a' },
  classroom: { wall: '#f8dfb9', roof: '#dca58f', glass: '#9bc3d7', accent: '#86b7a0', secondary: '#ebae72' },
  concert: { wall: '#e9def4', roof: '#b8a3cf', glass: '#9bc0d6', accent: '#9479bd', secondary: '#f0c172' },
  driving: { wall: '#dcebed', roof: '#a6c9cd', glass: '#9cbacf', accent: '#6aabb7', secondary: '#e9ac80' },
  reading: { wall: '#f6e4c9', roof: '#cfae9d', glass: '#a2c8ce', accent: '#88a7b4', secondary: '#da9a80' },
  dining: { wall: '#fce2cc', roof: '#e5b3a0', glass: '#9fc8cb', accent: '#df977f', secondary: '#edbd7c' },
  park: { wall: '#e8edce', roof: '#bed6ac', glass: '#9ac6ca', accent: '#81ae82', secondary: '#e9c17e' },
}

function polygonArea(path: Point[]) {
  let twice = 0
  for (let i = 1; i < path.length; i++) twice += path[i - 1][0] * path[i][1] - path[i][0] * path[i - 1][1]
  return Math.abs(twice) / 2
}

function centerOf(path: Point[]): Point {
  const points = path.length > 1 && path[0][0] === path.at(-1)![0] && path[0][1] === path.at(-1)![1] ? path.slice(0, -1) : path
  return [points.reduce((sum, p) => sum + p[0], 0) / points.length, points.reduce((sum, p) => sum + p[1], 0) / points.length]
}

function inside([x, y]: Point, ring: Point[]) {
  let hit = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

function distanceToLine(point: Point, path: Point[]) {
  let best = Infinity
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i]
    const dx = bx - ax, dy = by - ay
    const t = Math.max(0, Math.min(1, ((point[0] - ax) * dx + (point[1] - ay) * dy) / (dx * dx + dy * dy || 1)))
    best = Math.min(best, Math.hypot(point[0] - ax - t * dx, point[1] - ay - t * dy))
  }
  return best
}

function material(color: string) { return new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: .42, side: THREE.DoubleSide }) }
function put(group: THREE.Group, geometry: THREE.BufferGeometry, color: string, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(geometry, material(color))
  mesh.position.set(x, y, z)
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)
  return mesh
}
function box(group: THREE.Group, color: string, x: number, y: number, z: number, w: number, d: number, h: number) {
  return put(group, new THREE.BoxGeometry(w, d, h), color, x, y, z)
}
function ball(group: THREE.Group, color: string, x: number, y: number, z: number, r: number) {
  return put(group, new THREE.IcosahedronGeometry(r, 1), color, x, y, z)
}
function uprightCylinder(group: THREE.Group, color: string, x: number, y: number, z: number, top: number, bottom: number, height: number) {
  const mesh = put(group, new THREE.CylinderGeometry(top, bottom, height, 12), color, x, y, z)
  mesh.rotation.x = Math.PI / 2
  return mesh
}

function silhouette(group: THREE.Group, theme: SceneTheme, x: number, y: number, roof: number) {
  const p = colors[theme]
  const z = roof + 5
  if (theme === 'icecream') {
    const cone = put(group, new THREE.ConeGeometry(4.2, 8, 12), '#d8a26c', x, y, z + 1)
    cone.rotation.x = Math.PI / 2
    ball(group, '#f6b5be', x, y, z + 7, 4.7)
    ball(group, '#fff0d7', x + 2.5, y, z + 9, 2.5)
  } else if (theme === 'beach') {
    uprightCylinder(group, p.accent, x, y, z + 1, .6, .6, 10)
    const canopy = put(group, new THREE.ConeGeometry(8.5, 4, 12), p.secondary, x, y, z + 7)
    canopy.rotation.x = Math.PI / 2
    ball(group, '#fff2d5', x + 5, y, roof + 2.5, 2.1)
  } else if (theme === 'classroom' || theme === 'reading') {
    box(group, p.accent, x - 3, y, z, 6, 1.5, 8)
    box(group, p.secondary, x + 3, y, z, 6, 1.5, 8)
    box(group, '#fff8e7', x, y - 1.2, z + 4, 1.2, 3, 8)
    if (theme === 'classroom') uprightCylinder(group, '#e6a669', x + 7, y, z + 4, .9, .9, 12)
  } else if (theme === 'concert') {
    box(group, p.accent, x, y, z, 12, 2, 8)
    for (const dx of [-5, 5]) ball(group, p.secondary, x + dx, y, z + 7, 2.5)
    ball(group, '#fff0be', x, y, z + 10, 3)
  } else if (theme === 'driving') {
    box(group, p.accent, x, y, z, 12, 6, 4)
    box(group, '#f8efe0', x, y - 1, z + 3.5, 7, 4, 2)
    for (const dx of [-4, 4]) {
      const wheel = put(group, new THREE.TorusGeometry(1.7, .8, 8, 14), '#5d6372', x + dx, y - 3, z - 1)
      wheel.rotation.x = Math.PI / 2
    }
  } else if (theme === 'dining') {
    uprightCylinder(group, '#fff6e9', x, y, z, 5, 4, 8)
    uprightCylinder(group, p.accent, x, y, z + 4, 5.2, 5.2, 1)
    const handle = put(group, new THREE.TorusGeometry(3, .9, 8, 16), p.secondary, x + 6, y, z)
    handle.rotation.x = Math.PI / 2
  } else {
    uprightCylinder(group, '#b99b77', x, y, z - 1, 1.4, 2, 10)
    ball(group, p.accent, x, y, z + 6, 7)
    ball(group, '#a8d19c', x + 3, y, z + 8, 5)
  }
}

function localScenery(group: THREE.Group, data: SceneData, recipe: SceneRecipe | null, transform: (path: Point[]) => Point[], anchor: Point) {
  const radius = 620
  const greens = data.green.map((item) => item.rings.map(transform))
  const waters = data.water.map((item) => item.rings.map(transform))
  const sands = (data.sand || []).map((item) => item.rings.map(transform))
  const buildings = data.buildings.map((item) => transform(item.rings[0])).filter((ring) => ring.some(([x, y]) => Math.hypot(x - anchor[0], y - anchor[1]) < radius + 70))
  const roads = data.roads.map((item) => transform(item.path)).filter((path) => path.some(([x, y]) => Math.hypot(x - anchor[0], y - anchor[1]) < radius + 90))
  const insidePolygons = (point: Point, polygons: Point[][][]) => polygons.some(([outer, ...holes]) => inside(point, outer) && !holes.some((hole) => inside(point, hole)))
  const clear = (point: Point) => !insidePolygons(point, waters) && !buildings.some((ring) => inside(point, ring) || distanceToLine(point, ring) < 8)
    && !roads.some((path) => distanceToLine(point, path) < 8)
  // Keep native water surfaces. Two map renderers cannot share depth, and an OSM water
  // polygon drawn on our canvas can stretch across the horizon or cover native buildings.
  const trees: Point[] = []
  const addTree = (point: Point) => {
    if (trees.length >= 160 || Math.hypot(point[0] - anchor[0], point[1] - anchor[1]) > radius || Math.hypot(point[0] - anchor[0], point[1] - anchor[1]) < 20) return
    if (!clear(point) || trees.some((other) => Math.hypot(other[0] - point[0], other[1] - point[1]) < 18)) return
    trees.push(point)
  }
  // Only draw trees on mapped rows or mapped green land; no decorative circles or fake lawns.
  for (const row of data.treeRows) {
    const path = transform(row.path)
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], length = Math.hypot(b[0] - a[0], b[1] - a[1])
      for (let d = 14; d < length; d += 26) addTree([a[0] + (b[0] - a[0]) * d / length, a[1] + (b[1] - a[1]) * d / length])
    }
  }
  for (const road of data.roads.filter((item) => /^(primary|secondary|tertiary|residential)/.test(item.class))) {
    const path = transform(road.path)
    for (let i = 1; i < path.length && trees.length < 160; i++) {
      const a = path[i - 1], b = path[i]
      const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy)
      if (length < 55) continue
      for (let d = 24; d < length - 12 && trees.length < 160; d += 42) {
        const x = a[0] + dx * d / length, y = a[1] + dy * d / length
        const side = road.class === 'primary' || road.class === 'secondary' ? 20 : 14
        addTree([x - dy / length * side, y + dx / length * side])
        addTree([x + dy / length * side, y - dx / length * side])
      }
    }
  }
  for (let x = anchor[0] - radius; x < anchor[0] + radius && trees.length < 160; x += 27) for (let y = anchor[1] - radius; y < anchor[1] + radius && trees.length < 160; y += 27) {
    const point: Point = [x + Math.sin(x * .1 + y * .07) * 5, y + Math.cos(y * .13 - x * .06) * 5]
    if (insidePolygons(point, greens)) addTree(point)
  }
  if (trees.length) {
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.25, 1.6, 5.4, 7), material('#b5926f'), trees.length)
    const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(6.7, 1), material('#92bc85'), trees.length)
    const highlights = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(4.4, 1), material('#b6d49b'), trees.length)
    const instance = new THREE.Object3D()
    trees.forEach(([x, y], index) => {
      const size = .72 + ((index * 17) % 11) / 24
      instance.position.set(x, y, 2.7 * size)
      instance.rotation.set(Math.PI / 2, 0, 0)
      instance.scale.setScalar(size)
      instance.updateMatrix()
      trunks.setMatrixAt(index, instance.matrix)
      instance.position.set(x, y, 10 * size)
      instance.rotation.set(0, 0, 0)
      instance.updateMatrix()
      crowns.setMatrixAt(index, instance.matrix)
      instance.position.set(x + 2.1 * size, y, 11.2 * size)
      instance.updateMatrix()
      highlights.setMatrixAt(index, instance.matrix)
    })
    trunks.castShadow = crowns.castShadow = highlights.castShadow = true
    group.add(trunks, crowns, highlights)
    const shrubs = trees.filter((_, index) => index % 2 === 0).slice(0, 80)
    const hedges = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.5, 1), material('#85b978'), shrubs.length)
    shrubs.forEach(([x, y], index) => {
      instance.position.set(x + 5, y + 3, 2)
      instance.rotation.set(0, 0, index * .91)
      instance.scale.set(1 + index % 3 * .18, .8, .75)
      instance.updateMatrix()
      hedges.setMatrixAt(index, instance.matrix)
    })
    hedges.castShadow = true
    group.add(hedges)
  }
  const tufts: Point[] = []
  for (let x = anchor[0] - radius; x < anchor[0] + radius && tufts.length < 280; x += 19) for (let y = anchor[1] - radius; y < anchor[1] + radius && tufts.length < 280; y += 19) {
    const point: Point = [x + Math.sin(x * .15 + y * .05) * 4, y + Math.cos(y * .12 - x * .09) * 4]
    if (insidePolygons(point, greens) && clear(point)) tufts.push(point)
  }
  if (tufts.length) {
    const grass = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), material('#a5ce83'), tufts.length)
    const instance = new THREE.Object3D()
    tufts.forEach(([x, y], i) => {
      const size = .65 + (i % 7) * .12
      instance.position.set(x, y, .38)
      instance.rotation.set(0, 0, i * 1.7)
      instance.scale.set(2.2 * size, 1.25 * size, .45)
      instance.updateMatrix()
      grass.setMatrixAt(i, instance.matrix)
    })
    grass.name = 'mapped-grass-texture'
    group.add(grass)
  }
  const glints: number[] = []
  for (let x = anchor[0] - radius; x < anchor[0] + radius && glints.length < 480; x += 38) for (let y = anchor[1] - radius; y < anchor[1] + radius && glints.length < 480; y += 38) {
    const point: Point = [x + Math.sin(y * .11) * 7, y + Math.cos(x * .08) * 7]
    if (insidePolygons(point, waters)) glints.push(x - 5, y, .7, x + 6, y + 1.2, .7)
  }
  if (glints.length) {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(glints, 3))
    group.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#f4ffff', transparent: true, opacity: .75 })))
  }
  let umbrellas = 0
  if (recipe?.theme === 'beach') {
    for (let x = anchor[0] - 150; x < anchor[0] + 150 && umbrellas < 3; x += 32) for (let y = anchor[1] - 150; y < anchor[1] + 150 && umbrellas < 3; y += 32) {
      const point: Point = [x, y]
      if (!insidePolygons(point, sands) || !clear(point)) continue
      uprightCylinder(group, '#f5e7cb', x, y, 4.8, .5, .7, 9)
      const canopy = put(group, new THREE.ConeGeometry(7.5, 3.5, 12), umbrellas % 2 ? '#e69882' : '#76c6d0', x, y, 10)
      canopy.rotation.x = Math.PI / 2
      umbrellas++
    }
  }
  return umbrellas > 0
}

// The geographic material layer is present for every street-level photo, even before AI
// produces a card. It never erases a whole parcel or native building district.
export function createRegionalLandscape(convert: Convert, data: SceneData, at: Point, recipe: SceneRecipe | null) {
  const group = new THREE.Group()
  const transform = (path: Point[]) => convert(path.map(([lng, lat]) => {
    const p = wgs84ToGcj02({ lng, lat })
    return [p.lng, p.lat]
  }))
  const anchor = convert([at])[0]
  const themeVisual = localScenery(group, data, recipe, transform, anchor)
  return { group, themeVisual }
}

// The native map remains intact except for ONE mapped building chosen near a photo clue.
// A photo theme is an artistic treatment of that footprint, not a claim about its real use.
export function createRegionalMemory(convert: Convert, data: SceneData, recipe: SceneRecipe, limit = 3, showThemeSymbol = true, maxDistance = 220, excludedIds = new Set<string>()) {
  const group = new THREE.Group()
  const transform = (path: Point[]) => convert(path.map(([lng, lat]) => {
    const p = wgs84ToGcj02({ lng, lat })
    return [p.lng, p.lat]
  }))
  const anchor = convert([recipe.anchor])[0]
  // Around towers, an unknown OSM height is unsafe: replacing a native high-rise with an
  // estimated low block recreates the hollow/stumpy failure seen in the map screenshot.
  const tallNearby = data.buildings.some((building) => {
    const height = Number.parseFloat(building.height || '')
    if (!Number.isFinite(height) || height < 70) return false
    const ring = building.rings[0]
    if (!ring?.length) return false
    const center = centerOf(transform(ring))
    return Math.hypot(center[0] - anchor[0], center[1] - anchor[1]) < 350
  })
  const candidates = data.buildings.flatMap((building) => {
    if (excludedIds.has(building.id)) return []
    const ring = building.rings[0]
    if (!ring || ring.length < 4) return []
    const mapped = transform(ring)
    const center = centerOf(mapped)
    const area = polygonArea(mapped)
    const distance = Math.hypot(center[0] - anchor[0], center[1] - anchor[1])
    const height = Number.parseFloat(building.height || '')
    if (Number.isFinite(height) && height > 65) return []
    if (tallNearby && !(Number.isFinite(height) && height > 5)) return []
    if (!(Number.isFinite(height) && height > 5) && area > 1200) return []
    let perimeter = 0
    for (let i = 1; i < mapped.length; i++) perimeter += Math.hypot(mapped[i][0] - mapped[i - 1][0], mapped[i][1] - mapped[i - 1][1])
    const compactness = 4 * Math.PI * area / (perimeter * perimeter || 1)
    if (mapped.length > 10 && compactness > .8) return []
    // customCoords uses Web Mercator metres, about 1.17× ground metres at this latitude.
    return area >= 120 && area <= 3200 && distance < maxDistance ? [{ building, mapped, center, area, distance }] : []
  }).sort((a, b) => a.distance - b.distance || a.area - b.area)
  const selected = candidates.slice(0, limit)
  const hideNativePaths: Point[][] = []
  let estimatedHeight = false
  const p = colors[recipe.theme]
  selected.forEach(({ mapped, center, area, building }, index) => {
  const measured = Number.parseFloat(building.height || '')
  const levels = Number.parseFloat(building.levels || '')
  estimatedHeight ||= !(Number.isFinite(measured) && measured > 5) && !(Number.isFinite(levels) && levels >= 1)
  const height = Number.isFinite(measured) && measured > 5 ? Math.min(65, measured)
    : Number.isFinite(levels) && levels >= 1 ? Math.min(65, levels * 3.5)
      : Math.min(23, Math.max(12, 11 + Math.sqrt(area) * .13))
  const shape = new THREE.Shape()
  mapped.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y))
  shape.closePath()
  const shell = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false }), material(p.wall))
  shell.name = `photo-theme-${recipe.theme}-building`
  shell.castShadow = shell.receiveShadow = true
  group.add(shell)
  const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 1.6, bevelEnabled: true, bevelThickness: 1, bevelSize: 1.2, bevelSegments: 2 }), material(p.roof))
  roof.position.z = height
  roof.castShadow = roof.receiveShadow = true
  group.add(roof)
  const bottom = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 1.5, bevelEnabled: false }), material(p.secondary))
  bottom.position.z = .3
  group.add(bottom)
  // Windows and a striped entrance are placed on the longest real footprint edge.
  const edges = mapped.slice(1).map((point, i) => ({ a: mapped[i], b: point, length: Math.hypot(point[0] - mapped[i][0], point[1] - mapped[i][1]) }))
  const main = edges.sort((a, b) => b.length - a.length)[0]
  if (main && main.length > 8) {
    const dx = (main.b[0] - main.a[0]) / main.length
    const dy = (main.b[1] - main.a[1]) / main.length
    const mid: Point = [(main.a[0] + main.b[0]) / 2, (main.a[1] + main.b[1]) / 2]
    const normalSign = (mid[0] - center[0]) * dy + (mid[1] - center[1]) * -dx >= 0 ? 1 : -1
    const nx = dy * normalSign, ny = -dx * normalSign
    const count = Math.min(8, Math.floor((main.length - 4) / 7))
    const floors = Math.max(1, Math.min(4, Math.floor((height - 5) / 5)))
    for (let floor = 0; floor < floors; floor++) for (let i = 0; i < count; i++) {
      const t = (i + 1) / (count + 1)
      const pane = box(group, p.glass, main.a[0] + (main.b[0] - main.a[0]) * t + nx * .24, main.a[1] + (main.b[1] - main.a[1]) * t + ny * .24, 5.5 + floor * 5, 3.3, .5, 3.2)
      pane.rotation.z = Math.atan2(dy, dx)
    }
    const cx = (main.a[0] + main.b[0]) / 2 + nx * 1.2
    const cy = (main.a[1] + main.b[1]) / 2 + ny * 1.2
    const awning = box(group, p.accent, cx, cy, 5.5, Math.min(16, main.length * .6), 4, 1.4)
    awning.rotation.z = Math.atan2(dy, dx)
    for (const shift of [-.32, 0, .32]) {
      const stripe = box(group, '#fff9e9', cx + dx * shift * Math.min(16, main.length * .6), cy + dy * shift * Math.min(16, main.length * .6), 6.28, 1.4, 4.1, .18)
      stripe.rotation.z = Math.atan2(dy, dx)
    }
  }
  if (index === 0 && showThemeSymbol) silhouette(group, recipe.theme, center[0], center[1], height + 1.5)
  // Keep each clearing tight to a mapped footprint, never the full photo region.
  const gcjPath = building.rings[0].map(([lng, lat]): Point => {
    const p = wgs84ToGcj02({ lng, lat })
    return [p.lng, p.lat]
  })
  hideNativePaths.push(gcjPath)
  })
  return { group, hideNativePaths, buildingIds: selected.map(({ building }) => building.id), center: selected[0]?.center || null, estimatedHeight, colors: p }
}

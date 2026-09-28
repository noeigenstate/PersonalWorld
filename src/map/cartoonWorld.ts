import * as THREE from 'three'
import { CARTOON } from './cartoonPalette'

// The cartoon world: real geography (server/cartoonTiles.mjs) drawn as simple cartoon pieces —
// flat-coloured land, water with painted ripples, woods and parks with leafy trees, roads with
// zebra crossings and traffic lights, buildings from their real footprints and heights, and
// hill cones at mountain peaks. Flat colours and merged meshes keep the rendering load low.
// Nothing moves on its own: the scene only changes when the view does.

const GRID = 10000
const NEAR_RADIUS = 2 // tiles around the centre at the detailed zoom (5 × 5)
const MAX_TILES = 180

interface CartoonTile {
  land?: number[][][]; water?: number[][][]; forest?: number[][][]; grass?: number[][][]; park?: number[][][]; town?: number[][][]; sand?: number[][][]; ice?: number[][][]; rock?: number[][][]
  rivers?: { w: number; pts: number[] }[]
  roads?: { r: number; rail?: number; pts: number[] }[]
  borders?: { l: number; pts: number[] }[]
  buildings?: { h: number; b: number; ring: number[] }[]
  peaks?: { x: number; y: number; e: number }[]
}

export interface CartoonWorldOptions {
  // WGS-84 → scene position (the map's own coordinate frame, metres, z up)
  toScene: (lat: number, lng: number) => THREE.Vector3
  // Visible area and zoom of the map (WGS-84)
  view: () => { zoom: number; center: { lng: number; lat: number }; bounds: { west: number; south: number; east: number; north: number } }
  redraw: () => void
}

// A tile drawn near (at its own scale) or far (seen 3 levels closer: thinner lines, finer patterns)
const tileKey = (z: number, x: number, y: number, detail: boolean) => `${z}/${x}/${y}${detail ? '' : '~far'}`
const FAR_MAGNIFICATION = 8

const tileLng = (x: number, z: number) => (x / 2 ** z) * 360 - 180
const tileLat = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI
const lngTile = (lng: number, z: number) => Math.floor(((lng + 180) / 360) * 2 ** z)
const latTile = (lat: number, z: number) => Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z)

// ---- Shared materials (one set for the whole world) ----------------------------------------
function paintedTexture(size: number, paint: (g: CanvasRenderingContext2D, s: number) => void) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  paint(canvas.getContext('2d')!, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}
// Water: small white ripple arcs on the lake colour
const rippleTexture = () => paintedTexture(256, (g, s) => {
  g.fillStyle = CARTOON.water; g.fillRect(0, 0, s, s)
  const shade = g.createLinearGradient(0, 0, s, s)
  shade.addColorStop(0, 'rgba(31,149,216,0)'); shade.addColorStop(0.5, 'rgba(31,149,216,.22)'); shade.addColorStop(1, 'rgba(31,149,216,0)')
  g.fillStyle = shade; g.fillRect(0, 0, s, s)
  g.strokeStyle = CARTOON.ripple; g.lineWidth = 5; g.lineCap = 'round'
  let seed = 11
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 9; i++) {
    const x = rnd() * s, y = rnd() * s, w = 18 + rnd() * 16
    g.beginPath(); g.arc(x, y, w, Math.PI * 1.15, Math.PI * 1.85); g.stroke()
    g.beginPath(); g.arc(x + w * 1.3, y, w * 0.8, Math.PI * 1.15, Math.PI * 1.85); g.stroke()
  }
})
// Woods seen from afar: round leafy crowns
const canopyTexture = (base: string, leaf: string, light: string) => paintedTexture(256, (g, s) => {
  g.fillStyle = base; g.fillRect(0, 0, s, s)
  let seed = 5
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 26; i++) {
    const x = rnd() * s, y = rnd() * s, r = 12 + rnd() * 9
    for (const [dx, dy] of [[0, 0], [s, 0], [-s, 0], [0, s], [0, -s]]) {
      g.fillStyle = leaf; g.beginPath(); g.arc(x + dx, y + dy, r, 0, Math.PI * 2); g.fill()
      g.fillStyle = light; g.beginPath(); g.arc(x + dx - r * 0.3, y + dy - r * 0.3, r * 0.45, 0, Math.PI * 2); g.fill()
    }
  }
})

// Painted detail from the locally generated textures (scripts/assets/generate-textures.mjs): turned
// into light/dark variation around the palette colour, so the palette stays in charge of colour.
// Without the files the materials stay flat.
function paintedDetail(name: string, material: THREE.MeshBasicMaterial | THREE.MeshLambertMaterial, color: string, redraw: () => void) {
  const image = new Image()
  image.src = `/world-assets/textures/${name}.webp`
  image.decode().then(() => {
    const size = 512
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const g = canvas.getContext('2d', { willReadFrequently: true })!
    g.drawImage(image, 0, 0, size, size)
    const pixels = g.getImageData(0, 0, size, size)
    let mean = 0
    for (let i = 0; i < pixels.data.length; i += 4) mean += 0.299 * pixels.data[i] + 0.587 * pixels.data[i + 1] + 0.114 * pixels.data[i + 2]
    mean /= pixels.data.length / 4
    for (let i = 0; i < pixels.data.length; i += 4) {
      const lum = 0.299 * pixels.data[i] + 0.587 * pixels.data[i + 1] + 0.114 * pixels.data[i + 2]
      // centre on 0.8 so it can lighten as well as darken once the colour is raised by 1/0.8
      const v = Math.max(0, Math.min(255, (0.8 + (lum / mean - 1) * 0.55) * 255))
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = v
    }
    g.putImageData(pixels, 0, 0)
    const texture = new THREE.CanvasTexture(canvas)
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.anisotropy = 4
    material.map?.dispose()
    material.map = texture
    material.color.set(color).multiplyScalar(1 / 0.8)
    material.needsUpdate = true
    redraw()
  }).catch(() => {})
}

function materials() {
  const flat = (color: string, order: number, map?: THREE.Texture) => {
    const m = new THREE.MeshBasicMaterial({ color: map ? 0xffffff : color, map, side: THREE.DoubleSide, depthWrite: false })
    m.userData.order = order
    return m
  }
  const lit = (color: string) => new THREE.MeshLambertMaterial({ color, flatShading: true })
  return {
    water: flat(CARTOON.water, -70, rippleTexture()),
    foam: flat(CARTOON.foam, -66),
    land: flat(CARTOON.land, -60),
    town: flat(CARTOON.town, -58),
    grass: flat(CARTOON.grass, -57),
    sand: flat(CARTOON.sand, -57),
    rock: flat(CARTOON.rock, -57),
    ice: flat(CARTOON.ice, -57),
    park: flat(CARTOON.park, -56, canopyTexture(CARTOON.park, CARTOON.parkLeaf, CARTOON.leafLight)),
    // Close up the woods are real 3D trees: plain ground under them
    parkPlain: flat(CARTOON.park, -56),
    forestPlain: flat(CARTOON.forest, -56),
    forest: flat(CARTOON.forest, -56, canopyTexture(CARTOON.forest, CARTOON.forestLeaf, CARTOON.leafLight)),
    river: flat(CARTOON.river, -53),
    border: flat(CARTOON.border, -52),
    road: flat(CARTOON.road, -50),
    bigRoad: flat(CARTOON.bigRoad, -49),
    rail: flat(CARTOON.rail, -49),
    zebra: flat(CARTOON.zebra, -48),
    // Double-sided: the tile frame mirrors y (north up on screen, rows down in the tile)
    building: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    roof: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    trunk: new THREE.MeshLambertMaterial({ color: CARTOON.trunk, side: THREE.DoubleSide }),
    leaves: lit(CARTOON.treeLeaf),
    leavesLight: lit(CARTOON.treeLeafLight),
    pine: lit(CARTOON.pine),
    pineLight: lit(CARTOON.pineLight),
    // Cliffs face the water; lit so the rock reads as a wall
    cliff: new THREE.MeshLambertMaterial({ vertexColors: true }),
    // Same walls with the painted rock (the vertex colours still give the lighter top)
    cliffTextured: new THREE.MeshLambertMaterial({ vertexColors: true }),
    pole: new THREE.MeshLambertMaterial({ color: CARTOON.pole, side: THREE.DoubleSide }),
    lampRed: new THREE.MeshBasicMaterial({ color: CARTOON.lightRed }),
    lampAmber: new THREE.MeshBasicMaterial({ color: CARTOON.lightAmber }),
    lampGreen: new THREE.MeshBasicMaterial({ color: CARTOON.lightGreen }),
    hill: new THREE.MeshLambertMaterial({ color: CARTOON.hill, flatShading: true, side: THREE.DoubleSide }),
    mountain: new THREE.MeshLambertMaterial({ color: CARTOON.mountainRock, flatShading: true, side: THREE.DoubleSide }),
    snow: new THREE.MeshLambertMaterial({ color: CARTOON.snow, flatShading: true, side: THREE.DoubleSide }),
  }
}
type Materials = ReturnType<typeof materials>

// ---- Geometry helpers (tile space: u, v in 0…1, v down) -------------------------------------
function polygonsGeometry(polygons: number[][][], uvScale: number, height = 0) {
  const positions: number[] = [], uvs: number[] = []
  for (const polygon of polygons) {
    const rings = polygon.map((ring) => { const pts: THREE.Vector2[] = []; for (let i = 0; i < ring.length; i += 2) pts.push(new THREE.Vector2(ring[i] / GRID, ring[i + 1] / GRID)); return pts })
    const [outer, ...holes] = rings
    if (!outer || outer.length < 3) continue
    let triangles: number[][]
    try { triangles = THREE.ShapeUtils.triangulateShape(outer, holes) } catch { continue }
    const all = outer.concat(...holes)
    for (const tri of triangles) for (const index of tri) {
      const p = all[index]
      positions.push(p.x, p.y, height)
      uvs.push(p.x * uvScale, p.y * uvScale)
    }
  }
  if (!positions.length) return null
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  return geometry
}

// Flat ribbons along lines, `width` in tile units
function ribbonGeometry(lines: { pts: number[]; width: number }[], dashed = false, height = 0) {
  const positions: number[] = []
  for (const { pts, width } of lines) {
    for (let i = 0; i + 3 < pts.length; i += 2) {
      if (dashed && (i / 2) % 2) continue
      const ax = pts[i] / GRID, ay = pts[i + 1] / GRID, bx = pts[i + 2] / GRID, by = pts[i + 3] / GRID
      const length = Math.hypot(bx - ax, by - ay)
      if (!length) continue
      const nx = (-(by - ay) / length) * width / 2, ny = ((bx - ax) / length) * width / 2
      // a little past each end so joins look continuous
      const ex = ((bx - ax) / length) * width / 2, ey = ((by - ay) / length) * width / 2
      const a1 = [ax - ex + nx, ay - ey + ny], a2 = [ax - ex - nx, ay - ey - ny], b1 = [bx + ex + nx, by + ey + ny], b2 = [bx + ex - nx, by + ey - ny]
      positions.push(a1[0], a1[1], height, a2[0], a2[1], height, b1[0], b1[1], height, b1[0], b1[1], height, a2[0], a2[1], height, b2[0], b2[1], height)
    }
  }
  if (!positions.length) return null
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return geometry
}

// Every land edge that is a real shore (not the tile's own border)
function shoreEdges(land: number[][][]) {
  const edges: { ax: number; ay: number; bx: number; by: number; landOnLeft: boolean }[] = []
  const onBorder = (x: number, y: number) => x <= 1 || y <= 1 || x >= GRID - 1 || y >= GRID - 1
  for (const polygon of land) polygon.forEach((ring, index) => {
    let area = 0
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) area += ring[j] * ring[i + 1] - ring[i] * ring[j + 1]
    // Shoelace > 0: the ring's inside is on the left of its edges. Land is inside the outer ring
    // and outside the holes.
    const landOnLeft = index === 0 ? area > 0 : area < 0
    for (let i = 0; i < ring.length; i += 2) {
      const j = (i + 2) % ring.length
      const ax = ring[i], ay = ring[i + 1], bx = ring[j], by = ring[j + 1]
      if (onBorder(ax, ay) && onBorder(bx, by) && (ax === bx || ay === by)) continue
      edges.push({ ax: ax / GRID, ay: ay / GRID, bx: bx / GRID, by: by / GRID, landOnLeft })
    }
  })
  return edges
}

// Rock walls from the land down to the water, facing the water, lighter at the top
function cliffGeometry(edges: ReturnType<typeof shoreEdges>, depth: number) {
  const positions: number[] = [], colors: number[] = [], uvs: number[] = []
  const top = new THREE.Color(CARTOON.cliffTop), bottom = new THREE.Color(CARTOON.cliff)
  let run = 0
  for (const { ax, ay, bx, by, landOnLeft } of edges) {
    const length = Math.hypot(bx - ax, by - ay)
    const P = [ax, ay, 0, run], Q = [bx, by, 0, run + length], Pb = [ax, ay, -depth, run], Qb = [bx, by, -depth, run + length]
    run += length
    // (P, Q, Pb) faces left of P→Q; the water is on the side away from the land
    const tris = landOnLeft ? [P, Pb, Q, Q, Pb, Qb] : [P, Q, Pb, Q, Qb, Pb]
    for (const v of tris) {
      positions.push(v[0], v[1], v[2]); const c = v[2] < 0 ? bottom : top; colors.push(c.r, c.g, c.b)
      uvs.push(v[3] * 40, v[2] < 0 ? 0 : 1)
    }
  }
  if (!positions.length) return null
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.computeVertexNormals()
  return geometry
}

// Buildings: walls and a flat roof, pastel colours varied per building, lit so the sides read
function buildingsGeometry(buildings: NonNullable<CartoonTile['buildings']>, metresPerUnit: number, across: number, tileMetres: number) {
  const positions: number[] = [], colors: number[] = []
  // Roofs apart from the walls: they carry the painted tile texture (u, v in metres / 3)
  const roofPositions: number[] = [], roofColors: number[] = [], roofUvs: number[] = []
  const tileUv = tileMetres / 3
  const wall = new THREE.Color(), roof = new THREE.Color()
  const walls = CARTOON.buildingWalls.map((c) => new THREE.Color(c))
  const roofs = CARTOON.buildingRoofs.map((c) => new THREE.Color(c))
  for (const [index, { h, b, ring }] of buildings.entries()) {
    if (ring.length < 6) continue
    wall.copy(walls[index % walls.length]); roof.copy(roofs[(index * 7) % roofs.length])
    const top = h / metresPerUnit, bottom = b / metresPerUnit
    const pts: THREE.Vector2[] = []
    for (let i = 0; i < ring.length; i += 2) pts.push(new THREE.Vector2(ring[i] / GRID, ring[i + 1] / GRID))
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length]
      positions.push(p.x, p.y, bottom, q.x, q.y, bottom, q.x, q.y, top, p.x, p.y, bottom, q.x, q.y, top, p.x, p.y, top)
      for (let k = 0; k < 6; k++) colors.push(wall.r, wall.g, wall.b)
    }
    // Houses (small footprints) get a pitched roof over their oriented box; larger buildings a flat one
    let area = 0
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) area += pts[j].x * pts[i].y - pts[i].x * pts[j].y
    const squareMetres = Math.abs(area / 2) * tileMetres * tileMetres
    if (squareMetres < 700 && pts.length >= 4) {
      const cx = pts.reduce((sum, p) => sum + p.x, 0) / pts.length, cy = pts.reduce((sum, p) => sum + p.y, 0) / pts.length
      let xx = 0, xy = 0, yy = 0
      for (const p of pts) { xx += (p.x - cx) ** 2; xy += (p.x - cx) * (p.y - cy); yy += (p.y - cy) ** 2 }
      const angle = 0.5 * Math.atan2(2 * xy, xx - yy)
      const ax = Math.cos(angle), ay = Math.sin(angle)
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity
      for (const p of pts) {
        const a = (p.x - cx) * ax + (p.y - cy) * ay, b = -(p.x - cx) * ay + (p.y - cy) * ax
        minA = Math.min(minA, a); maxA = Math.max(maxA, a); minB = Math.min(minB, b); maxB = Math.max(maxB, b)
      }
      const long = maxA - minA >= maxB - minB
      const [e1x, e1y, e2x, e2y] = long ? [ax, ay, -ay, ax] : [-ay, ax, -ax, -ay]
      const hl = ((long ? maxA - minA : maxB - minB) / 2) * 1.06, hw = ((long ? maxB - minB : maxA - minA) / 2) * 1.12
      const mx = cx + ax * (maxA + minA) / 2 - ay * (maxB + minB) / 2, my = cy + ay * (maxA + minA) / 2 + ax * (maxB + minB) / 2
      const rise = hw * across * 0.95
      const corner = (s1: number, s2: number) => [mx + e1x * hl * s1 + e2x * hw * s2, my + e1y * hl * s1 + e2y * hw * s2, top]
      const ridge = (s1: number) => [mx + e1x * hl * s1, my + e1y * hl * s1, top + rise]
      const A = corner(1, 1), B = corner(-1, 1), C = corner(-1, -1), D = corner(1, -1), R1 = ridge(1), R2 = ridge(-1)
      const push = (tri: number[][], color: THREE.Color) => { for (const v of tri) { positions.push(v[0], v[1], v[2]); colors.push(color.r, color.g, color.b) } }
      const roofPush = (tri: number[][]) => {
        for (const v of tri) {
          const along = ((v[0] - mx) * e1x + (v[1] - my) * e1y) * tileUv
          const up = (hw - Math.abs((v[0] - mx) * e2x + (v[1] - my) * e2y)) * tileUv
          roofPositions.push(v[0], v[1], v[2]); roofColors.push(roof.r, roof.g, roof.b); roofUvs.push(along, up)
        }
      }
      roofPush([A, B, R2, A, R2, R1])
      roofPush([C, D, R1, C, R1, R2])
      push([D, A, R1], wall)
      push([B, C, R2], wall)
      continue
    }
    const flatRoof = squareMetres > 2500 ? new THREE.Color(CARTOON.flatRoof) : roof
    let triangles: number[][]
    try { triangles = THREE.ShapeUtils.triangulateShape(pts, []) } catch { continue }
    for (const tri of triangles) for (const i of tri) { roofPositions.push(pts[i].x, pts[i].y, top); roofColors.push(flatRoof.r, flatRoof.g, flatRoof.b); roofUvs.push(pts[i].x * tileUv, pts[i].y * tileUv) }
  }
  const make = (pos: number[], col: number[], uv?: number[]) => {
    if (!pos.length) return null
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    if (uv) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    geometry.computeVertexNormals()
    return geometry
  }
  return { walls: make(positions, colors), roofs: make(roofPositions, roofColors, roofUvs) }
}

// Random points inside polygons (for trees), deterministic per tile
function scatter(polygons: number[][][], perUnitArea: number, max: number, seed: number) {
  let s = seed || 1
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  const points: [number, number][] = []
  for (const polygon of polygons) {
    const outer = polygon[0].map((v) => v / GRID)
    let minX = 1, minY = 1, maxX = 0, maxY = 0
    for (let i = 0; i < outer.length; i += 2) { minX = Math.min(minX, outer[i]); maxX = Math.max(maxX, outer[i]); minY = Math.min(minY, outer[i + 1]); maxY = Math.max(maxY, outer[i + 1]) }
    const tries = Math.min(max - points.length, Math.ceil((maxX - minX) * (maxY - minY) * perUnitArea))
    for (let t = 0; t < tries && points.length < max; t++) {
      const x = minX + rnd() * (maxX - minX), y = minY + rnd() * (maxY - minY)
      if (x < 0 || y < 0 || x > 1 || y > 1) continue
      let inside = false
      for (let i = 0, j = outer.length - 2; i < outer.length; j = i, i += 2) {
        if ((outer[i + 1] > y) !== (outer[j + 1] > y) && x < ((outer[j] - outer[i]) * (y - outer[i + 1])) / (outer[j + 1] - outer[i + 1]) + outer[i]) inside = !inside
      }
      if (inside) points.push([x, y])
    }
    if (points.length >= max) break
  }
  return points
}

// Where roads of some size meet: the shared end points of their lines
function crossings(roads: NonNullable<CartoonTile['roads']>, max: number) {
  const count = new Map<string, { x: number; y: number; n: number; dir: [number, number] }>()
  for (const road of roads) {
    if (road.rail || road.r < 2) continue
    const ends = [[0, 2], [road.pts.length - 2, road.pts.length - 4]]
    for (const [i, j] of ends) {
      const key = `${road.pts[i]},${road.pts[i + 1]}`
      const entry = count.get(key) || { x: road.pts[i] / GRID, y: road.pts[i + 1] / GRID, n: 0, dir: [road.pts[j] - road.pts[i], road.pts[j + 1] - road.pts[i + 1]] as [number, number] }
      entry.n++
      count.set(key, entry)
    }
  }
  return [...count.values()].filter((c) => c.n >= 3 && c.x > 0.02 && c.y > 0.02 && c.x < 0.98 && c.y < 0.98).slice(0, max)
}

// ---- The world --------------------------------------------------------------------------------
export function createCartoonWorld(parent: THREE.Object3D, options: CartoonWorldOptions) {
  const root = new THREE.Group()
  root.name = 'cartoon-world'
  parent.add(root)
  if (import.meta.env.DEV) (window as unknown as { __cartoonRoot?: THREE.Group }).__cartoonRoot = root
  const m: Materials = materials()
  for (const [name, key, color] of [['grass', 'land', CARTOON.land], ['grass', 'grass', CARTOON.grass], ['forest', 'forest', CARTOON.forest], ['grass', 'park', CARTOON.park], ['forest', 'forestPlain', CARTOON.forest], ['grass', 'parkPlain', CARTOON.park], ['water', 'water', CARTOON.water], ['sand', 'sand', CARTOON.sand], ['stone', 'town', CARTOON.town], ['cliff', 'cliffTextured', '#ffffff'], ['roofRed', 'roof', '#ffffff']] as const) {
    paintedDetail(name, m[key] as THREE.MeshBasicMaterial, color, () => options.redraw())
  }
  const tiles = new Map<string, { group: THREE.Group; used: number; ready: boolean }>()
  const loading = new Map<string, Promise<void>>()
  let wanted = new Set<string>()
  let disposed = false
  let serial = 0

  // Shared small models for instancing
  const treeTrunk = new THREE.CylinderGeometry(0.12, 0.16, 1, 5).rotateX(Math.PI / 2).translate(0, 0, 0.5)
  const treeCrown = new THREE.IcosahedronGeometry(0.66, 1).translate(0, 0, 1.45)
  const pineLow = new THREE.ConeGeometry(0.62, 1.15, 7).rotateX(Math.PI / 2).translate(0, 0, 1.0)
  const pineHigh = new THREE.ConeGeometry(0.44, 0.95, 7).rotateX(Math.PI / 2).translate(0, 0, 1.62)
  const zebraBar = new THREE.PlaneGeometry(1, 1)
  const pole = new THREE.CylinderGeometry(0.08, 0.08, 1, 5).rotateX(Math.PI / 2).translate(0, 0, 0.5)
  const lamp = new THREE.SphereGeometry(0.12, 8, 6)
  const hill = new THREE.ConeGeometry(1, 1, 7).rotateX(Math.PI / 2).translate(0, 0, 0.5)
  const cap = new THREE.ConeGeometry(0.36, 0.36, 7).rotateX(Math.PI / 2).translate(0, 0, 0.82)
  const skirt = new THREE.ConeGeometry(1, 1, 9).rotateX(Math.PI / 2).translate(0, 0, 0.5)

  // Tile buildings are rebuilt without the footprints a styled street scene (styledDistrict.ts)
  // draws itself: they are the same OSM buildings, and the cartoon houses' gable roofs would
  // otherwise poke out between the styled ones as coloured shards.
  type TileBuildings = { list: NonNullable<CartoonTile['buildings']>; metresPerUnit: number; across: number; tileMetres: number; solid: THREE.Group; z: number; x: number; y: number; filterKey?: string }
  let hiddenBounds: { west: number; south: number; east: number; north: number } | null = null
  function addBuildingMeshes(group: THREE.Group, list: NonNullable<CartoonTile['buildings']>) {
    const info = group.userData.buildings as TileBuildings
    const { walls, roofs } = buildingsGeometry(list, info.metresPerUnit, info.across, info.tileMetres)
    for (const [geometry, material] of [[walls, m.building], [roofs, m.roof]] as const) {
      if (!geometry) continue
      // footprints are in tile space: scale them back up inside the undo-scale group
      const item = new THREE.Mesh(geometry, material)
      item.scale.set(group.scale.x, group.scale.y, 1)
      item.frustumCulled = false
      item.userData.building = true
      info.solid.add(item)
    }
  }
  function applyBuildingFilter(tile: { group: THREE.Group }) {
    const info = tile.group.userData.buildings as TileBuildings | undefined
    if (!info) return false
    const b = hiddenBounds
    const west = tileLng(info.x, info.z), east = tileLng(info.x + 1, info.z), north = tileLat(info.y, info.z), south = tileLat(info.y + 1, info.z)
    const touches = Boolean(b && west < b.east && east > b.west && south < b.north && north > b.south)
    const key = touches && b ? `${b.west},${b.south},${b.east},${b.north}` : ''
    if (key === (info.filterKey ?? '')) return false
    info.filterKey = key
    for (const item of [...info.solid.children]) if (item.userData.building) { (item as THREE.Mesh).geometry.dispose(); info.solid.remove(item) }
    // A building is left out when its centre lies inside the styled scene (ring points run 0..GRID across the tile, north down)
    const kept = touches && b ? info.list.filter(({ ring }) => {
      let cx = 0, cy = 0, n = 0
      for (let i = 0; i < ring.length; i += 2) { cx += ring[i] / GRID; cy += ring[i + 1] / GRID; n++ }
      const lng = tileLng(info.x + cx / n, info.z), lat = tileLat(info.y + cy / n, info.z)
      return !(lng > b.west && lng < b.east && lat > b.south && lat < b.north)
    }) : info.list
    if (kept.length) addBuildingMeshes(tile.group, kept)
    return true
  }

  function place(group: THREE.Group, z: number, x: number, y: number) {
    const nw = options.toScene(tileLat(y, z), tileLng(x, z))
    const se = options.toScene(tileLat(y + 1, z), tileLng(x + 1, z))
    group.position.copy(nw)
    group.scale.set(se.x - nw.x, se.y - nw.y, 1)
    return Math.abs(se.x - nw.x) // scene units across the tile
  }

  function mesh(geometry: THREE.BufferGeometry | null, material: THREE.Material, into: THREE.Group, order: number) {
    if (!geometry) return
    const item = new THREE.Mesh(geometry, material)
    item.renderOrder = order
    item.frustumCulled = false
    into.add(item)
  }

  function build(z: number, x: number, y: number, data: CartoonTile, detail: boolean) {
    const group = new THREE.Group()
    group.name = `cartoon-${z}/${x}/${y}`
    const across = place(group, z, x, y)
    const lat = tileLat(y + 0.5, z)
    // Metres on the ground per scene unit across this tile (the map frame is Web Mercator)
    const tileMetres = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / 2 ** z
    const metresPerUnit = tileMetres / across
    const order = detail ? 0 : -20 // coarse far tiles draw first
    // Heights: scene z is in map units; the tile group is not scaled in z
    const ground = new THREE.Group()
    ground.scale.set(1, 1, 1)
    group.add(ground)
    const magnify = detail ? 1 : FAR_MAGNIFICATION
    // Widths are in tile units: a tile shows about 512 pixels at its own zoom
    // (thinner at country scale, where roads would otherwise cover the land)
    const px = (pixels: number) => (pixels / 512) * (z < 7 ? 0.45 : z < 10 ? 0.7 : 1) / magnify
    // Land stands above the water like a diorama: the sea is the tile's floor, the land sits on top,
    // and rock cliffs with a line of surf follow the real shores
    const cliffMetres = Math.max(5, Math.min(tileMetres * 0.012, 2500)) / magnify
    const depth = cliffMetres / metresPerUnit
    const quad = new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, -depth)
    const uv = quad.getAttribute('uv') as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 6 * magnify, uv.getY(i) * 6 * magnify)
    mesh(quad, m.water, ground, m.water.userData.order + order)
    const land = data.land ?? [[[0, 0, GRID, 0, GRID, GRID, 0, GRID]]]
    mesh(polygonsGeometry(land, 10 * magnify), m.land, ground, m.land.userData.order + order)
    if (data.land) {
      const edges = shoreEdges(data.land)
      mesh(ribbonGeometry(edges.map((e) => ({ pts: [e.ax * GRID, e.ay * GRID, e.bx * GRID, e.by * GRID], width: px(3) })), false, -depth * 0.97), m.foam, ground, m.foam.userData.order + order)
      const walls = cliffGeometry(edges, depth)
      // The walls hang below the ground, and the ground layers write no depth: drawn before them, so
      // the land in front paints over a wall's hidden part instead of the wall standing up like a fence
      mesh(walls, m.cliffTextured, ground, -100 + order)
    } else if (data.water?.length) {
      // Tiles built before land was separated: flat water on the land
      mesh(polygonsGeometry(data.water, 6 * magnify, 0.001), m.water, ground, m.river.userData.order + order)
    }
    const kinds = ['town', 'grass', 'sand', 'rock', 'ice', 'park', 'forest'] as const
    for (const kind of kinds) {
      const polygons = data[kind]
      const material = detail && z >= 13 && kind === 'park' ? m.parkPlain : detail && z >= 13 && kind === 'forest' ? m.forestPlain : m[kind]
      if (polygons?.length) mesh(polygonsGeometry(polygons, 10 * magnify), material, ground, material.userData.order + order)
    }
    if (data.rivers) mesh(ribbonGeometry(data.rivers.map((r) => ({ pts: r.pts, width: px(r.w + 1) }))), m.river, ground, m.river.userData.order + order)
    if (data.borders) mesh(ribbonGeometry(data.borders.map((b) => ({ pts: b.pts, width: px(b.l <= 2 ? 3 : 1.6) })), true), m.border, ground, m.border.userData.order + order)
    if (data.roads) {
      const width = [1.2, 1.8, 2.6, 3.4, 4.6, 5.6]
      mesh(ribbonGeometry(data.roads.filter((r) => !r.rail && r.r < 4).map((r) => ({ pts: r.pts, width: px(width[r.r]) }))), m.road, ground, m.road.userData.order + order)
      mesh(ribbonGeometry(data.roads.filter((r) => !r.rail && r.r >= 4).map((r) => ({ pts: r.pts, width: px(width[r.r]) }))), m.bigRoad, ground, m.bigRoad.userData.order + order)
      mesh(ribbonGeometry(data.roads.filter((r) => r.rail).map((r) => ({ pts: r.pts, width: px(1.4) })), true), m.rail, ground, m.rail.userData.order + order)
    }
    if (detail && z >= 13) {
      // 3D pieces are sized in metres and kept upright: a group with the tile's x/y scale undone
      const solid = new THREE.Group()
      group.add(solid)
      const toLocal = (u: number, v: number) => new THREE.Vector3(u * group.scale.x, v * group.scale.y, 0)
      solid.scale.set(1 / group.scale.x, 1 / group.scale.y, 1)
      const metre = 1 / metresPerUnit // scene units per metre
      if (data.buildings?.length && z >= 14) {
        group.userData.buildings = { list: data.buildings, metresPerUnit, across, tileMetres, solid, z, x, y } satisfies TileBuildings
        addBuildingMeshes(group, data.buildings)
      }
      // Trees: mostly pines in woods, round leafy trees in parks and a few on open grass
      const size = (z >= 14 ? 10 : 28) * metre
      const planting = [
        ...scatter(data.forest || [], z >= 14 ? 1600 : 420, z >= 14 ? 700 : 240, x * 31 + y * 17).map((p) => [...p, 0.68] as const),
        ...scatter(data.park || [], z >= 14 ? 1100 : 300, z >= 14 ? 360 : 120, x * 13 + y * 7).map((p) => [...p, 0.25] as const),
        ...scatter(data.grass || [], z >= 14 ? 240 : 60, z >= 14 ? 120 : 40, x * 7 + y * 29).map((p) => [...p, 0.3] as const),
      ]
      if (planting.length) {
        const pines = planting.filter((_, i) => ((i * 2654435761) >>> 0) / 4294967296 < planting[i][2])
        const rounds = planting.filter((_, i) => !(((i * 2654435761) >>> 0) / 4294967296 < planting[i][2]))
        const trunks = new THREE.InstancedMesh(treeTrunk, m.trunk, planting.length)
        const lows = new THREE.InstancedMesh(pineLow, m.pine, Math.max(1, pines.length))
        const highs = new THREE.InstancedMesh(pineHigh, m.pineLight, Math.max(1, pines.length))
        const crowns = [new THREE.InstancedMesh(treeCrown, m.leaves, Math.max(1, rounds.length)), new THREE.InstancedMesh(treeCrown, m.leavesLight, Math.max(1, rounds.length))]
        lows.count = highs.count = pines.length
        crowns[0].count = crowns[1].count = 0
        const matrix = new THREE.Matrix4()
        const scaleOf = (i: number) => size * (0.75 + ((i * 37) % 10) / 20)
        planting.forEach(([u, v], i) => { const s = scaleOf(i); matrix.makeScale(s, s, s).setPosition(toLocal(u, v)); trunks.setMatrixAt(i, matrix) })
        pines.forEach(([u, v], i) => { const s = scaleOf(i + 3) * 1.15; matrix.makeScale(s, s, s * 1.2).setPosition(toLocal(u, v)); lows.setMatrixAt(i, matrix); highs.setMatrixAt(i, matrix) })
        rounds.forEach(([u, v], i) => { const s = scaleOf(i + 5); const target = crowns[i % 2]; matrix.makeScale(s, s, s).setPosition(toLocal(u, v)); target.setMatrixAt(target.count++, matrix) })
        for (const item of [trunks, lows, highs, ...crowns]) { item.frustumCulled = false; solid.add(item) }
      }
      // Zebra crossings and traffic lights where streets meet
      if (z >= 14 && data.roads) {
        const spots = crossings(data.roads, 40)
        if (spots.length) {
          const bars = new THREE.InstancedMesh(zebraBar, m.zebra, spots.length * 5)
          bars.renderOrder = m.zebra.userData.order
          const poles = new THREE.InstancedMesh(pole, m.pole, spots.length)
          const lamps = [m.lampRed, m.lampAmber, m.lampGreen].map((material) => new THREE.InstancedMesh(lamp, material, spots.length))
          const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3()
          spots.forEach((spot, i) => {
            const at = toLocal(spot.x, spot.y)
            const dir = new THREE.Vector2(spot.dir[0] * group.scale.x, spot.dir[1] * group.scale.y).normalize()
            const angle = Math.atan2(dir.y, dir.x)
            rotation.setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle)
            for (let k = 0; k < 5; k++) {
              const along = (6 + 0) * metre, across = (k - 2) * 1.6 * metre
              const pos = at.clone().add(new THREE.Vector3(Math.cos(angle) * along - Math.sin(angle) * across, Math.sin(angle) * along + Math.cos(angle) * across, 0.05 * metre))
              matrix.compose(pos, rotation, scale.set(3.4 * metre, 0.8 * metre, 1)); bars.setMatrixAt(i * 5 + k, matrix)
            }
            const corner = at.clone().add(new THREE.Vector3(Math.cos(angle + 0.8) * 9 * metre, Math.sin(angle + 0.8) * 9 * metre, 0))
            matrix.compose(corner, new THREE.Quaternion(), scale.set(metre * 1.6, metre * 1.6, metre * 5)); poles.setMatrixAt(i, matrix)
            lamps.forEach((item, k) => {
              matrix.compose(corner.clone().add(new THREE.Vector3(0, 0, metre * (5.6 + k * 0.45))), new THREE.Quaternion(), scale.set(metre * 1.6, metre * 1.6, metre * 1.6))
              item.setMatrixAt(i, matrix)
            })
          })
          for (const item of [bars, poles, ...lamps]) { item.frustumCulled = false; solid.add(item) }
        }
      }
    }
    // Hills at mountain peaks: cartoon cones, snow on the high ones
    if (data.peaks?.length) {
      const hills = new THREE.InstancedMesh(hill, m.mountain, data.peaks.length)
      const caps = new THREE.InstancedMesh(cap, m.snow, data.peaks.length)
      const feet = new THREE.InstancedMesh(skirt, m.hill, data.peaks.length)
      const matrix = new THREE.Matrix4()
      const holder = new THREE.Group()
      holder.scale.set(1 / group.scale.x, 1 / group.scale.y, 1)
      group.add(holder)
      data.peaks.forEach((peak, i) => {
        // Seen from far away a real peak would be invisible: hills are drawn at a readable size
        const radius = Math.max(across * 0.018, Math.min(across * 0.05, (peak.e * 2.2) / metresPerUnit))
        const height = radius * (peak.e > 1500 ? 1.25 : 0.9)
        matrix.makeScale(radius, radius, height).setPosition(new THREE.Vector3((peak.x / GRID) * group.scale.x, (peak.y / GRID) * group.scale.y, 0))
        hills.setMatrixAt(i, matrix)
        caps.setMatrixAt(i, peak.e > 1200 ? matrix : new THREE.Matrix4().makeScale(0, 0, 0))
        feet.setMatrixAt(i, new THREE.Matrix4().makeScale(radius * 1.7, radius * 1.7, height * 0.32).setPosition(new THREE.Vector3((peak.x / GRID) * group.scale.x, (peak.y / GRID) * group.scale.y, 0)))
      })
      hills.frustumCulled = caps.frustumCulled = feet.frustumCulled = false
      holder.add(feet, hills, caps)
    }
    return group
  }

  async function load(z: number, x: number, y: number, detail: boolean) {
    const key = tileKey(z, x, y, detail)
    if (tiles.has(key) || loading.has(key)) return
    const task = (async () => {
      const response = await fetch(`/api/cartoon-tiles/${z}/${x}/${y}.json`)
      if (!response.ok) throw new Error(`cartoon tile ${key}: ${response.status}`)
      const data = (await response.json()) as CartoonTile
      if (disposed) return
      const group = build(z, x, y, data, detail)
      root.add(group)
      const tile = { group, used: serial, ready: true }
      tiles.set(key, tile)
      applyBuildingFilter(tile)
      showWanted()
      options.redraw()
    })().catch(() => { retrySoon() }).finally(() => loading.delete(key))
    loading.set(key, task)
  }

  // Wanted tiles show. Tiles one level away stand in until every wanted tile is in, so the ground
  // never flashes empty; anything coarser is hidden at once — its roads, drawn for its own scale,
  // would be kilometres wide seen this close.
  let nearZoom = 0, farZoom = 0
  function showWanted() {
    const complete = [...wanted].every((key) => tiles.has(key))
    for (const [key, tile] of tiles) {
      const z = Number(key.split('/')[0])
      const standIn = !complete && (Math.abs(z - nearZoom) <= 1 || Math.abs(z - farZoom) <= 1)
      if (wanted.has(key)) { tile.group.visible = true; tile.used = serial }
      else tile.group.visible = standIn && tile.group.visible
    }
    if (tiles.size > MAX_TILES) {
      const old = [...tiles.entries()].filter(([key]) => !wanted.has(key)).sort((a, b) => a[1].used - b[1].used)
      for (const [key, tile] of old.slice(0, tiles.size - MAX_TILES)) {
        tile.group.traverse((item) => { if ((item as THREE.Mesh).geometry && !(item as THREE.InstancedMesh).isInstancedMesh) (item as THREE.Mesh).geometry.dispose() })
        root.remove(tile.group)
        tiles.delete(key)
      }
    }
  }

  // A tile that could not be built yet (source slow or down) is asked for again shortly
  let retryTimer = 0
  function retrySoon() {
    if (retryTimer || disposed) return
    retryTimer = window.setTimeout(() => { retryTimer = 0; refresh() }, 5000)
  }

  function refresh() {
    if (disposed) return
    serial++
    const { zoom, center, bounds } = options.view()
    const near = Math.max(3, Math.min(14, Math.round(zoom - 0.2)))
    const far = Math.max(2, near - 3)
    nearZoom = near
    farZoom = far
    const next = new Set<string>()
    const jobs: [number, number, number, boolean][] = []
    // Detailed tiles around the centre
    const cx = lngTile(center.lng, near), cy = latTile(center.lat, near)
    for (let dy = -NEAR_RADIUS; dy <= NEAR_RADIUS; dy++) for (let dx = -NEAR_RADIUS; dx <= NEAR_RADIUS; dx++) {
      const x = cx + dx, y = cy + dy
      if (y < 0 || y >= 2 ** near) continue
      const wrapped = ((x % 2 ** near) + 2 ** near) % 2 ** near
      next.add(tileKey(near, wrapped, y, true)); jobs.push([near, wrapped, y, true])
    }
    // Coarse tiles over the rest of the visible area (the horizon when the map is tilted)
    const west = lngTile(bounds.west, far), east = lngTile(bounds.east, far)
    const north = latTile(Math.min(85, bounds.north), far), south = latTile(Math.max(-85, bounds.south), far)
    const coarse: [number, number][] = []
    for (let y = Math.max(0, north); y <= Math.min(2 ** far - 1, south); y++) for (let x = west; x <= east; x++) coarse.push([((x % 2 ** far) + 2 ** far) % 2 ** far, y])
    const fx = lngTile(center.lng, far), fy = latTile(center.lat, far)
    coarse.sort((a, b) => Math.hypot(a[0] - fx, a[1] - fy) - Math.hypot(b[0] - fx, b[1] - fy))
    for (const [x, y] of coarse.slice(0, 36)) { next.add(tileKey(far, x, y, false)); jobs.push([far, x, y, false]) }
    wanted = next
    showWanted()
    // Nearest first, a few at a time
    jobs.sort((a, b) => Number(b[3]) - Number(a[3]))
    let running = 0
    const queue = jobs.filter(([z, x, y, detail]) => !tiles.has(tileKey(z, x, y, detail)))
    const pump = () => {
      while (running < 6 && queue.length) {
        const [z, x, y, detail] = queue.shift()!
        running++
        load(z, x, y, detail).finally(() => { running--; pump() })
      }
    }
    pump()
  }

  return {
    refresh,
    // For tests and debugging: tiles on screen, and whether streets have buildings / trees
    stats() {
      const shown = [...tiles.entries()].filter(([, t]) => t.group.visible)
      let buildings = 0, trees = 0, crossings = 0
      for (const [, t] of shown) t.group.traverse((item) => {
        const mesh = item as THREE.InstancedMesh
        if (mesh.isInstancedMesh && mesh.material === m.trunk) trees += mesh.count
        else if (mesh.isInstancedMesh && mesh.material === m.zebra) crossings += mesh.count / 5
        else if ((mesh as THREE.Mesh).material === m.building) buildings++
      })
      return { tiles: shown.length, zoom: shown.length ? Math.max(...shown.map(([key]) => Number(key.split('/')[0]))) : 0, buildings, trees, crossings }
    },
    setVisible(visible: boolean) { root.visible = visible },
    // Leave out tile buildings inside this WGS-84 box (a styled street scene draws them); null shows all again
    hideBuildingsIn(bounds: { west: number; south: number; east: number; north: number } | null) {
      const same = bounds === hiddenBounds || (bounds && hiddenBounds && bounds.west === hiddenBounds.west && bounds.south === hiddenBounds.south && bounds.east === hiddenBounds.east && bounds.north === hiddenBounds.north)
      if (same) return
      hiddenBounds = bounds
      let changed = false
      for (const tile of tiles.values()) if (applyBuildingFilter(tile)) changed = true
      if (changed) options.redraw()
    },
    dispose() {
      disposed = true
      window.clearTimeout(retryTimer)
      for (const tile of tiles.values()) tile.group.traverse((item) => (item as THREE.Mesh).geometry?.dispose())
      tiles.clear()
      for (const value of Object.values(m)) { const material = value as THREE.Material & { map?: THREE.Texture }; material.map?.dispose(); material.dispose() }
      for (const geometry of [treeTrunk, treeCrown, pineLow, pineHigh, zebraBar, pole, lamp, hill, cap, skirt]) geometry.dispose()
      parent.remove(root)
    },
  }
}

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { createPublicLandmark, type PublicLandmark } from './publicLandmarks'
import registry from './landmarkSites.json'

type Point = [number, number]
type Landmark = 'gongshu-umbrella' | 'gongshu-jade' | PublicLandmark

// Registry entries refer to identified buildings, never an entire city or park.
// Ground footprint: OSM. Shape language: architect's published plans/elevations.
// Heights, panel spacing and finishes remain authored cartoon approximations.
export function venueLandmark(id: string): Landmark | undefined {
  if (/^osm:way:1084641014(?::|$)/.test(id)) return 'gongshu-umbrella'
  if (/^osm:way:1084641019(?::|$)/.test(id)) return 'gongshu-jade'
  return registry.buildings.find((building) => id === building.id || id.startsWith(building.id + ':'))?.model as PublicLandmark | undefined
}

// A small baked diffuse fill matches the district's existing pastel Lambert
// palette under the shared map light. Shadows and shape shading remain active.
const material = (color: string, roughness = .68) => new THREE.MeshStandardMaterial({ color, roughness, emissive: color, emissiveIntensity: .09 })
function mesh(group: THREE.Group, geometry: THREE.BufferGeometry, mat: THREE.Material, name = '') {
  const item = new THREE.Mesh(geometry, mat)
  item.castShadow = item.receiveShadow = true; item.name = name; group.add(item)
  return item
}
function tube(points: THREE.Vector3[], radius: number) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), Math.max(10, points.length * 2), radius, 6, false)
}
function merged(group: THREE.Group, pieces: THREE.BufferGeometry[], mat: THREE.Material, name: string) {
  if (!pieces.length) return
  mesh(group, mergeGeometries(pieces), mat, name)
  pieces.forEach((piece) => piece.dispose())
}
function surface(at: (u: number, v: number) => THREE.Vector3, columns: number, rows: number, flip = false) {
  const positions: number[] = [], indices: number[] = []
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) {
    const p = at(x / columns, y / rows); positions.push(p.x, p.y, p.z)
    if (x && y) { const n = y * (columns + 1) + x; indices.push(n, n - 1, n - columns - 2, n, n - columns - 2, n - columns - 1) }
  }
  if (flip) for (let i = 0; i < indices.length; i += 3) [indices[i], indices[i + 1]] = [indices[i + 1], indices[i]]
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices); geometry.computeVertexNormals()
  return geometry
}
function slab(group: THREE.Group, ring: Point[], z: number, height: number, color: string) {
  const shape = new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x, y)))
  const g = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: true, bevelSize: .45, bevelThickness: .4, bevelSegments: 2, steps: 1 })
  g.translate(0, 0, z); return mesh(group, g, material(color))
}
function fittedOutline(ring: Point[]) {
  const minX = Math.min(...ring.map((p) => p[0])), maxX = Math.max(...ring.map((p) => p[0]))
  const minY = Math.min(...ring.map((p) => p[1])), maxY = Math.max(...ring.map((p) => p[1]))
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, rx = (maxX - minX) / 2, ry = (maxY - minY) / 2
  // Round the coarse survey polygon inwards. This keeps the geographic anchor
  // while removing the visible twenty-sided roof of the low-resolution outline.
  let rounded = ring.slice(0, -1)
  for (let pass = 0; pass < 3; pass++) rounded = rounded.flatMap((p, i) => {
    const q = rounded[(i + 1) % rounded.length]
    return [[p[0] * .75 + q[0] * .25, p[1] * .75 + q[1] * .25], [p[0] * .25 + q[0] * .75, p[1] * .25 + q[1] * .75]] as Point[]
  })
  rounded.push(rounded[0])
  // Ray intersection keeps the sculpt inside the supplied ground outline.
  const edge = (angle: number): Point => {
    const dx = Math.cos(angle), dy = Math.sin(angle)
    let distance = Infinity
    for (let i = 1; i < rounded.length; i++) {
      const ax = rounded[i - 1][0] - cx, ay = rounded[i - 1][1] - cy
      const ex = rounded[i][0] - rounded[i - 1][0], ey = rounded[i][1] - rounded[i - 1][1]
      const det = dx * ey - dy * ex
      if (Math.abs(det) < 1e-8) continue
      const t = (ax * ey - ay * ex) / det, s = (ax * dy - ay * dx) / det
      if (t > 0 && s >= 0 && s <= 1) distance = Math.min(distance, t)
    }
    if (!Number.isFinite(distance)) distance = Math.min(rx, ry)
    return [dx * distance, dy * distance]
  }
  return { cx, cy, rx, ry, edge }
}

export function createLandmarkVenue(rings: Point[][], id: Landmark, height?: number) {
  if (id !== 'gongshu-umbrella' && id !== 'gongshu-jade') {
    const source = registry.buildings.find((building) => building.model === id)
    return createPublicLandmark(rings, id, height || Number(source?.height) || 30)
  }
  const group = new THREE.Group(); group.name = id
  group.userData = { modelId: id, fidelity: 'reference-informed-cartoon', geometrySource: 'OSM footprint; authored roof and facade' }
  const { cx, cy, rx, ry, edge } = fittedOutline(rings[0])
  // Work near the origin so tiny facade details retain float precision in any city.
  group.position.set(cx, cy, 0)
  const ring: Point[] = rings[0].map(([x, y]) => [x - cx, y - cy])
  const cream = material('#faedcf', .5), bronze = material('#b69c70', .59), glass = material('#a5c9c1', .3)
  glass.metalness = .08

  if (id === 'gongshu-umbrella') {
    const h = height || 36
    // The wing is open towards the actual hockey pitch to the east. Its north /
    // south tips descend to buttresses; no closed cylindrical stadium walls.
    const roofHeight = (x: number, y: number) => 5.5 + h * .76 * Math.pow(Math.max(0, 1 - (y / ry) ** 2), .68) + h * .14 * (x / rx) * Math.max(0, 1 - (y / ry) ** 2)
    const roofAt = (u: number, v: number) => { const [x, y] = edge(u * Math.PI * 2); return new THREE.Vector3(x * v, y * v, roofHeight(x * v, y * v)) }
    const membrane = material('#fff1d6', .49); membrane.side = THREE.DoubleSide; membrane.emissiveIntensity = .18
    mesh(group, surface(roofAt, 96, 18, true), membrane, 'open-umbrella-wing')
    const perimeter = Array.from({ length: 129 }, (_, i) => roofAt(i / 128, 1))
    mesh(group, tube(perimeter, 1.05), cream, 'continuous-ring-beam')
    const ribs: THREE.BufferGeometry[] = [], braces: THREE.BufferGeometry[] = []
    const topSeams: THREE.BufferGeometry[] = []
    for (let i = -9; i <= 9; i++) {
      const y = ry * i / 10, half = rx * Math.sqrt(1 - (y / ry) ** 2) * .93
      const points = Array.from({ length: 13 }, (_, n) => { const x = -half + n / 12 * half * 2; return new THREE.Vector3(x, y, roofHeight(x, y) - .5) })
      ribs.push(tube(points, .38))
      topSeams.push(tube(points.map((p) => p.clone().add(new THREE.Vector3(0, 0, .62))), .13))
      if (i < 9) {
        const nextY = ry * (i + 1) / 10, nextHalf = rx * Math.sqrt(1 - (nextY / ry) ** 2) * .88
        for (let j = 0; j < 5; j++) {
          const x1 = -half + j / 5 * half * 2, x2 = -nextHalf + (j + 1) / 5 * nextHalf * 2
          braces.push(tube([new THREE.Vector3(x1, y, roofHeight(x1, y) - .7), new THREE.Vector3(x2, nextY, roofHeight(x2, nextY) - .7)], .23))
        }
      }
    }
    const buttresses: THREE.BufferGeometry[] = []
    for (const direction of [-1, 1]) {
      const points = Array.from({ length: 41 }, (_, i) => { const y = (-.92 + i / 40 * 1.84) * ry, x = direction * .31 * rx * Math.sqrt(1 - (y / ry) ** 2); return new THREE.Vector3(x, y, roofHeight(x, y) - 1.6) })
      ribs.push(tube(points, .7))
      for (const sign of [-1, 1]) {
        const y = sign * ry * .9, x = direction * rx * .14, top = roofHeight(x, y) - 1.7
        const buttress = new THREE.CylinderGeometry(2.2, 6.3, top, 4)
        buttress.rotateX(Math.PI / 2); buttress.rotateZ(Math.PI / 4); buttress.translate(x, y, top / 2)
        buttresses.push(buttress)
      }
    }
    merged(group, buttresses, material('#d9c6a5'), 'grounded-buttresses')
    merged(group, ribs, cream, 'arched-roof-ribs'); merged(group, braces, bronze, 'underside-diagonal-braces')
    merged(group, topSeams, material('#e4d5b7'), 'membrane-seams')
    // Curved foyer on the west half; lower open stepped seating faces east.
    const foyer = ring.filter(([x]) => x < 0).sort((a, b) => a[1] - b[1])
    const foyerShape: Point[] = [[-rx * .04, -ry * .74], ...foyer.map(([x, y]): Point => [x * .84, y * .76]), [-rx * .04, ry * .74], [-rx * .04, -ry * .74]]
    slab(group, foyerShape, .4, 10, '#95b9b6')
    const stepPieces: THREE.BufferGeometry[] = [], seats: THREE.BufferGeometry[] = [], aisles: THREE.BufferGeometry[] = []
    for (let row = 0; row < 16; row++) {
      const t = row / 15, x = (-.04 + t * .80) * rx, z = 1.3 + (1 - t) * 13, half = ry * (.65 - t * .04)
      const step = new THREE.BoxGeometry(rx * .057, half * 2, 1.4); step.translate(x, 0, z); stepPieces.push(step)
      for (let col = -17; col <= 17; col++) {
        if (Math.abs(col) % 9 === 0) continue
        const seat = new THREE.BoxGeometry(rx * .025, 1.22, .72); seat.translate(x, col / 17 * half * .93, z + 1.05); seats.push(seat)
      }
    }
    merged(group, stepPieces, material('#e9dabb'), 'tiered-grandstand')
    merged(group, seats, material('#77b7bd'), 'mint-seat-rows')
    for (const y of [-.33, 0, .33]) {
      const curve = Array.from({ length: 17 }, (_, i) => new THREE.Vector3((-.04 + i / 16 * .80) * rx, y * ry, 2.7 + (1 - i / 16) * 13))
      aisles.push(tube(curve, .24))
    }
    merged(group, aisles, cream, 'grandstand-rails')
  } else {
    const h = height || 31
    slab(group, ring.map(([x, y]) => [x * .92, y * .92]), .35, 4.8, '#8caca5')
    const topAt = (u: number) => h * (.87 + .11 * Math.cos(u * Math.PI * 2 - .55))
    const shellAt = (u: number, v: number, lift = 0) => {
      const [x, y] = edge(u * Math.PI * 2)
      const radius = .89 + .09 * v + .047 * Math.sin(v * Math.PI) + lift
      return new THREE.Vector3(x * radius, y * radius, 5.2 + (topAt(u) - 5.2) * v)
    }
    // Two overlapping brass ribbons open into diagonal glass ends, as in the
    // published facade. Rounded diamond panels are geometry, not random texture.
    const goldParts: THREE.BufferGeometry[] = [], lattice: THREE.BufferGeometry[] = []
    const isBrass = (u: number, v: number) => v < .96 && Math.abs(Math.sin(u * Math.PI * 2 + (v - .5) * .66)) > .48
    const shell = surface((u, v) => shellAt(u, v), 160, 14)
    const colors: number[] = [], brassTint = new THREE.Color('#c7aa73'), glassTint = new THREE.Color('#a5c9c1')
    for (let row = 0; row <= 14; row++) for (let col = 0; col <= 160; col++) colors.push(...(isBrass(col / 160, row / 14) ? brassTint : glassTint).toArray())
    shell.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    mesh(group, shell, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .5, metalness: .06 }), 'curved-brass-and-glass-envelope')
    const columns = 100, rows = 7
    for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
      const u = (col + (row % 2) * .5) / columns, v = (row + .5) / rows
      if (!isBrass(u, v)) continue
      const points = [[u, v - .48 / rows], [u + .48 / columns, v], [u, v + .48 / rows], [u - .48 / columns, v]].map(([a, b]) => shellAt(a, b, .0018))
      const center = shellAt(u, v, .0045)
      const positions = points.flatMap((p, i) => [...p.toArray(), ...points[(i + 1) % 4].toArray(), ...center.toArray()])
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geo.computeVertexNormals(); goldParts.push(geo)
    }
    const gold = material('#e2c58c', .48); gold.side = THREE.DoubleSide; gold.metalness = .13
    merged(group, goldParts, gold, 'overlapping-brass-scales')
    // Wider glass diamonds read from the map camera without thousands of nodes.
    for (let start = 0; start < 64; start++) for (const direction of [-1, 1]) {
      let path: THREE.Vector3[] = []
      const finish = () => { if (path.length > 1) lattice.push(tube(path, .17)); path = [] }
      for (let k = 0; k <= 24; k++) {
        const v = k / 24, u = start / 64 + direction * v * .105
        if (!isBrass(u, v)) path.push(shellAt(u, v, .0024)); else finish()
      }
      finish()
    }
    merged(group, lattice, material('#e9ddbd', .54), 'glass-diagrid')
    const roofAt = (u: number, r: number) => {
      const [x, y] = edge(u * Math.PI * 2)
      return new THREE.Vector3(x * r * .982, y * r * .982, h * .87 + h * .11 * Math.cos(u * Math.PI * 2 - .55) * r + 2.4 * (1 - r * r) + .75)
    }
    const roofMat = material('#f6ead5', .48); roofMat.side = THREE.DoubleSide; roofMat.emissiveIntensity = .18
    mesh(group, surface(roofAt, 144, 16, true), roofMat, 'tilted-oval-roof')
    const trim: THREE.BufferGeometry[] = []
    trim.push(tube(Array.from({ length: 161 }, (_, i) => roofAt(i / 160, 1)), .7))
    trim.push(tube(Array.from({ length: 161 }, (_, i) => shellAt(i / 160, .02, .004)), .55))
    for (let i = 0; i < 40; i++) trim.push(tube(Array.from({ length: 17 }, (_, j) => roofAt(i / 40, .16 + j / 16 * .83).add(new THREE.Vector3(0, 0, .10))), .12))
    merged(group, trim, material('#f9efd6'), 'roof-seams-and-soft-rims')
    const oculus = new THREE.CylinderGeometry(rx * .125, rx * .14, 1.4, 48)
    oculus.rotateX(Math.PI / 2); oculus.scale(1, ry / rx, 1); oculus.translate(0, 0, h * .87 + 3.5)
    mesh(group, oculus, material('#b7d8d0', .26), 'central-roof-light')
    const oculusRim = new THREE.TorusGeometry(rx * .132, .65, 6, 48)
    oculusRim.scale(1, ry / rx, 1); oculusRim.translate(0, 0, h * .87 + 4.05)
    mesh(group, oculusRim, cream, 'skylight-rim')
    const baseColumns: THREE.BufferGeometry[] = []
    for (let i = 0; i < 64; i++) {
      const [x, y] = edge(i / 64 * Math.PI * 2)
      const column = new THREE.BoxGeometry(.45, .45, 4.1); column.translate(x * .928, y * .928, 2.6); baseColumns.push(column)
    }
    merged(group, baseColumns, cream, 'podium-window-mullions')
  }
  return group
}

import * as THREE from 'three'

type Point = [number, number]
const cream = '#fff0ce'
const mint = '#b5d5c5'
const glass = '#86b8bf'

function shapeOf(rings: Point[][]) {
  const shape = new THREE.Shape(rings[0].map(([x, y]) => new THREE.Vector2(x, y)))
  for (const ring of rings.slice(1)) shape.holes.push(new THREE.Path(ring.map(([x, y]) => new THREE.Vector2(x, y))))
  return shape
}

function perimeter(ring: Point[], count: number) {
  const lengths = ring.slice(1).map((p, i) => Math.hypot(p[0] - ring[i][0], p[1] - ring[i][1]))
  const total = lengths.reduce((a, b) => a + b, 0)
  const points: Point[] = []
  for (let n = 0; n < count; n++) {
    let remaining = total * n / count
    let i = 0
    while (i < lengths.length - 1 && remaining > lengths[i]) remaining -= lengths[i++]
    const t = lengths[i] ? remaining / lengths[i] : 0
    points.push([ring[i][0] + (ring[i + 1][0] - ring[i][0]) * t, ring[i][1] + (ring[i + 1][1] - ring[i][1]) * t])
  }
  return points
}

function addSlab(group: THREE.Group, rings: Point[][], bottom: number, depth: number, color: string, bevel = .5) {
  const geometry = new THREE.ExtrudeGeometry(shapeOf(rings), { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, steps: 1 })
  geometry.translate(0, 0, bottom)
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: .8 }))
  mesh.castShadow = mesh.receiveShadow = true
  group.add(mesh)
  return mesh
}

// Two reusable architecture families, selected from OSM tags. The source footprint
// and measured height survive; roof curvature, ribs and facade finishes are artistic.
export function createVenueBuilding(rings: Point[][], height: number, kind: 'stadium' | 'sports_hall') {
  const group = new THREE.Group()
  group.name = `venue-${kind}`
  const ring = rings[0]
  const center: Point = [(Math.min(...ring.map((p) => p[0])) + Math.max(...ring.map((p) => p[0]))) / 2, (Math.min(...ring.map((p) => p[1])) + Math.max(...ring.map((p) => p[1]))) / 2]
  const scaled = (scale: number): Point[][] => rings.map((r) => r.map(([x, y]) => [center[0] + (x - center[0]) * scale, center[1] + (y - center[1]) * scale]))
  const wallTop = height * (kind === 'stadium' ? .50 : .68)
  addSlab(group, rings, .45, 2.2, '#e8d7b6', .8)
  addSlab(group, scaled(.965), 2.4, wallTop - 2.4, glass, .5)
  addSlab(group, rings, wallTop - 1, 1.7, cream, .9)
  // Continuous bands and rounded columns read as one public venue, rather than
  // dozens of apartment windows wrapped around an oval.
  if (kind === 'sports_hall') addSlab(group, scaled(.98), wallTop * .54, 1.1, mint, .4)
  const boundary = perimeter(ring, 64)
  const columns = new THREE.InstancedMesh(new THREE.CylinderGeometry(.65, .85, 1, 8), new THREE.MeshStandardMaterial({ color: cream, roughness: .75 }), boundary.length)
  const dummy = new THREE.Object3D()
  boundary.forEach(([x, y], index) => {
    dummy.position.set(center[0] + (x - center[0]) * .98, center[1] + (y - center[1]) * .98, wallTop / 2)
    dummy.rotation.set(Math.PI / 2, 0, 0)
    dummy.scale.set(1, wallTop - 1.5, 1)
    dummy.updateMatrix()
    columns.setMatrixAt(index, dummy.matrix)
  })
  columns.castShadow = columns.receiveShadow = true
  group.add(columns)
  if (rings.length > 1) {
    // An open stadium/courtyard in the source must remain open in the model.
    addSlab(group, rings, height - 2.2, 2.2, cream, .8)
    return group
  }

  const roofPoints = perimeter(ring, 96)
  const positions: number[] = [], colors: number[] = [], indices: number[] = []
  const colorA = new THREE.Color(kind === 'stadium' ? '#f8e4b5' : '#d3e2cc')
  const colorB = new THREE.Color(kind === 'stadium' ? '#fff4d3' : '#f9efd4')
  const ringsCount = 10
  const roofAt = (i: number, t: number) => {
    const [x, y] = roofPoints[i % roofPoints.length]
    const ribs = kind === 'stadium' ? Math.cos(i * Math.PI / 4) * .7 * t * (1 - t) : 0
    return new THREE.Vector3(center[0] + (x - center[0]) * t, center[1] + (y - center[1]) * t, wallTop + 1.7 + (height - wallTop - 1.7) * (1 - t * t) + ribs)
  }
  for (let row = 0; row <= ringsCount; row++) {
    const t = row / ringsCount
    for (let i = 0; i <= roofPoints.length; i++) {
      const point = roofAt(i, t)
      positions.push(point.x, point.y, point.z)
      const color = colorA.clone().lerp(colorB, kind === 'stadium' ? (Math.floor(i / 4) % 2 ? .8 : .2) : .25 + t * .5)
      colors.push(color.r, color.g, color.b)
      if (row && i) {
        const n = row * (roofPoints.length + 1) + i
        const last = n - roofPoints.length - 1
        indices.push(n - 1, n, last, n - 1, last, last - 1)
      }
    }
  }
  const roofGeometry = new THREE.BufferGeometry()
  roofGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  roofGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  roofGeometry.setIndex(indices)
  roofGeometry.computeVertexNormals()
  const roof = new THREE.Mesh(roofGeometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .64, side: THREE.DoubleSide }))
  roof.name = 'rounded-venue-roof'
  roof.castShadow = roof.receiveShadow = true
  group.add(roof)
  const ribs = new THREE.Group()
  for (let i = 0; i < roofPoints.length; i += kind === 'stadium' ? 8 : 12) {
    const points = Array.from({ length: 13 }, (_, j) => roofAt(i, .12 + j / 12 * .88).add(new THREE.Vector3(0, 0, .18)))
    const curve = new THREE.CatmullRomCurve3(points)
    ribs.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 14, .4, 5, false), new THREE.MeshStandardMaterial({ color: cream, roughness: .75 })))
  }
  group.add(ribs)
  return group
}

export function createSportsGround(rings: Point[][], sport: string, kind: string) {
  const group = new THREE.Group()
  group.name = 'mapped-sports-ground'
  const surface = new THREE.ShapeGeometry(shapeOf(rings))
  surface.translate(0, 0, .21)
  group.add(new THREE.Mesh(surface, new THREE.MeshLambertMaterial({ color: kind === 'track' ? '#dca28c' : sport === 'field_hockey' ? '#78bacb' : '#a5c883', side: THREE.DoubleSide })))
  const ring = rings[0]
  // Fit painted markings inside the mapped playing surface, retaining its bearing.
  const edges = ring.slice(1).map((b, i) => ({ a: ring[i], b, length: Math.hypot(b[0] - ring[i][0], b[1] - ring[i][1]) }))
  const edge = edges.sort((a, b) => b.length - a.length)[0]
  if (!edge || !sport || kind === 'track') return group
  const angle = Math.atan2(edge.b[1] - edge.a[1], edge.b[0] - edge.a[0])
  const cos = Math.cos(angle), sin = Math.sin(angle)
  const local = ring.map(([x, y]) => [x * cos + y * sin, -x * sin + y * cos])
  const minX = Math.min(...local.map((p) => p[0])), maxX = Math.max(...local.map((p) => p[0]))
  const minY = Math.min(...local.map((p) => p[1])), maxY = Math.max(...local.map((p) => p[1]))
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
  const halfX = (maxX - minX) * .32, halfY = (maxY - minY) * .31
  const project = (x: number, y: number) => new THREE.Vector3((cx + x) * cos - (cy + y) * sin, (cx + x) * sin + (cy + y) * cos, .225)
  const paths = [
    [[-halfX, -halfY], [halfX, -halfY], [halfX, halfY], [-halfX, halfY], [-halfX, -halfY]],
    [[0, -halfY], [0, halfY]],
    Array.from({ length: 49 }, (_, i) => [Math.cos(i / 48 * Math.PI * 2) * halfY * .28, Math.sin(i / 48 * Math.PI * 2) * halfY * .28]),
  ]
  for (const path of paths) {
    const curve = new THREE.CurvePath<THREE.Vector3>()
    for (let i = 1; i < path.length; i++) curve.add(new THREE.LineCurve3(project(path[i - 1][0], path[i - 1][1]), project(path[i][0], path[i][1])))
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, path.length * 2), .28, 4, false), new THREE.MeshBasicMaterial({ color: '#fff8dc' })))
  }
  return group
}

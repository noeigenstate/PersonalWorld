import * as THREE from 'three'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { wgs84ToGcj02 } from '../lib/geo'
import snapshot from './data/shanghai-pearl.json'
import { ORIENTAL_PEARL_GCJ } from './memoryScene'

// A deliberately art-directed district, anchored to independently sourced OSM geometry.
// Missing heights, windows, roof details, trees and cars are illustrative, not survey data.
type Point = [number, number]
type Polygon = { id: string; rings: Point[][]; height?: string | null; levels?: string | null }
type Road = { id: string; class: string; path: Point[] }
type Archetype = 0 | 1 | 2 | 3 // low, mid-rise, tower, broad hall
const data = snapshot as unknown as { bbox: [number, number, number, number]; buildings: Polygon[]; roads: Road[]; water: Polygon[]; green: Polygon[]; landuse: (Polygon & { kind: string })[]; treeRows: { id: string; path: Point[] }[] }
type Convert = (points: Point[]) => Point[]

const palettes = [
  { wall: '#f9ddc5', roof: '#e9b6a0', glass: '#9cc7d8' },
  { wall: '#f7d0cf', roof: '#e8aab3', glass: '#9bbad4' },
  { wall: '#e0edcf', roof: '#bbd7af', glass: '#9dc4cd' },
  { wall: '#ebdef3', roof: '#cdbbe0', glass: '#a4bad4' },
  { wall: '#fbeacb', roof: '#efd09b', glass: '#9fc6d7' },
  { wall: '#dcecef', roof: '#b8d9d7', glass: '#91b7c9' },
]

function hash(value: string) {
  let result = 2166136261
  for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619)
  return (result >>> 0) / 4294967295
}

function ringShape(rings: Point[][]) {
  const shape = new THREE.Shape()
  const write = (path: THREE.Path, ring: Point[]) => {
    ring.forEach(([x, y], index) => index ? path.lineTo(x, y) : path.moveTo(x, y))
    path.closePath()
  }
  const outer = rings[0]
  if (!outer || outer.length < 4) return null
  write(shape, outer)
  for (const ring of rings.slice(1)) {
    const hole = new THREE.Path()
    write(hole, ring)
    shape.holes.push(hole)
  }
  return shape
}

function polygonGeometry(rings: Point[][], z: number) {
  const shape = ringShape(rings)
  if (!shape) return null
  const geometry = new THREE.ShapeGeometry(shape)
  geometry.translate(0, 0, z)
  return geometry
}

function softenedRoofGeometry(rings: Point[][], z: number, size: number) {
  const shape = ringShape(rings)
  if (!shape) return null
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: size * .7,
    bevelEnabled: true,
    bevelThickness: size * .42,
    bevelSize: size * .55,
    bevelSegments: 2,
    curveSegments: 2,
    steps: 1,
  })
  geometry.translate(0, 0, z)
  return geometry
}

function mergedMesh(group: THREE.Group, geometries: THREE.BufferGeometry[], material: THREE.Material) {
  if (!geometries.length) return
  const merged = mergeGeometries(geometries, false)
  geometries.forEach((geometry) => geometry.dispose())
  if (!merged) return
  const mesh = new THREE.Mesh(merged, material)
  group.add(mesh)
  return mesh
}

function wallGeometry(ring: Point[], bottom: number, top: number, tiled: boolean, tileWidth = 13, tileHeight = 12) {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  for (let i = 1; i < ring.length; i++) {
    const [ax, ay] = ring[i - 1]
    const [bx, by] = ring[i]
    const dx = bx - ax
    const dy = by - ay
    const length = Math.hypot(dx, dy)
    if (length < 0.5) continue
    const start = positions.length / 3
    positions.push(ax, ay, bottom, bx, by, bottom, bx, by, top, ax, ay, top)
    const nx = dy / length
    const ny = -dx / length
    for (let j = 0; j < 4; j++) normals.push(nx, ny, 0)
    const repeatX = tiled ? length / tileWidth : 1
    const repeatY = tiled ? (top - bottom) / tileHeight : 1
    uvs.push(0, 0, repeatX, 0, repeatX, repeatY, 0, repeatY)
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  return geometry
}

function windowTexture(wall: string, glass: string, kind: Archetype) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const context = canvas.getContext('2d')!
  context.fillStyle = wall
  context.fillRect(0, 0, 128, 128)
  context.fillStyle = 'rgba(255,255,255,.32)'
  context.fillRect(0, 0, 128, 10)
  context.fillStyle = 'rgba(91,75,77,.12)'
  context.fillRect(0, 114, 128, 6)
  const windows = kind === 2
    ? [[9, 22, 24, 74], [45, 22, 24, 74], [81, 22, 24, 74]]
    : kind === 3
      ? [[15, 34, 41, 39], [72, 34, 41, 39]]
      : kind === 0
        ? [[19, 28, 38, 61], [72, 28, 38, 61]]
        : [[16, 30, 36, 58], [73, 30, 36, 58]]
  for (const [x, y, width, height] of windows) {
    context.fillStyle = '#fff9e8'
    context.fillRect(x - 3, y - 3, width + 6, height + 8)
    context.fillStyle = glass
    context.fillRect(x, y, width, height)
    context.fillStyle = 'rgba(255,255,255,.38)'
    context.fillRect(x + 4, y + 3, 5, height - 8)
    context.fillStyle = 'rgba(68,92,104,.22)'
    context.fillRect(x + width * .48, y, 2, height)
    context.fillRect(x, y + height * .48, width, 2)
    context.fillStyle = 'rgba(113,76,71,.20)'
    context.fillRect(x - 5, y + height + 4, width + 10, 5)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = 4
  return texture
}

function ribbonGeometry(paths: Point[][], width: number, z: number) {
  const positions: number[] = []
  const indices: number[] = []
  for (const path of paths) for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1]
    const [bx, by] = path[i]
    const length = Math.hypot(bx - ax, by - ay)
    if (length < 0.5) continue
    const nx = ((by - ay) / length) * width / 2
    const ny = (-(bx - ax) / length) * width / 2
    const start = positions.length / 3
    positions.push(ax + nx, ay + ny, z, ax - nx, ay - ny, z, bx - nx, by - ny, z, bx + nx, by + ny, z)
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function roadDashes(paths: Point[][], dash = 8, gap = 12) {
  const result: Point[][] = []
  for (const path of paths) {
    let offset = 0
    for (let i = 1; i < path.length; i++) {
      const [ax, ay] = path[i - 1]
      const [bx, by] = path[i]
      const length = Math.hypot(bx - ax, by - ay)
      if (length < .5) continue
      let at = 0
      while (at < length) {
        const phase = (offset + at) % (dash + gap)
        if (phase >= dash) {
          at += dash + gap - phase
          continue
        }
        const end = Math.min(length, at + dash - phase)
        if (end - at >= 1) result.push([
          [ax + (bx - ax) * at / length, ay + (by - ay) * at / length],
          [ax + (bx - ax) * end / length, ay + (by - ay) * end / length],
        ])
        at = end
      }
      offset += length
    }
  }
  return result
}

function parcelMaterial(color: string, kind: string) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { base: { value: new THREE.Color(color) }, planted: { value: kind === 'residential' ? 1 : 0 } },
    vertexShader: 'varying vec2 vMap; void main(){ vMap=position.xy; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `uniform vec3 base;
      uniform float planted;
      varying vec2 vMap;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      void main(){
        vec2 cell=floor(vMap/18.);
        vec2 edge=fract(vMap/18.);
        float tile=1.-smoothstep(.015,.042,min(min(edge.x,1.-edge.x),min(edge.y,1.-edge.y)));
        float grain=hash(floor(vMap/3.2));
        float variation=(hash(cell)-.5)*.055+(grain-.5)*.026;
        vec3 paved=base*(1.+variation-tile*.038);
        vec3 lawn=base*(1.+variation*.7);
        float fleck=step(.94,grain)*.018;
        lawn+=vec3(fleck*.5,fleck,fleck*.2);
        gl_FragColor=vec4(mix(paved,lawn,planted),1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
}

function inside([x, y]: Point, ring: Point[]) {
  let value = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) value = !value
  }
  return value
}

function actualHeight(building: Polygon, footprint: number) {
  const measured = Number.parseFloat(building.height || '')
  if (Number.isFinite(measured) && measured > 3 && measured < 1000) return measured
  const floors = Number.parseFloat(building.levels || '')
  if (Number.isFinite(floors) && floors > 0 && floors < 140) return floors * 3.5
  const random = hash(building.id)
  // Missing heights are estimates. Surveyed heights above stay untouched.
  return Math.min(46, Math.max(11, 12 + random * 23 + Math.sqrt(footprint) * 0.12))
}

function decorate(group: THREE.Group, parks: Point[][][], water: Point[][][], roads: { path: Point[]; major: boolean }[], treeRows: Point[][], occupied: Point[][], bounds: [Point, Point]) {
  const treePositions: Point[] = []
  const wet = (point: Point) => water.some((rings) => inside(point, rings[0]))
  const built = (point: Point) => occupied.some((ring) => inside(point, ring))
  const nearRoad = ([x, y]: Point) => roads.some(({ path, major }) => {
    const clearance = major ? 13 : 7
    for (let i = 1; i < path.length; i++) {
      const [ax, ay] = path[i - 1]
      const [bx, by] = path[i]
      const dx = bx - ax, dy = by - ay
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)))
      if (Math.hypot(x - ax - t * dx, y - ay - t * dy) < clearance) return true
    }
    return false
  })
  const addTree = (point: Point, mapped = false) => {
    if (point[0] < bounds[0][0] + 10 || point[0] > bounds[1][0] - 10 || point[1] < bounds[0][1] + 10 || point[1] > bounds[1][1] - 10) return
    if (!wet(point) && !built(point) && (mapped || !nearRoad(point)) && treePositions.every(([x, y]) => Math.hypot(point[0] - x, point[1] - y) > 13)) treePositions.push(point)
  }
  // Mapped OSM tree rows take precedence over illustrative planting.
  for (const path of treeRows) for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1]
    const [bx, by] = path[i]
    const length = Math.hypot(bx - ax, by - ay)
    for (let d = 5; d < length; d += 19) addTree([ax + (bx - ax) * d / length, ay + (by - ay) * d / length], true)
  }
  for (const rings of parks) {
    const ring = rings[0]
    const minX = Math.min(...ring.map((point) => point[0]))
    const maxX = Math.max(...ring.map((point) => point[0]))
    const minY = Math.min(...ring.map((point) => point[1]))
    const maxY = Math.max(...ring.map((point) => point[1]))
    for (let x = minX + 12; x < maxX && treePositions.length < 240; x += 19) for (let y = minY + 12; y < maxY && treePositions.length < 240; y += 19) {
      const point: Point = [x + (hash(`${x}:${y}`) - .5) * 9, y + (hash(`${y}:${x}`) - .5) * 9]
      if (inside(point, ring)) addTree(point)
    }
  }
  for (const { path } of roads.filter((road) => road.major)) for (let i = 1; i < path.length && treePositions.length < 360; i++) {
    const [ax, ay] = path[i - 1]
    const [bx, by] = path[i]
    const length = Math.hypot(bx - ax, by - ay)
    if (length < 45) continue
    for (let d = 21; d < length && treePositions.length < 360; d += 35) {
      const t = d / length
      const nx = -(by - ay) / length * 18
      const ny = (bx - ax) / length * 18
      addTree([ax + (bx - ax) * t + nx, ay + (by - ay) * t + ny])
      addTree([ax + (bx - ax) * t - nx, ay + (by - ay) * t - ny])
    }
  }
  // Sample the mapped shoreline itself, adding illustrative trees only where land is clear.
  for (const rings of water) for (let i = 1; i < rings[0].length && treePositions.length < 480; i++) {
    const [ax, ay] = rings[0][i - 1]
    const [bx, by] = rings[0][i]
    const dx = bx - ax, dy = by - ay
    const length = Math.hypot(dx, dy)
    if (length < 24) continue
    for (let d = 17; d < length && treePositions.length < 480; d += 29) {
      const x = ax + dx * d / length, y = ay + dy * d / length
      const nx = -dy / length * 17, ny = dx / length * 17
      addTree([x + nx, y + ny])
      addTree([x - nx, y - ny])
    }
  }
  const tuftPositions: Point[] = []
  for (const rings of parks) {
    const ring = rings[0]
    const minX = Math.min(...ring.map((point) => point[0]))
    const maxX = Math.max(...ring.map((point) => point[0]))
    const minY = Math.min(...ring.map((point) => point[1]))
    const maxY = Math.max(...ring.map((point) => point[1]))
    for (let x = minX + 7; x < maxX && tuftPositions.length < 420; x += 12) for (let y = minY + 7; y < maxY && tuftPositions.length < 420; y += 12) {
      const point: Point = [x + (hash(`${x}:${y}:grass`) - .5) * 5, y + (hash(`${y}:${x}:grass`) - .5) * 5]
      if (inside(point, ring) && !rings.slice(1).some((hole) => inside(point, hole)) && !wet(point) && !built(point) && !nearRoad(point)) tuftPositions.push(point)
    }
  }
  if (tuftPositions.length) {
    const tufts = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), tuftPositions.length)
    const tuftDummy = new THREE.Object3D()
    tuftPositions.forEach(([x, y], index) => {
      const scale = .7 + hash(`${index}:tuft`) * .7
      tuftDummy.position.set(x, y, .67)
      tuftDummy.rotation.set(0, 0, hash(`${index}:tuft-angle`) * Math.PI)
      tuftDummy.scale.set(2.4 * scale, 1.5 * scale, .5 * scale)
      tuftDummy.updateMatrix()
      tufts.setMatrixAt(index, tuftDummy.matrix)
      tufts.setColorAt(index, new THREE.Color(['#9fca78', '#b4d489', '#88b968'][Math.floor(hash(`${index}:tuft-color`) * 3)]))
    })
    group.add(tufts)
  }
  if (treePositions.length) {
    // Soft planted beds join up around the decorative tree rows. They sit below mapped
    // water, roads and parks, so those geographic boundaries always win in depth.
    const beds = new THREE.InstancedMesh(
      new THREE.CircleGeometry(1, 20),
      new THREE.MeshLambertMaterial({ color: '#ffffff', side: THREE.DoubleSide }),
      treePositions.length * 2,
    )
    const bedDummy = new THREE.Object3D()
    treePositions.forEach(([x, y], index) => {
      const angle = hash(`${index}:bed-angle`) * Math.PI * 2
      const size = .75 + hash(`${index}:bed-size`) * .45
      for (let j = 0; j < 2; j++) {
        bedDummy.position.set(x + Math.cos(angle) * (j ? 4 : -2), y + Math.sin(angle) * (j ? 4 : -2), .12 + j * .002)
        bedDummy.rotation.set(0, 0, angle + j * .6)
        bedDummy.scale.set((j ? 7 : 12) * size, (j ? 5 : 9) * size, 1)
        bedDummy.updateMatrix()
        beds.setMatrixAt(index * 2 + j, bedDummy.matrix)
        beds.setColorAt(index * 2 + j, new THREE.Color(j ? '#b7d394' : '#a9c985'))
      }
    })
    beds.name = 'illustrative-tree-beds'
    group.add(beds)
  }
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.4, 1.8, 5.2, 7), new THREE.MeshLambertMaterial({ color: '#b99b75' }), treePositions.length)
  const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(9.1, 1), new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), treePositions.length)
  const shrubs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(4.4, 1), new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), treePositions.length * 2)
  trunks.castShadow = crowns.castShadow = shrubs.castShadow = true
  crowns.receiveShadow = shrubs.receiveShadow = true
  const dummy = new THREE.Object3D()
  treePositions.forEach(([x, y], index) => {
    const scale = .72 + hash(`${index}:tree`) * .55
    dummy.position.set(x, y, 3.4)
    dummy.rotation.set(Math.PI / 2, 0, 0)
    dummy.scale.set(scale, scale, scale)
    dummy.updateMatrix()
    trunks.setMatrixAt(index, dummy.matrix)
    dummy.position.z = 10.5 * scale
    dummy.rotation.set(0, 0, hash(`${index}:angle`) * Math.PI)
    dummy.updateMatrix()
    crowns.setMatrixAt(index, dummy.matrix)
    crowns.setColorAt(index, new THREE.Color(['#8db785', '#a4c795', '#7eab80', '#bdd29b'][Math.floor(hash(`${index}:leaf`) * 4)]))
    for (let j = 0; j < 2; j++) {
      const angle = hash(`${index}:${j}:shrub`) * Math.PI * 2
      dummy.position.set(x + Math.cos(angle) * 9 * scale, y + Math.sin(angle) * 9 * scale, 4.2 * scale)
      dummy.scale.setScalar(scale * (j ? .64 : .75))
      dummy.updateMatrix()
      shrubs.setMatrixAt(index * 2 + j, dummy.matrix)
      shrubs.setColorAt(index * 2 + j, new THREE.Color(j ? '#b3ca8d' : '#9abe84'))
    }
  })
  group.add(trunks, crowns, shrubs)
}

export function createStyledDistrict(convert: Convert, clearAt: Point = ORIENTAL_PEARL_GCJ, clearRadius = 45) {
  const group = new THREE.Group()
  const transform = (points: Point[]) => convert(points.map(([lng, lat]) => {
    const p = wgs84ToGcj02({ lng, lat })
    return [p.lng, p.lat]
  }))
  const [west, south, east, north] = data.bbox
  const corners = transform([[west, south], [east, north]])
  const width = corners[1][0] - corners[0][0]
  const height = corners[1][1] - corners[0][1]
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'varying vec2 vUv; void main(){ float e=min(min(vUv.x,1.-vUv.x),min(vUv.y,1.-vUv.y)); float a=smoothstep(0.,.09,e); gl_FragColor=vec4(.942,.895,.832,a); }',
  }))
  ground.position.set((corners[0][0] + corners[1][0]) / 2, (corners[0][1] + corners[1][1]) / 2, .02)
  group.add(ground)

  const water = data.water.map((polygon) => polygon.rings.map(transform))
  const parks = data.green.map((polygon) => polygon.rings.map(transform))
  for (const [kind, color] of [
    ['commercial', '#f4ddc6'],
    ['retail', '#f3d5c7'],
    ['residential', '#d9e9c6'],
    ['brownfield', '#e5d6c8'],
  ] as const) {
    const surfaces = data.landuse.filter((polygon) => polygon.kind === kind)
      .map((polygon) => polygonGeometry(polygon.rings.map(transform), .07))
      .filter((value): value is THREE.ShapeGeometry => value !== null)
    if (surfaces.length) mergedMesh(group, surfaces, parcelMaterial(color, kind))
  }
  const waterShapes = water.map((rings) => polygonGeometry(rings, .15)).filter((value): value is THREE.ShapeGeometry => value !== null)
  const waterGeometry = mergeGeometries(waterShapes, false)
  waterShapes.forEach((geometry) => geometry.dispose())
  if (waterGeometry) {
    // One planar camera reflects the actual Three.js buildings, tower and trees. A small
    // target keeps this usable while panning; the shader tints and ripples that reflection.
    const reflectionSize = window.innerWidth < 700 ? 384 : 768
    const river = new Reflector(waterGeometry, {
      color: '#74c8d1',
      textureWidth: reflectionSize,
      textureHeight: reflectionSize,
      multisample: 0,
      clipBias: .002,
      shader: {
        name: 'StorybookRiver',
        uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null } },
        vertexShader: `uniform mat4 textureMatrix;
          varying vec4 vMirror;
          varying vec2 vMap;
          void main() {
            vMap = position.xy;
            vMirror = textureMatrix * vec4(position, 1.);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
          }`,
        fragmentShader: `uniform vec3 color;
          uniform sampler2D tDiffuse;
          varying vec4 vMirror;
          varying vec2 vMap;
          float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
          void main() {
            float broad = sin(vMap.x * .006 + sin(vMap.y * .004)) * sin(vMap.y * .005);
            float ripple = sin(vMap.x * .080 + sin(vMap.y * .028) * 1.7) * .003;
            vec4 uv = vMirror;
            uv.xy += vec2(ripple, ripple * .4) * uv.w;
            vec4 reflected = texture2DProj(tDiffuse, uv);
            vec3 water = mix(color * .78, color * 1.12, .5 + broad * .3);
            vec2 cell=floor(vMap/13.);
            vec2 local=fract(vMap/13.);
            float glint=step(.82,hash(cell))*(1.-smoothstep(.015,.09,abs(local.y-.48)));
            glint*=smoothstep(.10,.28,local.x)*(1.-smoothstep(.70,.93,local.x));
            water += vec3(.20, .24, .20) * glint;
            // Empty reflection pixels keep the river pastel instead of mirroring black.
            vec3 result = mix(water, reflected.rgb, clamp(reflected.a * .46, 0., .46));
            gl_FragColor = vec4(result, 1.);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      },
    })
    river.name = 'story-river-reflector'
    group.add(river)
  }
  const grassMaterial = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vMap; void main(){ vMap=position.xy; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `varying vec2 vMap;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){
        vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);
      }
      void main(){
        float patch=noise(vMap/27.);
        float grain=noise(vMap/2.5);
        float meadow=sin(vMap.x*.042+grain)*sin(vMap.y*.038);
        vec3 grass=mix(vec3(.48,.64,.35),vec3(.74,.84,.50),.38+patch*.40+grain*.12+meadow*.08);
        vec2 blade=fract(vMap/1.8+vec2(hash(floor(vMap/1.8))));
        float fleck=(1.-smoothstep(.02,.14,abs(blade.x-.5)))*smoothstep(.10,.34,blade.y)*(1.-smoothstep(.58,.80,blade.y));
        grass=mix(grass,vec3(.84,.91,.61),fleck*.13);
        gl_FragColor=vec4(grass,1.);
      }`,
  })
  mergedMesh(group, parks.map((rings) => polygonGeometry(rings, .19)).filter((value): value is THREE.ShapeGeometry => value !== null), grassMaterial)
  group.add(new THREE.Mesh(ribbonGeometry(water.map((rings) => rings[0]), 6, .22), new THREE.MeshBasicMaterial({ color: '#f8e9ce', side: THREE.DoubleSide })))
  const waterLines: Point[][] = []
  for (let x = corners[0][0] + 30; x < corners[1][0] - 30; x += 84) for (let y = corners[0][1] + 25; y < corners[1][1] - 25; y += 82) {
    const point: Point = [x + (hash(`${x}:wave`) - .5) * 34, y + (hash(`${y}:wave`) - .5) * 30]
    if (water.some((rings) => inside(point, rings[0]) && !rings.slice(1).some((hole) => inside(point, hole)))) {
      const length = 12 + hash(`${x}:${y}:length`) * 16
      waterLines.push([[point[0] - length, point[1]], [point[0], point[1] + 2], [point[0] + length, point[1]]])
    }
  }
  group.add(new THREE.Mesh(ribbonGeometry(waterLines, 1.7, .18), new THREE.MeshBasicMaterial({ color: '#edfdfa', transparent: true, opacity: .68, side: THREE.DoubleSide })))

  const roads = data.roads.map((road) => ({ path: transform(road.path), major: /^(motorway|trunk|primary|secondary|tertiary)/.test(road.class), class: road.class }))
  const types = [
    { match: (type: string) => /^(motorway|trunk|primary|secondary)/.test(type), width: 20, walk: 10, border: 3, curb: '#d7b7a4', surface: '#fff3e5' },
    { match: (type: string) => /^(tertiary|residential|living_street|unclassified)/.test(type), width: 12, walk: 7, border: 2.5, curb: '#dfbda8', surface: '#fff4e8' },
    { match: (type: string) => type === 'service', width: 6, walk: 0, border: 1.5, curb: '#e9cdb5', surface: '#fff2df' },
    { match: (type: string) => type === 'pedestrian', width: 5, walk: 0, border: 0, curb: '#e9cdb5', surface: '#fff5e8' },
    { match: (_type: string) => true, width: 2.5, walk: 0, border: 0, curb: '#ecd5bf', surface: '#fff7ed' },
  ]
  for (const type of types) {
    const paths = roads.filter((road) => type.match(road.class) && !types.slice(0, types.indexOf(type)).some((prior) => prior.match(road.class))).map((road) => road.path)
    if (!paths.length) continue
    if (type.walk) group.add(new THREE.Mesh(ribbonGeometry(paths, type.width + type.walk, .235), new THREE.MeshBasicMaterial({ color: '#fff6e9', side: THREE.DoubleSide })))
    if (type.border) group.add(new THREE.Mesh(ribbonGeometry(paths, type.width + type.border, .26), new THREE.MeshBasicMaterial({ color: type.curb, side: THREE.DoubleSide })))
    group.add(new THREE.Mesh(ribbonGeometry(paths, type.width, .29), new THREE.MeshBasicMaterial({ color: type.surface, side: THREE.DoubleSide })))
    if (type === types[0]) group.add(new THREE.Mesh(ribbonGeometry(roadDashes(paths), .75, .31), new THREE.MeshBasicMaterial({ color: '#dcbda9', side: THREE.DoubleSide })))
  }

  const facades = palettes.map(() => [[], [], [], []] as THREE.BufferGeometry[][])
  const plinths = palettes.map(() => [] as THREE.BufferGeometry[])
  const parapets = palettes.map(() => [] as THREE.BufferGeometry[])
  const roofs = palettes.map(() => [] as THREE.BufferGeometry[])
  const roofCaps = palettes.map(() => [] as THREE.BufferGeometry[])
  const facadeBands = palettes.map(() => [] as THREE.BufferGeometry[])
  const roofLines: number[] = []
  const roofFeatures: { point: Point; height: number; size: number; rotation: number }[] = []
  const occupied: Point[][] = []
  const anchor = convert([clearAt])[0]
  for (const item of data.buildings) {
    const rings = item.rings.map(transform)
    const outer = rings[0]
    if (outer.length < 4) continue
    const center: Point = [outer.reduce((sum, point) => sum + point[0], 0) / outer.length, outer.reduce((sum, point) => sum + point[1], 0) / outer.length]
    if (Math.hypot(center[0] - anchor[0], center[1] - anchor[1]) < clearRadius) continue
    let signedArea = 0
    for (let i = 1; i < outer.length; i++) signedArea += outer[i - 1][0] * outer[i][1] - outer[i][0] * outer[i - 1][1]
    const area = Math.abs(signedArea) / 2
    if (area < 18 || area > 24000) continue
    const height = actualHeight(item, area)
    const kind: Archetype = height >= 90 ? 2 : area >= 900 && height < 55 ? 3 : height < 27 ? 0 : 1
    const [tileWidth, tileHeight] = ([[17, 14], [13, 12], [12, 15], [19, 11]] as const)[kind]
    const block = `${Math.floor(center[0] / 155)}:${Math.floor(center[1] / 155)}`
    const basePalettes = [0, 0, 4, 2, 1, 3, 5]
    const accent = hash(`${item.id}:accent`) > .91
    const palette = accent ? (hash(`${item.id}:accent-color`) > .5 ? 1 : 3) : basePalettes[Math.floor(hash(block) * basePalettes.length)]
    const radius = Math.max(...outer.map(([x, y]) => Math.hypot(x - center[0], y - center[1])))
    const overhang = Math.min(2.2, Math.max(1.2, Math.sqrt(area) * .045))
    const roofOuter = outer.map(([x, y]): Point => [x + (x - center[0]) / radius * overhang, y + (y - center[1]) / radius * overhang])
    const roofRings = [roofOuter, ...rings.slice(1)]
    occupied.push(outer)
    facades[palette][kind].push(wallGeometry(outer, .65, height, true, tileWidth, tileHeight))
    plinths[palette].push(wallGeometry(roofOuter, .45, 2.5, false))
    parapets[palette].push(wallGeometry(roofOuter, height - .1, height + 2.3, false))
    const roof = polygonGeometry(roofRings, height + 2.3)
    if (roof) roofs[palette].push(roof)
    if (kind !== 2) {
      const cap = softenedRoofGeometry(roofRings, height + 2.3, kind === 3 ? 2.4 : kind === 0 ? 1.9 : 1.5)
      if (cap) roofCaps[palette].push(cap)
      if (height > 13) facadeBands[palette].push(wallGeometry(outer, height - 4.5, height - 3.3, false))
      if (kind === 1 || kind === 3) facadeBands[palette].push(wallGeometry(outer, 3.8, 5.1, false))
    } else for (let i = 1; i < roofOuter.length; i++) {
      roofLines.push(roofOuter[i - 1][0], roofOuter[i - 1][1], height + 2.37, roofOuter[i][0], roofOuter[i][1], height + 2.37)
    }
    if (area > 280 && hash(`${item.id}:roof`) > .35 && inside(center, outer)) {
      roofFeatures.push({ point: center, height: height + (kind === 2 ? 2.3 : 5), size: Math.min(11, Math.max(4, Math.sqrt(area) * .18)), rotation: hash(`${item.id}:rotation`) * Math.PI })
    }
  }
  palettes.forEach((palette, index) => {
    const roof = new THREE.MeshLambertMaterial({ color: palette.roof, side: THREE.DoubleSide })
    const structure = [
      mergedMesh(group, plinths[index], roof),
      mergedMesh(group, parapets[index], roof),
      mergedMesh(group, roofs[index], roof),
      mergedMesh(group, roofCaps[index], roof),
      mergedMesh(group, facadeBands[index], new THREE.MeshLambertMaterial({ color: palette.roof, side: THREE.DoubleSide })),
    ]
    for (let kind = 0; kind < 4; kind++) if (facades[index][kind].length) structure.push(mergedMesh(
      group,
      facades[index][kind],
      new THREE.MeshLambertMaterial({ map: windowTexture(palette.wall, palette.glass, kind as Archetype), side: THREE.DoubleSide }),
    ))
    for (const mesh of structure) if (mesh) { mesh.castShadow = true; mesh.receiveShadow = true }
  })
  const edgeGeometry = new THREE.BufferGeometry()
  edgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(roofLines, 3))
  group.add(new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({ color: '#fff6e7', transparent: true, opacity: .75 })))
  if (roofFeatures.length) {
    const features = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: '#f9eedc' }), roofFeatures.length)
    const dummy = new THREE.Object3D()
    roofFeatures.forEach((feature, index) => {
      dummy.position.set(feature.point[0], feature.point[1], feature.height + 1.3)
      dummy.rotation.set(0, 0, feature.rotation)
      dummy.scale.set(feature.size, feature.size * .65, 2.6)
      dummy.updateMatrix()
      features.setMatrixAt(index, dummy.matrix)
    })
    group.add(features)
    features.castShadow = features.receiveShadow = true
  }
  decorate(group, parks, water, roads, data.treeRows.map((row) => transform(row.path)), occupied, [corners[0], corners[1]])
  // The transparent plane receives the same shadow map over roads, lawns and water. It
  // replaces the old offset footprint silhouettes, so a tree crown has its own shape.
  const shadowGround = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.ShadowMaterial({ color: '#544952', opacity: .36, depthWrite: false }),
  )
  shadowGround.position.set(ground.position.x, ground.position.y, .34)
  shadowGround.receiveShadow = true
  shadowGround.name = 'real-scene-shadows'
  group.add(shadowGround)
  return { group, bounds: data.bbox }
}

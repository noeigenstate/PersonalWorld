import * as THREE from 'three'
import { seeded, toon } from './objects'
import type { MapPhoto } from './scene'

// These are art-directed memory miniatures, not parcel or building-footprint data.
// AMap's Oriental Pearl POI: https://ditu.amap.com/place/B00150F6D6 (GCJ-02).
export const ORIENTAL_PEARL_GCJ: [number, number] = [121.499718, 31.239703]
export const isOrientalPearl = (name?: string) => /东方明珠|oriental\s*pearl/i.test(name || '')
export interface MemoryScene {
  group: THREE.Group
  radius: number
  label: string
}

const P = {
  cream: 0xfff0d9,
  stone: 0xe5cdb7,
  pink: 0xe9a4b6,
  berry: 0xbe667e,
  mint: 0xb3d7b1,
  sage: 0x83ae86,
  lilac: 0xc7b4da,
  blue: 0xa7cbd8,
  gold: 0xe8bb73,
  glass: 0x86b8c7,
  ink: 0x625a61,
}

function shape(parent: THREE.Group, geometry: THREE.BufferGeometry, color: number, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(geometry, toon(color))
  mesh.position.set(x, y, z)
  parent.add(mesh)
  return mesh
}

function cuboid(parent: THREE.Group, x: number, y: number, z: number, w: number, h: number, d: number, color: number) {
  return shape(parent, new THREE.BoxGeometry(w, h, d), color, x, y, z)
}

function disc(parent: THREE.Group, x: number, y: number, z: number, radius: number, height: number, color: number, sides = 32) {
  return shape(parent, new THREE.CylinderGeometry(radius, radius, height, sides), color, x, y, z)
}

function ring(parent: THREE.Group, x: number, y: number, z: number, radius: number, tube: number, color: number) {
  const mesh = shape(parent, new THREE.TorusGeometry(radius, tube, 8, 48), color, x, y, z)
  mesh.rotation.x = Math.PI / 2
  return mesh
}

function tree(parent: THREE.Group, x: number, z: number, size = 1) {
  disc(parent, x, 3.8 * size, z, 1.2 * size, 7 * size, P.stone, 8)
  shape(parent, new THREE.IcosahedronGeometry(6.4 * size, 1), P.sage, x, 10 * size, z)
  shape(parent, new THREE.IcosahedronGeometry(4.7 * size, 1), P.mint, x + 1.3 * size, 12 * size, z)
}

function toyHouse(parent: THREE.Group, x: number, z: number, w: number, d: number, h: number, wall: number, roof: number) {
  cuboid(parent, x, h / 2 + 1, z, w, h, d, wall)
  cuboid(parent, x, h + 2.4, z, w + 3.5, 3.7, d + 3.5, roof)
  cuboid(parent, x, h + 4.7, z, w * 0.54, 1.2, d * 0.5, P.cream)
  const rows = Math.max(2, Math.floor(h / 7))
  const cols = Math.max(2, Math.floor(w / 6))
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const wx = x - w / 2 + ((col + 1) * w) / (cols + 1)
    const wy = 5 + row * ((h - 5) / rows)
    cuboid(parent, wx, wy, z + d / 2 + 0.15, 2.2, 2.9, 0.3, P.cream)
    cuboid(parent, wx, wy, z + d / 2 + 0.35, 1.55, 2.2, 0.24, P.glass)
  }
  cuboid(parent, x, 3.5, z + d / 2 + 0.45, 3.5, 6, 0.8, P.berry)
}

function storybook(photo: MapPhoto): MemoryScene {
  const group = new THREE.Group()
  const random = seeded([...photo.id].reduce((hash, c) => (hash * 31 + c.charCodeAt(0)) % 2147483647, 7))
  const walls = [P.cream, P.pink, P.mint, P.lilac]
  const roofs = [P.berry, P.sage, P.blue, P.gold]
  disc(group, 0, 0.8, 0, 43, 1.6, P.stone, 48)
  disc(group, 0, 1.9, 0, 39, 0.7, P.cream, 48)
  ring(group, 0, 2.3, 0, 36, 0.55, P.pink)
  toyHouse(group, -15, -8, 16, 13, 28, walls[Math.floor(random() * walls.length)], roofs[Math.floor(random() * roofs.length)])
  toyHouse(group, 14, 11, 14, 12, 20, walls[Math.floor(random() * walls.length)], roofs[Math.floor(random() * roofs.length)])
  for (const [x, z, s] of [[-26, 12, 0.9], [27, -12, 0.8], [-3, 27, 0.7], [26, 24, 0.55]] as const) tree(group, x, z, s)
  group.scale.setScalar(1.7)
  return { group, radius: 100, label: '照片地点 · 玩具小景示意' }
}

function pearl(): MemoryScene {
  const group = new THREE.Group()
  // An art-directed silhouette anchored to the located POI. The three spheres and
  // tapered cream core follow the landmark; surface detail is an illustration.
  disc(group, 0, 1.6, 0, 46, 3.2, P.stone, 48)
  disc(group, 0, 3.4, 0, 40, 0.9, P.cream, 48)
  ring(group, 0, 4.1, 0, 40, 0.9, P.pink)
  disc(group, 0, 11.5, 0, 29, 15, P.cream, 32)
  ring(group, 0, 19.5, 0, 29, 1.25, P.gold)
  shape(group, new THREE.CylinderGeometry(13, 24, 155, 32), P.cream, 0, 96.5, 0)
  disc(group, 0, 24, 0, 23.5, 3.5, P.stone, 32)
  for (let i = 0; i < 12; i++) {
    const angle = i / 12 * Math.PI * 2
    const radius = 21.8
    const window = cuboid(group, Math.cos(angle) * radius, 48, Math.sin(angle) * radius, 3.3, 35, 1.1, P.glass)
    window.rotation.y = -angle + Math.PI / 2
    const sill = cuboid(group, Math.cos(angle) * (radius + .4), 29, Math.sin(angle) * (radius + .4), 4, 1.2, 1.6, P.gold)
    sill.rotation.y = window.rotation.y
  }
  // The three buttresses make the lower body read as a building instead of a mast.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2
    const x = Math.cos(a) * 20
    const z = Math.sin(a) * 20
    shape(group, new THREE.CylinderGeometry(4.4, 6.4, 96, 12), P.stone, x, 65, z)
    disc(group, x, 19, z, 6.7, 4, P.cream, 12)
  }
  for (let i = 0; i < 10; i++) {
    const angle = i / 10 * Math.PI * 2
    disc(group, Math.cos(angle) * 13.1, 148, Math.sin(angle) * 13.1, 1, 55, i % 2 ? P.stone : P.gold, 8)
  }
  disc(group, 0, 184, 0, 9.5, 18, P.cream, 24)
  ring(group, 0, 193, 0, 9.5, 1.6, P.gold)
  shape(group, new THREE.SphereGeometry(32, 32, 20), P.pink, 0, 91, 0)
  shape(group, new THREE.SphereGeometry(27, 32, 20), P.berry, 0, 213, 0)
  for (const [y, r] of [[78, 29], [91, 32.1], [104, 29], [201, 24.2], [213, 27.1], [225, 24.2]] as const) ring(group, 0, y, 0, r, 1.1, P.gold)
  const sphereDetails = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), toon(P.cream), 160)
  const detail = new THREE.Object3D()
  let detailIndex = 0
  for (const [center, radius, offsets, columns] of [[91, 32, [-19, -7, 7, 19], 22], [213, 27, [-16, -5, 5, 16], 18]] as const) {
    for (const offset of offsets) {
      const orbit = Math.sqrt(radius * radius - offset * offset) + .4
      for (let i = 0; i < columns; i++) {
        const angle = i / columns * Math.PI * 2
        detail.position.set(Math.cos(angle) * orbit, center + offset, Math.sin(angle) * orbit)
        detail.rotation.set(0, -angle + Math.PI / 2, 0)
        detail.scale.set(offset === -7 || offset === -5 ? 2.4 : 1.8, 2.8, .7)
        detail.updateMatrix()
        sphereDetails.setMatrixAt(detailIndex++, detail.matrix)
      }
    }
  }
  sphereDetails.count = detailIndex
  group.add(sphereDetails)
  disc(group, 0, 267, 0, 3.6, 75, P.cream, 12)
  disc(group, 0, 311, 0, 2.2, 22, P.gold, 12)
  shape(group, new THREE.SphereGeometry(5, 16, 12), P.pink, 0, 329, 0)
  disc(group, 0, 348, 0, 1.1, 35, P.ink, 8)
  shape(group, new THREE.ConeGeometry(3, 13, 12), P.gold, 0, 372, 0)

  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.2
    tree(group, Math.cos(a) * 37, Math.sin(a) * 37, 0.68)
  }
  return { group, radius: 125, label: '东方明珠 · 风格化地标' }
}

export function createMemoryScene(photo: MapPhoto): MemoryScene {
  return isOrientalPearl(photo.landmark) ? pearl() : storybook(photo)
}

export const createOrientalPearlScene = pearl

export function inEastChina([lng, lat]: [number, number]) {
  return lng >= 115 && lng <= 123.8 && lat >= 25 && lat <= 36.5
}

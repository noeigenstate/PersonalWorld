import type { MapPhoto } from './scene'

export interface ProjectedPhoto { photo: MapPhoto; x: number; y: number }
export interface PhotoCluster { x: number; y: number; members: MapPhoto[] }

// A thumbnail, its count badge and its focus state occupy more space than one old
// screen grid cell. Merge nearby anchors even when they straddle cell boundaries.
const GAP = 96

export function clusterProjectedPhotos(points: ProjectedPhoto[]): PhotoCluster[] {
  const parent = points.map((_, index) => index)
  const root = (index: number): number => {
    while (parent[index] !== index) { parent[index] = parent[parent[index]]; index = parent[index] }
    return index
  }
  const bins = new Map<string, number[]>()
  points.forEach((point, index) => {
    const bx = Math.floor(point.x / GAP)
    const by = Math.floor(point.y / GAP)
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const other of bins.get(`${bx + dx}:${by + dy}`) || []) {
        if (Math.abs(point.x - points[other].x) < GAP && Math.abs(point.y - points[other].y) < GAP) {
          parent[root(index)] = root(other)
        }
      }
    }
    const key = `${bx}:${by}`
    bins.set(key, [...(bins.get(key) || []), index])
  })
  const groups = new Map<number, { x: number; y: number; members: MapPhoto[] }>()
  points.forEach((point, index) => {
    const key = root(index)
    const group = groups.get(key)
    if (group) { group.x += point.x; group.y += point.y; group.members.push(point.photo) }
    else groups.set(key, { x: point.x, y: point.y, members: [point.photo] })
  })
  return [...groups.values()].map((group) => ({ x: group.x / group.members.length, y: group.y / group.members.length, members: group.members }))
}

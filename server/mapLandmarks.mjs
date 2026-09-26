// Curated public assets fill known gaps in the vector building layer, including
// landmarks mapped as points. Their identity never depends on photo recognition.
import { readFileSync } from 'node:fs'
import polygonClipping from 'polygon-clipping'
import { containsPoint, ringsBounds } from './mapSceneDetails.mjs'
const registry = JSON.parse(readFileSync(new URL('../src/map/landmarkSites.json', import.meta.url), 'utf8'))

export function addRegisteredLandmarks(scene, point) {
  const box = scene.bbox
  const covered = (rings) => { const b = ringsBounds(rings); return b[0] >= box[0] && b[1] >= box[1] && b[2] <= box[2] && b[3] <= box[3] }
  const registered = registry.buildings.filter((b) => covered(b.rings))
  const ringArea = (ring) => {
    const [x, y] = ring[0]
    return Math.abs(ring.slice(1).reduce((sum, p, i) => sum + (ring[i][0]-x)*(p[1]-y)-(p[0]-x)*(ring[i][1]-y), 0)) / 2
  }
  const area = rings => ringArea(rings[0]) - rings.slice(1).reduce((sum, ring) => sum + ringArea(ring), 0)
  scene.buildings = scene.buildings.filter((building) => !registered.some((landmark) => {
    if (building.id === landmark.id || building.id.startsWith(landmark.id + ':')) return true
    // Tile quantization moves boundary vertices either side of the real outline,
    // and a mall can be split at a tile seam. Test actual shared area, not vertex
    // inclusion. Preserve broad adjoining podiums that only overlap the tower.
    const b = ringsBounds(building.rings), l = ringsBounds(landmark.rings)
    if (b[0] > l[2] || b[2] < l[0] || b[1] > l[3] || b[3] < l[1]) return false
    const buildingArea = area(building.rings)
    if (!buildingArea || buildingArea > area(landmark.rings) * 1.8) return false
    try {
      const overlap = polygonClipping.intersection(building.rings, landmark.rings).reduce((sum, rings) => sum + area(rings), 0)
      return overlap / buildingArea >= .78
    } catch { return false }
  })).concat(registered.map((b) => ({ ...b, kind: 'landmark' })))
  for (const venue of registry.venues) {
    if (!covered(venue.polygons[0])) continue
    if (!scene.venues.some(v=>v.id===venue.id)) scene.venues.push(venue)
    if (!scene.venue && venue.polygons.some(rings=>containsPoint(point,rings))) scene.venue = venue
  }
  return scene
}

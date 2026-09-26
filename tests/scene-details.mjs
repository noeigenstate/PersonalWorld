import assert from 'node:assert/strict'
import { containsPoint, extractDetails } from '../server/mapSceneDetails.mjs'

const ring = [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01]]
const nodes = ring.map(([lon, lat], i) => ({ type: 'node', id: i + 1, lon, lat }))
const result = extractDetails([
  ...nodes,
  { type: 'way', id: 10, nodes: [1, 2, 3, 4, 1], tags: { shop: 'mall', name: 'Fixture mall' } },
  { type: 'way', id: 11, nodes: [1, 2, 3, 4, 1], tags: { building: 'yes', leisure: 'sports_hall' } },
  { type: 'way', id: 12, nodes: [1, 2, 3, 4, 1], tags: { natural: 'water', water: 'pond' } },
  { type: 'way', id: 13, nodes: [1, 2, 3, 4, 1], tags: { leisure: 'pitch', sport: 'field_hockey' } },
  { type: 'way', id: 14, nodes: [1, 2, 99, 1], tags: { leisure: 'park', name: 'Incomplete boundary' } },
])
assert.equal(result.venues.length, 1, '不把缺节点的边界当完整场景')
assert.equal(result.venues[0].kind, 'mall')
assert.equal(result.buildings[0].kind, 'sports_hall')
assert.equal(result.water.length, 1)
assert.equal(result.grounds[0].sport, 'field_hockey')
const outer = [...ring, ring[0]]
const hole = [[.003, .003], [.007, .003], [.007, .007], [.003, .007], [.003, .003]]
assert.equal(containsPoint([.005, .005], [outer, hole]), false, '区域孔洞不是场地内部')
assert.equal(containsPoint([.001, .001], [outer, hole]), true)
console.log('Venue detail checks passed: mall boundaries, source building categories, water, sports grounds and incomplete polygons.')

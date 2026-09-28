import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { checkSkillFile } from '../../tests/skill-kit.mjs'
import { containsPoint, extractDetails } from '../../server/mapSceneDetails.mjs'

test('map-scene-styling has a discoverable skill entry', () => {
  checkSkillFile(fileURLToPath(new URL('.', import.meta.url)))
})

test('scene evidence keeps water, park and building boundaries distinct', () => {
  const points = [[0, 0], [.01, 0], [.01, .01], [0, .01]]
  const nodes = points.map(([lon, lat], i) => ({ type: 'node', id: i + 1, lon, lat }))
  const result = extractDetails([...nodes,
    { type: 'way', id: 10, nodes: [1, 2, 3, 4, 1], tags: { leisure: 'park', name: 'Fixture park' } },
    { type: 'way', id: 11, nodes: [1, 2, 3, 4, 1], tags: { natural: 'water', water: 'pond' } },
    { type: 'way', id: 12, nodes: [1, 2, 3, 4, 1], tags: { building: 'yes', leisure: 'sports_hall' } },
    { type: 'way', id: 13, nodes: [1, 2, 99, 1], tags: { leisure: 'park', name: 'Incomplete' } },
  ])
  assert.equal(result.venues.length, 1)
  assert.equal(result.water.length, 1)
  assert.equal(result.buildings[0].kind, 'sports_hall')
  const hole = [[.003, .003], [.007, .003], [.007, .007], [.003, .007], [.003, .003]]
  assert.equal(containsPoint([.005, .005], [[...points, points[0]], hole]), false)
})

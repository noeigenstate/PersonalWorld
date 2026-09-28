import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { checkSkillFile } from '../../tests/skill-kit.mjs'
import { storyRelationships } from '../../server/storyRelationships.mjs'
import { buildStoryGraph } from '../../server/storyGraph.mjs'

test('memory-identity has a discoverable skill entry', () => {
  checkSkillFile(fileURLToPath(new URL('.', import.meta.url)))
})

test('confirmed relationships do not create attendance in unrelated photos', () => {
  const people = [{ id: 'self', name: '爸爸', relationship: '我', confirmed: true }, { id: 'child', name: '团团', relationship: '女儿', confirmed: true }]
  const relations = storyRelationships(people)
  const assets = ['a', 'b'].map(id => ({ id, kind: 'image', card: { scene: '公园合影' } }))
  const faces = [{ id: 'fa', assetId: 'a', personId: 'child', status: 'confirmed' }]
  const graph = buildStoryGraph(assets, [], people, faces, [], relations)
  assert.deepEqual(graph.memberships.a, ['child'])
  assert.deepEqual(graph.memberships.b || [], [])
  assert.equal(graph.relationships[0].objectId, 'self')
  const renamed = storyRelationships([{ ...people[0], name: '新名字' }, people[1]], relations)
  assert.equal(renamed[0].id, relations[0].id)
  assert.match(renamed[0].value, /新名字/)
})

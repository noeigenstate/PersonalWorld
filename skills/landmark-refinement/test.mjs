import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { checkSkillFile } from '../../tests/skill-kit.mjs'
import { addRegisteredLandmarks } from '../../server/mapLandmarks.mjs'

test('landmark-refinement has its entry and reusable reference workflow', () => {
  checkSkillFile(fileURLToPath(new URL('.', import.meta.url)))
  assert.ok(readFileSync(new URL('references/workflow.md', import.meta.url), 'utf8').length > 100)
})

test('registered landmarks appear only at supported geography and keep unrelated buildings', () => {
  const distant = { bbox: [100, 25, 100.01, 25.01], buildings: [], venues: [] }
  addRegisteredLandmarks(distant, [100, 25])
  assert.equal(distant.buildings.length, 0)
  const existing = { id: 'fixture-neighbor', rings: [[[109.919, 20.221], [109.9191, 20.221], [109.9191, 20.2211], [109.919, 20.221]]] }
  const coast = { bbox: [109.91, 20.21, 109.93, 20.24], buildings: [existing], venues: [] }
  addRegisteredLandmarks(coast, [109.92, 20.224])
  assert.equal(coast.buildings.filter(b => b.model === 'jiaowei-lighthouse').length, 1)
  assert.ok(coast.buildings.some(b => b.id === existing.id))
  addRegisteredLandmarks(coast, [109.92, 20.224])
  assert.equal(coast.buildings.filter(b => b.model === 'jiaowei-lighthouse').length, 1)
})

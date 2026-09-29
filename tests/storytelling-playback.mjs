import { test } from 'node:test'
import assert from 'node:assert/strict'
import { storyFrame, shouldMoveStoryMap } from '../src/lib/storytelling.ts'

test('one paragraph advances its photos with speech, while comparisons remain stable', () => {
  const beat = { assetIds: ['a', 'b', 'c'], layout: 'sequence' }
  assert.deepEqual([0, .32, .34, .7, 1, 2].map(p => storyFrame(beat, p)), [0, 0, 1, 2, 2, 2])
  assert.equal(storyFrame({ ...beat, layout: 'compare' }, .9), 0)
})

test('repeated nearby photos hold the map; a genuinely different place moves it', () => {
  assert.equal(shouldMoveStoryMap(undefined, [120.13, 30.3]), true)
  assert.equal(shouldMoveStoryMap([120.13, 30.3], [120.132, 30.301]), false)
  assert.equal(shouldMoveStoryMap([120.13, 30.3], [120.2, 30.32]), true)
  assert.equal(shouldMoveStoryMap([120.13, 30.3], [110.2, 20.3]), true)
})

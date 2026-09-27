import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {reviewSnapshot,createMemoryReview} from '../server/memoryReview.mjs'

test('local review strips originals, secrets and unrelated keys',()=>{
  const snapshot=reviewSnapshot({assets:[{id:'photo-1',preview:'private-pixels',hash:'private-hash',name:'original-name',token:'secret',card:{title:'a card',scene:'a tree'}}],regions:[{photoIds:['photo-1','other-account'],center:[120,30]}]})
  assert.equal(snapshot.assets.length,1)
  assert.deepEqual(snapshot.regions[0].photoIds,['photo-1'])
  assert.ok(!/private-pixels|private-hash|original-name|secret/.test(JSON.stringify(snapshot)))
})
test('review snapshots remain isolated by account',async()=>{
  const store=createMemoryReview(await mkdtemp(join(tmpdir(),'pw-review-')))
  await store.save({id:'owner'},{assets:[{id:'photo-1'}]})
  assert.equal(await store.read({id:'stranger'}),null)
  assert.equal((await store.read({id:'owner'})).assets[0].id,'photo-1')
})

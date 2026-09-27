import {test} from 'node:test'
import assert from 'node:assert/strict'
import {discoverFilmStories,storyAlreadyMade,storyAttempted} from '../src/lib/filmStories.ts'
import {fallbackFilm,validateFilmPlan} from '../server/memoryFilmPlan.mjs'
const group=(place,count)=>Array.from({length:count},(_,i)=>({id:`${place}-${i}`,place,date:'2026-03-15',observed:'公园里的花与散步的人',confirmed:'',tags:[]}))
test('按真实地点发现有界故事，排除城市与住宅名，已完成故事不重剪',()=>{
  const stories=discoverFilmStories([...group('示例体育公园',8),...group('海滨',7),...group('示例万象城',5),...group('活动中心',5),...group('未来谷',4),...group('某市',12),...group('某某府',9)])
  assert.equal(stories.length,5);assert.ok(!stories.some(s=>/某/.test(s.place)))
  assert.equal(stories[0].key,discoverFilmStories([...stories[0].sources].reverse())[0].key)
  assert.equal(storyAlreadyMade(stories[0],[{status:'complete',plan:{shots:stories[0].sources.map(s=>({assetId:s.id}))}}]),true)
  assert.equal(storyAlreadyMade(stories[1],[{status:'complete',plan:{shots:stories[0].sources.map(s=>({assetId:s.id}))}}]),false)
  assert.equal(storyAlreadyMade(stories[0],[{status:'failed',plan:{shots:stories[0].sources.map(s=>({assetId:s.id}))}}]),false)
})
test('少量素材按真实长度成片，不复制照片；长素材依旧至少六张',()=>{
  for(const n of[2,3,4,5]){
    const sources=group('park',n),plan=validateFilmPlan(fallbackFilm(sources),sources)
    assert.equal(new Set(plan.shots.map(s=>s.assetId)).size,n)
    assert.ok(plan.shots.reduce((sum,s)=>sum+s.seconds,0)<26)
  }
  const sources=group('park',9)
  assert.throws(()=>validateFilmPlan({shots:fallbackFilm(sources).shots.slice(0,5)},sources))
})
test('同类活动跨地点形成候选，增量批次不会重复尝试相同素材',()=>{
  const sources=group('某某府',3).map((s,i)=>({...s,place:i?'某市':'某某府',observed:'孩子在吃冰淇淋'}))
  const stories=discoverFilmStories(sources)
  assert.equal(stories.length,1);assert.equal(stories[0].kind,'activity')
  assert.equal(stories[0].sources.length,3)
  assert.equal(storyAttempted([`auto-v2:old:${stories[0].key}`],stories[0].key),true)
  assert.equal(storyAttempted([`auto-v2:old:${stories[0].key}`],'different'),false)
})
test('导演可安排同日景别；跨日仍按时间排列，无依据下午被清除',()=>{
  const sources=group('park',4).map((s,i)=>({...s,id:`photo-${i}`,date:i<3?'2026-01-01':'2026-01-02',observed:'积雪地面和雪地里的人'}))
  const input={title:'这个下午',closing:'下午的回忆',shots:[3,2,0,1].map(i=>({assetId:sources[i].id,caption:'雪地里的下午',seconds:4,motion:'pull'}))}
  const plan=validateFilmPlan(input,sources)
  assert.deepEqual(plan.shots.map(s=>s.assetId),['photo-2','photo-0','photo-1','photo-3'])
  assert.equal(plan.treatment,'snow-journal');assert.ok(plan.shots.every(s=>!s.caption&&s.motion==='pull'))
  assert.ok(!plan.title.includes('下午')&&!plan.closing.includes('下午'))
})

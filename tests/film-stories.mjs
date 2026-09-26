import {test} from 'node:test'
import assert from 'node:assert/strict'
import {discoverFilmStories,storyAlreadyMade} from '../src/lib/filmStories.ts'
import {fallbackFilm,validateFilmPlan} from '../server/memoryFilmPlan.mjs'
const group=(place,count)=>Array.from({length:count},(_,i)=>({id:`${place}-${i}`,place,date:'2026-03-15',observed:'公园里的花与散步的人',confirmed:'',tags:[]}))
test('按真实地点发现有界故事，排除城市与住宅名，已完成故事不重剪',()=>{
  const stories=discoverFilmStories([...group('示例体育公园',8),...group('海滨',7),...group('示例万象城',5),...group('活动中心',5),...group('未来谷',4),...group('某市',12),...group('某某府',9)])
  assert.equal(stories.length,4);assert.ok(!stories.some(s=>/某/.test(s.place)))
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

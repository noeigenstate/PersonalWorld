import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,dirname,resolve} from 'node:path'
import {buildStoryGraph} from '../server/storyGraph.mjs'
import {createStoryUnderstanding} from '../server/storyUnderstanding.mjs'
import {eventInputs,libraryInput,validateCreativeStories,validateEventUnderstanding} from '../server/storyUnderstandingPlan.mjs'

const assets=['a','b','c','d','single'].map((id,i)=>({id,hash:id,dateSource:'exif',capturedAt:`2026-0${i<2?1:i<4?2:3}-01T06:00:00Z`,location:{aoi:i<2?'公园':i<4?'书店':'海边'},card:{scene:i<2?'一起用小铲子玩沙':i<4?'翻看绘本':'拿着甜筒看海',createdAt:'v1'}}))
const faces=assets.map((a,i)=>({id:'f'+a.id,assetId:a.id,personId:i<2?'child':'reader',status:'confirmed'}))
const snapshot=(name='团团')=>{const people=[{id:'child',name,confirmed:true,relationship:'女儿'},{id:'reader',name:'读者',confirmed:true,relationship:'朋友'}];return {revision:name,people,faces,graph:buildStoryGraph(assets,[],people,faces)}}
const sleep=()=>new Promise(resolve=>setTimeout(resolve,10))
async function ready(service,state){for(let i=0;i<200;i++){const s=service.decorate(state);if(s.understanding.phase==='ready')return s;await sleep()}throw new Error('understanding queue timeout')}
const eventResult=input=>validateEventUnderstanding({title:input.people[0].name+'的这次出游',summary:'照片中保留了活动的小片刻',insights:[{text:'手里的动作串起经历',assetIds:[input.photos[0].id]}],motifs:['手上的东西']},input)
const creativeResult=input=>validateCreativeStories({stories:[{key:'things-in-hands',title:'手里的小世界',angle:'用手中的物品串起不同地点',format:'details',assetIds:input.photos.map(p=>p.id),direction:'开场用环境，中间并置手上的动作，最后回到海边',sequence:[{text:'玩沙的小动作',assetIds:['a','b']}],evidence:[{text:'不同地点都有手中的物品',assetIds:input.photos.map(p=>p.id)}]}]},input)
const cleanup=root=>{assert.equal(dirname(resolve(root)),resolve(tmpdir()));rmSync(root,{recursive:true,force:true})}

test('durable incremental event understanding leads to grounded creative chapters and includes singletons',async()=>{
 const root=mkdtempSync(join(tmpdir(),'pw-understanding-')),calls=[]
 const planner=async(_config,kind,input)=>{calls.push({kind,id:input.eventId});return kind==='event'?eventResult(input):creativeResult(input)}
 let service=createStoryUnderstanding(root,{available:true,delayMs:0,planner})
 try{
   let raw=snapshot();service.observe(raw);let state=await ready(service,raw)
   assert.equal(calls.filter(c=>c.kind==='event').length,2)
   const creative=state.graph.chapters.find(c=>c.kind==='creative')
   assert.ok(creative.assetIds.includes('single'),'single-photo events remain available for cross-place themes')
   assert.ok(creative.brief.direction)
   assert.ok(state.graph.chapters.some(c=>c.interpretation))
   service.observe(raw);await sleep();assert.equal(calls.length,3,'no new source evidence, no repeated model call')
   raw=snapshot('新昵称');service.observe(raw);state=await ready(service,raw)
   assert.equal(calls.filter(c=>c.kind==='event').length,3,'only the affected event is re-understood')
   assert.notEqual(state.graph.chapters.find(c=>c.kind==='creative').revision,creative.revision)
   service.close();service=createStoryUnderstanding(root,{available:true,delayMs:0,planner});service.observe(raw)
   await ready(service,raw);await sleep();assert.equal(calls.length,5,'restart reuses completed revisions')
 }finally{service.close();cleanup(root)}
})

test('a correction while reasoning discards the stale response; pause prevents new calls',async()=>{
 const root=mkdtempSync(join(tmpdir(),'pw-understanding-race-'));let release,started=false,calls=0
 const planner=async(_config,kind,input)=>{
   calls++
   if(!started&&kind==='event'){started=true;await new Promise(resolve=>{release=resolve})}
   return kind==='event'?eventResult(input):creativeResult(input)
 }
 const service=createStoryUnderstanding(root,{available:true,delayMs:0,planner})
 try{
   service.observe(snapshot());while(!started)await sleep()
   const raw=snapshot('现在的名字');service.observe(raw);release()
   const result=await ready(service,raw)
   assert.ok(result.graph.chapters.filter(c=>c.interpretation).some(c=>c.title.startsWith('现在的名字')))
   assert.ok(!result.graph.chapters.some(c=>c.title==='团团的这次出游'))
   service.control({paused:true});const before=calls;service.observe(snapshot('再改名'));await new Promise(r=>setTimeout(r,70));assert.equal(calls,before)
   service.control({paused:false});await ready(service,snapshot('再改名'));assert.ok(calls>before)
 }finally{service.close();cleanup(root)}
})

test('failed input revisions do not retry forever; explicit retry is bounded',async()=>{
 const root=mkdtempSync(join(tmpdir(),'pw-understanding-failed-'));let calls=0
 const service=createStoryUnderstanding(root,{available:true,delayMs:0,planner:async()=>{calls++;throw new Error('provider unavailable')}})
 try{
   const raw=snapshot();service.observe(raw)
   for(let i=0;i<100&&service.decorate(raw).understanding.busy;i++)await sleep()
   const before=calls;service.observe(raw);await new Promise(r=>setTimeout(r,70));assert.equal(calls,before)
   assert.ok(service.decorate(raw).understanding.errors.length)
   service.control({retry:true});for(let i=0;i<100&&service.decorate(raw).understanding.busy;i++)await sleep();assert.ok(calls>before)
 }finally{service.close();cleanup(root)}
})

test('story validators reject invented photos, unsupported personal claims and duplicate angles',()=>{
 const inputs=eventInputs(snapshot(),1),input=libraryInput(inputs,{})
 assert.throws(()=>validateCreativeStories({stories:[{key:'fake',title:'第一次走路',angle:'无依据',assetIds:['invented']}]},input))
 assert.throws(()=>validateEventUnderstanding({title:'团团第一次走路',summary:'她最喜欢画画',insights:[]},inputs[0]))
 const story={key:'a',title:'手里的东西',angle:'观察已有的动作',format:'details',assetIds:['a','b'],sequence:[{text:'玩沙的小动作',assetIds:['a']}],evidence:[{text:'玩沙',assetIds:['a']}]}
 assert.equal(validateCreativeStories({stories:[story,{...story,key:'b'}]},input).length,1)
 assert.throws(()=>validateCreativeStories({stories:[{...story,evidence:[]}]},input))
 assert.throws(()=>validateCreativeStories({stories:[{...story,title:'读者在公园玩沙'}]},input),'a person elsewhere in the album cannot be claimed in these photos')
 assert.throws(()=>validateCreativeStories({stories:[{...story,sequence:[{text:'读者在玩沙',assetIds:['a']}]}]},input),'sequence beats enforce per-photo membership')
 const normalized=validateCreativeStories({stories:[{...story,evidence:[{text:'同日先走到这里，再跑去那里',assetIds:['a']}],sequence:[{text:'同日从书店又去了海边',assetIds:['a']}]}]},input)[0]
 assert.ok(normalized.evidence[0].text.includes(input.photos.find(p=>p.id==='a').observed))
 assert.ok(!normalized.sequence[0].text.includes('同日'))
 assert.deepEqual(validateCreativeStories({stories:[normalized]},input)[0],normalized,'source-backed normalization stays stable on reload')
})

test('a correction during library review never exposes its old story proposals',async()=>{
 const root=mkdtempSync(join(tmpdir(),'pw-understanding-weave-'));let release,started=false
 const planner=async(_config,kind,input)=>{
   if(kind==='event')return eventResult(input)
   if(!started){started=true;await new Promise(resolve=>{release=resolve})}
   return creativeResult(input)
 }
 const service=createStoryUnderstanding(root,{available:true,delayMs:0,planner})
 try{
   service.observe(snapshot());while(!started)await sleep()
   const raw=snapshot('改名后');service.observe(raw);release();await sleep()
   const interim=service.decorate(raw)
   if(interim.understanding.busy)assert.equal(interim.graph.chapters.filter(c=>c.kind==='creative').length,0)
   const fresh=await ready(service,raw);assert.equal(fresh.understanding.phase,'ready')
   assert.ok(fresh.graph.chapters.some(c=>c.title.startsWith('改名后')))
 }finally{service.close();cleanup(root)}
})

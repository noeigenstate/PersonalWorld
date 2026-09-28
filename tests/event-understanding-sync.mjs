import {test} from 'node:test'
import assert from 'node:assert/strict'
import {buildStoryGraph} from '../server/storyGraph.mjs'
import {createStoryUnderstanding} from '../server/storyUnderstanding.mjs'
import {validateEventUnderstanding} from '../server/storyUnderstandingPlan.mjs'
import {understoodEvents} from '../src/lib/eventUnderstanding.ts'
import {filmKnowledgeRevision} from '../server/filmKnowledge.mjs'
import {storyRelationships} from '../server/storyRelationships.mjs'
import {mkdtempSync,rmSync} from 'node:fs'
import {join,dirname,resolve} from 'node:path'
import {tmpdir} from 'node:os'

test('map event, singleton photo narrative and film knowledge follow confirmed identity changes without a feedback loop',async()=>{
  const root=mkdtempSync(join(tmpdir(),'pw-event-sync-'))
  const assets=['a','b'].map((id,i)=>({id,hash:id,kind:'image',capturedAt:`2026-04-${10+i}T06:00:00Z`,dateSource:'exif',card:{scene:'孩子在翻绘本',createdAt:'v1'}}))
  const events=assets.map((a,i)=>({id:'source-'+a.id,assetIds:[a.id],title:'日期片段',summary:'',occurredAt:a.capturedAt,status:i?'confirmed':'draft',people:[],tags:[],questions:[]}))
  const faces=assets.map(a=>({id:'f'+a.id,assetId:a.id,personId:'child',status:'confirmed'}))
  const snapshot=name=>{const people=[{id:'child',name,relationship:'女儿',confirmed:true}];return {revision:name,people,faces,graph:buildStoryGraph(assets,events,people,faces)}}
  let calls=0
  const service=createStoryUnderstanding(root,{available:true,delayMs:0,planner:async(_config,kind,input)=>{
    if(kind==='library')throw new Error('isolated event test')
    calls++;const name=input.people[0].name
    return validateEventUnderstanding({title:name+'翻绘本',summary:name+'看着手里的书页',insights:[{text:name+'在翻书',assetIds:input.photos.map(p=>p.id)}],photos:input.photos.map(p=>({assetId:p.id,title:name+'的书页',caption:name+'看着绘本'})),motifs:['绘本']},input)
  }})
  const settle=async raw=>{for(let i=0;i<150;i++){const state=service.decorate(raw);if(state.understanding.completed===2)return state;await new Promise(r=>setTimeout(r,10))}throw new Error('queue not completed')}
  try{
    let raw=snapshot('团团');service.observe(raw);let state=await settle(raw)
    let view=understoodEvents(events,assets,state)
    assert.equal(view[0].title,'团团翻绘本');assert.equal(view[0].status,'analyzed')
    assert.equal(view[1].title,'日期片段','confirmed event text stays owned by user')
    assert.equal(view[1].understanding.photos[0].caption,'团团看着绘本')
    assert.equal(events[0].title,'日期片段','generated text never mutates source inputs')
    service.observe(raw);assert.equal(calls,2,'UI projection must not trigger another interpretation')
    const oldKnowledge=filmKnowledgeRevision([{id:'a',narrative:view[0].understanding.photos[0].caption}])
    raw=snapshot('新昵称');service.observe(raw)
    assert.equal(understoodEvents(events,assets,service.decorate(raw))[0].title,'日期片段','stale interpretation is not shown while re-understanding')
    state=await settle(raw);view=understoodEvents(events,assets,state)
    assert.equal(view[0].title,'新昵称翻绘本');assert.equal(calls,4)
    assert.notEqual(oldKnowledge,filmKnowledgeRevision([{id:'a',narrative:view[0].understanding.photos[0].caption}]))
    assert.equal(understoodEvents(events,[{...assets[0],card:{scene:'在玩沙'}},assets[1]],state)[0].title,'日期片段','local observation changed before server sync')
    assert.equal(understoodEvents([{...events[0],assetIds:['a','new']}],assets,state)[0].title,'日期片段','imported photos invalidate partial event coverage')
  }finally{service.close();assert.equal(dirname(resolve(root)),resolve(tmpdir()));rmSync(root,{recursive:true,force:true})}
})

test('each photo narrative uses only that photograph’s confirmed people',()=>{
  const input={photos:[{id:'a',personIds:['child']},{id:'b',personIds:['grandma']}],people:[{id:'child',name:'团团',relationship:'女儿'},{id:'grandma',name:'姥姥',relationship:'团团的姥姥'}],relationships:[],confirmed:[]}
  const answer={title:'两页回忆',summary:'书页和沙地',insights:[{text:'两张照片有不同活动',assetIds:['a','b']}],photos:[{assetId:'a',title:'姥姥陪伴',caption:'姥姥在翻书'},{assetId:'b',title:'姥姥在沙地',caption:'姥姥拿着小铲子'}]}
  const result=validateEventUnderstanding(answer,input)
  assert.deepEqual(result.photos.map(p=>p.assetId),['b'])
})

test('the UI’s relative-to-user fields link to the unique confirmed self, with revocation and ambiguity preserved',()=>{
 const people=[{id:'self',name:'爸爸',relationship:'我',confirmed:true},{id:'child',name:'团团',relationship:'女儿',confirmed:true},{id:'spouse',name:'妈妈',relationship:'妻子',confirmed:true}]
 const relations=storyRelationships(people)
 assert.equal(relations.length,2);assert.ok(relations.every(r=>r.objectId==='self'&&r.source==='user'))
 assert.ok(relations.some(r=>r.value==='团团是爸爸的女儿'))
 assert.equal(storyRelationships([{...people[0],relationship:''},...people.slice(1)],relations).length,0,'removing self confirmation revokes owner-relative edges')
 assert.equal(storyRelationships([...people,{id:'other',relationship:'我',confirmed:true}],relations).length,0,'ambiguous owner is not guessed')
 const renamed=storyRelationships([{...people[0],name:'新名字'},...people.slice(1)],relations)
 assert.deepEqual(renamed.map(r=>r.id),relations.map(r=>r.id));assert.ok(renamed.every(r=>r.value.includes('新名字')))
})

test('a venue called a parent-child activity center does not invent a parent-child relationship',()=>{
 const input={photos:[{id:'a',observed:'商场的亲子活动中心，儿童在制作砂画',personIds:['child']}],people:[{id:'child',name:'团团',relationship:'女儿'}],relationships:[],confirmed:[]}
 const answer={title:'团团制作砂画',summary:'在亲子活动中心做砂画',insights:[{text:'手里拿着砂画工具',assetIds:['a']}]}
 assert.ok(validateEventUnderstanding(answer,input).summary)
 assert.throws(()=>validateEventUnderstanding({...answer,summary:'这是一次亲子互动'},input),/亲子/)
})

import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {openIdentityStore} from '../server/identityStore.mjs'
import {buildStoryGraph} from '../server/storyGraph.mjs'
import {candidateGroups} from '../server/identityCandidates.mjs'
import {storyRelationships} from '../server/storyRelationships.mjs'
import {validateFilmPlan} from '../server/memoryFilmPlan.mjs'

const asset=(id,day='01')=>({id,hash:id,kind:'image',capturedAt:`2026-01-${day}T06:30:00Z`,dateSource:'exif',location:{aoi:'测试公园',source:'gps'},card:{scene:'在雪地玩雪',createdAt:'v1'}})
const face=(axis=0)=>({embedding:Array.from({length:128},(_,i)=>i===axis?1:0),quality:'good',box:[.2,.2,.5,.5],confidence:.99,thumb:''})
const run=(s,id,fs=[face()])=>s.saveDetection(id,s.needsAnalysis(id,'model-v1').key,{fingerprint:'model-v1',faces:fs})
const withStore=fn=>{const root=mkdtempSync(join(tmpdir(),'memory-identity-'));const s=openIdentityStore(root);try{fn(s)}finally{s.close();rmSync(root,{recursive:true,force:true})}}
test('incremental content/model keys; no embeddings cross the API boundary',()=>withStore(s=>{
 s.sync({assets:[asset('a')],events:[]});const state=run(s,'a');assert.equal(state.faces.length,1);assert.equal(JSON.stringify(state).includes('embedding'),false)
 assert.equal(s.needsAnalysis('a','model-v1').needed,false);s.sync({assets:[{...asset('a'),card:{scene:'另一个描述'}}],events:[]});assert.equal(s.needsAnalysis('a','model-v1').needed,false)
 s.sync({assets:[{...asset('a'),hash:'new-content'}],events:[]});assert.equal(s.snapshot().faces.length,0);assert.equal(s.needsAnalysis('a','model-v1').needed,true)
}))
test('same-photo faces cannot collapse into one identity; human confirmation is stable',()=>withStore(s=>{
 s.sync({assets:[asset('a'),asset('b','02')],events:[]});let state=run(s,'a');const person=state.faces[0].personId
 s.correct({action:'name',personId:person,name:'测试人物',relationship:'家人'});state=run(s,'b',[face(),face()])
 const b=state.faces.filter(f=>f.assetId==='b');assert.equal(new Set(b.map(f=>f.personId)).size,2);assert.equal(b[0].personId,person);assert.equal(b[0].status,'matched')
 assert.throws(()=>s.correct({action:'merge',personId:b[1].personId,intoId:person}),/同一张照片/)
 assert.throws(()=>s.needsAnalysis('a','model-v2'),/迁移/)
}))
test('split, move, merge and undo preserve stable IDs and chapter invalidation',()=>withStore(s=>{
 s.sync({assets:[asset('a'),asset('b','02'),asset('c','03')],events:[]});run(s,'a');run(s,'b');let state=run(s,'c');const person=state.faces[0].personId
 state=s.correct({action:'name',personId:person,name:'团团'});const chapter=state.graph.chapters.find(c=>c.kind==='activity');assert.ok(chapter)
 state=s.correct({action:'name',personId:person,name:'新昵称'});assert.notEqual(chapter.revision,state.graph.chapters.find(c=>c.id===chapter.id).revision)
 state=s.correct({action:'split',faceIds:[state.faces[2].id]});const split=state.faces[2].personId;assert.notEqual(split,person)
 state=s.undo(state.lastCorrection.id);assert.equal(state.faces[2].personId,person)
 state=s.correct({action:'split',faceIds:[state.faces[2].id]});const separated=state.faces[2].personId
 state=s.correct({action:'merge',personId:separated,intoId:person});assert.ok(state.faces.every(f=>f.personId===person))
 state=s.fact({subjectId:person,value:'昵称是用户确认的'});assert.ok(s.enrich([{id:'a'}])[0].story.includes('昵称是用户确认的'))
 assert.equal(s.enrich([{id:'unrelated'}])[0].story,'')
}))
test('metadata-only observations do not invent cross-photo identities or dates',()=>{
 const state=buildStoryGraph([asset('a'),{...asset('b'),dateSource:'file'}],[],[],[])
 assert.equal(state.chapters.filter(c=>c.kind==='person').length,0)
 assert.equal(state.facts.some(f=>f.assetId==='b'&&f.type==='time'),false)
})
test('account stores are isolated and deletion removes biometric observations',()=>withStore(s=>{
 s.sync({assets:[asset('a')],events:[]});run(s,'a');const id=s.snapshot().faces[0].id
 withStore(other=>{assert.equal(other.hasFace(id),false);assert.equal(other.snapshot().faces.length,0)})
 s.sync({assets:[],events:[]});assert.equal(s.hasFace(id),false);assert.equal(s.snapshot().runs.length,0)
}))
test('candidate consensus blocks transitive bridges, co-occurrence and mixed models',()=>{
 const vector=angle=>Array.from({length:128},(_,i)=>i===0?Math.cos(angle):i===1?Math.sin(angle):0)
 const a={id:'a',assetId:'a',model:'v1',embedding:vector(0)},b={id:'b',assetId:'b',model:'v1',embedding:vector(.8)},c={id:'c',assetId:'c',model:'v1',embedding:vector(1.6)}
 assert.equal(candidateGroups([a,b,c]).length,2)
 assert.equal(candidateGroups([a,{...a,id:'b'}]).length,2)
 assert.equal(candidateGroups([a,{...a,id:'b',assetId:'b',model:'v2'}]).length,2)
})

test('confirming an anchor immediately re-matches older unlocked candidates',()=>withStore(s=>{
 s.sync({assets:[asset('a'),asset('b','02')],events:[]})
 run(s,'a');run(s,'b',[face(1)])
 const anchor=s.snapshot().faces.find(f=>f.assetId==='a').personId
 // A better detector pass refreshes a former candidate's feature, but it has
 // not yet been settled against the newly confirmed identity.
 run(s,'b',[face(0)])
 const state=s.correct({action:'name',personId:anchor,name:'团团',relationship:'女儿'})
 assert.equal(state.faces.find(f=>f.assetId==='b').personId,anchor)
 assert.equal(state.faces.find(f=>f.assetId==='b').status,'matched')
 assert.deepEqual(state.graph.memberships.b,[anchor])
}))

test('detector upgrades add missed faces without deleting confirmed identities',()=>withStore(s=>{
 s.sync({assets:[asset('a')],events:[]});let state=run(s,'a')
 const original=state.faces[0]
 s.correct({action:'name',personId:original.personId,name:'团团'})
 const info={available:true,fingerprint:'model-v1',detectorRevision:'multiscale-v2'}
 assert.deepEqual(s.pendingFor(info),['a'])
 const key=s.needsAnalysis('a','model-v1',false,'multiscale-v2').key
 state=s.saveDetection('a',key,{fingerprint:'model-v1',detectorRevision:'multiscale-v2',faces:[face(),{...face(1),box:[.6,.2,.9,.5]}]})
 assert.equal(state.faces.length,2)
 assert.equal(state.faces.find(f=>f.id===original.id).personId,original.personId)
 assert.equal(state.faces.find(f=>f.id===original.id).locked,true)
 assert.deepEqual(s.pendingFor(info),[])
 assert.equal(s.needsAnalysis('a','model-v1',false,'multiscale-v2').needed,false)
 // A second pass neither duplicates detections nor undoes explicit ignores.
 const second=state.faces.find(f=>f.id!==original.id)
 s.correct({action:'ignore',faceIds:[second.id]})
 state=s.saveDetection('a',key,{fingerprint:'model-v1',detectorRevision:'multiscale-v3',faces:[face(),{...face(1),box:[.6,.2,.9,.5]}]})
 assert.equal(state.faces.length,2);assert.equal(state.faces.find(f=>f.id===second.id).status,'ignored')
}))

test('revoking the confirmed anchor rechecks dependent automatic matches',()=>withStore(s=>{
 s.sync({assets:[asset('a'),asset('b','02')],events:[]});let state=run(s,'a')
 const anchor=state.faces[0]
 s.correct({action:'name',personId:anchor.personId,name:'团团'})
 state=run(s,'b');assert.equal(state.faces.find(f=>f.assetId==='b').status,'matched')
 state=s.correct({action:'ignore',faceIds:[anchor.id]})
 assert.equal(state.faces.find(f=>f.assetId==='b').status,'candidate')
 assert.deepEqual(state.graph.memberships.b,[])
}))

test('explicit family relationships survive renaming, scope to visible people, and invalidate relevant chapters',()=>withStore(s=>{
 s.sync({assets:[asset('a'),asset('b','02'),asset('child-only','03')],events:[]})
 let state=run(s,'a',[face(),{...face(1),box:[.6,.2,.9,.5]}])
 const [child,grandma]=state.faces
 s.correct({action:'name',personId:child.personId,name:'团团',relationship:'女儿'})
 s.correct({action:'name',personId:grandma.personId,name:'姥姥',relationship:'团团的姥姥'})
 run(s,'b',[face(),{...face(1),box:[.6,.2,.9,.5]}]);run(s,'child-only',[face()])
 state=s.snapshot();const relation=state.graph.relationships[0],chapter=state.graph.chapters.find(c=>c.kind==='relationship')
 assert.equal(relation.objectId,child.personId);assert.equal(chapter.assetIds.length,2)
 state=s.correct({action:'name',personId:child.personId,name:'新昵称',relationship:'女儿'})
 assert.equal(state.graph.relationships[0].id,relation.id)
 assert.equal(state.graph.relationships[0].value,'姥姥是新昵称的姥姥')
 assert.notEqual(state.graph.chapters.find(c=>c.id===chapter.id).revision,chapter.revision)
 const sources=s.enrich([{id:'a'},{id:'b'},{id:'child-only'}])
 assert.equal(sources[2].relationships.length,0)
 assert.ok(!sources[2].people.some(p=>p.name==='姥姥'))
 const answer={title:'祖孙的小日子',shots:sources.map(s=>({assetId:s.id,caption:'祖孙玩雪',seconds:4}))}
 const plan=validateFilmPlan(answer,sources)
 assert.equal(plan.title,'祖孙的小日子');assert.equal(plan.shots.find(s=>s.assetId==='child-only').caption,'')
 state=s.correct({action:'name',personId:grandma.personId,name:'姥姥',relationship:'家人'})
 assert.equal(state.graph.relationships.length,0)
 assert.equal(state.graph.chapters.filter(c=>c.kind==='relationship').length,0)
}))

test('ambiguous names and visual co-occurrence do not invent family edges',()=>{
 assert.deepEqual(storyRelationships([{id:'a',name:'团团',confirmed:true},{id:'b',name:'团团',confirmed:true},{id:'c',name:'姥姥',relationship:'团团的姥姥',confirmed:true}]),[])
 assert.deepEqual(storyRelationships([{id:'a',name:'团团',confirmed:true},{id:'c',name:'姥姥',relationship:'家人',confirmed:true}]),[])
})
test('candidate regrouping keeps explicitly split faces apart and confirmed identities intact',()=>withStore(s=>{
 s.sync({assets:[asset('a'),asset('b','02'),asset('c','03')],events:[]});run(s,'a');run(s,'b');let state=run(s,'c');const id=state.faces[0].personId
 state=s.correct({action:'name',personId:id,name:'保留这个人'});const selected=state.faces[1].id
 state=s.correct({action:'split',faceIds:[selected]});const separate=state.faces.find(f=>f.id===selected).personId
 state=s.reconcile();assert.equal(state.faces.find(f=>f.id===selected).personId,separate);assert.equal(state.people.find(p=>p.id===id).name,'保留这个人')
}))

import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {openIdentityStore} from '../server/identityStore.mjs'
import {buildStoryGraph} from '../server/storyGraph.mjs'
import {candidateGroups} from '../server/identityCandidates.mjs'

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
test('candidate regrouping keeps explicitly split faces apart and confirmed identities intact',()=>withStore(s=>{
 s.sync({assets:[asset('a'),asset('b','02'),asset('c','03')],events:[]});run(s,'a');run(s,'b');let state=run(s,'c');const id=state.faces[0].personId
 state=s.correct({action:'name',personId:id,name:'保留这个人'});const selected=state.faces[1].id
 state=s.correct({action:'split',faceIds:[selected]});const separate=state.faces.find(f=>f.id===selected).personId
 state=s.reconcile();assert.equal(state.faces.find(f=>f.id===selected).personId,separate);assert.equal(state.people.find(p=>p.id===id).name,'保留这个人')
}))

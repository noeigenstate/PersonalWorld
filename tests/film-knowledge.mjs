import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,dirname,resolve} from 'node:path'
import {createFilmService} from '../server/memoryFilms.mjs'
import {fallbackFilm,validateFilmPlan} from '../server/memoryFilmPlan.mjs'
import {filmKnowledgeRevision} from '../server/filmKnowledge.mjs'
import {nextFilmUpdate} from '../src/lib/filmUpdates.ts'

const sources=[{id:'a',date:'2026-02-19',observed:'沙滩上玩沙',confirmed:'',place:'测试海滩',tags:[]},{id:'b',date:'2026-02-19',observed:'一起拿着沙铲',confirmed:'',place:'测试海滩',tags:[]}]
const pause=()=>new Promise(resolve=>setTimeout(resolve,5))
async function waitFor(service,id,user,status){for(let i=0;i<200;i++){const job=service.get(id,user)[1];if(job.status===status)return job;await pause()}throw new Error('Test job did not reach '+status)}
const dataUrl='data:image/jpeg;base64,'+Buffer.from([255,216,...Array(30).fill(0)]).toString('base64')
async function images(service,job,user){for(const shot of job.plan.shots)assert.equal((await service.upload(job.id,shot.assetId,{dataUrl},user))[0],200)}

test('all films track current knowledge, preserve lineage, and replan a mid-upload correction',async()=>{
 const root=mkdtempSync(join(tmpdir(),'pw-film-knowledge-')),user={id:'isolated-knowledge-test'}
 let label='团团',note='',chapter={id:'chapter:test',revision:'one',assetIds:['a','b']}
 const planned=[]
 const service=createFilmService({}, {root,capability:async()=>({available:true}),exportRoot:undefined,
   enrichSources:(_user,input)=>input.map(s=>({...s,people:[{id:'child',name:label,relationship:'女儿'}],story:[s.story,`用户已确认的人物：${label}（女儿）`,note].filter(Boolean).join(' ')})),
   chapterFor:(_user,id)=>id===chapter.id?chapter:undefined,
   planner:async(_config,input)=>{planned.push(structuredClone(input));return {plan:validateFilmPlan(fallbackFilm(input),input),planner:'local'}},
   renderer:async(dir)=>{writeFileSync(join(dir,'film.mp4'),'test placeholder');return {duration:8,bytes:16}},
 })
 try{
   // No chapter ID: the old implementation missed this entire update path.
   const first=(await service.start({sources},user))[1]
   let job=await waitFor(service,first.id,user,'awaiting-images');await images(service,job,user);await service.render(job.id,user)
   job=await waitFor(service,job.id,user,'complete');assert.equal(job.knowledgeChanged,false)
   label='毛蛋';note='用户补充了新的故事事实'
   const changed=service.get(job.id,user)[1]
   assert.equal(changed.knowledgeChanged,true)
   const pending=nextFilmUpdate([changed],[]);assert.ok(pending)
   assert.equal(nextFilmUpdate([changed],[pending.key]),undefined)
   const second=(await service.start({fromJob:job.id},user))[1]
   assert.equal(second.lineageId,job.id);assert.equal(second.supersedesId,job.id)
   job=await waitFor(service,second.id,user,'awaiting-images');await images(service,job,user)
   label='毛蛋的新昵称'
   const replanned=await service.render(job.id,user)
   assert.equal(replanned[0],202)
   job=await waitFor(service,job.id,user,'awaiting-images')
   assert.equal(job.uploaded.length,0);assert.ok(planned.at(-1).every(s=>s.people[0].name===label))
   await images(service,job,user);await service.render(job.id,user);job=await waitFor(service,job.id,user,'complete')
   assert.equal(nextFilmUpdate(await service.list(user),[]),undefined,'old cut must not spawn another update')
   // Chapter binding survives a manual regeneration as well.
   const withChapter=(await service.start({sources,chapterId:chapter.id,regenerate:true},user))[1]
   job=await waitFor(service,withChapter.id,user,'awaiting-images');await images(service,job,user);await service.render(job.id,user);await waitFor(service,job.id,user,'complete')
   chapter={...chapter,revision:'two'}
   const inherited=(await service.start({fromJob:job.id,regenerate:true},user))[1]
   assert.equal(inherited.chapterId,chapter.id);assert.equal(inherited.chapterRevision,'two')
   await service.cancel(inherited.id,user)
 }finally{service.close();assert.equal(dirname(resolve(root)),resolve(tmpdir()));rmSync(root,{recursive:true,force:true})}
})

test('geometry and analysis timestamps do not cause creative rerenders; evidence changes do',()=>{
 const original={...sources[0],people:[{id:'a',name:'团团'}],faceBoxes:[[.1,.1,.3,.3]],identityRevision:'one'}
 assert.equal(filmKnowledgeRevision([original]),filmKnowledgeRevision([{...original,identityRevision:'two',faceBoxes:[[.11,.11,.3,.3]]}]))
 assert.notEqual(filmKnowledgeRevision([original]),filmKnowledgeRevision([{...original,observed:'在读绘本'}]))
})

test('an older film can be updated even when a different film is newest',()=>{
 const jobs=[{id:'other',createdAt:20,status:'complete'},{id:'beach',createdAt:10,status:'complete',knowledgeChanged:true,currentKnowledgeRevision:'new-fact'}]
 assert.equal(nextFilmUpdate(jobs,[]).job.id,'beach')
})

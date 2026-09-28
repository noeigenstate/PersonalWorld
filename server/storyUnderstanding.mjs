import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { eventInputs, libraryInput, storyHash, understandStory, validateCreativeStories, UNDERSTANDING_VERSION } from './storyUnderstandingPlan.mjs'
import { loadSkill } from './skills.mjs'

// A durable, account-local queue. Generated interpretations are never written
// back into the identity/fact store, and stale responses cannot publish.
export function createStoryUnderstanding(root,{config,planner=understandStory,delayMs=8000,available=Boolean(config?.apiKey&&config?.model)}={}){
  mkdirSync(root,{recursive:true})
  const file=join(root,'understanding.json')
  let state={version:UNDERSTANDING_VERSION,paused:false,events:{},weave:null,changes:[]}
  try{if(existsSync(file)){const saved=JSON.parse(readFileSync(file,'utf8'));state=saved.version===UNDERSTANDING_VERSION?{...state,...saved}:{...state,paused:saved.paused===true}}}catch{ /* Start from validated source facts if a snapshot is incomplete. */ }
  for(const job of [...Object.values(state.events),state.weave].filter(Boolean))if(job.status==='running')job.status='queued'
  // One recovery of this known validator issue after upgrade; never turn a
  // rejected/provider-failed input into a perpetual retry loop.
  for(const job of Object.values(state.events))if(job.status==='failed'&&job.error?.startsWith('事件理解未通过')&&job.repairVersion!=='scoped-claims-2'){
    job.status='queued';job.error='';job.repairVersion='scoped-claims-2'
  }
  const plannerRevision=storyHash([UNDERSTANDING_VERSION,config?.model||'test-planner',loadSkill('story-understanding')])
  const inputsFor=(snapshot,min=1)=>eventInputs(snapshot,min).map(input=>({...input,revision:storyHash([input.revision,plannerRevision])}))
  let timer,busy=false,closed=false,notBefore=0,raw=null
  const persist=()=>{const tmp=file+'.tmp';writeFileSync(tmp,JSON.stringify(state),'utf8');renameSync(tmp,file)}
  const schedule=(delay=delayMs)=>{clearTimeout(timer);if(closed||state.paused||!available)return;timer=setTimeout(()=>void pump(),delay);timer.unref()}
  const jobs=()=>Object.values(state.events)
  function prepareWeave(){
    if(!raw||jobs().some(j=>['queued','running'].includes(j.status)))return
    const allInputs=inputsFor(raw,1)
    if(allInputs.reduce((sum,e)=>sum+e.photos.length,0)<2)return
    const input=libraryInput(allInputs,state.events,state.weave?.result||[])
    input.revision=storyHash([input.revision,plannerRevision])
    if(state.weave?.wanted===input.revision)return
    state.weave={...state.weave,wanted:input.revision,input,status:'queued',error:'',changedAt:Date.now()}
  }
  async function pump(){
    if(closed||busy||state.paused||!available)return
    if(Date.now()<notBefore){schedule(notBefore-Date.now());return}
    prepareWeave()
    const job=jobs().find(j=>j.status==='queued')||(state.weave?.status==='queued'?state.weave:null)
    if(!job)return
    const kind=job===state.weave?'library':'event',revision=job.wanted,input=structuredClone(job.input)
    busy=true;job.status='running';job.startedAt=Date.now();persist()
    try{
      const result=await planner(config,kind,input)
      if(closed)return
      if(job.wanted!==revision||state.paused){job.status='queued';return}
      const stillPresent=kind==='library'?state.weave===job:state.events[input.eventId]===job
      if(!stillPresent)return
      if(job.result&&job.revision!==revision)job.previous={revision:job.revision,title:job.result.title||'',updatedAt:job.updatedAt}
      Object.assign(job,{result,revision,status:'complete',updatedAt:Date.now(),error:''})
    }catch(error){
      if(job.wanted===revision){job.status='failed';job.error=String(error.message||error).slice(0,260)}else job.status='queued'
    }finally{
      busy=false
      if(!closed){prepareWeave();persist();schedule(50)}
    }
  }
  function observe(snapshot,{paused}={}){
    raw=snapshot
    const controlChanged=typeof paused==='boolean'&&paused!==state.paused
    if(typeof paused==='boolean')state.paused=paused
    const inputs=inputsFor(snapshot),priorIds=new Set(Object.keys(state.events));let changed=state.sourceRevision!==snapshot.graph.revision
    state.sourceRevision=snapshot.graph.revision
    for(const input of inputs){
      priorIds.delete(input.eventId)
      const prior=state.events[input.eventId]
      if(prior?.wanted===input.revision)continue
      if(prior)Object.assign(prior,{wanted:input.revision,input,status:prior.status==='running'?'running':'queued',error:'',changedAt:Date.now()})
      else state.events[input.eventId]={wanted:input.revision,input,status:'queued',changedAt:Date.now()}
      changed=true
    }
    for(const id of priorIds){delete state.events[id];changed=true}
    if(snapshot.graph.facts.filter(f=>f.type==='observation').length<2)state.weave=null
    if(changed){
      notBefore=Date.now()+delayMs
      state.changes=[...state.changes,{revision:snapshot.graph.revision,at:Date.now(),events:inputs.filter(i=>state.events[i.eventId].wanted!==state.events[i.eventId].revision).map(i=>i.eventId)}].slice(-40)
    }
    prepareWeave()
    if(changed||controlChanged)persist()
    if(!busy)schedule(Math.max(0,notBefore-Date.now()))
    return decorate(snapshot)
  }
  function decorate(snapshot){
    const values=jobs(),complete=values.filter(j=>j.status==='complete'&&j.revision===j.wanted)
    const pending=values.some(j=>['queued','running'].includes(j.status))
    const currentWeave=state.weave?.status==='complete'&&state.weave.revision===state.weave.wanted&&!pending
    let proposals=[],validationError=''
    if(currentWeave)try{proposals=validateCreativeStories({stories:state.weave.result},state.weave.input)}catch(error){validationError=error.message}
    const chapters=snapshot.graph.chapters.map(chapter=>{
      if(chapter.kind!=='outing')return chapter
      const job=state.events[chapter.eventIds[0]]
      if(!job||job.status!=='complete'||job.revision!==job.wanted)return chapter
      return {...chapter,title:job.result.title,explanation:job.result.summary,interpretation:job.result,
        revision:storyHash([chapter.revision,job.revision,job.result]),understandingRevision:job.revision}
    })
    for(const proposal of [...proposals].reverse()){
      const photos=eventInputs(snapshot,1).flatMap(i=>i.photos).filter(p=>proposal.assetIds.includes(p.id))
      const dates=photos.map(p=>p.date).filter(Boolean).sort()
      const factIds=snapshot.graph.facts.filter(f=>proposal.assetIds.includes(f.assetId)||f.source==='user'&&proposal.personIds.includes(f.subjectId)).map(f=>f.id)
      chapters.unshift({id:`creative:${storyHash(proposal.key)}`,kind:'creative',title:proposal.title,assetIds:proposal.assetIds,personIds:proposal.personIds,factIds,
        eventIds:snapshot.graph.events.filter(e=>e.assetIds.some(id=>proposal.assetIds.includes(id))).map(e=>e.id),
        start:dates[0]||'',end:dates.at(-1)||'',explanation:proposal.reason,revision:proposal.revision,score:100,
        brief:{angle:proposal.angle,direction:proposal.direction,sequence:proposal.sequence,format:proposal.format,evidence:proposal.evidence},
        understandingRevision:state.weave.revision})
    }
    const errors=values.filter(j=>j.status==='failed').map(j=>({eventId:j.input.eventId,error:j.error}))
    if(state.weave?.status==='failed')errors.push({eventId:'library',error:state.weave.error})
    if(validationError)errors.push({eventId:'library',error:validationError})
    const phase=state.paused?'paused':!available?'unavailable':pending?'events':state.weave?.status==='running'||state.weave?.status==='queued'?'stories':validationError?'failed':currentWeave?'ready':errors.length?'failed':'idle'
    const understanding={available,paused:state.paused,phase,busy:available&&!state.paused&&(pending||['running','queued'].includes(state.weave?.status)),completed:complete.length,total:values.length,
      creativeCount:proposals.length,revision:currentWeave&&!validationError?state.weave.revision:'',updatedAt:state.weave?.updatedAt,errors,
      events:values.map(j=>({id:j.input.eventId,status:j.status,stale:j.revision!==j.wanted,title:j.result?.title||'',updatedAt:j.updatedAt})),changes:state.changes.slice(-6)}
    const events=snapshot.graph.events.map(event=>{
      const job=state.events[event.id]
      const fresh=job?.status==='complete'&&job.revision===job.wanted
      return {...event,understandingState:job?.status||'idle',interpretation:fresh?{...job.result,revision:job.revision,updatedAt:job.updatedAt}:undefined}
    })
    return {...snapshot,understanding,graph:{...snapshot.graph,events,chapters,revision:storyHash([snapshot.graph.revision,chapters.map(c=>c.revision),events.map(e=>e.interpretation?.revision)])}}
  }
  return {observe,decorate,
    control({paused,retry}={}){
      if(typeof paused==='boolean'){state.paused=paused;if(paused)clearTimeout(timer)}
      if(retry){for(const job of [...jobs(),state.weave].filter(Boolean))if(job.status==='failed'||raw&&job===state.weave&&job.status==='complete'&&!decorate(raw).understanding.creativeCount){job.status='queued';job.error=''}}
      persist();schedule(0);return raw?decorate(raw):null
    },
    close(){closed=true;clearTimeout(timer)},
  }
}

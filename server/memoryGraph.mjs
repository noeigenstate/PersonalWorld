import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { openIdentityStore } from './identityStore.mjs'
import { createFaceEngine } from './faceEngine.mjs'
import { createStoryUnderstanding } from './storyUnderstanding.mjs'

export function createMemoryGraph(root,{engine=createFaceEngine(),config,understandingOptions={}}={}) {
  const stores=new Map(),active=new Set(),understandings=new Map()
  let capability,checkedAt=0
  const accountKey=user=>createHash('sha256').update(user.id).digest('hex')
  const accountStore=key=>{
    if(!stores.has(key))stores.set(key,openIdentityStore(join(root,key)))
    return stores.get(key)
  }
  const store=user=>accountStore(accountKey(user))
  const accountUnderstanding=key=>{
    if(!understandings.has(key))understandings.set(key,createStoryUnderstanding(accountStore(key).root,{config,...understandingOptions}))
    return understandings.get(key)
  }
  const understanding=user=>accountUnderstanding(accountKey(user))
  const changed=(user,state,options)=>understanding(user).observe(state,options)
  // Textual evidence is already server-local. Resume the persistent queue even
  // while the browser is closed; original-image uploads still require its tab.
  if(config?.apiKey&&understandingOptions.available!==false&&existsSync(root))for(const entry of readdirSync(root,{withFileTypes:true})){
    if(entry.isDirectory()&&/^[a-f0-9]{64}$/.test(entry.name)&&existsSync(join(root,entry.name,'memory.sqlite')))
      accountUnderstanding(entry.name).observe(accountStore(entry.name).snapshot())
  }
  async function status(){
    if(capability&&Date.now()-checkedAt<30000)return capability
    try{capability={available:true,...await engine.status()}}
    catch(error){capability={available:false,message:error.message}}
    checkedAt=Date.now();return capability
  }
  async function withCapability(user,state){const info=await status();return {...state,capability:info,pending:store(user).pendingFor(info)}}
  return {
    async read(user){return withCapability(user,changed(user,store(user).reconcile()))},
    async sync(user,body){
      const s=store(user),{removed,...state}=s.sync(body)
      for(const id of removed)await rm(join(s.root,'faces',id+'.jpg'),{force:true}).catch(()=>{})
      return withCapability(user,changed(user,state,typeof body.automatic==='boolean'?{paused:!body.automatic}:undefined))
    },
    async analyze(user,body){
      const s=store(user),id=String(body.assetId||''),info=await status()
      if(!info.available)throw new Error(info.message)
      const {needed,key}=s.needsAnalysis(id,info.fingerprint,body.retry===true,info.detectorRevision)
      if(!needed)return {...s.snapshot(),capability:info}
      const activeKey=user.id+':'+id
      if(active.has(activeKey))return {...s.snapshot(),capability:info}
      if(typeof body.dataUrl!=='string'||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(body.dataUrl))throw new Error('人物分析需要 JPEG 照片')
      const image=Buffer.from(body.dataUrl.split(',')[1],'base64')
      if(image.length<20||image.length>8*1024*1024||image[0]!==255||image[1]!==216)throw new Error('照片格式无效或超过 8 MB')
      active.add(activeKey)
      const dir=join(s.root,'input');await mkdir(dir,{recursive:true})
      const file=join(dir,randomUUID()+'.jpg'),sourceHash=s.asset(id).hash
      try{
        await writeFile(file,image)
        const result=await engine.detect(file)
        if(s.asset(id)?.hash!==sourceHash)throw new Error('照片已更新，旧分析结果已放弃')
        const {saved,...state}=s.saveDetection(id,key,result)
        await mkdir(join(s.root,'faces'),{recursive:true})
        for(const face of saved||[])await writeFile(join(s.root,'faces',face.id+'.jpg'),Buffer.from(face.thumb,'base64'))
        return {...state,capability:info}
      }catch(error){s.runFailed(id,key,error.message);throw error}
      finally{active.delete(activeKey);await rm(file,{force:true}).catch(()=>{})}
    },
    correct:(user,body)=>changed(user,store(user).correct(body)),
    settle:user=>changed(user,store(user).reconcile()),
    undo:(user,body)=>changed(user,store(user).undo(String(body.id||''))),
    fact:(user,body)=>changed(user,store(user).fact(body)),
    understanding(user,body){const u=understanding(user);u.observe(store(user).snapshot());u.control(body);return u.decorate(store(user).snapshot())},
    enrich:(user,sources)=>store(user).enrich(sources),
    chapter:(user,id)=>understanding(user).decorate(store(user).snapshot()).graph.chapters.find(c=>c.id===id),
    context(user){
      const state=understanding(user).decorate(store(user).snapshot())
      return {people:state.people.filter(p=>p.confirmed).map(({id,name,relationship})=>({id,name,relationship})),
        relationships:state.graph.relationships,chapters:state.graph.chapters.slice(0,30),events:state.graph.events.slice(-100),facts:state.graph.facts.slice(-300)}
    },
    async face(user,id){
      if(!/^[a-f0-9]{32}$/.test(id)||!store(user).hasFace(id))return null
      return readFile(join(store(user).root,'faces',id+'.jpg')).catch(()=>null)
    },
    close(){engine.close();for(const value of understandings.values())value.close();for(const value of stores.values())value.close()},
  }
}

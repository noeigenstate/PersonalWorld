import { DatabaseSync } from 'node:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { buildStoryGraph } from './storyGraph.mjs'
import { candidateGroups } from './identityCandidates.mjs'

const text=(v,n=300)=>typeof v==='string'?v.slice(0,n):''
const list=(v,n=10000)=>Array.isArray(v)?v.slice(0,n):[]
const validId=v=>typeof v==='string'&&/^[\w:-]{1,100}$/.test(v)
const hash=v=>createHash('sha256').update(v).digest('hex')
const decode=v=>JSON.parse(v)
export const cosine=(a,b)=>a.length===b.length?a.reduce((s,v,i)=>s+v*b[i],0):-1

// Candidate grouping tolerates uncertain images only with stronger similarity.
// A centroid/anchor check prevents a chain of pairwise near-neighbours drifting.
function identityMatch(face,prototypes,persons,excluded=new Set()){
  const ranked=persons.filter(p=>!excluded.has(p.id)).map(person=>{
    const refs=(prototypes.get(person.id)||[]).filter(r=>r.assetId!==face.assetId&&r.model===face.model).sort((a,b)=>Number(b.locked)-Number(a.locked)||Number(b.quality==='good')-Number(a.quality==='good')).slice(0,12)
    if(!refs.length)return {person,score:-1,coherent:false}
    const scores=refs.map(r=>cosine(face.embedding,r.embedding)).sort((a,b)=>b-a)
    const center=face.embedding.map((_,i)=>refs.reduce((sum,r)=>sum+r.embedding[i],0)/refs.length),norm=Math.hypot(...center)||1
    const coherent=cosine(face.embedding,center.map(v=>v/norm))>=.55&&cosine(face.embedding,refs[0].embedding)>=.46
    return {person,score:scores.length>1?(scores[0]+scores[1])/2:scores[0],coherent}
  }).sort((a,b)=>b.score-a.score)
  const best=ranked[0],threshold=face.quality==='good'?.58:.66
  return {best,matched:Boolean(best&&best.coherent&&best.score>=threshold&&best.score-(ranked[1]?.score??-1)>=.08)}
}

export function cleanGraphAsset(a) {
  if(!validId(a?.id))throw new Error('照片 ID 无效')
  const location=a.location
  return {id:a.id,hash:text(a.hash,128)||a.id,kind:text(a.kind,20),capturedAt:text(a.capturedAt,40),dateSource:text(a.dateSource,20),
    location:location?{aoi:text(location.aoi,100),poi:text(typeof location.poi==='string'?location.poi:location.poi?.name,100),city:text(location.city,60),source:text(location.source,20),precision:text(location.precision,20)}:null,
    card:a.card?{title:text(a.card.title,100),scene:text(a.card.scene,1600),tags:list(a.card.tags,20).map(v=>text(v,40)),createdAt:text(a.card.createdAt,40)}:null}
}

export function openIdentityStore(root) {
  mkdirSync(root,{recursive:true})
  const db=new DatabaseSync(join(root,'memory.sqlite'))
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY, hash TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runs(asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,fingerprint TEXT,status TEXT,error TEXT);
    CREATE TABLE IF NOT EXISTS people(id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS faces(id TEXT PRIMARY KEY,asset_id TEXT REFERENCES assets(id) ON DELETE CASCADE,person_id TEXT,model TEXT,embedding TEXT,data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS face_asset ON faces(asset_id);
    CREATE INDEX IF NOT EXISTS face_person ON faces(person_id);
    CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS corrections(id TEXT PRIMARY KEY,created_at TEXT,before_state TEXT,after_revision TEXT,undone INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS manual_facts(id TEXT PRIMARY KEY,data TEXT NOT NULL);`)
  const all=()=>db.prepare('SELECT data FROM assets').all().map(r=>decode(r.data))
  const people=()=>db.prepare('SELECT data FROM people').all().map(r=>decode(r.data))
  const faces=()=>db.prepare('SELECT data FROM faces').all().map(r=>decode(r.data))
  const readState=(key,fallback)=>{const row=db.prepare('SELECT value FROM state WHERE key=?').get(key);return row?decode(row.value):fallback}
  const writeState=(key,value)=>db.prepare('INSERT OR REPLACE INTO state VALUES (?,?)').run(key,JSON.stringify(value))
  const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result}catch(e){db.exec('ROLLBACK');throw e}}
  const bump=()=>{const revision=randomUUID();writeState('revision',revision);return revision}
  const writePerson=p=>db.prepare('INSERT OR REPLACE INTO people VALUES (?,?)').run(p.id,JSON.stringify(p))
  const writeFace=f=>db.prepare('UPDATE faces SET person_id=?,data=? WHERE id=?').run(f.personId,JSON.stringify(f),f.id)
  const newPerson=()=>{const p={id:randomUUID(),name:'',relationship:'',confirmed:false,createdAt:new Date().toISOString()};writePerson(p);return p}
  const getAsset=id=>{const row=db.prepare('SELECT data FROM assets WHERE id=?').get(id);return row?decode(row.data):null}
  const manualFacts=()=>db.prepare('SELECT data FROM manual_facts').all().map(r=>decode(r.data))
  function regroupCandidates(){
    const rows=db.prepare('SELECT * FROM faces ORDER BY rowid').all().map(r=>({...decode(r.data),embedding:decode(r.embedding)}))
    const candidates=rows.filter(f=>f.status==='candidate'&&!f.locked).sort((a,b)=>Number(b.quality==='good')-Number(a.quality==='good')||a.id.localeCompare(b.id))
    const persons=people().filter(p=>!p.mergedInto),prototypes=new Map(),occupied=new Map()
    const add=f=>{const list=prototypes.get(f.personId)||[];list.push({embedding:f.embedding,locked:f.locked||f.status==='confirmed',quality:f.quality,assetId:f.assetId,model:f.model});prototypes.set(f.personId,list);const ids=occupied.get(f.personId)||new Set();ids.add(f.assetId);occupied.set(f.personId,ids)}
    for(const f of rows.filter(f=>f.status!=='ignored'&&(f.status!=='candidate'||f.locked)))add(f)
    let changed=false
    for(const f of candidates){
      const excluded=new Set([...occupied].filter(([,ids])=>ids.has(f.assetId)).map(([id])=>id))
      const {matched,best}=identityMatch(f,prototypes,persons,excluded)
      let person=matched?best.person:persons.find(p=>p.id===f.personId&&!prototypes.has(p.id))
      if(!person){person=newPerson();persons.push(person)}
      const data={...f,personId:person.id,status:person.confirmed&&matched&&f.quality==='good'?'matched':'candidate',score:matched?Number(best.score.toFixed(3)):null,candidate:!matched&&best?.score>.4?{personId:best.person.id,score:Number(best.score.toFixed(3))}:null}
      delete data.embedding;writeFace(data);add({...data,embedding:f.embedding});changed ||= data.personId!==f.personId||data.status!==f.status
    }
    const current=faces(),byId=new Map(rows.map(f=>[f.id,f]))
    const review=current.filter(f=>f.status==='candidate'&&!f.locked&&!persons.find(p=>p.id===f.personId)?.confirmed).slice(0,400).map(f=>({...f,embedding:byId.get(f.id).embedding}))
    const reserved=new Set(current.filter(f=>!review.some(r=>r.id===f.id)).map(f=>f.personId))
    for(const group of candidateGroups(review)){
      const votes=new Map();for(const f of group)votes.set(f.personId,(votes.get(f.personId)||0)+1)
      const prior=[...votes].sort((a,b)=>b[1]-a[1]).find(([id])=>!reserved.has(id))?.[0]
      const person=prior?persons.find(p=>p.id===prior):newPerson();reserved.add(person.id)
      for(const face of group){const data={...face,personId:person.id,candidate:null,status:'candidate'};delete data.embedding;writeFace(data);changed ||= face.personId!==person.id}
    }
    writeState('groupingVersion','candidate-consensus-v3');writeState('groupingPending',false);if(changed)bump()
  }
  function snapshot() {
    const records=all(),observations=faces(),persons=people().filter(p=>!p.mergedInto && (p.confirmed||observations.some(f=>f.personId===p.id&&f.status!=='ignored')))
    const graph=buildStoryGraph(records,readState('events',[]),persons,observations,manualFacts())
    return {revision:readState('revision','initial'),people:persons.map(p=>({...p,faceIds:observations.filter(f=>f.personId===p.id&&f.status!=='ignored').map(f=>f.id)})),
      faces:observations.map(f=>({...f,thumbnail:`/api/memory-graph/faces/${f.id}`})),runs:db.prepare('SELECT asset_id as assetId,status,error FROM runs').all(),
      pending:records.filter(a=>!db.prepare('SELECT asset_id FROM runs WHERE asset_id=?').get(a.id)).map(a=>a.id),graph,
      lastCorrection:db.prepare('SELECT id,created_at as createdAt,after_revision as revision FROM corrections WHERE undone=0 ORDER BY created_at DESC LIMIT 1').get()||null}
  }
  return {root,close:()=>db.close(),asset:getAsset,snapshot,hasFace:id=>Boolean(db.prepare('SELECT id FROM faces WHERE id=?').get(id)),
    reconcile(){if(readState('groupingVersion','')!=='candidate-consensus-v3'||readState('groupingPending',false))tx(regroupCandidates);return snapshot()},
    sync(input){return tx(()=>{
      if(!Array.isArray(input.assets)||input.assets.length>10000)throw new Error('相册同步需要完整且不超过 10000 张的资产清单')
      const incoming=input.assets.map(cleanGraphAsset),ids=new Set(incoming.map(a=>a.id)),removed=[],events=list(input.events).map(e=>({id:text(e.id,100),title:text(e.title,100),summary:text(e.summary,1200),place:text(e.place,100),status:e.status==='confirmed'?'confirmed':'draft',assetIds:list(e.assetIds).filter(id=>ids.has(id))}))
      if(ids.size!==incoming.length)throw new Error('相册存在重复 ID')
      let changed=JSON.stringify(events)!==JSON.stringify(readState('events',[]))
      for(const a of incoming){
        const prior=getAsset(a.id),data=JSON.stringify(a)
        if(JSON.stringify(prior)===data)continue
        if(prior&&prior.hash!==a.hash){removed.push(...faces().filter(f=>f.assetId===a.id).map(f=>f.id));db.prepare('DELETE FROM faces WHERE asset_id=?').run(a.id);db.prepare('DELETE FROM runs WHERE asset_id=?').run(a.id)}
        db.prepare('INSERT INTO assets VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET hash=excluded.hash,data=excluded.data').run(a.id,a.hash,data);changed=true
      }
      for(const old of all())if(!ids.has(old.id)){removed.push(...faces().filter(f=>f.assetId===old.id).map(f=>f.id));db.prepare('DELETE FROM assets WHERE id=?').run(old.id);changed=true}
      for(const fact of manualFacts().filter(f=>f.assetIds.length)){
        const remaining=fact.assetIds.filter(id=>ids.has(id))
        if(remaining.length===fact.assetIds.length)continue
        if(remaining.length)db.prepare('UPDATE manual_facts SET data=? WHERE id=?').run(JSON.stringify({...fact,assetIds:remaining}),fact.id)
        else db.prepare('DELETE FROM manual_facts WHERE id=?').run(fact.id)
        changed=true
      }
      writeState('events',events);if(changed)bump()
      if(readState('groupingVersion','')!=='candidate-consensus-v3')regroupCandidates()
      return {removed,...snapshot()}
    })},
    needsAnalysis(id,fingerprint,retry=false){
      const asset=getAsset(id);if(!asset)throw new Error('照片已不在当前相册')
      const run=db.prepare('SELECT * FROM runs WHERE asset_id=?').get(id)
      const key=hash(asset.hash+'|'+fingerprint)
      if(run?.fingerprint===key&&['complete','no-faces'].includes(run.status))return {needed:false,key}
      if(run?.status==='failed'&&!retry)return {needed:false,key}
      if(run&&run.fingerprint!==key&&faces().some(f=>f.assetId===id&&f.status==='confirmed'))throw new Error('人物模型版本已变化，已确认的人物保留，需单独迁移')
      return {needed:true,key}
    },
    runFailed(id,key,error){if(getAsset(id)){db.prepare('INSERT OR REPLACE INTO runs VALUES (?,?,?,?)').run(id,key,'failed',text(error,180));bump()}},
    saveDetection(id,key,result){return tx(()=>{
      if(!getAsset(id))throw new Error('照片已移除')
      const existing=faces().filter(f=>f.assetId===id)
      if(existing.some(f=>f.status==='confirmed'))return snapshot()
      db.prepare('DELETE FROM faces WHERE asset_id=?').run(id)
      const prototypes=new Map(),persons=people().filter(p=>!p.mergedInto)
      for(const row of db.prepare('SELECT * FROM faces WHERE model=? ORDER BY rowid').all(result.fingerprint)){
        const f=decode(row.data);if(f.status==='ignored')continue
        const ps=prototypes.get(f.personId)||[];ps.push({embedding:decode(row.embedding),locked:f.status==='confirmed',quality:f.quality,assetId:f.assetId,model:f.model});prototypes.set(f.personId,ps)
      }
      const used=new Set(),saved=[]
      for(const [index,face] of result.faces.entries()){
        const embedding=face.embedding
        if(!Array.isArray(embedding)||embedding.length<64||embedding.length>1024||!embedding.every(Number.isFinite))continue
        const {best,matched}=identityMatch({...face,assetId:id,model:result.fingerprint},prototypes,persons,used)
        const person=matched?best.person:newPerson();used.add(person.id)
        const faceId=hash(`${id}|${result.fingerprint}|${index}`).slice(0,32)
        const data={id:faceId,assetId:id,personId:person.id,box:face.box,quality:face.quality,confidence:face.confidence,
          status:matched&&person.confirmed&&face.quality==='good'?'matched':'candidate',score:matched?Number(best.score.toFixed(3)):null,model:result.fingerprint,
          candidate:!matched&&best?.score>.4?{personId:best.person.id,score:Number(best.score.toFixed(3))}:null}
        db.prepare('INSERT INTO faces VALUES (?,?,?,?,?,?)').run(faceId,id,person.id,result.fingerprint,JSON.stringify(embedding),JSON.stringify(data))
        saved.push({id:faceId,thumb:face.thumb})
      }
      db.prepare('INSERT OR REPLACE INTO runs VALUES (?,?,?,?)').run(id,key,saved.length?'complete':'no-faces','');writeState('groupingPending',true);bump()
      return {saved,...snapshot()}
    })},
    correct(body){return tx(()=>{
      const before={people:people(),faces:faces(),facts:manualFacts()},observations=faces()
      const p=people().find(p=>p.id===body.personId&&!p.mergedInto)
      if(body.action==='name'){
        if(!p)throw new Error('人物不存在')
        const name=text(body.name,40).trim(),relationship=text(body.relationship,30).trim()
        if(!name&&!relationship)throw new Error('请填写名字或称呼')
        writePerson({...p,name,relationship,confirmed:true})
        for(const f of observations.filter(f=>f.personId===p.id&&f.status!=='ignored'))writeFace({...f,status:'confirmed',locked:true})
      }else if(['move','ignore','split','confirm'].includes(body.action)){
        const selected=observations.filter(f=>list(body.faceIds,500).includes(f.id));if(!selected.length)throw new Error('请选择人脸')
        let target=body.action==='split'?newPerson():p
        if(['move','split'].includes(body.action)&&!target)throw new Error('目标人物不存在')
        if(body.action==='move'){
          const targetAssets=new Set(observations.filter(f=>f.personId===target.id&&!selected.some(s=>s.id===f.id)).map(f=>f.assetId))
          if(selected.some(f=>targetAssets.has(f.assetId)))throw new Error('两组在同一张照片中出现，请逐张核对，不能直接合并')
        }
        for(const f of selected)writeFace({...f,personId:target?.id||f.personId,status:body.action==='ignore'?'ignored':body.action==='split'?'candidate':'confirmed',candidate:null,locked:true})
      }else if(body.action==='merge'){
        const other=people().find(p=>p.id===body.intoId&&!p.mergedInto)
        if(!p||!other||p.id===other.id)throw new Error('请选择两个不同人物')
        const a=observations.filter(f=>f.personId===p.id),b=observations.filter(f=>f.personId===other.id)
        if(a.some(f=>b.some(v=>v.assetId===f.assetId)))throw new Error('两组在同一张照片中出现，请先逐张核对')
        for(const f of a)writeFace({...f,personId:other.id,status:'confirmed',candidate:null,locked:true})
        for(const fact of manualFacts().filter(f=>f.subjectId===p.id))db.prepare('UPDATE manual_facts SET data=? WHERE id=?').run(JSON.stringify({...fact,subjectId:other.id}),fact.id)
        writePerson({...other,name:other.name||p.name,relationship:other.relationship||p.relationship,confirmed:other.confirmed||p.confirmed})
        writePerson({...p,mergedInto:other.id})
      }else throw new Error('不支持的人物修改')
      const revision=bump(),id=randomUUID()
      db.prepare('INSERT INTO corrections VALUES (?,?,?,?,0)').run(id,new Date().toISOString(),JSON.stringify(before),revision)
      return snapshot()
    })},
    undo(id){return tx(()=>{
      const row=db.prepare('SELECT * FROM corrections WHERE id=? AND undone=0').get(id)
      if(!row||row.after_revision!==readState('revision',''))throw new Error('记录已发生变化，请直接调整当前人物分组')
      const before=decode(row.before_state),existing=new Set(faces().map(f=>f.id))
      for(const p of before.people)writePerson(p)
      for(const f of before.faces)if(existing.has(f.id))writeFace(f)
      if(before.facts){db.prepare('DELETE FROM manual_facts').run();for(const fact of before.facts)db.prepare('INSERT INTO manual_facts VALUES (?,?)').run(fact.id,JSON.stringify(fact))}
      db.prepare('UPDATE corrections SET undone=1 WHERE id=?').run(id);bump();return snapshot()
    })},
    fact(body){return tx(()=>{
      const id=body.id&&validId(body.id)?body.id:`fact:user:${randomUUID()}`
      if(body.remove){db.prepare('DELETE FROM manual_facts WHERE id=?').run(id);bump();return snapshot()}
      const person=people().find(p=>p.id===body.subjectId&&!p.mergedInto)
      if(!person)throw new Error('人物不存在')
      const value=text(body.value,500).trim();if(!value)throw new Error('请输入要记住的事实')
      const fact={id,subjectId:person.id,type:'note',value,assetIds:list(body.assetIds,500).filter(id=>getAsset(id)),revision:randomUUID()}
      db.prepare('INSERT OR REPLACE INTO manual_facts VALUES (?,?)').run(id,JSON.stringify(fact));bump();return snapshot()
    })},
    enrich(sources){
      const state=snapshot(),persons=new Map(state.people.map(p=>[p.id,p]))
      return sources.map(source=>{
        const asset=getAsset(source.id),fs=state.faces.filter(f=>f.assetId===source.id&&f.status!=='ignored')
        const ids=state.graph.memberships[source.id]||[],members=ids.map(id=>persons.get(id)).filter(Boolean)
        const notes=manualFacts().filter(f=>ids.includes(f.subjectId)&&(!f.assetIds.length||f.assetIds.includes(source.id)))
        return {...source,capturedAt:asset?(asset.dateSource==='exif'?asset.capturedAt:''):(source.capturedAt||''),
          people:members.map(p=>({id:p.id,name:p.name,relationship:p.relationship})),faceBoxes:fs.map(f=>f.box),
          story:[source.story||'',...members.map(p=>`用户已确认的人物：${p.name}${p.relationship?'（'+p.relationship+'）':''}`),...notes.map(f=>f.value)].filter(Boolean).join(' '),
          factIds:state.graph.facts.filter(f=>f.assetId===source.id||notes.some(n=>n.id===f.id)).map(f=>f.id),identityRevision:hash(JSON.stringify([members,fs.map(f=>[f.id,f.personId,f.status]),notes])).slice(0,24)}
      })
    },
  }
}

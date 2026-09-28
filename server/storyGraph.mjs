import { createHash } from 'node:crypto'
import { storyRelationships } from './storyRelationships.mjs'

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,24)
const dayOf = asset => asset.dateSource !== 'file' && Number.isFinite(Date.parse(asset.capturedAt))
  ? new Date(Date.parse(asset.capturedAt)+8*3600000).toISOString().slice(0,10) : ''
const themes = [
  ['snow','雪地里的小片刻',/积雪|雪地|滑雪|雪场/],
  ['sweet','甜筒小合集',/冰淇淋|冰激凌|甜筒|雪糕/],
  ['making','小小创作簿',/手工|画画|绘画|砂画|马克笔|涂鸦|闪粉/],
  ['beach','海边的日子',/海滩|沙滩|玩沙|海边|沙粒/],
  ['reading','一起翻过的书页',/绘本|读书|阅读|共读/],
  ['play','户外的小快乐',/羽毛球|滑梯|秋千|奔跑|骑车|蹦床/],
]
const publicPlace = value => !value || /(?:府|小区|公寓|家园|花城|华庭|幢|室|号)$/.test(value) ? '' : value

// Cheap, deterministic graph maintenance. No face or model call happens here.
// Stable chapter IDs and content fingerprints let downstream editors invalidate
// only a chapter whose photos, observations or confirmed people have changed.
export function buildStoryGraph(assets, sourceEvents, people, faces, manualFacts = [], priorRelationships = []) {
  const ids=new Set(assets.map(a=>a.id)), personById=new Map(people.map(p=>[p.id,p]))
  const relationships=storyRelationships(people,priorRelationships)
  const facesByAsset=new Map()
  for(const face of faces){
    if(face.status==='ignored' || !ids.has(face.assetId))continue
    const list=facesByAsset.get(face.assetId)||[];list.push(face);facesByAsset.set(face.assetId,list)
  }
  const facts=[],assetFacts=new Map(), memberships=new Map(), times=new Map()
  const addFact=(asset,type,value,status,source)=>{
    if(!value)return
    const id=`fact:${digest([asset.id,type,source])}`
    facts.push({id,assetId:asset.id,type,value,status,source,revision:digest(value)})
    const list=assetFacts.get(asset.id)||[];list.push(id);assetFacts.set(asset.id,list)
  }
  for(const asset of assets){
    const day=dayOf(asset);times.set(asset.id,day)
    addFact(asset,'time',day,asset.dateSource==='exif'?'metadata':'approximate',asset.dateSource)
    addFact(asset,'place',asset.location?.aoi||asset.location?.poi||asset.location?.city,'metadata',asset.location?.source||'unknown')
    addFact(asset,'observation',asset.card?.scene,'observed','photo-card')
    const members=[...new Set((facesByAsset.get(asset.id)||[]).filter(f=>f.status==='confirmed'||f.status==='matched').map(f=>f.personId).filter(id=>personById.get(id)?.confirmed))].sort()
    memberships.set(asset.id,members)
    for(const personId of members) addFact(asset,'person',personId,'identity',`identity:${personId}`)
  }
  for(const fact of manualFacts) facts.push({...fact,status:'confirmed',source:'user'})
  for(const relation of relationships) facts.push({...relation,type:'relationship',revision:digest(relation)})
  const groups=new Map()
  const eventByAsset=new Map(sourceEvents.flatMap(e=>(e.assetIds||[]).map(id=>[id,e])))
  for(const asset of assets){
    const given=eventByAsset.get(asset.id),day=times.get(asset.id)
    // Unknown times remain separate, not assigned an invented birthday or trip.
    const place=asset.location?.aoi||asset.location?.poi||given?.place||asset.location?.city||''
    const slot=day && asset.dateSource==='exif' ? Math.floor(new Date(Date.parse(asset.capturedAt)+8*3600000).getUTCHours()/6) : 'unknown'
    const key=given?.status==='confirmed'?`user:${given.id}`:day?`${day}|${place||given?.id||'unlocated'}|${slot}`:`undated:${given?.id||asset.id}`
    const group=groups.get(key)||{id:`event:${digest(key)}`,assets:[],given:given?.status==='confirmed'?given:null,place}
    group.assets.push(asset);groups.set(key,group)
  }
  const events=[...groups.values()].map(group=>{
    const members=group.assets.sort((a,b)=>a.capturedAt.localeCompare(b.capturedAt))
    const days=members.map(a=>times.get(a.id)).filter(Boolean).sort()
    const matched=themes.find(([, ,re])=>members.some(a=>re.test(a.card?.scene||'')))
    const event={id:group.id,assetIds:members.map(a=>a.id),title:group.given?.title||`${publicPlace(group.place)||matched?.[1]||'日常片段'}${days[0]?' · '+days[0]:''}`,
      place:group.place,start:days[0]||'',end:days.at(-1)||'',status:group.given?'confirmed':'derived',
      personIds:[...new Set(members.flatMap(a=>memberships.get(a.id)||[]))],factIds:members.flatMap(a=>assetFacts.get(a.id)||[])}
    if(group.given) {
      const id=`fact:user-event:${group.given.id}`
      facts.push({id,type:'event',value:`${group.given.title}。${group.given.summary}`,assetIds:event.assetIds,status:'confirmed',source:'user'})
      event.factIds.push(id)
    }
    return event
  })
  const chapters=[]
  const add=(key,kind,title,members,personIds=[],explanation='')=>{
    const selected=[...new Set(members)].filter(id=>ids.has(id)).sort((a,b)=>(times.get(a)||'9999').localeCompare(times.get(b)||'9999')||a.localeCompare(b))
    if(selected.length<2)return
    const participants=[...new Set([...personIds,...selected.flatMap(id=>memberships.get(id)||[])])]
    const related=events.filter(e=>e.assetIds.some(id=>selected.includes(id)))
    const factIds=[...new Set(related.flatMap(e=>e.factIds).filter(id=>{const f=facts.find(f=>f.id===id);return !f?.assetId||selected.includes(f.assetId)}))]
    const userFacts=manualFacts.filter(f=>participants.includes(f.subjectId)&&(!f.assetIds?.length||f.assetIds.some(id=>selected.includes(id))))
    factIds.push(...userFacts.map(f=>f.id))
    factIds.push(...relationships.filter(r=>participants.includes(r.subjectId)&&participants.includes(r.objectId)).map(r=>r.id))
    const chosenFacts=facts.filter(f=>factIds.includes(f.id))
    const dates=selected.map(id=>times.get(id)).filter(Boolean)
    chapters.push({id:`chapter:${digest(key)}`,kind,title,assetIds:selected,personIds:participants,eventIds:related.map(e=>e.id),factIds,
      start:dates[0]||'',end:dates.at(-1)||'',explanation,
      revision:digest([selected,chosenFacts,participants.map(id=>personById.get(id))]),
      score:selected.length+new Set(dates).size*2+(personIds.length?8:0)})
  }
  for(const event of events) add(event.id,'outing',event.title,event.assetIds,event.personIds,'同一时段、同一地点的照片片段')
  for(const [key,title,re] of themes){
    const selected=assets.filter(a=>re.test(a.card?.scene||''))
    if(selected.length>=3)add(`activity:${key}`,'activity',title,selected.map(a=>a.id),[],'画面里重复出现的活动；不据此断言人物相同或个人偏好')
  }
  const places=[...new Set(events.map(e=>e.place).filter(publicPlace))]
  for(const place of places){
    const selected=events.filter(e=>e.place===place)
    if(new Set(selected.map(e=>e.start).filter(Boolean)).size>=2)add(`revisit:${place}`,'revisit',`再到${place}`,selected.flatMap(e=>e.assetIds),[],'相同地点、不同日期的回忆')
  }
  for(const person of people.filter(p=>p.confirmed)){
    const selected=assets.filter(a=>memberships.get(a.id)?.includes(person.id))
    if(new Set(selected.map(a=>times.get(a.id)).filter(Boolean)).size>=2)
      add(`person:${person.id}`,'person',`${person.name||person.relationship||'这个人'}的时光`,selected.map(a=>a.id),[person.id],'已确认人物参与的多个日子；不自动断言成长里程碑')
  }
  for(const relation of relationships){
    const selected=assets.filter(a=>{const members=memberships.get(a.id)||[];return members.includes(relation.subjectId)&&members.includes(relation.objectId)})
    add(`together:${relation.id}`,'relationship',`${personById.get(relation.subjectId).name||relation.label}和${personById.get(relation.objectId).name}的片刻`,selected.map(a=>a.id),[relation.subjectId,relation.objectId],`${relation.value}；这些照片已分别确认两人出现，不根据年龄或同地点猜测关系`)
  }
  return {events,chapters:chapters.sort((a,b)=>b.score-a.score),facts,relationships,memberships:Object.fromEntries(memberships),
    revision:digest([assets.map(a=>[a.id,a.hash,a.card?.createdAt]),events,chapters.map(c=>c.revision)])}
}

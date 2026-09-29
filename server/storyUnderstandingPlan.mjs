import { createHash } from 'node:crypto'
import { chat, parseJsonAnswer } from './stepfun.mjs'
import { loadSkill } from './skills.mjs'
import { knownKinshipWords } from './storyRelationships.mjs'

export const UNDERSTANDING_VERSION='story-understanding-3'
export const storyHash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,24)
const text=(v,max=300)=>typeof v==='string'?v.replace(/[\x00-\x1f]/g,' ').trim().slice(0,max):''
const sample=(items,max)=>items.length<=max?items:Array.from({length:max},(_,i)=>items[Math.round(i*(items.length-1)/(max-1))])

export function eventInputs(state,minimum=2){
  const facts=state.graph.facts,people=state.people.filter(p=>p.confirmed)
  return state.graph.events.filter(e=>e.assetIds.length>=minimum).map(event=>{
    const ids=sample(event.assetIds,28)
    const photos=ids.map(id=>({id,observed:text(facts.find(f=>f.assetId===id&&f.type==='observation')?.value,700),
      date:facts.find(f=>f.assetId===id&&f.type==='time')?.value||'',timeSource:facts.find(f=>f.assetId===id&&f.type==='time')?.status||'unknown',
      place:text(facts.find(f=>f.assetId===id&&f.type==='place')?.value,100),personIds:state.graph.memberships[id]||[]})).filter(p=>p.observed)
    const personIds=[...new Set(photos.flatMap(p=>p.personIds))].sort()
    const known=facts.filter(f=>f.source==='user'&&(
      f.type==='event'&&f.assetIds?.some(id=>ids.includes(id))||
      f.type==='note'&&(!f.subjectId||personIds.includes(f.subjectId))&&(!f.assetIds?.length||f.assetIds.some(id=>ids.includes(id)))||
      f.type==='relationship'&&personIds.includes(f.subjectId)&&personIds.includes(f.objectId)))
    const input={eventId:event.id,photos,people:people.filter(p=>personIds.includes(p.id)).map(({id,name,relationship})=>({id,name,relationship})),
      relationships:(state.graph.relationships||[]).filter(r=>personIds.includes(r.subjectId)&&personIds.includes(r.objectId)),
      confirmed:known.map(({id,value,assetIds,subjectId,objectId})=>({id,value,assetIds,subjectId,objectId})),factIds:facts.filter(f=>ids.includes(f.assetId)||known.some(k=>k.id===f.id)).map(f=>f.id)}
    return {...input,revision:storyHash([UNDERSTANDING_VERSION,input])}
  }).filter(e=>e.photos.length>=minimum)
}

// Strong personal claims require actual user evidence. Interpretations stay
// separate from confirmed facts even when their supporting photo IDs are valid.
function unsupportedClaims(value,input){
  const confirmed=JSON.stringify([input.people,input.relationships,input.confirmed])
  const observed=(input.photos||[]).map(p=>p.observed||'').join(' ')
  // The name/type of a venue is not a claim that its visitors are related.
  const checked=String(value||'').replace(/亲子(?:活动中心|乐园|餐厅|区域)/g,word=>observed.includes(word)?'活动场所':word)
  const claims=checked.match(/第一次[^，。！!?？]{0,8}|首次|\d+岁|[一二三四五六七八九十]+岁|最爱|最喜欢|爱吃|长高了|学会了|性格[^，。！!?？]{0,5}|单独外出|没有其他家人|三代同框|三代人|每次出游|专属出游|女儿|儿子|妈妈|母亲|爸爸|父亲|姥姥|姥爷|外婆|外公|奶奶|爷爷|父女|母女|祖孙|亲子/g)||[]
  const aliases=knownKinshipWords(input.people,input.relationships)
  return claims.filter(claim=>!confirmed.includes(claim)&&!aliases.has(claim))
}
function grounded(value,input,max){
  const result=text(value,max)
  return unsupportedClaims(result,input).length?'':result
}
function scopePhotos(input,assetIds){
  const photos=input.photos.filter(p=>assetIds.includes(p.id)),personIds=new Set(photos.flatMap(p=>p.personIds))
  return {...input,photos,people:input.people.filter(p=>personIds.has(p.id)),relationships:input.relationships.filter(r=>personIds.has(r.subjectId)&&personIds.has(r.objectId)),
    confirmed:input.confirmed.filter(f=>(!f.subjectId||personIds.has(f.subjectId))&&(!f.objectId||personIds.has(f.objectId))&&(!f.assetIds?.length||f.assetIds.some(id=>assetIds.includes(id))))}
}
function scopedText(value,input,scope,max){
  const result=grounded(value,scope,max)
  // A named person elsewhere in the library does not establish presence here.
  const absent=input.people.filter(p=>!scope.people.some(s=>s.id===p.id)).map(p=>p.name).filter(Boolean)
  return absent.some(name=>result.includes(name))?'':result
}
const photoEvidence=(input,ids)=>input.photos.filter(p=>ids.includes(p.id)).map(p=>({assetIds:[p.id],status:'observation',
  text:`${p.date||'日期未确定'}${p.timeSource==='approximate'?'（大致时间）':''} · ${p.observed}`}))
export function validateEventUnderstanding(answer,input){
  const known=new Set(input.photos.map(p=>p.id))
  const insights=(Array.isArray(answer?.insights)?answer.insights:[]).slice(0,5).flatMap(i=>{
    const assetIds=[...new Set(Array.isArray(i.assetIds)?i.assetIds:[])].filter(id=>known.has(id))
    const value=scopedText(i.text,input,scopePhotos(input,assetIds),220)
    return assetIds.length&&value?[{text:value,assetIds,status:'interpretation'}]:[]
  })
  const title=grounded(answer?.title,input,40),summary=grounded(answer?.summary,input,450)
  if(!title||!summary||!insights.length)throw new Error(`事件理解未通过：${!title?'标题缺少依据：'+unsupportedClaims(answer?.title,input).join('、')+'；':''}${!summary?'摘要缺少依据：'+unsupportedClaims(answer?.summary,input).join('、')+'；':''}${!insights.length?'线索缺少照片依据或含有未在相应照片确认的人物；':''}改写上述称谓或断言，只描述已知人物和可见动作，不将场所中的成年人自动当作父母`)
  const photos=(Array.isArray(answer.photos)?answer.photos:[]).flatMap(photo=>{
    if(!known.has(photo.assetId))return []
    const scope=scopePhotos(input,[photo.assetId])
    const caption=scopedText(photo.caption,input,scope,160),title=scopedText(photo.title,input,scope,32)
    return caption&&title?[{assetId:photo.assetId,title,caption}]:[]
  }).filter((p,i,all)=>all.findIndex(other=>other.assetId===p.assetId)===i)
  return {title,summary,insights,photos,openQuestions:(Array.isArray(answer.openQuestions)?answer.openQuestions:[]).map(v=>text(v,120)).filter(Boolean).slice(0,3),
    motifs:(Array.isArray(answer.motifs)?answer.motifs:[]).map(v=>text(v,30)).filter(Boolean).slice(0,6),status:'interpretation'}
}

export function libraryInput(inputs,results,previous=[]){
  const people=[...new Map(inputs.flatMap(i=>i.people).map(p=>[p.id,p])).values()]
  const relationships=[...new Map(inputs.flatMap(i=>i.relationships).map(r=>[r.id,r])).values()]
  const confirmed=[...new Map(inputs.flatMap(i=>i.confirmed).map(f=>[f.id,f])).values()]
  const photos=[...new Map(inputs.flatMap(i=>i.photos).map(p=>[p.id,p])).values()]
  const events=inputs.map(i=>({eventId:i.eventId,assetIds:i.photos.map(p=>p.id),understanding:results[i.eventId]?.status==='complete'&&results[i.eventId]?.revision===results[i.eventId]?.wanted?results[i.eventId].result:null}))
  const content={people,relationships,confirmed,photos,events}
  return {...content,previous:previous.map(c=>({key:c.key,title:c.title,angle:c.angle,assetIds:c.assetIds})).slice(0,8),revision:storyHash([UNDERSTANDING_VERSION,content])}
}

export function validateCreativeStories(answer,input){
  const photoById=new Map(input.photos.map(p=>[p.id,p])),seen=new Set()
  const stories=(Array.isArray(answer?.stories)?answer.stories:[]).slice(0,8).flatMap(s=>{
    const key=text(s.key,48).toLowerCase().replace(/[^a-z0-9-]/g,'')
    const assetIds=[...new Set(Array.isArray(s.assetIds)?s.assetIds:[])].filter(id=>photoById.has(id)).slice(0,24)
    const scope=scopePhotos(input,assetIds)
    const title=scopedText(s.title,input,scope,40),angle=scopedText(s.angle,input,scope,240)
    if(!key||seen.has(key)||assetIds.length<2||!title||!angle)return []
    const selected=assetIds.map(id=>photoById.get(id)),personIds=[...new Set(selected.flatMap(p=>p.personIds))]
    const referenced=(Array.isArray(s.evidence)?s.evidence:[]).slice(0,5).flatMap(e=>{
      const ids=[...new Set(Array.isArray(e.assetIds)?e.assetIds:[])].filter(id=>assetIds.includes(id))
      const value=scopedText(e.text,input,scopePhotos(input,ids),180)
      return ids.length&&value?[{text:value,assetIds:ids}]:[]
    })
    if(!referenced.length)return []
    // Supporting observations and sequence content are copied from the source
    // record, never a model's rephrasing of dates, actions or who was there.
    const evidence=photoEvidence(input,[...new Set(referenced.flatMap(e=>e.assetIds))]).slice(0,8)
    const sequence=(Array.isArray(s.sequence)?s.sequence:[]).slice(0,12).flatMap(beat=>{
      const ids=[...new Set(Array.isArray(beat.assetIds)?beat.assetIds:[])].filter(id=>assetIds.includes(id))
      const value=scopedText(beat.text,input,scopePhotos(input,ids),200)
      return ids.length&&value?[{text:photoEvidence(input,ids).map(e=>e.text).join('；'),assetIds:ids}]:[]
    })
    if(!sequence.length)return []
    // Free-form direction describes editing only. Person-specific claims must
    // be in a sequence beat that can be checked against its referenced photos.
    const rawDirection=scopedText(s.direction,input,scope,320)
    const direction=input.people.some(p=>p.name&&rawDirection.includes(p.name))||/父女|母女|父子|母子|祖孙|独游|同日|随后/.test(rawDirection)?'按可靠日期组织大画面与细节，用并置回看和停顿形成节奏，结尾留白。':rawDirection
    seen.add(key)
    return [{key,title,angle,assetIds,personIds,format:['relationship','motif','revisit','details','outing'].includes(s.format)?s.format:'outing',
      direction,sequence,reason:scopedText(s.reason,input,scope,300)||angle,
      evidence,revision:storyHash([assetIds,selected,scope.people,scope.relationships,angle,direction,sequence])}]
  })
  const unique=stories.filter((s,index)=>!stories.slice(0,index).some(prior=>prior.format===s.format&&s.assetIds.filter(id=>prior.assetIds.includes(id)).length/Math.max(prior.assetIds.length,s.assetIds.length)>.8))
  const first=unique.filter((s,i)=>!unique.slice(0,i).some(p=>p.format===s.format))
  const diverse=[...first,...unique.filter(s=>!first.includes(s))].slice(0,5)
  if(!diverse.length)throw new Error('没有形成带真实照片依据的故事候选')
  return diverse
}

export async function understandStory(config,kind,input){
  const messages=[{role:'system',content:loadSkill('story-understanding')},{role:'user',content:JSON.stringify({mode:kind,...input})}]
  for(let attempt=0;attempt<2;attempt++){
    let raw=await chat(config,messages,{json:true})
    if(kind==='library'){
      // A separate evidence review receives original observations and memberships,
      // not just the writer's summaries. One review, never a self-reasoning loop.
      raw=await chat(config,[{role:'system',content:loadSkill('story-understanding')+'\n现在只做证据复核。逐条核对候选的标题、角度、镜头步骤和证据。原始 photos 的 personIds 才是在场证据：人物未匹配时保持未知，不能根据已有亲属关系把海边老人认作姥姥。禁止从不在画面推断没有同行、独自出游；从食物或表情推断最爱、每次出游、固定喜好；从跨月推断技能成长。删除或改写无依据内容。direction 只写不涉及具体人物/情节的镜头语言，具体内容放在带照片 ID 的 sequence。返回纠正后的同一 stories JSON，不能新增没有原片依据的情节。'},
        {role:'user',content:JSON.stringify({mode:'library',...input,candidates:parseJsonAnswer(raw)})}],{json:true})
    }
    try{return kind==='event'?validateEventUnderstanding(parseJsonAnswer(raw),input):validateCreativeStories(parseJsonAnswer(raw),input)}
    catch(error){if(attempt)throw error;messages.push({role:'assistant',content:raw},{role:'user',content:`结构校验未通过：${text(error.message,150)}。请使用输入中的真实照片 ID 和依据，修正完整 JSON。`})}
  }
}

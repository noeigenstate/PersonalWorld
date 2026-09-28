import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { BookOpen, X } from 'lucide-react'
import type { MemoryAsset } from '../types'
import type { StoryChapter } from '../lib/memoryGraph'
import type { useMemoryGraph } from '../lib/useMemoryGraph'
import './memoryLibrary.css'

export function MemoryLibrary({library,assets,onPhoto,onFilm}:{library:ReturnType<typeof useMemoryGraph>;assets:MemoryAsset[];onPhoto:(id:string)=>void;onFilm:(chapter:StoryChapter)=>void}){
  const [open,setOpen]=useState(false),[tab,setTab]=useState<'people'|'stories'>('people'),[personId,setPersonId]=useState('')
  const [selected,setSelected]=useState<string[]>([]),[name,setName]=useState(''),[relationship,setRelationship]=useState(''),[target,setTarget]=useState(''),[note,setNote]=useState('')
  const [error,setError]=useState(''),[saving,setSaving]=useState(false)
  const state=library.state,person=state?.people.find(p=>p.id===personId),faces=state?.faces.filter(f=>f.personId===personId&&f.status!=='ignored')||[]
  useEffect(()=>{setSelected([]);setName(person?.name||'');setRelationship(person?.relationship||'');setNote('');setTarget('')},[personId,person?.name,person?.relationship])
  useEffect(()=>{if(!open)return;const close=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false)};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[open])
  const act=async(path:string,body:unknown)=>{setSaving(true);setError('');try{await library.mutate(path,body);setSelected([])}catch(e){setError(e instanceof Error?e.message:'保存失败')}finally{setSaving(false)}}
  const correct=(action:string,extra={})=>act('/correct',{action,personId,faceIds:selected,...extra})
  const label=(id:string)=>{const p=state?.people.find(v=>v.id===id);return p?.name||p?.relationship||'待确认人物'}
  return <>
    <button className="button" onClick={()=>setOpen(true)}><BookOpen size={16}/><span>人物与故事</span>{library.busy&&<small>整理中</small>}</button>
    {open&&createPortal(<div className="modal-backdrop" onClick={()=>setOpen(false)}><section className="memory-library" role="dialog" aria-modal="true" aria-labelledby="library-heading" onClick={e=>e.stopPropagation()}>
      <header className="modal-header"><div><span className="section-kicker">把分散的片刻，慢慢连起来</span><h2 id="library-heading">人物与故事</h2></div><button className="icon-button" aria-label="关闭人物与故事" onClick={()=>setOpen(false)}><X/></button></header>
      <div className="library-status"><span>{library.busy?`本机正在整理人物 ${library.progress.done}/${library.progress.total}`:state?`已处理 ${state.runs.filter(r=>r.status!=='failed').length} 张 · ${state.people.filter(p=>p.confirmed).length} 位已确认人物 · ${state.graph.chapters.length} 个故事章节`:'正在读取相册…'}</span><button className="button button-subtle" onClick={()=>library.setPaused(!library.paused)}>{library.paused?'开启自动整理':'暂停自动整理'}</button></div>
      {state?.capability?.available===false&&<p role="status">本机人物引擎暂不可用：{state.capability.message}</p>}
      {(error||library.error)&&<p className="film-error" role="alert">{error||library.error}<button className="button" onClick={library.retry}>重试</button></p>}
      <nav className="library-tabs"><button className={tab==='people'?'active':''} onClick={()=>setTab('people')}>人物</button><button className={tab==='stories'?'active':''} onClick={()=>setTab('stories')}>故事章节</button></nav>
      {tab==='people'?<div className="library-people"><aside>
        <p>候选分组由本机自动整理。先核对组内照片，再确认称呼；相似的脸仍可能分错。</p>
        {[...(state?.people||[])].sort((a,b)=>Number(b.confirmed)-Number(a.confirmed)||b.faceIds.length-a.faceIds.length).map(p=><button key={p.id} className={`person-card ${p.id===personId?'active':''}`} onClick={()=>setPersonId(p.id)}><div>{p.faceIds.slice(0,3).map(id=><img key={id} src={`/api/memory-graph/faces/${id}`} alt="候选人物"/>)}</div><strong>{p.name||p.relationship||'待确认人物'}</strong><small>{p.faceIds.length} 张 · {p.confirmed?'已确认称呼':'请核对分组'}</small></button>)}
        {state&&!state.people.length&&<p>清晰可见的人脸会在这里形成候选组。背影和模糊画面可能无法归组。</p>}
      </aside><main>{person?<>
        <h3>{label(personId)}</h3><p>点击小头像选择需要调整的照片；“查看原图”可核对同框的不同人物。</p>
        <div className="identity-faces">{faces.map(face=><div key={face.id}><button className={selected.includes(face.id)?'selected':''} aria-pressed={selected.includes(face.id)} onClick={()=>setSelected(s=>s.includes(face.id)?s.filter(id=>id!==face.id):[...s,face.id])}><img src={face.thumbnail} alt="选择此人脸"/><small>{face.status==='confirmed'?'已确认':face.status==='matched'?'自动匹配':face.quality==='good'?'候选':'需仔细核对'}</small></button><button className="text-button" onClick={()=>{onPhoto(face.assetId);setOpen(false)}}>查看原图</button></div>)}</div>
        <div className="identity-name"><label>名字或昵称<input value={name} maxLength={40} onChange={e=>setName(e.target.value)} placeholder="例如：小团子"/></label><label>与你的关系<input value={relationship} maxLength={30} onChange={e=>setRelationship(e.target.value)} placeholder="例如：女儿 / 我"/></label><button className="button button-primary" disabled={saving||(!name.trim()&&!relationship.trim())} onClick={()=>void correct('name',{name,relationship})}>确认这组是同一人</button></div>
        <p>关系也可以写成“某位已命名人物的姥姥”等明确说明。确认后会自动复查旧候选，并更新相关故事和短片。</p>
        {(state?.graph.relationships||[]).filter(r=>r.subjectId===personId||r.objectId===personId).map(r=><p className="identity-relation" key={r.id}>{r.value} · 已用于关联故事</p>)}
        <div className="identity-tools"><select aria-label="目标人物" value={target} onChange={e=>setTarget(e.target.value)}><option value="">选择目标人物</option>{state?.people.filter(p=>p.id!==personId).map((p,i)=><option key={p.id} value={p.id}>{p.name||p.relationship||`待确认人物 ${i+1}`} · {p.faceIds.length} 张</option>)}</select><button disabled={saving||!selected.length||!target} onClick={()=>void correct('move',{personId:target})}>将选中照片移入</button><button disabled={saving||!selected.length} onClick={()=>void correct('split')}>拆成新人物</button><button disabled={saving||!selected.length} onClick={()=>void correct('ignore')}>忽略选中人脸</button><button disabled={saving||!target} onClick={()=>void correct('merge',{intoId:target})}>整组合并到目标人物</button></div>
        {state?.lastCorrection&&state.lastCorrection.revision===state.revision&&<button className="text-button" disabled={saving} onClick={()=>void act('/undo',{id:state.lastCorrection!.id})}>撤销上一次人物调整</button>}
        {person.confirmed&&<div className="identity-facts"><h4>你确认过的小事实</h4><p>这些补充会用于这个人物的故事。系统不会把单张照片里的猜测当作长期事实。</p>{state?.graph.facts.filter(f=>f.subjectId===personId&&f.type==='note').map(f=><p key={f.id}>{f.value} <button className="text-button" onClick={()=>void act('/fact',{id:f.id,remove:true})}>删除</button></p>) }<textarea value={note} maxLength={500} onChange={e=>setNote(e.target.value)} placeholder="例如：我们给她的小名是团团。"/><button className="button" disabled={saving||!note.trim()} onClick={()=>{void act('/fact',{subjectId:personId,value:note});setNote('')}}>记住这条补充</button></div>}
      </>:<div className="library-empty">选择一个候选人物，看看照片是否属于同一个人。</div>}</main></div>:<div className="story-chapters">
        {state?.graph.chapters.map(chapter=><article key={chapter.id}><div className="chapter-photos">{chapter.assetIds.slice(0,4).map(id=>{const a=assets.find(a=>a.id===id);return a?.preview?<button key={id} onClick={()=>{onPhoto(id);setOpen(false)}}><img src={a.preview} alt={a.card?.title||'故事照片'}/></button>:null})}</div><small>{chapter.start}{chapter.end!==chapter.start?' — '+chapter.end:''} · {chapter.assetIds.length} 张</small><h3>{chapter.title}</h3><p>{chapter.explanation}</p>{chapter.personIds.length>0&&<p>{chapter.personIds.map(label).join(' · ')}</p>}<details><summary>这段故事的依据</summary>{chapter.factIds.slice(0,18).map(id=>{const f=state.graph.facts.find(f=>f.id===id);return f?<p key={id}><small>{f.source==='user'?'你已确认':f.type==='observation'?'照片观察':f.type==='person'?'人物匹配':'拍摄信息'}</small> {f.type==='person'?label(f.value):f.value}</p>:null})}</details><button className="button button-primary" onClick={()=>{onFilm(chapter);setOpen(false)}}>自动剪成短片</button></article>)}
        {state&&!state.graph.chapters.length&&<p>同一地点或活动有两张以上照片后，故事章节会自动出现。</p>}
      </div>}
    </section></div>,document.body)}
  </>
}

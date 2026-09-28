import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, Film, LoaderCircle, Pause, Play, RotateCcw, X } from 'lucide-react'
import type { MemoryAsset, MemoryEvent } from '../types'
import { filmActive, filmBatch, filmImage, filmRequest, filmSources, boundedFilmSources, type FilmJob, type FilmSource } from '../lib/memoryFilm'
import { discoverFilmStories, storyAlreadyMade, storyAttempted } from '../lib/filmStories'
import { nextFilmUpdate } from '../lib/filmUpdates'
import { loadFilmSettings, saveFilmSettings } from '../lib/storage'
import type { MemoryGraphState, StoryChapter } from '../lib/memoryGraph'

export function MemoryFilms({ assets, events, ready, analyzing, graph, requestedChapter }: { assets: MemoryAsset[]; events: MemoryEvent[]; ready: boolean; analyzing: boolean; graph:MemoryGraphState|null; requestedChapter:{chapter:StoryChapter;at:number}|null }) {
  const [open, setOpen] = useState(false)
  const [jobs, setJobs] = useState<FilmJob[]>([])
  const [settings, setSettings] = useState<{ enabled: boolean; attempted: string[] } | null>(null)
  const [capable, setCapable] = useState<boolean | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [batch, setBatch] = useState('')
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  const [uploading, setUploading] = useState(0)
  const [selected, setSelected] = useState('')
  const [contextDraft, setContextDraft] = useState('')
  const [contextSaving, setContextSaving] = useState(false)
  const [contextMessage, setContextMessage] = useState('')
  const lock = useRef(false), uploadLock = useRef(false)
  const alive = useRef(true), generation = useRef(0)
  const latestAssets = useRef(assets); latestAssets.current = assets
  const sources = useMemo(() => filmSources(assets, events), [assets, events])
  const stories = useMemo(() => {
    const chapters=graph?.graph.chapters||[]
    const found=discoverFilmStories(sources).map(story=>{
      const chapter=chapters.find(c=>c.assetIds.length===story.sources.length&&story.sources.every(s=>c.assetIds.includes(s.id)))
      return {...story,key:story.key+(chapter?':'+chapter.revision:''),chapterId:chapter?.id,chapterRevision:chapter?.revision,automatic:true}
    })
    if(!found.length&&sources.length>=2)found.push({key:`album:${sources.map(s=>s.id).join(',')}`,place:'这些日子里的片段',sources,chapterId:undefined,chapterRevision:undefined,automatic:true})
    for(const chapter of chapters){
      if(found.some(s=>s.chapterId===chapter.id||s.sources.length===chapter.assetIds.length&&s.sources.every(a=>chapter.assetIds.includes(a.id))))continue
      const candidates=sources.filter(s=>chapter.assetIds.includes(s.id));if(candidates.length<2)continue
      found.push({key:`chapter:${chapter.id}:${chapter.revision}`,place:chapter.title,sources:candidates,chapterId:chapter.id,chapterRevision:chapter.revision,automatic:['person','relationship'].includes(chapter.kind)})
    }
    return found
  }, [sources,graph?.graph.revision])
  const round = `auto-v3:${batch}:`
  const attempted=(key:string)=>storyAttempted((settings?.attempted||[]).filter(v=>v.startsWith('auto-v3:')||v.startsWith('manual-v3:')),key)
  const made=(story:typeof stories[number])=>storyAlreadyMade(story,jobs.filter(j=>j.version==='memory-film-6'&&(!story.chapterId||j.chapterId===story.chapterId&&j.chapterRevision===story.chapterRevision)))
  const roundUsed = settings?.attempted.filter(key => key.startsWith(round)).length || 0
  const assetKey = assets.map((a) => `${a.id}:${a.hash}`).sort().join('|')
  const current = jobs.find((j) => filmActive(j))
  const pendingUpdate=nextFilmUpdate(jobs,settings?.attempted||[])
  const changedChapter=(graph?.graph.chapters||[]).find(chapter=>{
    const latest=jobs.find(j=>j.chapterId===chapter.id&&j.status==='complete'&&j.version==='memory-film-6')
    return latest&&latest.chapterRevision!==chapter.revision&&!settings?.attempted.includes(`identity:${chapter.id}:${chapter.revision}`)
  })
  const creativeRound=graph?.understanding?.revision?`creative-v1:${graph.understanding.revision}:`:''
  const creativeNext=(graph?.graph.chapters||[]).find(c=>c.kind==='creative'&&
    sources.filter(s=>c.assetIds.includes(s.id)).length>=2&&
    !settings?.attempted.includes(creativeRound+c.id+':'+c.revision)&&
    !jobs.some(j=>j.status==='complete'&&j.chapterId===c.id&&j.chapterRevision===c.revision))
  const creativeReady=Boolean(creativeRound&&creativeNext&&(settings?.attempted.filter(k=>k.startsWith(creativeRound)).length||0)<2)
  const displayed = jobs.find((j) => j.id === selected) || current || jobs.find((j) => j.status === 'complete') || jobs[0]
  const upsert = (job: FilmJob) => setJobs((all) => [job, ...all.filter((j) => j.id !== job.id)].sort((a, b) => b.createdAt - a.createdAt))
  useEffect(() => { setContextDraft(displayed?.storyContext?.text || '') }, [displayed?.id, displayed?.storyContext?.revision])
  useEffect(() => { setContextMessage('') }, [displayed?.id])

  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++ } }, [])
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    loadFilmSettings().then((value) => { if (!cancelled) setSettings(value) }).catch(() => { if (!cancelled) setSettings({ enabled: true, attempted: [] }) })
    filmRequest<{ jobs: FilmJob[]; capability: { available: boolean } }>().then((data) => {
      if (!cancelled) { setJobs(data.jobs); setCapable(data.capability.available); setLoaded(true) }
    }).catch((e) => { if (!cancelled) { setError(e.message); setLoaded(true) } })
    return () => { cancelled = true }
  }, [ready])
  useEffect(() => {
    let cancelled = false
    void filmBatch(latestAssets.current).then((value) => { if (!cancelled) setBatch(value) })
    return () => { cancelled = true }
  }, [assetKey])
  useEffect(() => { if (settings) void saveFilmSettings(settings).catch(() => setError('自动生成设置未能保存')) }, [settings])

  async function start(manual = false, fromJob?: string, attempt = batch, candidates: FilmSource[] = sources, chapterId?:string) {
    if (lock.current || current || (!fromJob && candidates.length < 2) || !batch) return
    lock.current = true; setStarting(true); setError('')
    const ticket = generation.current
    setSettings((s) => s ? { ...s, attempted: [...new Set([...s.attempted, attempt])].slice(-256) } : s)
    try {
      const job = await filmRequest<FilmJob>('', { sources: fromJob ? undefined : boundedFilmSources(candidates), fromJob, batch, regenerate: manual, chapterId })
      if (alive.current && ticket !== generation.current) upsert(await filmRequest<FilmJob>(`/${job.id}/cancel`, {}))
      else if (alive.current) { upsert(job); setSelected(job.id) }
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : '生成失败') }
    finally { lock.current = false; if (alive.current) setStarting(false) }
  }

  const chapterHandled=useRef(0)
  useEffect(()=>{
    if(!requestedChapter||chapterHandled.current===requestedChapter.at||!batch||!loaded||!capable)return
    setOpen(true)
    if(current||starting)return
    const chapter=graph?.graph.chapters.find(c=>c.id===requestedChapter.chapter.id)||requestedChapter.chapter
    chapterHandled.current=requestedChapter.at
    void start(true,undefined,`chapter:${chapter.id}:${chapter.revision}`,sources.filter(s=>chapter.assetIds.includes(s.id)),chapter.id)
  },[requestedChapter,batch,loaded,capable,current,starting,graph])

  useEffect(() => {
    if (!loaded || !capable || !settings?.enabled || !batch || current || starting || analyzing || sources.length < 2 || pendingUpdate || changedChapter || creativeReady) return
    if (roundUsed >= 3) return
    const next = stories.find(story => story.automatic && !attempted(story.key) && !made(story))
    if (stories.length && !next) return
    if (!stories.length && (settings.attempted.includes(round+'album') || jobs.some(j => j.batch === batch&&j.version==='memory-film-6'))) return
    const timer = window.setTimeout(() => { void start(false, undefined, next ? round + next.key : round+'album', next?.sources || sources,next?.chapterId) }, 10_000)
    return () => window.clearTimeout(timer)
  }, [loaded, capable, settings, batch, jobs, current, starting, analyzing, sources, stories,pendingUpdate?.key,changedChapter?.revision,creativeReady])

  // Confirmed identities and factual corrections invalidate their own chapter.
  // Track the revision durably so a correction never becomes an endless render.
  useEffect(()=>{
    if(!changedChapter||!settings?.enabled||!capable||current||starting||analyzing||!batch||pendingUpdate)return
    const timer=window.setTimeout(()=>{void start(false,undefined,`identity:${changedChapter.id}:${changedChapter.revision}`,sources.filter(s=>changedChapter.assetIds.includes(s.id)),changedChapter.id)},20_000)
    return()=>window.clearTimeout(timer)
  },[changedChapter?.revision,settings,capable,current,starting,analyzing,batch,pendingUpdate?.key])

  // A fresh semantic pass can propose genuinely different cuts of the same
  // album. Produce at most two per understanding revision, with no user brief.
  useEffect(()=>{
    if(!creativeReady||!creativeNext||!settings?.enabled||!capable||current||starting||analyzing||!batch||pendingUpdate||changedChapter)return
    const timer=window.setTimeout(()=>void start(false,undefined,creativeRound+creativeNext.id+':'+creativeNext.revision,sources.filter(s=>creativeNext.assetIds.includes(s.id)),creativeNext.id),10_000)
    return()=>window.clearTimeout(timer)
  },[creativeRound,creativeNext?.revision,creativeReady,settings,capable,current,starting,analyzing,batch,pendingUpdate?.key,changedChapter?.revision])

  // A confirmed correction may arrive from this UI or an authorized assistant.
  // Re-edit only that film's photos, once per revision, respecting Pause.
  useEffect(() => {
    if (!pendingUpdate || !settings?.enabled || !capable || current || starting || analyzing || !batch) return
    const timer = window.setTimeout(() => { void start(false, pendingUpdate.job.id, pendingUpdate.key) },20_000)
    return () => window.clearTimeout(timer)
  }, [pendingUpdate?.key, settings, capable, current, starting, analyzing, batch])

  // Repair the known short-source validation fallback once after the planner
  // upgrade. Generic provider outages stay manual; Pause is always respected.
  const repair = jobs.find(j => j.status === 'complete' && j.planner === 'local' && ['memory-film-1','memory-film-2','memory-film-3'].includes(j.version || '') && j.warning?.includes('剪辑方案需要至少') && !settings?.attempted.includes(`repair:${j.id}:4`))
  useEffect(() => {
    if (!repair || !settings?.enabled || !capable || current || starting || analyzing || !batch) return
    const timer = window.setTimeout(() => { void start(false, repair.id, `repair:${repair.id}:4`) }, 2000)
    return () => window.clearTimeout(timer)
  }, [repair?.id, settings, capable, current, starting, analyzing, batch])

  useEffect(() => {
    if (!current) return
    let cancelled = false, polling = false
    const poll = async () => {
      if (polling) return
      polling = true
      try { const job = await filmRequest<FilmJob>(`/${current.id}`); if (!cancelled) upsert(job) }
      catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : '进度读取失败') }
      finally { polling = false }
    }
    const timer = window.setInterval(() => { void poll() }, 1800)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [current?.id])

  // Recover a service reconnect or a renderer repair without requiring a page
  // refresh. Completed jobs need no continual polling.
  const reconnect = loaded && !current && (capable === null || jobs.some((j) => j.status === 'failed'))
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    const refresh = async () => {
      try {
        const data = await filmRequest<{ jobs: FilmJob[]; capability: { available: boolean } }>()
        if (!cancelled) { setJobs(data.jobs); setCapable(data.capability.available); setLoaded(true); setError('') }
      } catch { /* Keep the last known result while the local service restarts. */ }
    }
    window.addEventListener('focus', refresh)
    const timer = reconnect ? window.setInterval(() => { void refresh() }, 8000) : undefined
    const changed=window.setTimeout(()=>{if(open||graph?.revision)void refresh()},1200)
    return () => { cancelled = true;window.clearTimeout(changed);window.removeEventListener('focus', refresh); if (timer) window.clearInterval(timer) }
  }, [ready, reconnect, open,graph?.revision])

  useEffect(() => {
    if (current?.status !== 'awaiting-images' || uploadLock.current || !current.plan) return
    const task = current, plan = current.plan, ticket = generation.current
    uploadLock.current = true
    void (async () => {
      try {
        for (const [index, shot] of plan.shots.entries()) {
          if (!alive.current || ticket !== generation.current) return
          if (task.uploaded.includes(shot.assetId)) continue
          const asset = latestAssets.current.find((a) => a.id === shot.assetId)
          if (!asset) throw new Error('选中的照片已被移除，请重新生成')
          const dataUrl = await filmImage(asset)
          if (!alive.current || ticket !== generation.current) return
          const job = await filmRequest<FilmJob>(`/${task.id}/images/${shot.assetId}`, { dataUrl })
          if (alive.current && ticket === generation.current) { upsert(job); setUploading(index + 1) }
        }
        if (alive.current && ticket === generation.current) upsert(await filmRequest<FilmJob>(`/${task.id}/render`, {}))
      } catch (e) {
        if (alive.current && ticket === generation.current) {
          setError(e instanceof Error ? e.message : '照片准备失败')
          const stopped = await filmRequest<FilmJob>(`/${task.id}/cancel`, {}).catch(() => null)
          if (stopped && alive.current) upsert(stopped)
        }
      } finally { uploadLock.current = false; if (alive.current) setUploading(0) }
    })()
  }, [current])

  async function pause() {
    generation.current++
    setSettings((s) => s ? { ...s, enabled: false } : s)
    if (current) {
      try { upsert(await filmRequest<FilmJob>(`/${current.id}/cancel`, {})) }
      catch (e) { setError(e instanceof Error ? e.message : '暂停失败') }
    }
  }
  async function saveContext(text: string) {
    if (!displayed || contextSaving || current) return
    setContextSaving(true); setError('')
    try {
      upsert(await filmRequest<FilmJob>(`/${displayed.id}/context`, { text }))
      setContextMessage(settings?.enabled ? '已记住，将自动重新编排这段回忆。' : '已记住，下次重新编排时使用。')
    } catch (e) { setError(e instanceof Error ? e.message : '回忆补充保存失败') }
    finally { setContextSaving(false) }
  }
  useEffect(() => {
    if (!open) return
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [open])

  const remaining = stories.filter(story => !attempted(story.key) && !made(story))
  const status = current?.status === 'planning' ? '正在寻找值得留住的故事…' : current?.status === 'awaiting-images' ? `正在准备照片 ${uploading || current.uploaded.length}/${current.plan?.shots.length || 0}` : current?.status === 'queued' ? '已排队，等待剪辑…' : current?.status === 'rendering' ? `正在剪辑 · ${current.progress}%` : analyzing ? '等照片理解完成后，自动剪一段回忆' : sources.length < 2 ? `已有 ${sources.length} 张可用照片，满 2 张后自动编排` : !settings?.enabled ? '自动生成已暂停' : roundUsed >= 3 ? '这批照片已尝试编排 3 段回忆，还可选择下方主题' : remaining.length ? `发现 ${remaining.length} 段回忆，接着编排${remaining[0].place}` : '照片就绪后会自动编排，无需填写创意'
  return <>
    <button className={`button film-entry ${current || starting ? 'working' : ''}`} onClick={() => setOpen(true)} title="自动回忆短片" aria-label="回忆短片">
      {current || starting ? <LoaderCircle size={16} className="film-spin" /> : <Film size={16} />}<span>回忆短片</span>{jobs.some((j) => j.status === 'complete') && <i />}
    </button>
    {open && createPortal(<div className="modal-backdrop film-backdrop" onClick={() => setOpen(false)}>
      <section className="film-modal" role="dialog" aria-modal="true" aria-labelledby="film-heading" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><div><span className="section-kicker">留住平常的小日子</span><h2 id="film-heading">你的回忆，自己成片</h2></div><button className="icon-button" onClick={() => setOpen(false)} aria-label="关闭回忆短片"><X size={21} /></button></div>
        <div className="film-layout">
          <div className="film-screen">
            {displayed?.status === 'complete' ? <video key={displayed.id} controls playsInline preload="metadata" poster={`/api/memory-films/${displayed.id}/poster`} src={displayed.url} /> : <div className="film-placeholder">
              <div className="film-photo-stack">{assets.filter((a) => a.kind === 'image' && a.preview).slice(-3).map((a) => <img key={a.id} src={a.preview} alt="回忆照片" />)}</div>
              <Film size={30} /><h3>{current ? '正在把片段串成回忆' : '让照片慢慢讲一个故事'}</h3><p>{status}</p>
              {current && <progress value={current.progress} max={100} />}
            </div>}
          </div>
          <div className="film-notes">
            <div className="film-auto"><span>{settings?.enabled ? '自动生成已开启' : '自动生成已暂停'}</span><button className="button button-subtle" onClick={() => settings?.enabled ? void pause() : setSettings((s) => s ? { ...s, enabled: true } : s)}>{settings?.enabled ? <Pause size={13} /> : <Play size={13} />}{settings?.enabled ? '暂停' : '开启'}</button></div>
            <p className="film-status" aria-live="polite">{status}</p>
            {displayed?.plan && <><h3>{displayed.plan.title}</h3><p>{displayed.plan.reason}</p><span className="film-label">{displayed.plan.kind === 'outing' ? '一次游玩' : displayed.plan.kind === 'revisit' ? '同地重访' : '时光片段'} · {displayed.plan.shots.length} 张照片{displayed.duration ? ` · ${displayed.duration} 秒` : ''}</span></>}
            <div className="film-actions">
              {displayed?.status === 'complete' && <a className="button button-primary" href={displayed.url} download={`回忆-${displayed.id}.mp4`}><Download size={15} />保存视频</a>}
              <button className="button button-subtle" disabled={Boolean(current) || starting || sources.length < 2 || capable !== true} onClick={() => void start(true, displayed?.plan ? displayed.id : undefined)}><RotateCcw size={14} />{displayed ? '重新编排一版' : '现在自动生成'}</button>
            </div>
            {error && <p role="alert" className="film-error">{error}</p>}
            {remaining.length > 0 && <details><summary>还有哪些回忆可以成片</summary><div className="film-history">{remaining.map(story => <button key={story.key} disabled={Boolean(current) || starting} onClick={() => void start(false, undefined, 'manual-v3:'+story.key, story.sources,story.chapterId)}>{story.place} · {story.sources.length} 张</button>)}</div></details>}
            {capable === false && <p className="film-error">请检查服务端 FFmpeg、Python 和 Pillow，当前无法生成视频。</p>}
            {displayed?.error && <p className="film-error">{displayed.error}</p>}
            {displayed?.warning && <p className="film-warning">{displayed.warning}</p>}
            {displayed?.exportError && <p className="film-warning">{displayed.exportError}</p>}
            {displayed?.status==='complete'&&(displayed.knowledgeChanged||displayed.chapterChanged)&&<p className="film-warning" role="status">人物或照片资料已更新。这是更新前的成片；{settings?.enabled?'停止修改一会儿后，会自动按最新资料重编。':'开启自动生成或点击“重新编排一版”即可更新。'}</p>}
            {displayed?.plan && <details className="film-context">
              <summary>人物与故事补充（可选）{displayed.storyContext?.notes.length ? ' · 已记住' : ''}</summary>
              <p>可以补充人物关系或这次出游的小故事。只用于本片的 {displayed.plan.shots.length} 张照片；留空也能自动成片。</p>
              {!displayed.storyContext?.text && Boolean(displayed.storyContext?.notes.length) && <ul>{displayed.storyContext?.notes.map((note) => <li key={note.text}>{note.text}（{note.count} 张）</li>)}</ul>}
              <label htmlFor="film-context-text">这段回忆的已知事实</label>
              <textarea id="film-context-text" rows={3} maxLength={400} value={contextDraft} onChange={(e) => setContextDraft(e.target.value)} placeholder="例如：这次是我和女儿一起去海边。" />
              <div className="film-context-actions"><button className="button button-subtle" disabled={Boolean(current) || starting || contextSaving || !contextDraft.trim()} onClick={() => void saveContext(contextDraft)}>保存补充</button>{Boolean(displayed.storyContext?.notes.length) && <button className="button button-subtle" disabled={Boolean(current) || starting || contextSaving} onClick={() => void saveContext('')}>清除本段补充</button>}</div>
              <p aria-live="polite">{contextMessage || (displayed.storyContext?.changed ? '补充已更新，将在重新编排时写进新短片。' : '补充只保存在当前账户，可以随时修改或清除。')}</p>
            </details>}
            {displayed?.plan && <details><summary>这段回忆用了哪些照片</summary><ol className="film-shot-list">{displayed.plan.shots.map((shot) => <li key={shot.assetId}><img src={assets.find((a) => a.id === shot.assetId)?.preview} alt="选中的照片" /><div><b>{shot.caption || '保留照片原本的瞬间'}</b><small>{shot.date} · {shot.seconds} 秒</small><p>{shot.evidence}</p></div></li>)}</ol></details>}
            {jobs.filter((j) => j.status === 'complete').length > 1 && <div className="film-history">{jobs.filter((j) => j.status === 'complete').map((j) => <button key={j.id} onClick={() => setSelected(j.id)}>{j.plan?.title} · {new Date(j.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</button>)}</div>}
            <p className="film-footnote">自动选故事、照片与字幕，配上轻柔的原创合成音乐。{displayed?.exportedAt ? 'MP4 已自动保存到本机导出目录；这里的在线预览保留 24 小时。' : '仅选中的照片传到本机服务制作；在线预览保留 24 小时，可随时保存 MP4。'}照片原件仍留在你的相册中。</p>
          </div>
        </div>
      </section>
    </div>, document.body)}
  </>
}

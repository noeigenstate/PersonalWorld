import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, Film, LoaderCircle, Pause, Play, RotateCcw, X } from 'lucide-react'
import type { MemoryAsset, MemoryEvent } from '../types'
import { filmActive, filmBatch, filmImage, filmRequest, filmSources, type FilmJob, type FilmSource } from '../lib/memoryFilm'
import { discoverFilmStories, storyAlreadyMade } from '../lib/filmStories'
import { loadFilmSettings, saveFilmSettings } from '../lib/storage'

export function MemoryFilms({ assets, events, ready, analyzing }: { assets: MemoryAsset[]; events: MemoryEvent[]; ready: boolean; analyzing: boolean }) {
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
  const stories = useMemo(() => discoverFilmStories(sources), [sources])
  const assetKey = assets.map((a) => `${a.id}:${a.hash}`).sort().join('|')
  const current = jobs.find((j) => filmActive(j))
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

  async function start(manual = false, fromJob?: string, attempt = batch, candidates: FilmSource[] = sources) {
    if (lock.current || current || (!fromJob && candidates.length < 2) || !batch) return
    lock.current = true; setStarting(true); setError('')
    const ticket = generation.current
    setSettings((s) => s ? { ...s, attempted: [...new Set([...s.attempted, attempt])].slice(-30) } : s)
    try {
      const job = await filmRequest<FilmJob>('', { sources: fromJob ? undefined : candidates, fromJob, batch, regenerate: manual })
      if (alive.current && ticket !== generation.current) upsert(await filmRequest<FilmJob>(`/${job.id}/cancel`, {}))
      else if (alive.current) { upsert(job); setSelected(job.id) }
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : '生成失败') }
    finally { lock.current = false; if (alive.current) setStarting(false) }
  }

  useEffect(() => {
    if (!loaded || !capable || !settings?.enabled || !batch || current || starting || analyzing || sources.length < 2) return
    const next = stories.find(story => !settings.attempted.includes(story.key) && !storyAlreadyMade(story, jobs))
    if (stories.length && !next) return
    if (!stories.length && (settings.attempted.includes(batch) || jobs.some(j => j.batch === batch))) return
    const timer = window.setTimeout(() => { void start(false, undefined, next?.key || batch, next?.sources || sources) }, 10_000)
    return () => window.clearTimeout(timer)
  }, [loaded, capable, settings, batch, jobs, current, starting, analyzing, sources, stories])

  // A confirmed correction may arrive from this UI or an authorized assistant.
  // Re-edit only that film's photos, once per revision, respecting Pause.
  const corrected = jobs[0]?.status === 'complete' && jobs[0].storyContext?.changed ? jobs[0] : undefined
  const correctionKey = corrected ? `context:${corrected.id}:${corrected.storyContext?.revision}` : ''
  useEffect(() => {
    if (!corrected || !settings?.enabled || !capable || current || starting || analyzing || !batch || settings.attempted.includes(correctionKey)) return
    const timer = window.setTimeout(() => { void start(false, corrected.id, correctionKey) }, 2000)
    return () => window.clearTimeout(timer)
  }, [correctionKey, settings, capable, current, starting, analyzing, batch])

  // Repair the known short-source validation fallback once after the planner
  // upgrade. Generic provider outages stay manual; Pause is always respected.
  const repair = jobs.find(j => j.status === 'complete' && j.planner === 'local' && j.version !== 'memory-film-4' && j.warning?.includes('剪辑方案需要至少') && !settings?.attempted.includes(`repair:${j.id}:4`))
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
    if (open) void refresh()
    return () => { cancelled = true; window.removeEventListener('focus', refresh); if (timer) window.clearInterval(timer) }
  }, [ready, reconnect, open])

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

  const remaining = stories.filter(story => !settings?.attempted.includes(story.key) && !storyAlreadyMade(story, jobs))
  const status = current?.status === 'planning' ? '正在寻找值得留住的故事…' : current?.status === 'awaiting-images' ? `正在准备照片 ${uploading || current.uploaded.length}/${current.plan?.shots.length || 0}` : current?.status === 'queued' ? '已排队，等待剪辑…' : current?.status === 'rendering' ? `正在剪辑 · ${current.progress}%` : analyzing ? '等照片理解完成后，自动剪一段回忆' : sources.length < 2 ? `已有 ${sources.length} 张可用照片，满 2 张后自动编排` : !settings?.enabled ? '自动生成已暂停' : remaining.length ? `还有 ${remaining.length} 段地点回忆，接着编排${remaining[0].place}` : '照片就绪后会自动编排，无需填写创意'
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
            {capable === false && <p className="film-error">服务端未找到 FFmpeg，暂时无法生成视频。</p>}
            {displayed?.error && <p className="film-error">{displayed.error}</p>}
            {displayed?.warning && <p className="film-warning">{displayed.warning}</p>}
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
            <p className="film-footnote">自动选故事、照片与字幕，配上轻柔的原创合成音乐。仅选中的照片传到本机服务制作；成片保留 24 小时，请及时保存。照片原件仍留在你的相册中。</p>
          </div>
        </div>
      </section>
    </div>, document.body)}
  </>
}

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Aperture, ArrowLeft, ArrowRight, CalendarDays, Check, CheckCircle2,
  ChevronRight, CircleHelp, Clock3, FileImage, MapPin, Pencil, Play, Plus,
  ShieldCheck, Sparkles, Trash2, Upload, X,
} from 'lucide-react'
import { analyzeEvent, fetchAiConfig } from './lib/api'
import { importFiles } from './lib/import'
import { eventCover, formatDate, formatMonth, makeEvents, mergeImportedEvents } from './lib/memory'
import { getFile, loadMemory, removeFile, saveMemory } from './lib/storage'
import type { AiConfig, MemoryAsset, MemoryEvent, MemoryState } from './types'

const initialMemory: MemoryState = { assets: [], events: [] }

function toneForStatus(status: MemoryEvent['status']) {
  return status === 'confirmed' ? 'confirmed' : status === 'analyzed' ? 'analyzed' : 'draft'
}

function statusLabel(status: MemoryEvent['status']) {
  return status === 'confirmed' ? '已确认' : status === 'analyzed' ? '待确认' : '待整理'
}

function AssetImage({ asset, className = '' }: { asset?: MemoryAsset; className?: string }) {
  if (!asset?.preview) return <div className={`asset-fallback ${className}`}><FileImage size={28} strokeWidth={1.5} /></div>
  return <img className={className} src={asset.preview} alt={asset.name} />
}

function EventVisual({ event, assets, className = '' }: { event: MemoryEvent; assets: MemoryAsset[]; className?: string }) {
  const cover = eventCover(event, assets)
  return (
    <div className={`event-visual ${className}`}>
      <AssetImage asset={cover} />
      {cover?.kind === 'video' && <span className="video-mark"><Play size={16} fill="currentColor" /></span>}
    </div>
  )
}

export default function App() {
  const [memory, setMemory] = useState<MemoryState>(initialMemory)
  const [ready, setReady] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [activeEventId, setActiveEventId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<MemoryEvent | null>(null)
  const [editing, setEditing] = useState(false)
  const [activeAssetId, setActiveAssetId] = useState<string | null>(null)
  const [videoUrl, setVideoUrl] = useState('')
  const [busyEventId, setBusyEventId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [aiConfig, setAiConfig] = useState<AiConfig>({ available: false, mode: 'unconfigured', message: '正在检查 AI 连接…' })
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadMemory().then((data) => { setMemory(data); setReady(true) }).catch(() => setReady(true))
    fetchAiConfig().then(setAiConfig).catch(() => setAiConfig({ available: false, mode: 'unconfigured', message: 'AI 服务未启动；本地整理仍可使用' }))
  }, [])

  useEffect(() => {
    if (ready) saveMemory(memory).catch(() => setNotice('本地存储失败，请检查浏览器可用空间'))
  }, [memory, ready])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 4600)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (!activeAssetId) { setVideoUrl(''); return }
    const asset = memory.assets.find((item) => item.id === activeAssetId)
    if (asset?.kind !== 'video') return
    let url = ''
    getFile(asset.id).then((file) => {
      if (!file) return
      url = URL.createObjectURL(file)
      setVideoUrl(url)
    })
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [activeAssetId, memory.assets])

  const events = useMemo(() => [...memory.events].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()), [memory.events])
  const activeEvent = events.find((event) => event.id === activeEventId)
  const activeAsset = memory.assets.find((asset) => asset.id === activeAssetId)

  async function handleFiles(files: File[]) {
    if (!files.length || importing) return
    setImporting(true)
    try {
      const result = await importFiles(files, memory.assets.map((asset) => asset.hash))
      if (result.assets.length) {
        const importedEvents = makeEvents(result.assets)
        setMemory((current) => ({
          assets: [...current.assets, ...result.assets],
          events: mergeImportedEvents(current.events, importedEvents),
        }))
        setImportOpen(false)
      }
      const messages = [`已导入 ${result.assets.length} 个影像`]
      if (result.duplicates) messages.push(`跳过 ${result.duplicates} 个重复文件`)
      if (result.rejected.length) messages.push(result.rejected.slice(0, 2).join('；'))
      setNotice(messages.join(' · '))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '导入失败，请重试')
    } finally {
      setImporting(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  function openEvent(event: MemoryEvent) {
    setActiveEventId(event.id)
    setEditDraft({ ...event, people: [...event.people], tags: [...event.tags], questions: [...event.questions] })
    setEditing(false)
  }

  async function runAnalysis(event: MemoryEvent) {
    if (!aiConfig.available) { setNotice('请先在 .env 中配置 StepFun API Key，重启服务后再分析'); return }
    setBusyEventId(event.id)
    try {
      const result = await analyzeEvent(event, memory.assets)
      const next: MemoryEvent = {
        ...event,
        title: result.title || event.title,
        summary: result.summary || event.summary,
        type: result.type || event.type,
        place: result.place || '',
        people: result.people || [],
        visibleText: result.visibleText || '',
        tags: result.tags || [],
        questions: result.questions || [],
        confidence: result.confidence,
        status: 'analyzed',
      }
      setMemory((current) => ({ ...current, events: current.events.map((item) => item.id === event.id ? next : item) }))
      if (activeEventId === event.id) setEditDraft(next)
      setNotice('分析完成，请核对事件内容')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '分析失败，请重试')
    } finally {
      setBusyEventId(null)
    }
  }

  function saveEvent() {
    if (!editDraft) return
    if (!editDraft.title.trim()) { setNotice('请填写事件标题'); return }
    const next = { ...editDraft, title: editDraft.title.trim(), summary: editDraft.summary.trim(), status: 'confirmed' as const, questions: [] }
    setMemory((current) => ({ ...current, events: current.events.map((item) => item.id === next.id ? next : item) }))
    setEditDraft(next)
    setEditing(false)
    setNotice('事件已确认并保存')
  }

  async function deleteAsset(id: string) {
    if (!window.confirm('要从本地记忆中移除这个影像吗？此操作无法撤销。')) return
    await removeFile(id)
    setMemory((current) => ({
      assets: current.assets.filter((asset) => asset.id !== id),
      events: current.events.map((event) => ({ ...event, assetIds: event.assetIds.filter((assetId) => assetId !== id) })).filter((event) => event.assetIds.length),
    }))
    setActiveAssetId(null)
    setNotice('影像已移除')
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <span className="brand">
          <span className="brand-symbol"><Aperture size={22} strokeWidth={2} /></span>
          <span className="brand-type">Personal World</span>
        </span>
        <nav className="main-nav" aria-label="主导航">
          <span className="nav-item active" aria-current="page"><CalendarDays size={18} strokeWidth={1.8} /><span>事件</span></span>
        </nav>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <span className="mobile-brand"><Aperture size={20} strokeWidth={2} />Personal World</span>
          <div className="topbar-breadcrumb"><span>我的人生地图</span><ChevronRight size={15} /><strong>事件</strong></div>
          <div className="topbar-actions">
            <span className={`connection-status ${aiConfig.available ? 'online' : ''}`} title={aiConfig.message}><span />{aiConfig.available ? 'StepFun 已配置' : '本地模式'}</span>
            <button className="button button-primary top-import" onClick={() => setImportOpen(true)}><Plus size={17} />导入影像</button>
          </div>
        </header>

        <div className="page-content">
          <div className="page-heading">
            <div><h1>事件<span className="title-period">.</span></h1><p>照片先归入事件，时间与地点再从事件中得出。</p></div>
          </div>

          {events.length === 0 ? (
            <div className="collection-empty">
              <span><CalendarDays size={29} strokeWidth={1.5} /></span>
              <h2>还没有事件</h2>
              <p>导入手机里的照片、视频或截图。Personal World 会先按拍摄时间分组，再由你和 AI 一起确认发生了什么。</p>
              <button className="button button-primary" onClick={() => setImportOpen(true)}><Upload size={17} />导入第一批影像</button>
            </div>
          ) : (
            <div className="timeline-main">
              {events.map((event, index) => {
                const newMonth = index === 0 || formatMonth(events[index - 1].occurredAt) !== formatMonth(event.occurredAt)
                return <div key={event.id}>{newMonth && <div className="timeline-month">{formatMonth(event.occurredAt)}<span>{events.filter((item) => formatMonth(item.occurredAt) === formatMonth(event.occurredAt)).length} 个事件</span></div>}
                  <button className="timeline-entry" onClick={() => openEvent(event)}>
                    <span className="timeline-point" />
                    <span className="timeline-date"><strong>{new Date(event.occurredAt).getDate().toString().padStart(2, '0')}</strong><small>{new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(new Date(event.occurredAt))}</small></span>
                    <EventVisual event={event} assets={memory.assets} className="timeline-thumb" />
                    <span className="timeline-info"><span className="timeline-topline"><span className={`status-pill ${toneForStatus(event.status)}`}>{statusLabel(event.status)}</span><span>{event.assetIds.length} 个影像</span></span><strong>{event.title}</strong><span className="timeline-summary">{event.summary}</span><span className="timeline-tags">{event.place && <span><MapPin size={14} />{event.place}</span>}{event.type !== '待整理' && <span>#{event.type}</span>}</span></span>
                    <ChevronRight className="entry-arrow" size={19} />
                  </button>
                </div>
              })}
            </div>
          )}
        </div>
      </main>

      <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/*" multiple hidden onChange={(event) => handleFiles(Array.from(event.target.files || []))} />
      {importOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !importing) setImportOpen(false) }}><section className="import-modal" role="dialog" aria-modal="true" aria-label="导入影像"><div className="modal-header"><div><span className="section-kicker">IMPORT</span><h2>导入你的影像</h2></div><button className="icon-button" onClick={() => setImportOpen(false)} aria-label="关闭导入窗口" disabled={importing}><X size={20} /></button></div><div className={`drop-zone ${dragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); handleFiles(Array.from(event.dataTransfer.files)) }}><span className="drop-icon"><Upload size={27} strokeWidth={1.6} /></span><h3>{importing ? '正在读取影像…' : '拖拽照片到这里'}</h3><p>或从设备中选择照片、视频和截图</p><button className="button button-primary" onClick={() => fileInput.current?.click()} disabled={importing}>选择文件<ArrowRight size={17} /></button></div><div className="import-notes"><span><ShieldCheck size={16} />原始文件保存在本浏览器</span><span><CheckCircle2 size={16} />自动跳过完全重复文件</span></div></section></div>}

      {activeEvent && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setActiveEventId(null) }}><section className="detail-panel" role="dialog" aria-modal="true" aria-label="事件详情"><div className="detail-topbar"><button className="back-link" onClick={() => setActiveEventId(null)}><ArrowLeft size={18} />返回</button><div><span className={`status-pill ${toneForStatus(activeEvent.status)}`}>{statusLabel(activeEvent.status)}</span><button className="icon-button" onClick={() => setActiveEventId(null)} aria-label="关闭事件详情"><X size={20} /></button></div></div><div className="detail-scroll"><EventVisual event={activeEvent} assets={memory.assets} className="detail-cover" /><div className="detail-body"><div className="detail-date"><CalendarDays size={16} />{formatDate(activeEvent.occurredAt)}<span>·</span>{activeEvent.assetIds.length} 个影像</div>{editing && editDraft ? <div className="edit-form"><label>事件标题<input value={editDraft.title} onChange={(event) => setEditDraft({ ...editDraft, title: event.target.value })} /></label><label>这段记忆<input value={editDraft.summary} onChange={(event) => setEditDraft({ ...editDraft, summary: event.target.value })} /></label><div className="edit-two"><label>地点<input value={editDraft.place} onChange={(event) => setEditDraft({ ...editDraft, place: event.target.value })} placeholder="可留空" /></label><label>事件类型<input value={editDraft.type} onChange={(event) => setEditDraft({ ...editDraft, type: event.target.value })} /></label></div><label>人物（用逗号分隔）<input value={editDraft.people.join('，')} onChange={(event) => setEditDraft({ ...editDraft, people: event.target.value.split(/[,，]/).map((item) => item.trim()).filter(Boolean) })} placeholder="例如：我、妈妈" /></label><div className="edit-actions"><button className="button button-subtle" onClick={() => setEditing(false)}>取消</button><button className="button button-primary" onClick={saveEvent}><Check size={17} />确认并保存</button></div></div> : <><div className="detail-title-row"><h2>{activeEvent.title}</h2><button className="icon-button bordered" onClick={() => setEditing(true)} aria-label="编辑事件"><Pencil size={17} /></button></div><p className="detail-summary">{activeEvent.summary}</p><div className="detail-fields"><div><span>事件类型</span><strong>{activeEvent.type}</strong></div><div><span>地点</span><strong>{activeEvent.place || '尚未确认'}</strong></div><div><span>人物</span><strong>{activeEvent.people.join('、') || '尚未确认'}</strong></div></div>{activeEvent.questions.length > 0 && <div className="question-block"><div><CircleHelp size={17} /><strong>有待确认的信息</strong></div>{activeEvent.questions.map((question) => <p key={question}>{question}</p>)}<button onClick={() => setEditing(true)}>补充信息<ArrowRight size={15} /></button></div>}</>}
                  {activeEvent.visibleText && !editing && <div className="ocr-block"><span>影像中的文字</span><p>{activeEvent.visibleText}</p></div>}
                  <div className="detail-section-heading"><div><span className="section-kicker">MOMENTS</span><h3>这段记忆的影像</h3></div><span>点击照片查看大图</span></div><div className="detail-photo-grid">{activeEvent.assetIds.map((id) => { const asset = memory.assets.find((item) => item.id === id); if (!asset) return null; return <div className="detail-photo" key={id}><button className="photo-open" onClick={() => setActiveAssetId(id)}><AssetImage asset={asset} />{asset.kind === 'video' && <span className="video-mark"><Play size={16} fill="currentColor" /></span>}</button></div> })}</div></div></div><div className="detail-footer"><button className="button button-subtle" onClick={() => setEditing(true)}><Pencil size={17} />手动完善</button><button className="button button-primary" onClick={() => runAnalysis(activeEvent)} disabled={busyEventId === activeEvent.id || !aiConfig.available}><Sparkles size={17} />{busyEventId === activeEvent.id ? '正在分析…' : '用 StepFun 分析'}</button></div></section></div>}

      {activeAsset && <div className="lightbox" role="dialog" aria-modal="true" aria-label="查看影像"><div className="lightbox-toolbar"><span>{activeAsset.name}</span><div><button onClick={() => deleteAsset(activeAsset.id)} aria-label="删除影像"><Trash2 size={19} /></button><button onClick={() => setActiveAssetId(null)} aria-label="关闭影像"><X size={21} /></button></div></div><div className="lightbox-stage">{activeAsset.kind === 'video' && videoUrl ? <video src={videoUrl} controls autoPlay /> : <AssetImage asset={activeAsset} />}</div><div className="lightbox-caption"><Clock3 size={16} />{formatDate(activeAsset.capturedAt, { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}{activeAsset.dateSource === 'file' && <span>（文件日期）</span>}</div></div>}

      {notice && <div className="toast" role="status"><span className="toast-dot" />{notice}<button onClick={() => setNotice('')} aria-label="关闭提示"><X size={16} /></button></div>}
    </div>
  )
}

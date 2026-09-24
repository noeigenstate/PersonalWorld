import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Aperture, ArrowDownRight, ArrowLeft, ArrowRight, CalendarDays, Check, CheckCircle2,
  ChevronRight, CircleHelp, Clock3, FileImage, FolderHeart, Heart, ImagePlus,
  LayoutGrid, MapPin, MessageCircle, Network, Pencil, Play, Plus, Search, Send,
  ShieldCheck, Sparkles, Trash2, Upload, UserRound, WandSparkles, X,
} from 'lucide-react'
import { analyzeEvent, askMemory, fetchAiConfig } from './lib/api'
import { importFiles } from './lib/import'
import { eventCover, formatDate, formatMonth, makeEvents, mergeImportedEvents, searchEvents } from './lib/memory'
import { getFile, loadMemory, removeFile, saveMemory } from './lib/storage'
import type { AiConfig, MemoryAsset, MemoryEvent, MemoryState } from './types'

type Section = 'home' | 'timeline' | 'albums' | 'graph' | 'chat'
type ChatMessage = { role: 'user' | 'assistant'; text: string; source?: string }

const navItems: { key: Section; label: string; icon: typeof LayoutGrid }[] = [
  { key: 'home', label: '工作台', icon: LayoutGrid },
  { key: 'timeline', label: '人生时间线', icon: CalendarDays },
  { key: 'albums', label: '事件相册', icon: FolderHeart },
  { key: 'graph', label: '记忆图谱', icon: Network },
  { key: 'chat', label: '回忆对话', icon: MessageCircle },
]

const sectionTitles: Record<Section, { eyebrow: string; title: string; desc: string }> = {
  home: { eyebrow: 'YOUR MEMORY SPACE', title: '工作台', desc: '把日常的碎片，慢慢整理成有脉络的回忆。' },
  timeline: { eyebrow: 'CHRONICLE', title: '人生时间线', desc: '按发生的时间，回看每一段重要片刻。' },
  albums: { eyebrow: 'COLLECTIONS', title: '事件相册', desc: '每一个事件，都有自己的照片与故事。' },
  graph: { eyebrow: 'CONNECTIONS', title: '记忆图谱', desc: '看看事件、地点和人物之间的联系。' },
  chat: { eyebrow: 'ASK YOUR MEMORIES', title: '回忆对话', desc: '向你的照片提问，从已整理的记录中寻找答案。' },
}

const initialMemory: MemoryState = { assets: [], events: [] }

function toneForStatus(status: MemoryEvent['status']) {
  return status === 'confirmed' ? 'confirmed' : status === 'analyzed' ? 'analyzed' : 'draft'
}

function statusLabel(status: MemoryEvent['status']) {
  return status === 'confirmed' ? '已确认' : status === 'analyzed' ? '待确认' : '待整理'
}

function IconBadge({ icon: Icon, className = '' }: { icon: typeof Aperture; className?: string }) {
  return <span className={`icon-badge ${className}`}><Icon size={19} strokeWidth={1.8} /></span>
}

function AssetImage({ asset, className = '' }: { asset?: MemoryAsset; className?: string }) {
  if (!asset?.preview) return <div className={`asset-fallback ${className}`}><FileImage size={28} strokeWidth={1.5} /></div>
  return <img className={className} src={asset.preview} alt={asset.name} />
}

function EmptyArt() {
  return (
    <div className="empty-art" aria-hidden="true">
      <div className="art-grid" />
      <div className="art-ring ring-left" />
      <div className="art-ring ring-right" />
      <div className="memory-ribbon ribbon-blue" />
      <div className="memory-ribbon ribbon-spectrum" />
      <div className="glass-lens lens-left"><div className="lens-scene lens-scene-sea" /></div>
      <div className="glass-lens lens-middle"><div className="lens-scene lens-scene-sky" /></div>
      <div className="glass-lens lens-right"><div className="lens-scene lens-scene-sunset" /></div>
      <div className="glass-plus"><Plus size={35} strokeWidth={1.8} /></div>
    </div>
  )
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

function localReply(question: string, events: MemoryEvent[], assets: MemoryAsset[]) {
  const normalized = question.toLowerCase().replace(/[？?，。！!\s]/g, '')
  const scored = events.map((event) => {
    const words = [event.title, event.place, event.type, ...event.people, ...event.tags].filter(Boolean)
    const score = words.reduce((sum, word) => sum + (normalized.includes(word.toLowerCase()) ? 2 : 0), 0)
    return { event, score }
  }).sort((a, b) => b.score - a.score)
  const matches = scored.filter((item) => item.score > 0).slice(0, 3)
  if (!matches.length) {
    if (events.length === 1) {
      const only = events[0]
      return `目前只有「${only.title}」这一条记录，包含 ${only.assetIds.length} 个影像片段。你可以打开事件补充信息，之后再问我具体内容。`
    }
    return `当前记录里还找不到这个问题的可靠答案。已整理 ${events.length} 个事件、${assets.length} 个影像片段；可以先完善事件标题、地点或人物信息。`
  }
  return matches.map(({ event }) => `${formatDate(event.occurredAt)} · ${event.title}${event.place ? ` · ${event.place}` : ''}\n${event.summary}`).join('\n\n')
}

export default function App() {
  const [memory, setMemory] = useState<MemoryState>(initialMemory)
  const [ready, setReady] = useState(false)
  const [section, setSection] = useState<Section>('home')
  const [search, setSearch] = useState('')
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
  const [chatInput, setChatInput] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
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
  const visibleEvents = useMemo(() => searchEvents(events, search), [events, search])
  const activeEvent = events.find((event) => event.id === activeEventId)
  const activeAsset = memory.assets.find((asset) => asset.id === activeAssetId)
  const pendingCount = events.filter((event) => event.status !== 'confirmed').length
  const peopleCount = new Set(events.flatMap((event) => event.people)).size

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
        setSection('timeline')
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

  function toggleFavorite(id: string) {
    setMemory((current) => ({ ...current, assets: current.assets.map((asset) => asset.id === id ? { ...asset, favorite: !asset.favorite } : asset) }))
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

  async function sendQuestion(question: string) {
    const text = question.trim()
    if (!text || chatBusy) return
    setChatInput('')
    setSection('chat')
    setMessages((current) => [...current, { role: 'user', text }])
    setChatBusy(true)
    try {
      const answer = aiConfig.available ? await askMemory(text, events) : localReply(text, events, memory.assets)
      setMessages((current) => [...current, { role: 'assistant', text: answer, source: aiConfig.available ? 'StepFun · 基于事件记录' : '本地检索 · 基于事件记录' }])
    } catch (error) {
      setMessages((current) => [...current, { role: 'assistant', text: error instanceof Error ? error.message : '提问失败，请重试', source: '连接失败' }])
    } finally {
      setChatBusy(false)
    }
  }

  const currentHeading = sectionTitles[section]

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setSection('home')} aria-label="返回工作台">
          <span className="brand-symbol"><Aperture size={22} strokeWidth={2} /></span>
          <span className="brand-type">见岁</span>
        </button>
        <div className="sidebar-label">空间</div>
        <nav className="main-nav" aria-label="主导航">
          {navItems.map(({ key, label, icon: Icon }) => (
            <button key={key} className={`nav-item ${section === key ? 'active' : ''}`} onClick={() => { setSection(key); setSearch('') }}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
              {key === 'timeline' && pendingCount > 0 && <span className="nav-count">{pendingCount}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="note-line"><ShieldCheck size={15} /> 你的影像保存在此浏览器</span>
            <p>只有点击「用 StepFun 分析」时，所选事件的图片预览才会发送给 AI。</p>
          </div>
          <div className="sidebar-footer"><span className="footer-dot" /> 见岁 <span>·</span> WEB PREVIEW</div>
        </div>
      </aside>

      <main className={`main-content section-${section}`}>
        <header className="topbar">
          <button className="mobile-brand" onClick={() => setSection('home')}><Aperture size={20} strokeWidth={2} />见岁</button>
          <div className="topbar-breadcrumb"><span>我的记忆空间</span><ChevronRight size={15} /><strong>{currentHeading.title}</strong></div>
          <div className="topbar-actions">
            {['timeline', 'albums'].includes(section) && <label className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索事件、地点或人物" aria-label="搜索事件" /></label>}
            <span className={`connection-status ${aiConfig.available ? 'online' : ''}`} title={aiConfig.message}><span />{aiConfig.available ? 'StepFun 已配置' : '本地模式'}</span>
            <button className="button button-primary top-import" onClick={() => setImportOpen(true)}><Plus size={17} />导入影像</button>
          </div>
        </header>

        <div className="page-content">
          <div className="page-heading">
            <div><div className="eyebrow">{currentHeading.eyebrow}</div><h1>{currentHeading.title}<span className="title-period">.</span></h1><p>{currentHeading.desc}</p></div>
            {section !== 'home' && <button className="text-link desktop-only" onClick={() => setImportOpen(true)}><ImagePlus size={17} />添加影像<ArrowRight size={16} /></button>}
          </div>

          {section === 'home' && (
            <>
              {!memory.assets.length ? (
                <section className="welcome-surface">
                  <div className="welcome-copy">
                    <div className="welcome-kicker"><Sparkles size={15} />从这里开始</div>
                    <h2>每张照片背后，<br /><span>都有一段故事。</span></h2>
                    <p>导入手机里的照片、视频或截图。见岁会先按时间整理，等你准备好，再用 AI 重建事件。</p>
                    <div className="welcome-actions"><button className="button button-light" onClick={() => setImportOpen(true)}><Upload size={18} />导入第一批影像</button><span>支持 JPG、PNG、WebP 与视频</span></div>
                  </div>
                  <EmptyArt />
                </section>
              ) : (
                <section className="hero-event">
                  <div className="hero-event-image"><EventVisual event={events[0]} assets={memory.assets} /></div>
                  <div className="hero-event-copy"><span className="section-kicker">最近的记忆</span><span className={`status-pill ${toneForStatus(events[0].status)}`}>{statusLabel(events[0].status)}</span><h2>{events[0].title}</h2><p>{events[0].summary}</p><div className="hero-meta"><CalendarDays size={16} />{formatDate(events[0].occurredAt)}<span>·</span>{events[0].assetIds.length} 个影像</div><button className="button button-light" onClick={() => openEvent(events[0])}>查看这段记忆<ArrowRight size={17} /></button></div>
                </section>
              )}

              <section className="overview-section">
                <div className="section-title-row"><div><span className="section-kicker">OVERVIEW</span><h2>你的记忆概览</h2></div><span className="muted">所有内容仅存于当前浏览器</span></div>
                <div className="stats-row">
                  <div className="stat"><span className="stat-icon"><FileImage size={21} /></span><strong>{memory.assets.length}</strong><span>影像片段</span></div>
                  <div className="stat"><span className="stat-icon"><CalendarDays size={21} /></span><strong>{events.length}</strong><span>重建事件</span></div>
                  <div className="stat"><span className="stat-icon"><CircleHelp size={21} /></span><strong>{pendingCount}</strong><span>等待确认</span></div>
                  <div className="stat"><span className="stat-icon"><UserRound size={21} /></span><strong>{peopleCount}</strong><span>已记录人物</span></div>
                </div>
              </section>

              <section className="workflow-section">
                <div className="section-title-row"><div><span className="section-kicker">HOW IT WORKS</span><h2>让回忆逐渐清晰</h2></div></div>
                <div className="workflow-grid">
                  <div><span className="workflow-number">01</span><IconBadge icon={ImagePlus} /><h3>导入与归档</h3><p>读取拍摄时间，自动聚合相近影像，并跳过完全重复的文件。</p></div>
                  <div><span className="workflow-number">02</span><IconBadge icon={WandSparkles} /><h3>理解发生了什么</h3><p>选定事件后调用 StepFun，提炼事件主题、地点线索与待确认的问题。</p></div>
                  <div><span className="workflow-number">03</span><IconBadge icon={Network} /><h3>连接人生脉络</h3><p>确认人物与地点，形成可以搜索、可以追问的个人记忆图谱。</p></div>
                </div>
              </section>
            </>
          )}

          {section === 'timeline' && (
            <section className="timeline-page">
              {events.length === 0 ? <EmptyCollection title="时间线还没有内容" desc="导入几张照片，系统会先用拍摄时间搭建你的第一条时间线。" onImport={() => setImportOpen(true)} icon={CalendarDays} /> : visibleEvents.length === 0 ? <EmptySearch query={search} /> : (
                <div className="timeline-layout">
                  <div className="timeline-main">
                    {visibleEvents.map((event, index) => {
                      const newMonth = index === 0 || formatMonth(visibleEvents[index - 1].occurredAt) !== formatMonth(event.occurredAt)
                      return <div key={event.id}>{newMonth && <div className="timeline-month">{formatMonth(event.occurredAt)}<span>{visibleEvents.filter((item) => formatMonth(item.occurredAt) === formatMonth(event.occurredAt)).length} 个事件</span></div>}
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
                  <aside className="timeline-aside"><div className="aside-heading"><Sparkles size={18} /><strong>整理进度</strong></div><p>逐条核对 AI 的推断，记忆才会越来越准确。</p><div className="progress-track"><span style={{ width: `${events.length ? ((events.length - pendingCount) / events.length) * 100 : 0}%` }} /></div><div className="progress-copy"><strong>{events.length - pendingCount}/{events.length}</strong><span>事件已确认</span></div><div className="aside-divider" /><span className="aside-tip"><ShieldCheck size={16} />不确定的事件会保持“待确认”状态。</span></aside>
                </div>
              )}
            </section>
          )}

          {section === 'albums' && (
            <section className="albums-page">
              {events.length === 0 ? <EmptyCollection title="事件相册等待第一张照片" desc="导入后，照片会自动进入对应的时间片段。你可以为喜欢的照片点亮精选。" onImport={() => setImportOpen(true)} icon={FolderHeart} /> : visibleEvents.length === 0 ? <EmptySearch query={search} /> : <div className="album-grid">
                {visibleEvents.map((event) => <button className="album-card" key={event.id} onClick={() => openEvent(event)}><EventVisual event={event} assets={memory.assets} /><span className="album-text"><span className="album-date">{formatDate(event.occurredAt)} · {event.assetIds.length} 个影像</span><strong>{event.title}</strong><span>{event.place || event.summary}</span></span><span className="album-arrow"><ArrowDownRight size={18} /></span></button>)}
              </div>}
            </section>
          )}

          {section === 'graph' && <GraphView events={events} onImport={() => setImportOpen(true)} onOpenEvent={openEvent} />}

          {section === 'chat' && (
            <section className="chat-page">
              <div className="chat-stage">
                {!messages.length ? <div className="chat-empty"><span className="chat-emblem"><MessageCircle size={27} strokeWidth={1.6} /></span><h2>关于你的回忆，<br />有什么想问的？</h2><p>回答会依据已整理的事件记录。信息不足时，我会直接告诉你。</p><div className="prompt-list">{['我最近记录了哪些事件？', '有哪些照片还需要我确认？', '帮我回顾已整理的记忆'].map((prompt) => <button key={prompt} onClick={() => sendQuestion(prompt)}>{prompt}<ArrowRight size={16} /></button>)}</div></div> : <div className="message-list">{messages.map((message, index) => <div className={`message ${message.role}`} key={index}><div className="message-avatar">{message.role === 'assistant' ? <Aperture size={17} /> : <UserRound size={17} />}</div><div><div className="message-body">{message.text}</div>{message.source && <span className="message-source">{message.source}</span>}</div></div>)}{chatBusy && <div className="message assistant"><div className="message-avatar"><Aperture size={17} /></div><div className="message-body loading-dots"><span /><span /><span /></div></div>}</div>}
              </div>
              <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); sendQuestion(chatInput) }}><input value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="问问你的记忆…" aria-label="输入回忆问题" /><button type="submit" disabled={!chatInput.trim() || chatBusy} aria-label="发送问题"><Send size={19} /></button></form>
              <div className="chat-caption">{aiConfig.available ? '由 StepFun 回答 · 仅基于已保存的事件文字信息' : '当前为本地检索模式 · 配置 StepFun 后可进行自然语言问答'}</div>
            </section>
          )}
        </div>
      </main>

      <nav className="mobile-nav" aria-label="手机导航">{navItems.map(({ key, label, icon: Icon }) => <button key={key} className={section === key ? 'active' : ''} onClick={() => { setSection(key); setSearch('') }}><Icon size={20} strokeWidth={1.9} /><span>{label.replace('人生', '').replace('事件', '').replace('记忆', '')}</span></button>)}</nav>

      <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/*" multiple hidden onChange={(event) => handleFiles(Array.from(event.target.files || []))} />
      {importOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !importing) setImportOpen(false) }}><section className="import-modal" role="dialog" aria-modal="true" aria-label="导入影像"><div className="modal-header"><div><span className="section-kicker">IMPORT MEMORIES</span><h2>导入你的影像</h2></div><button className="icon-button" onClick={() => setImportOpen(false)} aria-label="关闭导入窗口" disabled={importing}><X size={20} /></button></div><div className={`drop-zone ${dragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); handleFiles(Array.from(event.dataTransfer.files)) }}><span className="drop-icon"><Upload size={27} strokeWidth={1.6} /></span><h3>{importing ? '正在读取影像…' : '拖拽照片到这里'}</h3><p>或从设备中选择照片、视频和截图</p><button className="button button-primary" onClick={() => fileInput.current?.click()} disabled={importing}>选择文件<ArrowRight size={17} /></button></div><div className="import-notes"><span><ShieldCheck size={16} />原始文件保存在本浏览器</span><span><CheckCircle2 size={16} />自动跳过完全重复文件</span></div></section></div>}

      {activeEvent && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setActiveEventId(null) }}><section className="detail-panel" role="dialog" aria-modal="true" aria-label="事件详情"><div className="detail-topbar"><button className="back-link" onClick={() => setActiveEventId(null)}><ArrowLeft size={18} />返回</button><div><span className={`status-pill ${toneForStatus(activeEvent.status)}`}>{statusLabel(activeEvent.status)}</span><button className="icon-button" onClick={() => setActiveEventId(null)} aria-label="关闭事件详情"><X size={20} /></button></div></div><div className="detail-scroll"><EventVisual event={activeEvent} assets={memory.assets} className="detail-cover" /><div className="detail-body"><div className="detail-date"><CalendarDays size={16} />{formatDate(activeEvent.occurredAt)}<span>·</span>{activeEvent.assetIds.length} 个影像</div>{editing && editDraft ? <div className="edit-form"><label>事件标题<input value={editDraft.title} onChange={(event) => setEditDraft({ ...editDraft, title: event.target.value })} /></label><label>这段记忆<input value={editDraft.summary} onChange={(event) => setEditDraft({ ...editDraft, summary: event.target.value })} /></label><div className="edit-two"><label>地点<input value={editDraft.place} onChange={(event) => setEditDraft({ ...editDraft, place: event.target.value })} placeholder="可留空" /></label><label>事件类型<input value={editDraft.type} onChange={(event) => setEditDraft({ ...editDraft, type: event.target.value })} /></label></div><label>人物（用逗号分隔）<input value={editDraft.people.join('，')} onChange={(event) => setEditDraft({ ...editDraft, people: event.target.value.split(/[,，]/).map((item) => item.trim()).filter(Boolean) })} placeholder="例如：我、妈妈" /></label><div className="edit-actions"><button className="button button-subtle" onClick={() => setEditing(false)}>取消</button><button className="button button-primary" onClick={saveEvent}><Check size={17} />确认并保存</button></div></div> : <><div className="detail-title-row"><h2>{activeEvent.title}</h2><button className="icon-button bordered" onClick={() => setEditing(true)} aria-label="编辑事件"><Pencil size={17} /></button></div><p className="detail-summary">{activeEvent.summary}</p><div className="detail-fields"><div><span>事件类型</span><strong>{activeEvent.type}</strong></div><div><span>地点</span><strong>{activeEvent.place || '尚未确认'}</strong></div><div><span>人物</span><strong>{activeEvent.people.join('、') || '尚未确认'}</strong></div></div>{activeEvent.questions.length > 0 && <div className="question-block"><div><CircleHelp size={17} /><strong>有待确认的信息</strong></div>{activeEvent.questions.map((question) => <p key={question}>{question}</p>)}<button onClick={() => setEditing(true)}>补充信息<ArrowRight size={15} /></button></div>}</>}
                  {activeEvent.visibleText && !editing && <div className="ocr-block"><span>影像中的文字</span><p>{activeEvent.visibleText}</p></div>}
                  <div className="detail-section-heading"><div><span className="section-kicker">MOMENTS</span><h3>这段记忆的影像</h3></div><span>点击照片查看 · 点击爱心设为精选</span></div><div className="detail-photo-grid">{activeEvent.assetIds.map((id) => { const asset = memory.assets.find((item) => item.id === id); if (!asset) return null; return <div className="detail-photo" key={id}><button className="photo-open" onClick={() => setActiveAssetId(id)}><AssetImage asset={asset} />{asset.kind === 'video' && <span className="video-mark"><Play size={16} fill="currentColor" /></span>}</button><button className={`favorite-button ${asset.favorite ? 'active' : ''}`} onClick={() => toggleFavorite(id)} aria-label={asset.favorite ? '取消精选' : '设为精选'}><Heart size={17} fill={asset.favorite ? 'currentColor' : 'none'} /></button></div> })}</div></div></div><div className="detail-footer"><button className="button button-subtle" onClick={() => setEditing(true)}><Pencil size={17} />手动完善</button><button className="button button-primary" onClick={() => runAnalysis(activeEvent)} disabled={busyEventId === activeEvent.id || !aiConfig.available}><Sparkles size={17} />{busyEventId === activeEvent.id ? '正在分析…' : '用 StepFun 分析'}</button></div></section></div>}

      {activeAsset && <div className="lightbox" role="dialog" aria-modal="true" aria-label="查看影像"><div className="lightbox-toolbar"><span>{activeAsset.name}</span><div><button onClick={() => toggleFavorite(activeAsset.id)} aria-label={activeAsset.favorite ? '取消精选' : '设为精选'}><Heart size={19} fill={activeAsset.favorite ? 'currentColor' : 'none'} /></button><button onClick={() => deleteAsset(activeAsset.id)} aria-label="删除影像"><Trash2 size={19} /></button><button onClick={() => setActiveAssetId(null)} aria-label="关闭影像"><X size={21} /></button></div></div><div className="lightbox-stage">{activeAsset.kind === 'video' && videoUrl ? <video src={videoUrl} controls autoPlay /> : <AssetImage asset={activeAsset} />}</div><div className="lightbox-caption"><Clock3 size={16} />{formatDate(activeAsset.capturedAt, { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}{activeAsset.dateSource === 'file' && <span>（文件日期）</span>}</div></div>}

      {notice && <div className="toast" role="status"><span className="toast-dot" />{notice}<button onClick={() => setNotice('')} aria-label="关闭提示"><X size={16} /></button></div>}
    </div>
  )
}

function EmptyCollection({ title, desc, onImport, icon: Icon }: { title: string; desc: string; onImport: () => void; icon: typeof CalendarDays }) {
  return <div className="collection-empty"><span><Icon size={29} strokeWidth={1.5} /></span><h2>{title}</h2><p>{desc}</p><button className="button button-primary" onClick={onImport}><Plus size={17} />导入影像</button></div>
}

function EmptySearch({ query }: { query: string }) {
  return <div className="search-empty"><Search size={29} strokeWidth={1.5} /><h2>没有找到“{query}”</h2><p>试试搜索事件标题、地点、人物或标签。</p></div>
}

function GraphView({ events, onImport, onOpenEvent }: { events: MemoryEvent[]; onImport: () => void; onOpenEvent: (event: MemoryEvent) => void }) {
  if (!events.length) return <EmptyCollection title="关系会从记忆中生长" desc="导入影像并确认事件后，人物、地点和经历会在这里连成图谱。" onImport={onImport} icon={Network} />
  const selectedEvents = events.slice(0, 6)
  const people = Array.from(new Set(events.flatMap((event) => event.people))).slice(0, 4)
  const places = Array.from(new Set(events.map((event) => event.place).filter(Boolean))).slice(0, 3)
  const center = { x: 390, y: 240 }
  const eventNodes = selectedEvents.map((event, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / selectedEvents.length
    return { event, x: center.x + Math.cos(angle) * 205, y: center.y + Math.sin(angle) * 155 }
  })
  const satellite = [...people.map((label) => ({ label, kind: 'person' as const })), ...places.map((label) => ({ label, kind: 'place' as const }))]
  return <section className="graph-page"><div className="graph-summary"><span><Network size={18} /> 当前图谱</span><strong>{events.length} <small>事件</small></strong><strong>{people.length} <small>人物</small></strong><strong>{places.length} <small>地点</small></strong></div><div className="graph-canvas-wrap"><svg className="graph-canvas" viewBox="0 0 780 500" role="img" aria-label="事件、人物与地点的关系图"><defs><linearGradient id="graphLine" x1="0" x2="1"><stop stopColor="#91a9ed" /><stop offset="1" stopColor="#d8e0f2" /></linearGradient></defs>{eventNodes.map(({ event, x, y }) => <line key={`line-${event.id}`} x1={center.x} y1={center.y} x2={x} y2={y} stroke="url(#graphLine)" strokeWidth="1.4" />)}{satellite.map(({ label, kind }, index) => { const target = eventNodes.find(({ event }) => kind === 'person' ? event.people.includes(label) : event.place === label); if (!target) return null; const side = target.x < center.x ? -1 : 1; const x = Math.max(58, Math.min(722, target.x + side * 115)); const y = Math.max(55, Math.min(455, target.y + (index % 2 === 0 ? -53 : 53))); return <g key={`${kind}-${label}`}><line x1={target.x} y1={target.y} x2={x} y2={y} stroke="#d7dfed" strokeDasharray="4 5" /><circle cx={x} cy={y} r="27" fill={kind === 'person' ? '#eaf2ff' : '#edf7f2'} stroke={kind === 'person' ? '#cbdcf8' : '#d4eadf'} /><text x={x} y={y + 3} textAnchor="middle" className="graph-small-label">{label.slice(0, 5)}</text></g> })}<circle cx={center.x} cy={center.y} r="58" fill="#1a2744" /><circle cx={center.x} cy={center.y} r="66" fill="none" stroke="#d5e0f9" /><text x={center.x} y={center.y - 2} textAnchor="middle" className="graph-center-label">我的</text><text x={center.x} y={center.y + 19} textAnchor="middle" className="graph-center-label">记忆</text>{eventNodes.map(({ event, x, y }) => <g key={event.id} onClick={() => onOpenEvent(event)} className="graph-event-node" role="button" tabIndex={0} onKeyDown={(keyboardEvent) => { if (keyboardEvent.key === 'Enter') onOpenEvent(event) }}><circle cx={x} cy={y} r="44" fill="#fff" stroke="#cbd8ed" strokeWidth="1.4" /><circle cx={x} cy={y} r="39" fill="#f7f9fe" /><text x={x} y={y - 3} textAnchor="middle" className="graph-event-label">{event.title.slice(0, 7)}</text><text x={x} y={y + 16} textAnchor="middle" className="graph-event-date">{formatDate(event.occurredAt, { month: 'numeric', day: 'numeric' })}</text></g>)}</svg></div><p className="graph-hint">点击事件节点查看详情。人物与地点会在你确认事件后逐渐出现。</p><div className="graph-legend"><span><i className="legend-event" />事件</span><span><i className="legend-person" />人物</span><span><i className="legend-place" />地点</span></div></section>
}

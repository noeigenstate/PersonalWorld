import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, CalendarDays, Check, CircleHelp, Clock3, FileImage, MapPin, Pencil, Play, Sparkles, Trash2, X } from 'lucide-react'
import type { MemoryAsset, MemoryEvent } from '../types'
import { cityLabel, eventCover, formatDate } from '../lib/memory'
import { getFile } from '../lib/storage'

export function statusLabel(status: MemoryEvent['status']) {
  return status === 'confirmed' ? '已确认' : status === 'analyzed' ? '待确认' : '待整理'
}

export function AssetImage({ asset, className = '' }: { asset?: MemoryAsset; className?: string }) {
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

const sourceNote: Record<string, string> = { gps: '由照片定位得出', ai: 'AI 推断，待你确认', user: '你填写的' }

interface Props {
  event: MemoryEvent
  assets: MemoryAsset[]
  firsts: string[]
  aiAvailable: boolean
  busy: boolean
  onClose: () => void
  onAnalyze: () => void
  onSave: (event: MemoryEvent) => void
  onDeleteAsset: (id: string) => void
}

export function EventDetail({ event, assets, firsts, aiAvailable, busy, onClose, onAnalyze, onSave, onDeleteAsset }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(event)
  const [activeAssetId, setActiveAssetId] = useState<string | null>(null)
  const [videoUrl, setVideoUrl] = useState('')
  const activeAsset = assets.find((asset) => asset.id === activeAssetId)

  useEffect(() => { setDraft(event) }, [event])

  useEffect(() => {
    if (activeAsset?.kind !== 'video') { setVideoUrl(''); return }
    let url = ''
    getFile(activeAsset.id).then((file) => { if (file) { url = URL.createObjectURL(file); setVideoUrl(url) } })
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [activeAsset])

  function save() {
    const city = draft.city?.trim()
    onSave({
      ...draft,
      title: draft.title.trim(),
      summary: draft.summary.trim(),
      city: city || undefined,
      citySource: city ? (city === event.city ? event.citySource : 'user') : undefined,
      status: 'confirmed',
      questions: [],
    })
    setEditing(false)
  }

  const where = [event.city ? cityLabel(event.city) : '', event.place].filter(Boolean).join(' · ')
  const tone = event.status === 'confirmed' ? 'confirmed' : event.status === 'analyzed' ? 'analyzed' : 'draft'

  return (
    <>
      <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
        <section className="detail-panel" role="dialog" aria-modal="true" aria-label="事件详情">
          <div className="detail-topbar">
            <button className="back-link" onClick={onClose}><ArrowLeft size={18} />返回地图</button>
            <div><span className={`status-pill ${tone}`}>{statusLabel(event.status)}</span><button className="icon-button" onClick={onClose} aria-label="关闭事件详情"><X size={20} /></button></div>
          </div>
          <div className="detail-scroll">
            <EventVisual event={event} assets={assets} className="detail-cover" />
            <div className="detail-body">
              <div className="detail-date">
                <CalendarDays size={16} />{formatDate(event.occurredAt)}
                {event.endedAt && formatDate(event.endedAt) !== formatDate(event.occurredAt) && <> – {formatDate(event.endedAt, { month: 'long', day: 'numeric' })}</>}
                <span>·</span>{event.assetIds.length} 个影像
              </div>
              {editing ? (
                <div className="edit-form">
                  <label>事件标题<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
                  <label>这段记忆<input value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} /></label>
                  <div className="edit-two">
                    <label>城市<input value={draft.city || ''} onChange={(e) => setDraft({ ...draft, city: e.target.value })} placeholder="例如：上海市" /></label>
                    <label>具体地点<input value={draft.place} onChange={(e) => setDraft({ ...draft, place: e.target.value })} placeholder="可留空" /></label>
                  </div>
                  <div className="edit-two">
                    <label>事件类型<input value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })} /></label>
                    <label>人物（用逗号分隔）<input value={draft.people.join('，')} onChange={(e) => setDraft({ ...draft, people: e.target.value.split(/[,，]/).map((item) => item.trim()).filter(Boolean) })} placeholder="例如：我、妈妈" /></label>
                  </div>
                  <div className="edit-actions">
                    <button className="button button-subtle" onClick={() => { setDraft(event); setEditing(false) }}>取消</button>
                    <button className="button button-primary" onClick={save} disabled={!draft.title.trim()}><Check size={17} />确认并保存</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="detail-title-row"><h2>{event.title}</h2><button className="icon-button bordered" onClick={() => setEditing(true)} aria-label="编辑事件"><Pencil size={17} /></button></div>
                  <p className="detail-summary">{event.summary}</p>
                  {firsts.length > 0 && <div className="first-tags">{firsts.map((first) => <span key={first}>{first}</span>)}</div>}
                  <div className="detail-fields">
                    <div><span>地点</span><strong>{where || '尚未确认'}</strong>{event.city && event.citySource && <small className={event.citySource === 'ai' ? 'unsure' : ''}>{sourceNote[event.citySource]}</small>}</div>
                    <div><span>事件类型</span><strong>{event.type}</strong></div>
                    <div><span>人物</span><strong>{event.people.join('、') || '尚未确认'}</strong></div>
                  </div>
                  {event.questions.length > 0 && (
                    <div className="question-block">
                      <div><CircleHelp size={17} /><strong>有待确认的信息</strong></div>
                      {event.questions.map((question) => <p key={question}>{question}</p>)}
                      <button onClick={() => setEditing(true)}>补充信息<ArrowRight size={15} /></button>
                    </div>
                  )}
                </>
              )}
              {event.visibleText && !editing && <div className="ocr-block"><span>影像中的文字</span><p>{event.visibleText}</p></div>}
              <div className="detail-section-heading"><div><span className="section-kicker">MOMENTS</span><h3>这段记忆的影像</h3></div><span>点击照片查看大图</span></div>
              <div className="detail-photo-grid">
                {event.assetIds.map((id) => {
                  const asset = assets.find((item) => item.id === id)
                  if (!asset) return null
                  return (
                    <div className="detail-photo" key={id}>
                      <button className="photo-open" onClick={() => setActiveAssetId(id)}>
                        <AssetImage asset={asset} />
                        {asset.kind === 'video' && <span className="video-mark"><Play size={16} fill="currentColor" /></span>}
                        {asset.latitude !== undefined && <span className="gps-mark" title="带定位"><MapPin size={13} /></span>}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
          <div className="detail-footer">
            <button className="button button-subtle" onClick={() => setEditing(true)}><Pencil size={17} />手动完善</button>
            <button className="button button-primary" onClick={onAnalyze} disabled={busy || !aiAvailable}><Sparkles size={17} />{busy ? '正在分析…' : '用 StepFun 分析'}</button>
          </div>
        </section>
      </div>
      {activeAsset && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label="查看影像">
          <div className="lightbox-toolbar">
            <span>{activeAsset.name}</span>
            <div>
              <button onClick={() => { onDeleteAsset(activeAsset.id); setActiveAssetId(null) }} aria-label="删除影像"><Trash2 size={19} /></button>
              <button onClick={() => setActiveAssetId(null)} aria-label="关闭影像"><X size={21} /></button>
            </div>
          </div>
          <div className="lightbox-stage">{activeAsset.kind === 'video' && videoUrl ? <video src={videoUrl} controls autoPlay /> : <AssetImage asset={activeAsset} />}</div>
          <div className="lightbox-caption"><Clock3 size={16} />{formatDate(activeAsset.capturedAt, { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}{activeAsset.dateSource === 'file' && <span>（文件日期）</span>}</div>
        </div>
      )}
    </>
  )
}

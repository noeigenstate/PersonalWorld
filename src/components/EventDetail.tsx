import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, CalendarDays, Check, CircleHelp, Clock3, FileImage, LoaderCircle, MapPin, Pencil, Play, Sparkles, Trash2, X } from 'lucide-react'
import type { MemoryAsset, MemoryEvent } from '../types'
import { cityLabel, eventCover, formatDate } from '../lib/memory'
import type { PhotoFacts } from '../lib/photoFacts'
import { PhotoCard, type PeerTools } from './PhotoCard'
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
  // "Last time" facts the record can stand behind (src/lib/firstsLasts.ts)
  lasts?: string[]
  aiAvailable: boolean
  // The automatic analysis is working on this event right now
  busy: boolean
  onClose: () => void
  onSave: (event: MemoryEvent) => void
  onDeleteAsset: (id: string) => void
  cardBusyIds: string[]
  onGenerateCard: (asset: MemoryAsset, facts: PhotoFacts) => void
  peers: PeerTools
  // Open straight on this photo (e.g. clicked on the map)
  initialAssetId?: string | null
  identities?:Record<string,string[]>
}

export function EventDetail({ event, assets, firsts, lasts = [], aiAvailable, busy, onClose, onSave, onDeleteAsset, cardBusyIds, onGenerateCard, peers, initialAssetId, identities }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(event)
  const [activeAssetId, setActiveAssetId] = useState<string | null>(initialAssetId ?? null)
  const [videoUrl, setVideoUrl] = useState('')
  const activeAsset = assets.find((asset) => asset.id === activeAssetId)

  useEffect(() => { if (!editing) setDraft(event) }, [event, editing])

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
                  {event.understanding && <section className="event-understanding">
                    <h3>根据当前资料整理</h3>
                    {event.status === 'confirmed' && <p>{event.understanding.summary}</p>}
                    {event.understanding.insights.map((insight, index) => <p key={index}>{insight.text}</p>)}
                    <small>结合照片线索与已确认人物关系更新。你确认的事件内容会保留。</small>
                  </section>}
                  {(firsts.length > 0 || lasts.length > 0) && <div className="first-tags">{firsts.map((first) => <span key={first}>{first}</span>)}{lasts.map((last) => <span className="last" key={last}>{last}</span>)}</div>}
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
          {/* Analysis runs by itself (App); the person only corrects and confirms */}
          <div className="detail-footer">
            <span className="detail-auto" role="status">
              {busy ? <LoaderCircle size={15} className="film-spin" /> : <Sparkles size={15} />}
              {busy ? '正在自动分析这件事…' : event.status === 'draft' ? (aiAvailable ? '等待自动分析' : '接入 StepFun 后会自动分析') : event.status === 'analyzed' ? '已自动分析，请核对' : '你已确认'}
            </span>
            <div>
              <button className="button button-subtle" onClick={() => setEditing(true)}><Pencil size={17} />手动完善</button>
              {event.status === 'analyzed' && !editing && <button className="button button-primary" onClick={() => onSave({ ...event, status: 'confirmed', questions: [] })}><Check size={17} />确认无误</button>}
            </div>
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
          <div className="lightbox-body">
            <div className="lightbox-media">
              <div className="lightbox-stage">{activeAsset.kind === 'video' && videoUrl ? <video src={videoUrl} controls autoPlay /> : <AssetImage asset={activeAsset} />}</div>
              <div className="lightbox-caption"><Clock3 size={16} />{formatDate(activeAsset.capturedAt, { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}{activeAsset.dateSource !== 'exif' && <span>（{activeAsset.dateSource === 'filename' ? '文件名中的保存时间' : '文件时间'}）</span>}</div>
            </div>
            <PhotoCard asset={activeAsset} event={event} aiAvailable={aiAvailable} busy={cardBusyIds.includes(activeAsset.id)} onGenerate={(facts) => onGenerateCard(activeAsset, facts)} peers={peers} identities={identities?.[activeAsset.id]} />
          </div>
        </div>
      )}
    </>
  )
}

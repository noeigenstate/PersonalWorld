import { useEffect, useState } from 'react'
import { Check, Images, MapPinned, RefreshCw, Sparkles } from 'lucide-react'
import type { ContextFill, MemoryAsset, MemoryEvent, PhotoCard as Card } from '../types'
import { photoFacts } from '../lib/photoFacts'
import { getFile } from '../lib/storage'

export interface PeerTools {
  candidateCount: (asset: MemoryAsset) => number
  busyId: string | null
  infer: (asset: MemoryAsset) => void
  apply: (asset: MemoryAsset, field: 'city' | 'place', value: string) => void
  assetById: (id: string) => MemoryAsset | undefined
  showOnMap?: (asset: MemoryAsset) => void
}

interface Props {
  asset: MemoryAsset
  event?: MemoryEvent
  aiAvailable: boolean
  busy: boolean
  onGenerate: (facts: ReturnType<typeof photoFacts>) => void
  peers: PeerTools
  identities?:string[]
}

const fillLabels = { city: '城市', place: '地点', time: '时间', event: '事件' } as const

function Confidence({ value }: { value: number }) {
  return <span className="pc-confidence" title="把握程度"><i style={{ width: `${Math.round(value * 100)}%` }} /><b>{Math.round(value * 100)}%</b></span>
}

// 〔…〕 marks inference inside the caption
function Marked({ text }: { text: string }) {
  return <>{text.split(/(〔[^〕]*〕)/).map((part, i) => (part.startsWith('〔') && part.endsWith('〕') ? <span className="inferred" key={i}>{part.slice(1, -1)}</span> : part))}</>
}

export function PhotoCard({ asset, event, aiAvailable, busy, onGenerate, peers, identities }: Props) {
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | undefined>()

  // Photos imported before sizes were recorded: read the size from the original file
  useEffect(() => {
    setDimensions(undefined)
    if (asset.width || asset.kind === 'video') return
    let cancelled = false
    getFile(asset.id).then((file) => (file ? createImageBitmap(file) : undefined)).then((bitmap) => {
      if (bitmap && !cancelled) setDimensions({ width: bitmap.width, height: bitmap.height })
      bitmap?.close()
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [asset.id, asset.width, asset.kind])

  const facts = photoFacts(asset, event, dimensions)
  const card: Card | undefined = asset.card
  const understood = event?.understanding?.photos?.find(photo => photo.assetId === asset.id)
  const context = asset.context
  const candidates = peers.candidateCount(asset)
  const cityKnown = Boolean(event?.city && event.citySource !== 'ai')
  const fills = context ? (Object.entries(context.fills) as [keyof typeof fillLabels, ContextFill | null][]).filter((entry): entry is [keyof typeof fillLabels, ContextFill] => Boolean(entry[1])) : []
  const related = context?.matches.filter((m) => m.relation !== '无关') || []

  return (
    <aside className="photo-card" aria-label="照片信息卡">
      <div className="pc-kicker">照片信息卡</div>
      {card ? <h2>{understood?.title || card.title}</h2> : <h2 className="pc-placeholder">这张照片记录了什么？</h2>}
      {(understood?.caption || card?.caption) && <p className="pc-caption"><Marked text={understood?.caption || card!.caption} /></p>}
      {understood && <small className="pc-muted">已结合当前人物关系与照片线索更新</small>}
      {Boolean(identities?.length)&&<section><h3>人物库关联</h3><p>{identities!.join(' · ')}</p><small>使用你确认过的称呼。自动匹配若有误，可在“人物与故事”中调整。</small></section>}

      <section>
        <h3>程序读到的</h3>
        <dl className="pc-facts">
          <div><dt>时间</dt><dd>{facts.time}<small className={facts.timeSource === 'exif' ? '' : 'warn'}>{facts.timeNote}</small></dd></div>
          <div><dt>地点</dt><dd className={facts.placeInferred ? 'pc-inferred-place' : ''}>{facts.place}<small>{facts.placeNote}</small>{asset.location?.evidence && <small>{asset.location.evidence}</small>}</dd></div>
          <div><dt>设备</dt><dd>{facts.device || '未知'}</dd></div>
          <div><dt>尺寸</dt><dd>{facts.size}</dd></div>
          <div><dt>文件</dt><dd className="pc-file">{facts.fileName}</dd></div>
        </dl>
        {peers.showOnMap && (asset.location || asset.latitude !== undefined) && (
          <button className="pc-apply pc-show-map" onClick={() => peers.showOnMap!(asset)}><MapPinned size={14} />在地图上看</button>
        )}
        {facts.stripped && (
          <p className="pc-stripped">这张图不含拍摄信息（时间、定位、设备都已被去掉），常见于微信、QQ 发送的非原图。想要完整信息，请发送时勾选"原图"，或从手机相册用数据线、AirDrop 导出原图后再导入。</p>
        )}
      </section>

      {card ? (
        <>
          <section>
            <h3>画面里有</h3>
            <p>{card.scene}</p>
            {card.visibleText && <p className="pc-text"><span>可读文字</span>{card.visibleText}</p>}
          </section>
          {card.landmark && (
            <section>
              <h3>认出的地标</h3>
              <div className="pc-landmark">
                <div><strong>{card.landmark.name}</strong><span>{card.landmark.city}</span></div>
                <Confidence value={card.landmark.confidence} />
                {!cityKnown && card.landmark.city && <button className="pc-apply" onClick={() => peers.apply(asset, 'city', card.landmark!.city)}><Check size={14} />采用为地点</button>}
              </div>
            </section>
          )}
          {card.clues.length > 0 && (
            <section>
              <h3>线索与推断</h3>
              <ul className="pc-clues">
                {card.clues.map((clue, i) => (
                  <li key={i}>
                    <span className="pc-kind">{clue.kind}</span>
                    <div>
                      <p className="pc-evidence">{clue.evidence}</p>
                      <p className="pc-inference">→ {clue.inference}</p>
                    </div>
                    <Confidence value={clue.confidence} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {card.eventGuess.type && (
            <section>
              <h3>可能是</h3>
              <p><strong className="pc-event">{card.eventGuess.type}</strong>{card.eventGuess.reason}</p>
            </section>
          )}
          {card.questions.length > 0 && (
            <section className="pc-questions">
              <h3>请你确认</h3>
              {card.questions.map((q) => <p key={q}>{q}</p>)}
            </section>
          )}
          {card.tags.length > 0 && <div className="pc-tags">{card.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
        </>
      ) : (
        <p className="pc-empty">让 StepFun 看看这张照片：写下画面内容、可读的文字，以及能推断出时间、地点和事件的线索。每条推断都会写明依据。</p>
      )}

      <section className="pc-peers">
        <h3>从其他照片补全</h3>
        {context ? (
          <>
            {fills.length ? (
              <ul className="pc-fills">
                {fills.map(([field, fill]) => (
                  <li key={field}>
                    <span className="pc-kind">{fillLabels[field]}</span>
                    <div>
                      <p><strong>{fill.value}</strong></p>
                      <p className="pc-inference">{fill.reason}</p>
                      <div className="pc-sources">
                        {fill.fromRefIds.map((id) => {
                          if (id === 'landmark') return <span key={id} className="pc-source-tag">地标</span>
                          const ref = peers.assetById(id)
                          return ref ? <img key={id} src={ref.preview} alt={ref.name} title={ref.name} /> : null
                        })}
                      </div>
                    </div>
                    <div className="pc-fill-side">
                      <Confidence value={fill.confidence} />
                      {(field === 'city' || field === 'place') && !(field === 'city' && cityKnown && event?.city === fill.value) && (
                        <button className="pc-apply" onClick={() => peers.apply(asset, field, fill.value)}><Check size={14} />采用</button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="pc-muted">其他照片里没有找到可靠的依据，暂不补全。</p>}
            {related.length > 0 && (
              <ul className="pc-matches">
                {related.map((m) => {
                  const ref = peers.assetById(m.refId)
                  return <li key={m.refId}>{ref && <img src={ref.preview} alt={ref.name} />}<div><b>{m.relation}</b><span>{m.evidence}</span></div></li>
                })}
              </ul>
            )}
            {context.conflicts.map((c) => <p key={c} className="pc-conflict">{c}</p>)}
            <p className="pc-muted">对比了 {context.matches.length} 张照片，{context.matches.length - related.length} 张判断为无关。</p>
          </>
        ) : (
          <p className="pc-muted">{candidates ? `有 ${candidates} 张带定位或已确认地点的照片可以对比。` : '还没有带定位或已确认地点的照片可以对比。'}</p>
        )}
        <button className="button button-subtle pc-generate" onClick={() => peers.infer(asset)} disabled={!candidates || !aiAvailable || peers.busyId === asset.id || !asset.preview}>
          <Images size={16} />{peers.busyId === asset.id ? '正在对比…' : context ? '重新对比' : '对比其他照片'}
        </button>
      </section>

      <button className={`button ${card ? 'button-subtle' : 'button-primary'} pc-generate`} onClick={() => onGenerate(facts)} disabled={busy || !aiAvailable || asset.kind === 'video' || !asset.preview}>
        {card ? <RefreshCw size={16} /> : <Sparkles size={16} />}
        {busy ? '正在看这张照片…' : card ? '重新生成' : '生成信息卡'}
      </button>
      {!aiAvailable && <p className="pc-hint">需要在 .env 中配置 StepFun 后才能生成。</p>}
    </aside>
  )
}

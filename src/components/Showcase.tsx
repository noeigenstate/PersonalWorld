import { ChevronLeft, ChevronRight, Maximize2, Pause, Play, X } from 'lucide-react'
import type { MemoryAsset, MemoryEvent } from '../types'
import { cityLabel, formatDate } from '../lib/memory'

export interface ShowcaseState {
  ids: string[]
  // gallery: photos the butler found; slideshow: a story told over its photos
  mode: 'gallery' | 'slideshow'
  index: number
  playing: boolean
}

interface Props {
  showcase: ShowcaseState
  assets: MemoryAsset[]
  events: MemoryEvent[]
  onChange: (next: ShowcaseState) => void
  onClose: () => void
  onOpen: (assetId: string) => void
}

// Photos the butler brings up, on a stage over the map: the map itself moves to where each one
// was taken. Photos are content, so the stage is the clear glass over media, dimmed.
export function Showcase({ showcase, assets, events, onChange, onClose, onOpen }: Props) {
  const list = showcase.ids.map((id) => assets.find((a) => a.id === id)).filter((a): a is MemoryAsset => Boolean(a?.preview))
  if (!list.length) return null
  const index = Math.min(showcase.index, list.length - 1)
  const asset = list[index]
  const event = events.find((e) => e.assetIds.includes(asset.id))
  const place = asset.location?.aoi || asset.location?.poi?.name || asset.location?.label || (event?.city ? cityLabel(event.city) : '')
  const title = asset.card?.title || event?.title || asset.name
  const step = (delta: number) => onChange({ ...showcase, index: (index + delta + list.length) % list.length, playing: false })

  return (
    <section className={`showcase ${showcase.mode}`} aria-label={showcase.mode === 'slideshow' ? '幻灯片' : '找到的照片'} data-count={list.length}>
      <div className="showcase-stage">
        <img key={asset.id} src={asset.preview} alt={title} />
        {list.length > 1 && <>
          <button type="button" className="showcase-nav prev" onClick={() => step(-1)} aria-label="上一张"><ChevronLeft size={22} /></button>
          <button type="button" className="showcase-nav next" onClick={() => step(1)} aria-label="下一张"><ChevronRight size={22} /></button>
        </>}
        <div className="showcase-tools">
          {list.length > 1 && <button type="button" onClick={() => onChange({ ...showcase, playing: !showcase.playing })} aria-label={showcase.playing ? '暂停播放' : '自动播放'}>{showcase.playing ? <Pause size={17} /> : <Play size={17} />}</button>}
          <button type="button" onClick={() => onOpen(asset.id)} aria-label="查看这张照片的详情"><Maximize2 size={17} /></button>
          <button type="button" onClick={onClose} aria-label="收起照片"><X size={19} /></button>
        </div>
      </div>
      <div className="showcase-caption">
        <b>{title}</b>
        <small>{formatDate(asset.capturedAt)}{place ? ` · ${place}` : ''}{list.length > 1 ? ` · ${index + 1}/${list.length}` : ''}</small>
      </div>
      {list.length > 1 && (
        <div className="showcase-strip" role="list">
          {list.map((item, i) => <button type="button" key={item.id} role="listitem" className={i === index ? 'on' : ''} onClick={() => onChange({ ...showcase, index: i, playing: false })} aria-label={`第 ${i + 1} 张`} aria-current={i === index}><img src={item.preview} alt="" /></button>)}
        </div>
      )}
    </section>
  )
}

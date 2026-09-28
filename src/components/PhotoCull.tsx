import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronLeft, Layers, Star, Trash2, X } from 'lucide-react'
import type { MemoryAsset, PhotoLook } from '../types'
import { findStacks, keepCount, photoLook, rankStack, reviewImage, type CullReview } from '../lib/cull'
import { reviewStack } from '../lib/api'
import { loadPreference, savePreference } from '../lib/storage'

// 删照片: similar photos are stacked, the best few are marked to keep, the rest are pre-selected
// for deletion. Nothing is deleted until the user confirms.
type StackReview = { reviews: Record<string, CullReview>; keep: string[]; summary: string }

interface Props {
  assets: MemoryAsset[]
  ready: boolean
  aiAvailable: boolean
  onLooks: (looks: Record<string, PhotoLook>) => void
  onDelete: (ids: string[]) => Promise<void>
}

// Local time, as the photo was taken
const when = (iso: string) => {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function PhotoCull({ assets, ready, aiAvailable, onLooks, onDelete }: Props) {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<string[]>([])
  const [reviews, setReviews] = useState<Record<string, StackReview>>({})
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const measuring = useRef(false)
  // Each stack is sent to the model at most once per session, even when it fails
  const tried = useRef(new Set<string>())

  useEffect(() => {
    if (!ready) return
    void loadPreference<string[]>('cull-dismissed', []).then(setDismissed)
    void loadPreference<Record<string, StackReview>>('cull-reviews', {}).then(setReviews)
  }, [ready])

  // Measure photos imported before this feature, or just now; a few at a time so the map stays smooth
  useEffect(() => {
    if (!ready || measuring.current) return
    const pending = assets.filter((a) => a.kind === 'image' && !a.look && a.preview)
    if (!pending.length) return
    measuring.current = true
    void (async () => {
      const looks: Record<string, PhotoLook> = {}
      for (const [index, asset] of pending.entries()) {
        looks[asset.id] = await photoLook(asset.preview).catch(() => ({ dhash: '', sharpness: 0, brightness: 0, clipped: 0 }))
        if ((index + 1) % 24 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
      }
      measuring.current = false
      onLooks(looks)
    })()
  }, [assets, ready, onLooks])

  const stacks = useMemo(() => findStacks(assets).filter((s) => !dismissed.includes(s.key)), [assets, dismissed])
  const stack = stacks.find((s) => s.key === current) || null
  const review = stack ? reviews[stack.key] : undefined
  const ranked = useMemo(() => (stack ? rankStack(stack, review?.reviews, review?.keep) : []), [stack, review])
  const extra = stacks.reduce((sum, s) => sum + s.assets.length - keepCount(s.assets.length), 0)

  // Opening a stack pre-selects everything not recommended, and asks the model once per stack
  useEffect(() => {
    if (!stack) return
    setSelected(new Set(ranked.filter((r) => !r.keep).map((r) => r.asset.id)))
  }, [stack?.key, review])

  useEffect(() => {
    if (!stack || review || !aiAvailable || tried.current.has(stack.key)) return
    const key = stack.key
    tried.current.add(key)
    setReviewing(key)
    setError('')
    void (async () => {
      try {
        // The model sees at most 12: the sharpest ones by local ranking
        const candidates = rankStack(stack).slice(0, 12).map((r) => r.asset)
        const photos = await Promise.all(candidates.map(async (a) => ({ id: a.id, dataUrl: await reviewImage(a.preview), time: when(a.capturedAt), sharpness: a.look?.sharpness })))
        const result = await reviewStack(photos, keepCount(stack.assets.length))
        setReviews((all) => {
          const next = { ...all, [key]: result }
          void savePreference('cull-reviews', next)
          return next
        })
      } catch (e) {
        setError(e instanceof Error ? `没能检查闭眼和表情：${e.message}；先按清晰度排序` : '没能检查闭眼和表情')
      } finally {
        setReviewing(null)
      }
    })()
  }, [stack, review, aiAvailable])

  // A reviewed stack does not come back: neither when kept whole nor as the few left after deleting
  function dismiss(key: string) {
    setDismissed((all) => {
      const next = [...all, key]
      void savePreference('cull-dismissed', next)
      return next
    })
    setCurrent(null)
  }

  async function removeSelected() {
    if (!stack || !selected.size) return
    const left = stack.assets.length - selected.size
    const warning = left ? '' : '这会删除这一组的全部照片。'
    if (!window.confirm(`${warning}删除选中的 ${selected.size} 张照片？浏览器缓存和服务电脑上的副本都会删除，无法撤销。`)) return
    setDeleting(true)
    try {
      await onDelete([...selected])
      dismiss(stack.assets.map((a) => a.id).filter((id) => !selected.has(id)).sort().join(','))
    } finally {
      setDeleting(false)
    }
  }

  const toggle = (id: string) => setSelected((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next })

  if (!stacks.length) return null
  return <>
    <button className="button cull-entry" onClick={() => setOpen(true)} title="相似的照片叠在一起，挑出最好的几张">
      <Layers size={16} /><span>整理重复</span><b>{stacks.length}</b>
    </button>
    {open && createPortal(<div className="modal-backdrop" onClick={() => setOpen(false)}>
      <section className="cull-sheet" role="dialog" aria-modal="true" aria-labelledby="cull-heading" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div>
            {stack ? <button className="back-link" onClick={() => setCurrent(null)}><ChevronLeft size={16} />全部 {stacks.length} 组</button> : <span className="section-kicker">连拍、闭眼、模糊、重复构图</span>}
            <h2 id="cull-heading">{stack ? `${stack.assets.length} 张相似照片` : '整理重复照片'}</h2>
          </div>
          <button className="icon-button" onClick={() => setOpen(false)} aria-label="关闭整理重复照片"><X size={21} /></button>
        </header>

        {!stack && <>
          <p className="cull-lead">找到 {stacks.length} 组构图相似的照片，每组推荐保留最好的几张，约可删除 {extra} 张。点开一组查看，确认后才会删除。</p>
          <ul className="cull-stacks">
            {stacks.map((s) => (
              <li key={s.key}>
                <button className="cull-pile" onClick={() => setCurrent(s.key)} aria-label={`${s.assets.length} 张相似照片，${when(s.assets[0].capturedAt)}`}>
                  <span className="cull-pile-photos">
                    {s.assets.slice(0, 3).reverse().map((a, i) => <img key={a.id} src={a.preview} alt="" style={{ '--i': i } as React.CSSProperties} />)}
                    <b>{s.assets.length}</b>
                  </span>
                  <span className="cull-pile-text">
                    <strong>{when(s.assets[0].capturedAt)}</strong>
                    <small>推荐保留 {keepCount(s.assets.length)} 张{reviews[s.key] ? ' · 已检查' : ''}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>}

        {stack && <>
          <p className="cull-lead" role="status">
            {reviewing === stack.key ? '正在检查闭眼、模糊和表情…' : review?.summary || (aiAvailable ? '' : '未连接 StepFun，按清晰度和曝光排序；闭眼需要连接后才能检查。')}
            {error && <span className="cull-error">{error}</span>}
          </p>
          <ul className="cull-grid">
            {ranked.map((r) => {
              const marked = selected.has(r.asset.id)
              const note = review?.reviews[r.asset.id]?.note
              return (
                <li key={r.asset.id} className={`${r.keep ? 'keep' : ''} ${marked ? 'marked' : ''}`}>
                  <button className="cull-photo" onClick={() => toggle(r.asset.id)} aria-pressed={marked} aria-label={`${marked ? '取消删除' : '标记删除'}：${r.asset.name}`}>
                    <img src={r.asset.preview} alt={r.asset.name} />
                    {r.keep && <span className="cull-keep"><Star size={12} />推荐保留</span>}
                    <span className="cull-check">{marked ? <Trash2 size={14} /> : <Check size={14} />}</span>
                  </button>
                  <div className="cull-meta">
                    <span className="cull-score">{r.score.toFixed(1)}</span>
                    {r.issues.map((issue) => <em key={issue}>{issue}</em>)}
                  </div>
                  {note && <p className="cull-note">{note}</p>}
                </li>
              )
            })}
          </ul>
          <footer className="cull-actions">
            <button className="button button-subtle" onClick={() => dismiss(stack.key)}>这组都保留</button>
            <button className="button cull-delete" onClick={() => void removeSelected()} disabled={!selected.size || deleting}>
              <Trash2 size={15} />{deleting ? '正在删除…' : `删除选中的 ${selected.size} 张`}
            </button>
          </footer>
        </>}
      </section>
    </div>, document.body)}
  </>
}

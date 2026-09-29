import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, X } from 'lucide-react'
import type { MemoryAsset } from '../types'
import { speak } from '../lib/api'
import { rememberStoryNote, storyFrame, type NarratedStory } from '../lib/storytelling'
import { MarkedText } from './VoiceButler'

interface Props {
  story: NarratedStory
  assets: MemoryAsset[]
  onFocus: (assetId: string) => void
  onClose: () => void
  onOpen: (assetId: string) => void
  onAnother: () => void
  onRetell: (id: string) => void
  onRemembered: () => void
}

const delay = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(new DOMException('Stopped', 'AbortError')); return }
  const abort = () => { window.clearTimeout(timer); reject(new DOMException('Stopped', 'AbortError')) }
  const timer = window.setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
  signal.addEventListener('abort', abort, { once: true })
})

// A paragraph owns its photos and voice. Pause/resume keeps audio time; seeking cancels all old work.
export function StoryStage({ story, assets, onFocus, onClose, onOpen, onAnother, onRetell, onRemembered }: Props) {
  const [index, setIndex] = useState(0), [frame, setFrame] = useState(0), [replay, setReplay] = useState(0)
  const [playing, setPlaying] = useState(true), [phase, setPhase] = useState('loading')
  const [voiceUnavailable, setVoiceUnavailable] = useState(false)
  const [note, setNote] = useState(''), [saving, setSaving] = useState(false), [saved, setSaved] = useState(false), [error, setError] = useState('')
  const playingRef = useRef(true), audio = useRef<HTMLAudioElement | null>(null)
  const callbacks = useRef({ onFocus, onClose, onRemembered }); callbacks.current = { onFocus, onClose, onRemembered }
  const cache = useRef(new Map<number, Promise<string | null>>())
  const requests = useRef<AbortController | null>(null)
  const beat = story.beats[index]
  const finished = phase === 'ended'
  const setPlay = (value: boolean) => {
    playingRef.current = value; setPlaying(value)
    if (!value) audio.current?.pause()
    else if (audio.current) void audio.current.play().catch(() => { setVoiceUnavailable(true); audio.current?.dispatchEvent(new Event('error')) })
  }
  const seek = (next: number) => {
    audio.current?.pause(); audio.current = null
    playingRef.current = true; setPlaying(true); setFrame(0)
    setIndex(Math.max(0, Math.min(story.beats.length - 1, next))); setReplay(v => v + 1)
  }

  useEffect(() => {
    const controller = new AbortController(); requests.current = controller
    const urls = cache.current = new Map()
    return () => {
      controller.abort(); audio.current?.pause(); audio.current = null
      void Promise.all(urls.values()).then(values => values.forEach(url => { if (url) URL.revokeObjectURL(url) }))
    }
  }, [story.id])

  useEffect(() => {
    const controller = new AbortController(), signal = controller.signal
    const load = (i: number) => {
      if (!story.beats[i]?.text) return Promise.resolve(null)
      const entries = cache.current
      if (!entries.has(i)) entries.set(i, speak(story.beats[i].text, requests.current?.signal).then(blob => URL.createObjectURL(blob)).catch(() => { entries.delete(i); return null }))
      return cache.current.get(i)!
    }
    // Only the next paragraph is prefetched, keeping live speech requests bounded.
    void load(index); void load(index + 1)
    const waitPlaying = async () => { while (!playingRef.current) await delay(80, signal) }
    const wait = async (ms: number, progress?: (value: number) => void) => {
      let elapsed = 0
      while (elapsed < ms) {
        await waitPlaying()
        const start = performance.now(); await delay(Math.min(80, ms - elapsed), signal)
        if (playingRef.current) elapsed += performance.now() - start
        progress?.(Math.min(1, elapsed / ms))
      }
    }
    const run = async () => {
      setFrame(0); setPhase(beat.text ? 'loading' : 'lead')
      const url = beat.text ? await load(index) : null
      if (signal.aborted) return
      setPhase('lead'); await wait(beat.leadInMs)
      if (beat.text) {
        setPhase('speaking'); await waitPlaying()
        let heard = false
        if (url) {
          setVoiceUnavailable(false)
          const player = new Audio(url); audio.current = player
          heard = await new Promise<boolean>(resolve => {
            const done = (ok: boolean) => {
              signal.removeEventListener('abort', abort)
              player.onended = null; player.onerror = null; player.ontimeupdate = null
              player.pause(); if (audio.current === player) audio.current = null
              resolve(ok)
            }
            const abort = () => done(false)
            signal.addEventListener('abort', abort, { once: true })
            player.onended = () => { setFrame(storyFrame(beat, 1)); done(true) }
            player.onerror = () => done(false)
            player.ontimeupdate = () => { if (Number.isFinite(player.duration) && player.duration > 0) setFrame(storyFrame(beat, player.currentTime / player.duration)) }
            void player.play().catch(() => done(false))
          })
        }
        if (signal.aborted) return
        if (!heard) {
          setVoiceUnavailable(true)
          await wait(Math.max(3200, beat.text.length * 190), progress => setFrame(storyFrame(beat, progress)))
        }
      }
      if (signal.aborted) return
      setPhase('hold'); await wait(beat.holdMs, beat.text ? undefined : progress => setFrame(storyFrame(beat, progress)))
      if (signal.aborted) return
      if (index + 1 < story.beats.length) { setFrame(0); setIndex(index + 1) }
      else { setPhase('ended'); playingRef.current = false; setPlaying(false) }
    }
    void run().catch(e => { if (e.name !== 'AbortError') { setError('播放暂时中断，可以重播这一段'); playingRef.current = false; setPlaying(false) } })
    return () => controller.abort()
  }, [story, index, replay, beat])

  useEffect(() => {
    callbacks.current.onFocus(beat.assetIds[beat.layout === 'sequence' ? frame : 0])
  }, [beat, frame])

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest('input,textarea,button,select')) return
      if (event.key === 'Escape') callbacks.current.onClose()
      if (event.code === 'Space') { event.preventDefault(); if (finished) seek(0); else setPlay(!playingRef.current) }
    }
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  })

  const visible = beat.layout === 'compare' ? beat.assetIds : [beat.assetIds[Math.min(frame, beat.assetIds.length - 1)]]
  const noteIds = story.reflection?.assetIds || beat.assetIds
  return <section className={`story-stage tone-${story.tone}`} role="region" aria-label="回忆故事" data-beat={index} data-phase={phase} data-layout={beat.layout}>
    <header className="story-stage-header">
      <div><small>边看边讲 · {index + 1}/{story.beats.length}</small><h2>{story.title}</h2></div>
      <div className="story-controls">
        <button type="button" onClick={() => finished ? seek(0) : setPlay(!playing)} aria-label={finished ? '重播故事' : playing ? '暂停故事' : '继续故事'}>{finished ? <RotateCcw size={19} /> : playing ? <Pause size={19} /> : <Play size={19} />}</button>
        <button type="button" onClick={onClose} aria-label="收起故事"><X size={20} /></button>
      </div>
    </header>
    <div className={`story-pictures layout-${beat.layout}`} data-frames={visible.length}>
      {visible.map(id => {
        const asset = assets.find(a => a.id === id), source = story.evidence.find(p => p.id === id)
        return <figure key={id}>
          {asset?.preview ? <button type="button" onClick={() => { setPlay(false); onOpen(id) }} aria-label="查看照片详情"><img src={asset.preview} alt={asset.card?.title || '这段回忆的照片'} /></button> : <p className="story-missing">这张照片暂未加载，请稍后重播</p>}
          <figcaption><time>{source?.date || '日期未确定'}{source?.timeSource && !['exif', 'confirmed'].includes(source.timeSource) ? ' · 大致时间' : ''}</time><span>{source?.place || source?.city || ''}</span></figcaption>
        </figure>
      })}
    </div>
    <div className="story-narration" aria-live="polite">
      {phase === 'loading' ? <small>正在准备这一段声音…</small> : beat.text && phase !== 'lead' ? <p><MarkedText text={beat.text} /></p> : <span className="story-breath" aria-label="留一点时间看照片">· · ·</span>}
      {voiceUnavailable && <small className="story-audio-note">语音暂不可用，正按字幕节奏播放</small>}
    </div>
    <nav className="story-progress" aria-label="故事段落">
      <button type="button" disabled={index === 0} onClick={() => seek(index - 1)} aria-label="上一段故事"><ChevronLeft size={18} /></button>
      <div>{story.beats.map((b, i) => <button type="button" key={b.id} className={i === index ? 'on' : ''} onClick={() => seek(i)} aria-current={i === index ? 'step' : undefined} aria-label={`第 ${i + 1} 段故事${b.text ? '' : '，留白'}`}><span /></button>)}</div>
      <button type="button" disabled={index + 1 === story.beats.length} onClick={() => seek(index + 1)} aria-label="下一段故事"><ChevronRight size={18} /></button>
    </nav>
    {finished && <div className="story-afterword">
      <div className="story-after-actions"><button type="button" onClick={() => seek(0)}>再听一遍</button><button type="button" onClick={onAnother}>听另一段回忆</button></div>
      <details><summary>{story.reflection?.question || '给这几张照片补一句你记得的事（可选）'}</summary>
        <form onSubmit={async event => {
          event.preventDefault(); if (!note.trim() || saving) return
          setSaving(true); setError('')
          try { await rememberStoryNote(story.id, noteIds, note.trim()); setSaved(true); setNote(''); callbacks.current.onRemembered() }
          catch (e) { setError(e instanceof Error ? e.message : '补充保存失败') }
          finally { setSaving(false) }
        }}>
          <small>记在对应照片里，后续故事会使用这条补充。</small>
          <textarea value={note} onChange={event => setNote(event.target.value)} maxLength={500} aria-label="补充这段回忆" placeholder="当时还有什么值得记住的小事？" />
          <button type="submit" disabled={saving || !note.trim()}>{saving ? '正在记住…' : '记住这件事'}</button>
          {saved && <><span role="status">已记住</span><button type="button" onClick={() => onRetell(story.id)}>按新补充重讲</button></>}
        </form>
      </details>
    </div>}
    {error && <p className="story-error" role="alert">{error}</p>}
  </section>
}

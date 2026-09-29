import { useEffect, useRef, useState } from 'react'
import { Headphones, Keyboard, Mic, Send, VolumeX, X } from 'lucide-react'
import type { StorySummary } from '../lib/storytelling'

export type VoiceState = 'idle' | 'recording' | 'transcribing'

// One line of what was just said: the user's words as they are recognised, or the butler's answer
export interface Subtitle {
  id: string
  role: 'user' | 'assistant'
  text: string
  // Still being recognised while the button is held
  live?: boolean
  error?: boolean
}

interface Props {
  voiceState: VoiceState
  busy: boolean
  storyBusy?: boolean
  disabled: boolean
  subtitle: Subtitle | null
  speaking: boolean
  onVoiceStart: () => void
  onVoiceEnd: () => void
  onTextSubmit: (text: string) => void
  stories: StorySummary[]
  onTellStory: (id?: string) => void
  onStopSpeaking: () => void
  onDismiss: () => void
}

// 〔…〕 marks what the butler inferred rather than knows
export function MarkedText({ text }: { text: string }) {
  const parts = text.split(/(〔[^〕]*〕)/)
  return <>{parts.map((part, i) => part.startsWith('〔') && part.endsWith('〕') ? <span className="inferred" key={i} title="推断的内容，待你确认">{part.slice(1, -1)}</span> : part)}</>
}

// A #tell= link only fills the draft. Sending it still requires a deliberate user action.
const linkedDraft = () => new URLSearchParams(window.location.hash.slice(1)).get('tell')?.trim().slice(0, 500) || ''

export function VoiceButler({ voiceState, busy, storyBusy, disabled, subtitle, speaking, stories, onTellStory, onVoiceStart, onVoiceEnd, onTextSubmit, onStopSpeaking, onDismiss }: Props) {
  const holding = useRef(false)
  const [draft, setDraft] = useState(linkedDraft)
  const [typing, setTyping] = useState(() => Boolean(linkedDraft()))
  const [storyMenu, setStoryMenu] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const blocked = disabled || busy || voiceState !== 'idle'
  useEffect(() => {
    const prefill = () => { const text = linkedDraft(); if (text) { setDraft(text); setTyping(true) } }
    window.addEventListener('hashchange', prefill)
    return () => window.removeEventListener('hashchange', prefill)
  }, [])
  useEffect(() => { if (typing && !blocked) input.current?.focus() }, [typing, blocked])
  const release = () => { if (holding.current) { holding.current = false; onVoiceEnd() } }
  const waiting = storyBusy ? '正在选片、组织讲述并核对内容，首次生成需要一些时间…' : '正在回想…'
  const hint = voiceState === 'recording' ? '正在听，松开发送' : voiceState === 'transcribing' ? '正在识别…' : busy ? waiting : disabled ? '接入 StepFun 后可以和我说话' : '按住说话'

  return (
    <div className="voice-butler" aria-label="人生管家">
      {storyMenu && <div className="butler-story-menu" aria-label="听回忆故事">
        <header><b>听一段回忆</b><button type="button" onClick={() => setStoryMenu(false)} aria-label="收起故事选择"><X size={16} /></button></header>
        <button type="button" disabled={blocked} onClick={() => { setStoryMenu(false); onTellStory() }}>自动挑选，讲一段新故事</button>
        {stories.slice(0, 4).map(story => <button type="button" key={story.id} disabled={blocked} onClick={() => { setStoryMenu(false); onTellStory(story.id) }}>{story.title}<small>再听这段</small></button>)}
      </div>}
      {subtitle && (
        <div className={`subtitle ${subtitle.role === 'user' ? 'me' : 'bot'}${subtitle.live ? ' live' : ''}${subtitle.error ? ' error' : ''}`} role="status" aria-live="polite">
          {subtitle.role === 'user' ? <Mic size={16} aria-label="你说" /> : <span className="subtitle-avatar" aria-hidden="true">管</span>}
          <p><MarkedText text={subtitle.text || (subtitle.live ? '正在听' : '')} />{subtitle.live && <span className="subtitle-live" aria-label="正在识别">…</span>}</p>
          {subtitle.role === 'assistant' && speaking && <button type="button" onClick={onStopSpeaking} aria-label="停止朗读"><VolumeX size={15} /></button>}
          {!subtitle.live && <button type="button" onClick={onDismiss} aria-label="收起字幕"><X size={15} /></button>}
        </div>
      )}
      {busy && !subtitle?.live && voiceState === 'idle' && <div className="subtitle bot pending" role="status"><span className="subtitle-avatar" aria-hidden="true">管</span><p>{waiting}</p></div>}
      {typing ? <form className="butler-text-entry" aria-label="文字询问人生管家" onSubmit={(event) => {
        event.preventDefault()
        const text = draft.trim()
        if (!text || blocked) return
        if (linkedDraft()) window.history.replaceState(null, '', window.location.pathname + window.location.search)
        setDraft('')
        onTextSubmit(text)
      }}>
        <button type="button" className="butler-text-close" onClick={() => setTyping(false)} aria-label="收起文字输入" title="收起文字输入"><X size={18} /></button>
        <input ref={input} value={draft} onChange={(event) => setDraft(event.target.value)} disabled={blocked} maxLength={500} aria-label="想回忆什么" placeholder="边看照片，边讲讲这段回忆…" enterKeyHint="send" onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault()
          if (event.key === 'Escape') setTyping(false)
        }} />
        <button type="submit" className="butler-text-send" disabled={blocked || !draft.trim()} aria-label="发送给人生管家" title="发送"><Send size={19} /></button>
      </form> : <div className="butler-input-controls"><button type="button" className="butler-type" disabled={blocked} onClick={() => setStoryMenu(value => !value)} aria-label="听回忆故事" aria-expanded={storyMenu}><Headphones size={19} /><span>听故事</span></button><button
        type="button"
        className={`hold ${voiceState}`}
        disabled={disabled || busy || voiceState === 'transcribing'}
        aria-label={hint}
        title={hint}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); holding.current = true; onVoiceStart() }}
        onPointerUp={release}
        onPointerCancel={release}
        onContextMenu={(e) => e.preventDefault()}
      >
        <Mic size={26} />
      </button><button type="button" className="butler-type" disabled={voiceState !== 'idle'} onClick={() => setTyping(true)} aria-label="打字和管家说话" title="无需麦克风，打字讲回忆"><Keyboard size={19} /><span>打字</span></button></div>}
      <small className="hold-hint">{typing ? disabled ? '接入 StepFun 后可以发送' : busy ? '正在回想…' : '回车发送 · 可以说「边看照片边讲故事」' : hint}</small>
    </div>
  )
}

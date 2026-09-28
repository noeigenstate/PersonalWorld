import { useRef } from 'react'
import { Mic, VolumeX, X } from 'lucide-react'

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
  disabled: boolean
  subtitle: Subtitle | null
  speaking: boolean
  onVoiceStart: () => void
  onVoiceEnd: () => void
  onStopSpeaking: () => void
  onDismiss: () => void
}

// 〔…〕 marks what the butler inferred rather than knows
export function MarkedText({ text }: { text: string }) {
  const parts = text.split(/(〔[^〕]*〕)/)
  return <>{parts.map((part, i) => part.startsWith('〔') && part.endsWith('〕') ? <span className="inferred" key={i} title="推断的内容，待你确认">{part.slice(1, -1)}</span> : part)}</>
}

// The life butler has no chat window: a microphone over the map, and subtitles above it while
// someone speaks or the butler answers. Everything else it does happens on the map itself.
export function VoiceButler({ voiceState, busy, disabled, subtitle, speaking, onVoiceStart, onVoiceEnd, onStopSpeaking, onDismiss }: Props) {
  const holding = useRef(false)
  const release = () => { if (holding.current) { holding.current = false; onVoiceEnd() } }
  const hint = voiceState === 'recording' ? '正在听，松开发送' : voiceState === 'transcribing' ? '正在识别…' : busy ? '正在回想…' : disabled ? '接入 StepFun 后可以和我说话' : '按住说话'

  return (
    <div className="voice-butler" aria-label="人生管家">
      {subtitle && (
        <div className={`subtitle ${subtitle.role === 'user' ? 'me' : 'bot'}${subtitle.live ? ' live' : ''}${subtitle.error ? ' error' : ''}`} role="status" aria-live="polite">
          {subtitle.role === 'user' ? <Mic size={16} aria-label="你说" /> : <span className="subtitle-avatar" aria-hidden="true">管</span>}
          <p><MarkedText text={subtitle.text || (subtitle.live ? '正在听' : '')} />{subtitle.live && <span className="subtitle-live" aria-label="正在识别">…</span>}</p>
          {subtitle.role === 'assistant' && speaking && <button type="button" onClick={onStopSpeaking} aria-label="停止朗读"><VolumeX size={15} /></button>}
          {!subtitle.live && <button type="button" onClick={onDismiss} aria-label="收起字幕"><X size={15} /></button>}
        </div>
      )}
      {busy && !subtitle?.live && voiceState === 'idle' && <div className="subtitle bot pending" role="status"><span className="subtitle-avatar" aria-hidden="true">管</span><p>正在回想…</p></div>}
      <button
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
      </button>
      <small className="hold-hint">{hint}</small>
    </div>
  )
}

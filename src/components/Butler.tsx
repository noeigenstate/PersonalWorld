import { useEffect, useRef, useState } from 'react'
import { Keyboard, Mic, Send, Volume2, X } from 'lucide-react'
import type { MemoryAsset, MemoryEvent, PlaceRole } from '../types'
import { AssetImage } from './EventDetail'

export interface ButlerMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  eventIds?: string[]
  voice?: boolean
  error?: boolean
  // Ask the user which kind of life base this city is
  roleFor?: string
}

export type VoiceState = 'idle' | 'recording' | 'transcribing'

interface Props {
  messages: ButlerMessage[]
  busy: boolean
  voiceState: VoiceState
  focusLabel: string
  events: MemoryEvent[]
  assets: MemoryAsset[]
  speakingId: string | null
  onAsk: (text: string) => void
  onVoiceStart: () => void
  onVoiceEnd: () => void
  onSpeak: (message: ButlerMessage) => void
  onConfirmRole: (city: string, role: PlaceRole) => void
  onOpenEvent: (id: string) => void
  onClose: () => void
}

const roleChoices: [PlaceRole, string][] = [['home', '老家'], ['study', '求学'], ['work', '工作'], ['residence', '居住']]

// 〔…〕 marks what the butler inferred rather than knows
function MarkedText({ text }: { text: string }) {
  const parts = text.split(/(〔[^〕]*〕)/)
  return <>{parts.map((part, i) => part.startsWith('〔') && part.endsWith('〕') ? <span className="inferred" key={i} title="推断的内容，待你确认">{part.slice(1, -1)}</span> : part)}</>
}

export function Butler({ messages, busy, voiceState, focusLabel, events, assets, speakingId, onAsk, onVoiceStart, onVoiceEnd, onSpeak, onConfirmRole, onOpenEvent, onClose }: Props) {
  const [typing, setTyping] = useState(false)
  const [draft, setDraft] = useState('')
  const list = useRef<HTMLDivElement>(null)
  const holding = useRef(false)

  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }) }, [messages, busy])

  const release = () => { if (holding.current) { holding.current = false; onVoiceEnd() } }

  return (
    <aside className="butler" aria-label="人生管家">
      <div className="butler-head">
        <div className="avatar" aria-hidden="true">管</div>
        <div><b>人生管家</b><small>{focusLabel}</small></div>
        <button className="icon-button" onClick={onClose} aria-label="关闭人生管家"><X size={19} /></button>
      </div>

      <div className="msgs" ref={list}>
        {messages.map((message) => {
          if (message.role === 'user') {
            return (
              <div className="bubble me" key={message.id}>
                {message.voice && <span className="voice-tag"><Mic size={13} />语音</span>}
                {message.text}
              </div>
            )
          }
          const cited = (message.eventIds || []).map((id) => events.find((e) => e.id === id)).filter((e): e is MemoryEvent => Boolean(e))
          const photos = cited.flatMap((e) => e.assetIds).map((id) => assets.find((a) => a.id === id)).filter((a): a is MemoryAsset => Boolean(a?.preview)).slice(0, 3)
          const photoCount = cited.reduce((sum, e) => sum + e.assetIds.length, 0)
          return (
            <div className={`bubble bot ${message.error ? 'error' : ''}`} key={message.id}>
              <MarkedText text={message.text} />
              {photos.length > 0 && (
                <div className="thumbs">
                  {photos.map((asset) => {
                    const owner = cited.find((e) => e.assetIds.includes(asset.id))!
                    return <button key={asset.id} onClick={() => onOpenEvent(owner.id)} aria-label={`查看事件：${owner.title}`}><AssetImage asset={asset} /></button>
                  })}
                </div>
              )}
              {message.roleFor && (
                <div className="role-choices">
                  {roleChoices.map(([role, label]) => <button key={role} onClick={() => onConfirmRole(message.roleFor!, role)}>{label}</button>)}
                </div>
              )}
              <div className="bubble-foot">
                {cited.length > 0 && <span className="basis">依据：{cited.length} 个事件 · {photoCount} 张照片</span>}
                {!message.error && !message.roleFor && (
                  <button className={`speak ${speakingId === message.id ? 'on' : ''}`} onClick={() => onSpeak(message)} aria-label={speakingId === message.id ? '停止朗读' : '朗读回答'}><Volume2 size={15} /></button>
                )}
              </div>
            </div>
          )
        })}
        {busy && <div className="bubble bot pending">正在回想…</div>}
      </div>

      {typing ? (
        <form className="composer" onSubmit={(event) => { event.preventDefault(); if (draft.trim() && !busy) { onAsk(draft.trim()); setDraft('') } }}>
          <button type="button" className="kbd" onClick={() => setTyping(false)} aria-label="切换到语音输入"><Mic size={18} /></button>
          <input id="butler-input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="问问那时候发生了什么" aria-label="输入问题" autoFocus />
          <button type="submit" className="send" disabled={!draft.trim() || busy} aria-label="发送"><Send size={18} /></button>
        </form>
      ) : (
        <div className="composer">
          <button type="button" className="kbd" onClick={() => setTyping(true)} aria-label="切换到键盘输入"><Keyboard size={18} /></button>
          <button
            type="button"
            className={`hold ${voiceState}`}
            disabled={busy || voiceState === 'transcribing'}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); holding.current = true; onVoiceStart() }}
            onPointerUp={release}
            onPointerCancel={release}
            onContextMenu={(e) => e.preventDefault()}
          >
            <Mic size={20} />
            {voiceState === 'recording' ? '正在听，松开发送' : voiceState === 'transcribing' ? '正在识别…' : '按住说话'}
          </button>
        </div>
      )}
    </aside>
  )
}

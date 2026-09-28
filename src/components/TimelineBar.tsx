import type { MemoryEvent, Place } from '../types'
import { cityLabel, formatYearMonth, roleLabels } from '../lib/memory'
import { timeTicks } from '../lib/timeTicks'

const time = (value: string) => new Date(value).getTime()

interface Props {
  events: MemoryEvent[]
  bases: Place[]
  storyIds: Set<string>
  selectedCity: string | null
  highlightedEventId: string | null
  onOpenEvent: (id: string) => void
  scrubAt: number | null
  onScrub: (at: number) => void
}

export function TimelineBar({ events, bases, storyIds, selectedCity, highlightedEventId, onOpenEvent, scrubAt, onScrub }: Props) {
  if (!events.length) return null
  const start = Math.min(...events.map((e) => time(e.occurredAt)))
  const end = Math.max(...events.map((e) => time(e.endedAt || e.occurredAt)), start + 86400000)
  const pad = (end - start) * 0.02
  const from = start - pad
  const span = end + pad - from
  const pct = (value: number) => ((value - from) / span) * 100
  const ticks = timeTicks(from, end + pad)
  const range = formatYearMonth(new Date(start).toISOString()) === formatYearMonth(new Date(end).toISOString()) ? formatYearMonth(new Date(start).toISOString()) : `${formatYearMonth(new Date(start).toISOString())} – ${formatYearMonth(new Date(end).toISOString())}`
  const highlighted = events.find((e) => e.id === highlightedEventId)
  const scrubDate = scrubAt === null ? '' : new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' }).format(scrubAt)
  const focus = scrubAt !== null ? `${scrubDate}${highlighted ? ` · ${highlighted.title}` : ''}` : highlighted
    ? `${formatYearMonth(highlighted.occurredAt)} · ${highlighted.title}`
    : selectedCity ? `${cityLabel(selectedCity)}的 ${storyIds.size} 件事` : `${range} · ${events.length} 件事`
  const progress = Math.max(0, Math.min(100, pct(scrubAt ?? end)))

  return (
    <section className="timebar" aria-label="时间线">
      <div className="timebar-head"><b>时间线</b><span>{focus}</span></div>
      <div className="track">
        <div className="timebar-rail" />
        <div className="timebar-progress" style={{ width: `${progress}%` }} />
        <input
          className="time-scrubber"
          type="range"
          min="0"
          max="1000"
          value={Math.round(progress * 10)}
          aria-label="拖动时间进度条"
          aria-valuetext={scrubAt === null ? `最新时间 ${range}` : scrubDate}
          onChange={(event) => onScrub(from + Number(event.target.value) / 1000 * span)}
        />
        {bases.map((base, index) => {
          const left = pct(Math.max(from, time(base.firstAt)))
          const next = bases[index + 1]
          const right = pct(next ? time(next.firstAt) : end + pad)
          const on = selectedCity === base.city
          return (
            <div key={base.city}>
              <span className={`band-name ${on ? 'on' : ''}`} style={{ left: `${(left + right) / 2}%` }}>{cityLabel(base.city)} · {base.roleConfirmed || base.role !== 'residence' ? roleLabels[base.role] : '生活过'}</span>
            </div>
          )
        })}
        {events.map((event) => {
          const now = event.id === highlightedEventId
          const story = storyIds.has(event.id)
          return (
            <button
              key={event.id}
              className={`dot ${now ? 'now' : story ? 'story' : ''}`}
              style={{ left: `${pct(time(event.occurredAt))}%` }}
              onClick={() => { onScrub(time(event.occurredAt)); onOpenEvent(event.id) }}
              title={`${formatYearMonth(event.occurredAt)} · ${event.title}`}
              aria-label={`${formatYearMonth(event.occurredAt)} ${event.title}`}
            />
          )
        })}
      </div>
      <div className="years">{ticks.map((tick) => <span key={tick.at} style={{ left: `${pct(tick.at)}%` }}>{tick.label}</span>)}</div>
    </section>
  )
}

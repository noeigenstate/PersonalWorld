import type { MemoryEvent, Place } from '../types'
import { cityLabel, formatYearMonth, roleLabels } from '../lib/memory'
import { timeTicks } from '../lib/timeTicks'

const roleVar: Record<string, string> = { home: 'var(--role-home)', study: 'var(--role-study)', work: 'var(--role-work)', residence: 'var(--role-residence)' }
const time = (value: string) => new Date(value).getTime()

interface Props {
  events: MemoryEvent[]
  bases: Place[]
  storyIds: Set<string>
  selectedCity: string | null
  highlightedEventId: string | null
  onOpenEvent: (id: string) => void
}

export function TimelineBar({ events, bases, storyIds, selectedCity, highlightedEventId, onOpenEvent }: Props) {
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
  const focus = highlighted
    ? `${formatYearMonth(highlighted.occurredAt)} · ${highlighted.title}`
    : selectedCity ? `${cityLabel(selectedCity)}的 ${storyIds.size} 件事` : `${range} · ${events.length} 件事`

  return (
    <section className="timebar" aria-label="时间线">
      <div className="timebar-head"><b>时间线</b><span>{focus}</span></div>
      <div className="track">
        {bases.map((base, index) => {
          const left = pct(Math.max(from, time(base.firstAt)))
          const next = bases[index + 1]
          const right = pct(next ? time(next.firstAt) : end + pad)
          const on = selectedCity === base.city
          return (
            <div key={base.city}>
              <div className={`band ${on ? 'on' : ''}`} style={{ left: `calc(${left}% + 2px)`, width: `calc(${Math.max(0, right - left)}% - 4px)`, background: roleVar[base.role] }} />
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
              onClick={() => onOpenEvent(event.id)}
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

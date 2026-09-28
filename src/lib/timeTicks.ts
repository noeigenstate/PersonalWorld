// Labels under the time bar. The unit follows the span shown: years for a life, months for a
// season, days for a trip, so a few weeks of photos still get dates instead of an empty axis.

export interface Tick { at: number; label: string }

const DAY = 86400000
const MAX = 9

export function timeTicks(from: number, to: number): Tick[] {
  const span = to - from
  const ticks: Tick[] = []
  if (span >= 3 * 365 * DAY) {
    const first = new Date(from).getFullYear() + 1, last = new Date(to).getFullYear()
    const step = Math.max(1, Math.ceil((last - first + 1) / MAX))
    for (let y = first; y <= last; y += step) ticks.push({ at: new Date(y, 0, 1).getTime(), label: String(y) })
    return ticks
  }
  if (span >= 60 * DAY) {
    const start = new Date(from)
    let month = start.getFullYear() * 12 + start.getMonth() + 1
    const lastMonth = new Date(to).getFullYear() * 12 + new Date(to).getMonth()
    const step = Math.max(1, Math.ceil((lastMonth - month + 1) / MAX))
    for (; month <= lastMonth; month += step) {
      const y = Math.floor(month / 12), m = month % 12
      ticks.push({ at: new Date(y, m, 1).getTime(), label: `${y}.${String(m + 1).padStart(2, '0')}` })
    }
    return ticks
  }
  // Days: whole local days inside the range, spaced to at most MAX labels; month shown when it changes
  const first = new Date(from)
  const day = new Date(first.getFullYear(), first.getMonth(), first.getDate() + 1)
  const days = Math.max(1, Math.floor((to - day.getTime()) / DAY) + 1)
  const step = Math.max(1, Math.ceil(days / MAX))
  let lastMonth = -1
  for (let d = new Date(day); d.getTime() <= to; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + step)) {
    const label = d.getMonth() !== lastMonth ? `${d.getMonth() + 1}月${d.getDate()}日` : `${d.getDate()}日`
    lastMonth = d.getMonth()
    ticks.push({ at: d.getTime(), label })
  }
  return ticks
}

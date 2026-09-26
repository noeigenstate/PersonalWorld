import { createHash } from 'node:crypto'
import { chat, parseJsonAnswer } from './stepfun.mjs'
import { loadSkill } from './skills.mjs'

export const FILM_VERSION = 'memory-film-4'
const clean = (v, length) => String(v || '').replace(/[\x00-\x1f]/g, ' ').trim().slice(0, length)

export function readFilmSources(input) {
  const seen = new Set()
  return (Array.isArray(input) ? input : []).slice(0, 80).flatMap((v) => {
    const id = clean(v?.id, 100)
    if (!/^[\w-]+$/.test(id) || seen.has(id)) return []
    seen.add(id)
    const date = /^\d{4}-\d{2}-\d{2}$/.test(v.date) && Number.isFinite(Date.parse(v.date)) ? v.date : ''
    return [{ id, date, observed: clean(v.observed, 320), confirmed: clean(v.confirmed, 220), place: clean(v.place, 60), tags: Array.isArray(v.tags) ? v.tags.slice(0, 6).map((t) => clean(t, 20)) : [] }]
  }).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
}

export const filmFingerprint = (sources) => createHash('sha256').update(FILM_VERSION + JSON.stringify(sources)).digest('hex')

function sampled(sources, max = 10) {
  const n = Math.min(sources.length, max)
  return Array.from({ length: n }, (_, i) => sources[Math.round(i * (sources.length - 1) / (n - 1))])
}

// Rules provide an honest usable edit if the model is unavailable; never pretend
// the fallback involved semantic selection or a verified identity across visits.
export function fallbackFilm(sources) {
  const days = new Set(sources.map((s) => s.date).filter(Boolean))
  return {
    kind: days.size > 1 ? 'season' : 'outing', title: '把这些小日子留住', closing: '平常的小事，也值得记住',
    reason: '按可靠日期均匀选取已有照片，保留这段时间的片段。',
    shots: sampled(sources).map((s) => ({ assetId: s.id, caption: '', seconds: 4.5, evidence: '已有照片与拍摄日期' })),
  }
}

export function validateFilmPlan(answer, sources) {
  const known = new Map(sources.map((s) => [s.id, s]))
  const seen = new Set()
  const text = (value, max, source) => {
    const result = clean(value, max)
    // Strong personal claims need user-confirmed evidence, never only AI guesses.
    const claims = result.match(/第一次[^，。！!?？]{0,12}|\d+\s*岁|[一二三四五六七八九十]+岁|生日|女儿|儿子|妈妈|爸爸|母亲|父亲|父女|母女|父子|母子|奶奶|爷爷|外婆|外公|姥姥|姥爷|祖孙|长辈|最爱|爱吃|长高|长大/g) || []
    const facts = source ? `${source.confirmed} ${source.story || ''}` : chosen.map((s) => `${s.confirmed} ${s.story || ''}`).join(' ')
    return claims.some((claim) => !facts.includes(claim)) ? '' : result
  }
  const shots = (Array.isArray(answer?.shots) ? answer.shots : []).slice(0, 12).flatMap((shot) => {
    const source = known.get(shot?.assetId)
    if (!source || seen.has(source.id)) return []
    seen.add(source.id)
    return [{ assetId: source.id, caption: text(shot.caption, 28, source), seconds: Math.min(5, Math.max(3.5, Number(shot.seconds) || 4.5)), evidence: clean(shot.evidence, 180), date: source.date }]
  })
  const minimum = Math.min(6, sources.length)
  if (minimum < 2 || shots.length < minimum) throw new Error(`剪辑方案需要至少 ${Math.max(2, minimum)} 张不同的已有照片`)
  const order = new Map(sources.map((s, i) => [s.id, i]))
  shots.sort((a, b) => order.get(a.assetId) - order.get(b.assetId))
  const dates = new Set(shots.map((s) => s.date).filter(Boolean))
  const kind = dates.size <= 1 ? 'outing' : answer.kind === 'revisit' ? 'revisit' : 'season'
  const chosen = shots.map((shot) => known.get(shot.assetId))
  return { kind, title: text(answer.title, 22) || '把这些小日子留住', closing: text(answer.closing, 28) || '平常的小事，也值得记住', reason: clean(answer.reason, 240), shots }
}

export async function planFilm(config, sources) {
  try {
    const messages = [
      { role: 'system', content: loadSkill('memory-film') },
      { role: 'user', content: JSON.stringify({ sources }) },
    ]
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await chat(config, messages, { json: true })
      try { return { plan: validateFilmPlan(parseJsonAnswer(raw), sources), planner: 'stepfun' } }
      catch (error) {
        if (attempt) throw error
        // One bounded structural repair, not repeated image calls. The validator
        // remains authoritative; the second invalid response uses the fallback.
        messages.push({ role: 'assistant', content: raw }, { role: 'user', content: `方案校验未通过：${clean(error.message, 160)}。输入共 ${sources.length} 张；少于 6 张时使用全部真实 ID，6 张以上选 6–12 张。请修正并只返回完整 JSON。` })
      }
    }
    throw new Error('剪辑方案未完成')
  } catch (error) {
    return { plan: validateFilmPlan(fallbackFilm(sources), sources), planner: 'local', warning: `智能编排暂不可用，已按日期生成基础剪辑。${clean(error.message, 120)}` }
  }
}

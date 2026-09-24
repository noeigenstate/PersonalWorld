// Cross-photo inference: builds the request for the photo-context skill and reads its answer.
// Shared by the API route and the skill's eval so both exercise exactly the same logic.

const str = (v, max = 80) => String(v ?? '').slice(0, max)
const clamp = (v) => (typeof v === 'number' ? Math.max(0, Math.min(1, v)) : 0.5)
const RELATIONS = ['同一场景', '同一地点', '同一事件', '无关']

function describe(known = {}) {
  return [
    known.city ? `城市：${str(known.city, 20)}（来源：${str(known.citySource || '未知', 10)}）` : '城市：未知',
    known.place ? `地点：${str(known.place, 40)}` : '',
    known.time ? `时间：${str(known.time, 30)}（来源：${str(known.timeSource || '未知', 10)}）` : '',
    known.title ? `信息卡：${str(known.title, 20)}；${str(known.scene, 80)}` : '',
  ].filter(Boolean).join('；')
}

export function contextMessages({ system, target, refs, consented }) {
  const lines = [
    `目标照片（第 1 张图）：${describe(target.known)}`,
    ...refs.map((r, i) => `R${i + 1}（第 ${i + 2} 张图）：${describe(r.known)}`),
    `隐私声明：${consented ? '用户已同意' : '用户未同意'}`,
  ]
  return [
    { role: 'system', content: system },
    { role: 'user', content: [
      { type: 'text', text: `对比目标照片和参考照片，补全目标照片的信息。\n${lines.join('\n')}` },
      { type: 'image_url', image_url: { url: target.dataUrl } },
      ...refs.map((r) => ({ type: 'image_url', image_url: { url: r.dataUrl } })),
    ] },
  ]
}

// R1…Rn back to photo ids; "landmark" stays as is
export function readContext(answer, refs) {
  const idOf = (label) => (String(label) === 'landmark' ? 'landmark' : refs[Number(String(label).replace(/\D/g, '')) - 1]?.id)
  const matches = (Array.isArray(answer.matches) ? answer.matches : [])
    .map((m) => ({ refId: idOf(m?.ref), relation: RELATIONS.includes(m?.relation) ? m.relation : '无关', evidence: str(m?.evidence, 120), confidence: clamp(m?.confidence) }))
    .filter((m) => m.refId && m.refId !== 'landmark')
  const fill = (f) => {
    if (!f || typeof f !== 'object' || !str(f.value)) return null
    const fromRefIds = (Array.isArray(f.fromRefs) ? f.fromRefs : []).map(idOf).filter(Boolean)
    return fromRefIds.length ? { value: str(f.value, 40), fromRefIds, reason: str(f.reason, 120), confidence: clamp(f.confidence) } : null
  }
  const fills = answer.fills && typeof answer.fills === 'object' ? answer.fills : {}
  return {
    matches,
    fills: { city: fill(fills.city), place: fill(fills.place), time: fill(fills.time), event: fill(fills.event) },
    conflicts: (Array.isArray(answer.conflicts) ? answer.conflicts : []).filter((c) => typeof c === 'string').slice(0, 3),
  }
}

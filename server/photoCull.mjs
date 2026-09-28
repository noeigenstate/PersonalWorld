// Choosing the best photos of a stack: builds the request for the photo-cull skill and reads its answer.
// Shared by the API route and the skill's eval so both exercise exactly the same logic.

const str = (v, max = 60) => String(v ?? '').slice(0, max)
export const MAX_PHOTOS = 12

export function cullMessages({ system, photos, keep }) {
  const lines = photos.map((p, i) => `P${i + 1}（第 ${i + 1} 张图）：${p.time ? `拍摄于 ${str(p.time, 20)}` : '拍摄时间未知'}${Number.isFinite(p.sharpness) ? `；清晰度 ${Math.round(p.sharpness)}` : ''}`)
  return [
    { role: 'system', content: system },
    { role: 'user', content: [
      { type: 'text', text: `这 ${photos.length} 张照片构图相似，请逐张检查并推荐保留。建议保留张数：${keep}。\n${lines.join('\n')}` },
      ...photos.map((p) => ({ type: 'image_url', image_url: { url: p.dataUrl } })),
    ] },
  ]
}

// P1…Pn back to photo ids; photos the model skipped get no review rather than a guessed one
export function readCull(answer, photos) {
  const idOf = (ref) => photos[Number(String(ref).replace(/\D/g, '')) - 1]?.id
  const reviews = {}
  for (const item of Array.isArray(answer?.photos) ? answer.photos : []) {
    const id = idOf(item?.ref)
    if (!id || reviews[id]) continue
    const score = Number(item.score)
    reviews[id] = {
      eyesClosed: item.eyesClosed === true,
      blurry: item.blurry === true,
      issues: (Array.isArray(item.issues) ? item.issues : []).filter((v) => typeof v === 'string' && v.trim()).map((v) => str(v.trim(), 12)).slice(0, 4),
      score: Number.isFinite(score) ? Math.max(0, Math.min(10, score)) : 5,
      note: str(item.note, 60),
    }
  }
  const keep = [...new Set((Array.isArray(answer?.keep) ? answer.keep : []).map(idOf).filter(Boolean))]
  return { reviews, keep, summary: str(answer?.summary, 80) }
}

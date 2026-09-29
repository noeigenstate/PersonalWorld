// 4D spacetime scenes: one place seen at different times. Two parts:
//   1. the spacetime-scene skill's request and answer (which time slices exist, which photo
//      reconstructs each, what each layer can say and on what evidence) — skills/spacetime-scene
//   2. the relief reconstruction of one photo on this computer: ComfyUI's Depth Anything 3 nodes
//      turn the picture into a textured mesh (GLB) that can be looked around, saved per account
// Shared by the API routes and the skill's test so both exercise the same logic.

const str = (v, max = 60) => String(v ?? '').slice(0, max)
const DATE = /^\d{4}-\d{2}-\d{2}$/
export const MAX_PHOTOS = 40
// Bump when the reconstruction changes: models saved under an older version are rebuilt on demand
export const RELIEF_VERSION = 2
export const EVIDENCE = ['observed', 'inferred', 'unknown']
export const LAYERS = ['season', 'timeOfDay', 'weather', 'sound', 'traffic']

export function sceneMessages({ system, place, photos }) {
  const lines = photos.map((p, i) => [
    `P${i + 1}：${p.date ? `拍摄于 ${p.date}` : '日期不可靠'}`,
    `画面：${str(p.scene, 200) || '（无信息卡）'}`,
    p.tags?.length ? `标签：${p.tags.slice(0, 6).map((t) => str(t, 12)).join('、')}` : '',
    p.event ? `事件：${str(p.event, 60)}${p.confirmed ? '（已确认）' : ''}` : '',
  ].filter(Boolean).join('；'))
  return [
    { role: 'system', content: system },
    { role: 'user', content: `地点：${str(place, 80) || '未命名'}\n共 ${photos.length} 张照片：\n${lines.join('\n')}` },
  ]
}

function layer(raw) {
  const evidence = EVIDENCE.includes(raw?.evidence) ? raw.evidence : 'unknown'
  const value = evidence === 'unknown' ? null : str(raw?.value, 40) || null
  return { value, evidence: value ? evidence : 'unknown', basis: value ? str(raw?.basis, 80) : '' }
}

// P numbers back to photo ids; every photo in at most one epoch; layers always complete, with
// "unknown" wherever the model gave no usable evidence. Undated photos come from the input,
// not from the model: they can never be in an epoch.
export function readScenePlan(answer, photos) {
  const idOf = (ref) => photos[Number(String(ref).replace(/\D/g, '')) - 1]?.id
  const dated = new Map(photos.filter((p) => DATE.test(p.date || '')).map((p) => [p.id, p.date]))
  const used = new Set()
  const epochs = []
  for (const raw of Array.isArray(answer?.epochs) ? answer.epochs : []) {
    const photoIds = [...new Set((Array.isArray(raw?.photoRefs) ? raw.photoRefs : []).map(idOf).filter((id) => id && dated.has(id) && !used.has(id)))]
    if (!photoIds.length) continue
    photoIds.forEach((id) => used.add(id))
    const dates = photoIds.map((id) => dated.get(id)).sort()
    const keyPhoto = idOf(raw.keyPhoto)
    const layers = Object.fromEntries(LAYERS.map((name) => [name, layer(raw.layers?.[name])]))
    layers.sound = { value: null, evidence: 'unknown', basis: '' } // photos carry no sound
    layers.buildings = (Array.isArray(raw.layers?.buildings) ? raw.layers.buildings : []).slice(0, 8)
      .map((b) => ({ name: str(b?.name, 40), state: str(b?.state, 40), ...layer({ value: str(b?.state, 40) || '—', evidence: b?.evidence, basis: b?.basis }) }))
      .filter((b) => b.name).map(({ value: _value, ...b }) => b)
    epochs.push({
      id: `epoch-${dates[0]}-${photoIds[0]}`,
      from: DATE.test(raw.from || '') && raw.from >= dates[0] && raw.from <= dates.at(-1) ? raw.from : dates[0],
      to: DATE.test(raw.to || '') && raw.to >= dates[0] && raw.to <= dates.at(-1) ? raw.to : dates.at(-1),
      title: str(raw.title, 40),
      photoIds,
      keyPhoto: keyPhoto && photoIds.includes(keyPhoto) ? keyPhoto : null,
      layers,
      changes: str(raw.changes, 160),
      caption: str(raw.caption, 120),
    })
  }
  epochs.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
  return {
    place: str(answer?.place, 80),
    epochs,
    undated: photos.filter((p) => !dated.has(p.id)).map((p) => p.id),
    summary: str(answer?.summary, 160),
  }
}

// ---- Relief reconstruction on this computer (ComfyUI + Depth Anything 3) ----------------------
// Read per call so a test can point at a dead address without restarting
const comfyUrl = (options) => options?.comfy || process.env.COMFY_URL || 'http://127.0.0.1:8188'

export async function reliefCapability(options) {
  const COMFY = comfyUrl(options)
  try {
    const info = await (await fetch(`${COMFY}/object_info/LoadDA3Model`, { signal: AbortSignal.timeout(3000) })).json()
    // ComfyUI describes a combo as ['COMBO', { options }] (older builds: [options])
    const spec = info.LoadDA3Model?.input?.required?.model_name
    const options = Array.isArray(spec?.[0]) ? spec[0] : spec?.[1]?.options || []
    const model = options.find((n) => /depth.?anything|da3/i.test(n)) || options[0]
    return model ? { available: true, model } : { available: false, model: null, reason: 'ComfyUI 的 geometry_estimation 目录里没有 Depth Anything 3 模型' }
  } catch {
    return { available: false, model: null, reason: '本机的 ComfyUI 没有运行' }
  }
}

function workflow(image, model, resolution) {
  return {
    1: { class_type: 'LoadDA3Model', inputs: { model_name: model, weight_dtype: 'default' } },
    2: { class_type: 'LoadImage', inputs: { image } },
    3: { class_type: 'DA3Inference', inputs: { da3_model: ['1', 0], image: ['2', 0], resolution, resize_method: 'upper_bound_resize', mode: 'mono' } },
    // Half-resolution vertices keep a photo's mesh under a few hundred thousand triangles. The
    // default 0.04 depth-jump limit also cuts grazing ground (water, roads) into strips; 0.12 keeps
    // it, and real edges (a bridge against the far bank) still tear
    4: { class_type: 'DA3GeometryToMesh', inputs: { da3_geometry: ['3', 0], batch_index: 0, decimation: 2, discontinuity_threshold: Number(process.env.DA3_DISCONTINUITY) || 0.12, confidence_threshold: 0.1, use_sky_mask: true, texture: true } },
    5: { class_type: 'SaveGLB', inputs: { mesh: ['4', 0], filename_prefix: '3d/personal-world-scene' } },
  }
}

/** A photo (JPEG/PNG bytes) → a textured relief mesh (GLB bytes). Takes 5–30 s on the GPU. */
export async function reconstructRelief(bytes, { name = 'photo.jpg', resolution = 1008, timeoutMs = 180_000, comfy } = {}) {
  const COMFY = comfyUrl({ comfy })
  const capability = await reliefCapability({ comfy })
  if (!capability.available) throw new Error(capability.reason)
  const form = new FormData()
  form.append('image', new Blob([bytes], { type: 'image/jpeg' }), name)
  form.append('overwrite', 'true')
  form.append('subfolder', 'personal-world')
  const uploaded = await (await fetch(`${COMFY}/upload/image`, { method: 'POST', body: form })).json()
  if (!uploaded.name) throw new Error('照片没有传到 ComfyUI')
  const image = uploaded.subfolder ? `${uploaded.subfolder}/${uploaded.name}` : uploaded.name
  const queued = await (await fetch(`${COMFY}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: workflow(image, capability.model, resolution) }) })).json()
  if (!queued.prompt_id) throw new Error(`ComfyUI 拒绝了重建请求：${JSON.stringify(queued.node_errors || queued.error || queued).slice(0, 200)}`)
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (Date.now() > deadline) throw new Error('三维重建超时')
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const history = await (await fetch(`${COMFY}/history/${queued.prompt_id}`)).json()
    const entry = history[queued.prompt_id]
    if (!entry) continue
    if (entry.status?.status_str === 'error') throw new Error(`三维重建失败：${JSON.stringify(entry.status.messages).slice(0, 200)}`)
    const file = Object.values(entry.outputs || {}).flatMap((o) => Object.values(o)).flat().find((f) => f && typeof f === 'object' && /[.]glb$/i.test(f.filename || ''))
    if (!file) { if (entry.status?.completed) throw new Error('ComfyUI 没有输出模型文件'); continue }
    const url = `${COMFY}/view?filename=${encodeURIComponent(file.filename)}&subfolder=${encodeURIComponent(file.subfolder || '')}&type=${file.type || 'output'}`
    return Buffer.from(await (await fetch(url)).arrayBuffer())
  }
}

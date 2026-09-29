// StepFun OpenAI-compatible API. Docs: https://platform.stepfun.com/docs/llms.txt
// Default is the Step Plan (subscription credit) endpoint; https://api.stepfun.com/v1 bills the balance.
export const STEP_PLAN_URL = 'https://api.stepfun.com/step_plan/v1'

export function stepfunConfig(env = process.env) {
  return {
    baseUrl: (env.STEPFUN_BASE_URL?.trim() || STEP_PLAN_URL).replace(/\/$/, ''),
    apiKey: env.STEPFUN_API_KEY?.trim(),
    model: env.STEPFUN_MODEL?.trim(),
    storyModel: env.STEPFUN_STORY_MODEL?.trim(),
    asrModel: env.STEPFUN_ASR_MODEL?.trim() || 'stepaudio-2.5-asr',
    ttsModel: env.STEPFUN_TTS_MODEL?.trim() || 'stepaudio-2.5-tts',
    ttsVoice: env.STEPFUN_TTS_VOICE?.trim() || 'cixingnansheng',
  }
}

function requireKey(config) {
  if (!config.apiKey || !config.model) throw new Error('请先在 .env 中填写 STEPFUN_API_KEY 和 STEPFUN_MODEL，再重启服务')
}

async function withTimeout(ms, run) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await run(controller.signal)
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('StepFun 响应超时，请稍后重试')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function failure(response) {
  const result = await response.json().catch(() => ({}))
  const detail = result?.error?.message || result?.message || `HTTP ${response.status}`
  return new Error(`StepFun 调用失败：${String(detail).slice(0, 300)}`)
}

export async function chat(config, messages, { json = false, reasoningEffort, timeoutMs = 90_000 } = {}) {
  requireKey(config)
  return withTimeout(timeoutMs, async (signal) => {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.model, messages, ...(json ? { response_format: { type: 'json_object' } } : {}), ...(['low', 'medium', 'high'].includes(reasoningEffort) ? { reasoning_effort: reasoningEffort } : {}) }),
      signal,
    })
    if (!response.ok) throw await failure(response)
    const result = await response.json()
    if (result.choices?.[0]?.finish_reason === 'length') throw new Error('StepFun 输出被截断，请缩短问题或减少照片数量')
    const content = result.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new Error('StepFun 返回结果为空')
    return content
  })
}

export function parseJsonAnswer(value) {
  const cleaned = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(cleaned)
  } catch {
    const first = cleaned.indexOf('{')
    const last = cleaned.lastIndexOf('}')
    if (first < 0 || last < first) throw new Error('StepFun 返回内容不是 JSON，请重试')
    return JSON.parse(cleaned.slice(first, last + 1))
  }
}

// Step Plan has no /audio/transcriptions: speech goes to POST /audio/asr/sse as base64 JSON and the
// transcript comes back as server-sent events (transcript.text.delta …, then transcript.text.done)
export const usesStepPlan = (config) => /\/step_plan(\/|$)/.test(config.baseUrl)

export function readAsrEvents(stream) {
  let done = '', deltas = ''
  // One event per line; trim() also drops a CR
  for (const line of stream.split(String.fromCharCode(10)).map((l) => l.trim())) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    let event
    try { event = JSON.parse(payload) } catch { continue }
    if (event.type === 'transcript.text.done' && typeof event.text === 'string') done = event.text
    else if (event.type === 'transcript.text.delta' && typeof event.delta === 'string') deltas += event.delta
    else if (event.type === 'error' || event.error) throw new Error(`StepFun 语音识别失败：${event.error?.message || event.message || '未知错误'}`)
  }
  return (done || deltas).trim()
}

// Step Plan: POST /audio/asr/sse; balance: POST /v1/audio/transcriptions, multipart (mp3/pcm/ogg/wav)
export async function transcribe(config, wav) {
  requireKey(config)
  if (usesStepPlan(config)) {
    return withTimeout(60_000, async (signal) => {
      const response = await fetch(`${config.baseUrl}/audio/asr/sse`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ audio: { data: Buffer.from(wav).toString('base64'), input: { transcription: { model: config.asrModel, language: 'zh' }, format: { type: 'wav' } } } }),
        signal,
      })
      if (!response.ok) throw await failure(response)
      return readAsrEvents(await response.text())
    })
  }
  return withTimeout(60_000, async (signal) => {
    const form = new FormData()
    form.append('model', config.asrModel)
    form.append('response_format', 'json')
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'question.wav')
    const response = await fetch(`${config.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: form,
      signal,
    })
    if (!response.ok) throw await failure(response)
    const result = await response.json()
    return typeof result.text === 'string' ? result.text.trim() : ''
  })
}

// POST /v1/audio/speech, JSON: model, input (≤1000 chars), voice → mp3 bytes
export async function speak(config, text) {
  requireKey(config)
  return withTimeout(60_000, async (signal) => {
    const response = await fetch(`${config.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.ttsModel, input: text.slice(0, 1000), voice: config.ttsVoice, response_format: 'mp3' }),
      signal,
    })
    if (!response.ok) throw await failure(response)
    return Buffer.from(await response.arrayBuffer())
  })
}

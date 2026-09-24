// StepFun OpenAI-compatible API. Docs: https://platform.stepfun.com/docs/llms.txt

export function stepfunConfig(env = process.env) {
  return {
    baseUrl: (env.STEPFUN_BASE_URL || 'https://api.stepfun.com/v1').replace(/\/$/, ''),
    apiKey: env.STEPFUN_API_KEY?.trim(),
    model: env.STEPFUN_MODEL?.trim(),
    asrModel: env.STEPFUN_ASR_MODEL?.trim() || 'stepaudio-2.5-asr',
    ttsModel: env.STEPFUN_TTS_MODEL?.trim() || 'stepaudio-2.5-tts',
    ttsVoice: env.STEPFUN_TTS_VOICE?.trim() || 'cixingnansheng',
    agentUrl: env.STEPFUN_AGENT_API_URL?.trim(),
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

export async function chat(config, messages, { json = false } = {}) {
  requireKey(config)
  return withTimeout(90_000, async (signal) => {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.model, messages, ...(json ? { response_format: { type: 'json_object' } } : {}) }),
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

// POST /v1/audio/transcriptions, multipart: model, response_format, file (mp3/pcm/ogg/wav)
export async function transcribe(config, wav) {
  requireKey(config)
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

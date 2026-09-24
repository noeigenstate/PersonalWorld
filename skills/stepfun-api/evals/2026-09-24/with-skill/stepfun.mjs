// StepFun (阶跃星辰) API client — Node 24 native ESM, zero npm deps.
// Uses global fetch / FormData / Blob. Reads the key from STEPFUN_API_KEY.
//
// Verified against skills/stepfun-api/SKILL.md (checked live 2026-09-24).
// Base URL: https://api.stepfun.com/v1
// - Chat/vision/JSON:  POST /v1/chat/completions   model: step-3.7-flash
// - Speech to text:    POST /v1/audio/transcriptions  model: stepaudio-2.5-asr
// - Text to speech:    POST /v1/audio/speech           model: stepaudio-2.5-tts

const BASE_URL = 'https://api.stepfun.com/v1'

function apiKey() {
  const key = process.env.STEPFUN_API_KEY
  if (!key) throw new Error('STEPFUN_API_KEY is not set')
  return key
}

function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${apiKey()}`, ...extra }
}

async function withTimeout(ms, run) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await run(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

function parseJsonLoose(raw) {
  // Defensive parse: strip ```json fences, else fall back to first {..last }.
  let text = raw.trim()
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) text = fenced[1].trim()
  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(text.slice(start, end + 1))
    }
    throw new Error(`StepFun: could not parse JSON from response: ${raw.slice(0, 200)}`)
  }
}

/**
 * Ask a vision-capable StepFun chat model a question about an image and
 * require a JSON object answer.
 *
 * @param {string} question - the question / instruction for the model.
 * @param {string} imageDataUrl - base64 data URL, e.g. "data:image/jpeg;base64,...".
 * @returns {Promise<object>} parsed JSON object from the model's answer.
 */
export async function askJson(question, imageDataUrl) {
  const body = {
    model: 'step-3.7-flash',
    messages: [
      { role: 'system', content: '你是一个视觉助手。严格只输出一个 JSON 对象，不要输出其他文字或 Markdown 代码块。' },
      {
        role: 'user',
        content: [
          { type: 'text', text: question },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      },
    ],
    response_format: { type: 'json_object' },
  }

  const res = await withTimeout(60_000, (signal) =>
    fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
      signal,
    })
  )

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`StepFun chat/completions failed: ${res.status} ${errText}`)
  }

  const data = await res.json()
  const choice = data.choices?.[0]
  if (choice?.finish_reason === 'length') {
    throw new Error('StepFun chat/completions: response was truncated (finish_reason=length)')
  }
  const content = choice?.message?.content
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('StepFun chat/completions: empty response content')
  }
  return parseJsonLoose(content)
}

/**
 * Transcribe a WAV recording to text using StepFun ASR.
 *
 * @param {Buffer} wavBuffer - 16-bit PCM WAV audio bytes.
 * @returns {Promise<string>} recognized text.
 */
export async function transcribe(wavBuffer) {
  const form = new FormData()
  form.append('model', 'stepaudio-2.5-asr')
  form.append('response_format', 'json')
  form.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'audio.wav')

  const res = await withTimeout(90_000, (signal) =>
    fetch(`${BASE_URL}/audio/transcriptions`, {
      method: 'POST',
      // Do NOT set Content-Type manually — fetch adds the multipart boundary.
      headers: authHeaders(),
      body: form,
      signal,
    })
  )

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`StepFun audio/transcriptions failed: ${res.status} ${errText}`)
  }

  const data = await res.json()
  if (typeof data.text !== 'string') {
    throw new Error(`StepFun audio/transcriptions: unexpected response shape: ${JSON.stringify(data).slice(0, 200)}`)
  }
  return data.text
}

/**
 * Synthesize Chinese text to speech (mp3) using StepFun TTS.
 *
 * @param {string} text - Chinese text to speak (max ~1000 characters).
 * @returns {Promise<Buffer>} mp3 audio bytes.
 */
export async function speak(text) {
  const body = {
    model: 'stepaudio-2.5-tts',
    input: text,
    voice: 'cixingnansheng',
    response_format: 'mp3',
  }

  const res = await withTimeout(60_000, (signal) =>
    fetch(`${BASE_URL}/audio/speech`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
      signal,
    })
  )

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`StepFun audio/speech failed: ${res.status} ${errText}`)
  }

  const arrayBuffer = await res.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

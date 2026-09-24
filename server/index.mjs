import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'

loadEnv({ path: fileURLToPath(new URL('../.env', import.meta.url)) })

const port = Number(process.env.PORT ?? 8787)
const baseUrl = (process.env.STEPFUN_BASE_URL || 'https://api.stepfun.com/v1').replace(/\/$/, '')
const apiKey = process.env.STEPFUN_API_KEY?.trim()
const model = process.env.STEPFUN_MODEL?.trim()
const agentUrl = process.env.STEPFUN_AGENT_API_URL?.trim()

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readJson(req) {
  const chunks = []
  let bytes = 0
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > 22 * 1024 * 1024) throw new Error('一次请求的图片总量不能超过 20 MB')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function parseJsonAnswer(value) {
  if (typeof value !== 'string') throw new Error('StepFun 没有返回可解析的文本')
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

async function stepfun(messages, json = false) {
  if (!apiKey || !model) throw new Error('请先在 .env 中填写 STEPFUN_API_KEY 和 STEPFUN_MODEL，再重启服务')
  const endpoint = `${baseUrl}/chat/completions`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 90_000)
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, messages, ...(json ? { response_format: { type: 'json_object' } } : {}) }),
      signal: controller.signal,
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) {
      const detail = result?.error?.message || result?.message || `HTTP ${response.status}`
      throw new Error(`StepFun 调用失败：${String(detail).slice(0, 300)}`)
    }
    if (result.choices?.[0]?.finish_reason === 'length') throw new Error('StepFun 输出被截断，请减少一次分析的照片数量')
    const content = result.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new Error('StepFun 返回结果为空')
    return content
  } finally {
    clearTimeout(timer)
  }
}

const systemPrompt = `你是见岁的影像事件整理助手。你的任务是从用户提供的照片和确切元数据中重建生活事件。只把画面可见或元数据明确提供的信息当成事实，不猜测真实人名、人物关系、精确地址、疾病或私人经历。不确定的信息放在 questions，供用户确认。用简体中文，严格输出 JSON 对象，不要 Markdown。字段：title（12字内）、summary（1到2句）、type（旅行/聚会/日常/工作/庆祝/其他之一）、place（不能确定则空字符串）、people（仅已知名字，未知不要编造）、visibleText（画面中清晰可读的主要文字，最多200字；看不清则空字符串）、tags（最多4个）、questions（最多2个明确问题）、confidence（0到1，表示事件判断把握程度）。`

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url || '/', 'http://localhost').pathname
  if (req.method === 'GET' && path === '/api/config') {
    return send(res, 200, {
      available: Boolean(apiKey && model),
      mode: apiKey && model ? 'model' : agentUrl ? 'agent-needs-adapter' : 'unconfigured',
      message: apiKey && model
        ? `StepFun ${model} 已配置，连接尚未验证`
        : agentUrl
          ? '已填写 Agent 地址，仍需核对该 Agent 的 API 请求格式'
          : '未配置 StepFun API Key；本地整理仍可使用',
    })
  }
  if (req.method === 'GET' && path === '/api/health') return send(res, 200, { ok: true })
  if (req.method !== 'POST' || !['/api/analyze', '/api/chat'].includes(path)) return send(res, 404, { error: '接口不存在' })
  if (req.headers['x-memory-agent'] !== 'web') return send(res, 403, { error: '请求来源未通过校验' })

  try {
    const body = await readJson(req)
    if (path === '/api/analyze') {
      const images = Array.isArray(body.images) ? body.images.slice(0, 6) : []
      if (!images.length) return send(res, 400, { error: '请先选择至少一张可分析的图片' })
      if (images.some((item) => typeof item.dataUrl !== 'string' || !/^data:image\/(jpeg|png|webp|gif);base64,/i.test(item.dataUrl))) {
        return send(res, 400, { error: '图片格式不受支持' })
      }
      const context = images.map((item, index) => `${index + 1}. ${String(item.name || '未命名')}；拍摄时间：${String(item.capturedAt || '未知')}；坐标：${item.latitude && item.longitude ? `${item.latitude},${item.longitude}` : '未知'}`).join('\n')
      const content = [
        { type: 'text', text: `请判断这些影像属于什么事件。元数据如下：\n${context}\n\n如多张图片无法证明同一事件，应降低 confidence，并提问确认。` },
        ...images.map((item) => ({ type: 'image_url', image_url: { url: item.dataUrl } })),
      ]
      const answer = parseJsonAnswer(await stepfun([
        { role: 'system', content: systemPrompt },
        { role: 'user', content },
      ], true))
      return send(res, 200, {
        title: typeof answer.title === 'string' ? answer.title : '',
        summary: typeof answer.summary === 'string' ? answer.summary : '',
        type: typeof answer.type === 'string' ? answer.type : '其他',
        place: typeof answer.place === 'string' ? answer.place : '',
        people: Array.isArray(answer.people) ? answer.people.filter((v) => typeof v === 'string').slice(0, 8) : [],
        visibleText: typeof answer.visibleText === 'string' ? answer.visibleText.slice(0, 200) : '',
        tags: Array.isArray(answer.tags) ? answer.tags.filter((v) => typeof v === 'string').slice(0, 4) : [],
        questions: Array.isArray(answer.questions) ? answer.questions.filter((v) => typeof v === 'string').slice(0, 2) : [],
        confidence: typeof answer.confidence === 'number' ? Math.max(0, Math.min(1, answer.confidence)) : undefined,
      })
    }

    const question = String(body.question || '').trim()
    if (!question || question.length > 1000) return send(res, 400, { error: '问题不能为空，且不能超过 1000 字' })
    const events = Array.isArray(body.events) ? body.events.slice(0, 80) : []
    const memoryContext = events.map((event) => JSON.stringify({
      title: event.title,
      occurredAt: event.occurredAt,
      summary: event.summary,
      place: event.place,
      people: event.people,
      visibleText: event.visibleText,
      tags: event.tags,
      status: event.status,
    })).join('\n')
    const answer = await stepfun([
      { role: 'system', content: '你是用户的回忆检索助手。只根据提供的事件记录回答，不能补造经历、人物关系或地点。若记录不足，明确说不知道并提示需要哪些照片或确认信息。尽量简短，用简体中文。' },
      { role: 'user', content: `事件记录：\n${memoryContext || '暂无事件记录'}\n\n用户问题：${question}` },
    ])
    return send(res, 200, { answer })
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    return send(res, 500, { error: message })
  }
})

server.listen(port, '127.0.0.1', () => console.log(`见岁 API running on http://127.0.0.1:${server.address().port}`))

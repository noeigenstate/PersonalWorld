import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { amapConfig, proxyAmapService, reverseGeocode } from './amap.mjs'
import { chat, parseJsonAnswer, speak, stepfunConfig, transcribe } from './stepfun.mjs'
import { SESSION_COOKIE, createUserStore, readCookie, sessionCookie } from './users.mjs'

loadEnv({ path: fileURLToPath(new URL('../.env', import.meta.url)) })

const port = Number(process.env.PORT ?? 8787)
const stepfun = stepfunConfig()
const amap = amapConfig()
const users = createUserStore(process.env.USERS_FILE || fileURLToPath(new URL('./data/users.json', import.meta.url)))

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readBody(req, limit) {
  const chunks = []
  let bytes = 0
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > limit) throw new Error(`请求内容不能超过 ${Math.round(limit / 1024 / 1024)} MB`)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

const readJson = async (req) => JSON.parse((await readBody(req, 22 * 1024 * 1024)).toString('utf8'))
const strings = (value, max) => (Array.isArray(value) ? value.filter((v) => typeof v === 'string').slice(0, max) : [])

const analyzePrompt = `你是 Personal World 的影像事件整理助手。你的任务是从用户提供的照片和确切元数据中重建生活事件。只把画面可见或元数据明确提供的信息当成事实，不猜测真实人名、人物关系、精确地址、疾病或私人经历。不确定的信息放在 questions，供用户确认。用简体中文，严格输出 JSON 对象，不要 Markdown。字段：title（12字内）、summary（1到2句）、type（旅行/聚会/日常/工作/庆祝/其他之一）、place（具体地点，如"外滩"，不能确定则空字符串）、city（所在城市，如"上海市"；元数据已给出城市时照抄，不能确定则空字符串）、people（仅已知名字，未知不要编造）、visibleText（画面中清晰可读的主要文字，最多200字；看不清则空字符串）、tags（最多4个）、questions（最多2个明确问题）、confidence（0到1，表示事件判断把握程度）。`

const butlerPrompt = `你是用户的「人生管家」。你的记忆就是下面提供的个人世界模型：用户经历过的事件，以及这些事件发生的城市。
规则：
1. 只依据记忆回答，不补造经历、人物、关系或地点。记忆里没有的，直接说不知道，并告诉用户需要补充什么照片或信息。
2. status 为 confirmed 的事件是用户确认过的事实。其他事件的标题、地点、人物都是推断：回答中凡是来自推断的内容，用〔〕包起来，并在最后用一句话请用户确认。
3. 提到"第一次"时，只使用事件的 firsts 字段，说成"照片记录中的第一次"。不要主动提起任何"最后一次"，除非用户明确问到。
4. 如果提供了 focus，用户说的"这里""那时候"默认指 focus 的城市和时间范围。
5. 用第二人称"你"，语气温暖、简洁，像记得一切的老朋友。回答会被朗读，不超过 120 字，不用列表和 Markdown。
严格输出 JSON 对象：{"answer": "回答文字", "eventIds": ["回答中用到的事件 id，按提到的顺序"]}`

function compactEvent(event) {
  return {
    id: String(event.id || ''),
    title: String(event.title || '').slice(0, 40),
    summary: String(event.summary || '').slice(0, 200),
    type: String(event.type || ''),
    start: String(event.start || ''),
    end: String(event.end || ''),
    city: String(event.city || ''),
    place: String(event.place || ''),
    people: strings(event.people, 8),
    tags: strings(event.tags, 4),
    status: String(event.status || 'draft'),
    visibleText: String(event.visibleText || '').slice(0, 120),
    firsts: strings(event.firsts, 4),
    photoCount: Number(event.photoCount) || 0,
  }
}

const routes = {
  async 'POST /api/analyze'(body) {
    const images = Array.isArray(body.images) ? body.images.slice(0, 6) : []
    if (!images.length) return [400, { error: '请先选择至少一张可分析的图片' }]
    if (images.some((item) => typeof item.dataUrl !== 'string' || !/^data:image\/(jpeg|png|webp|gif);base64,/i.test(item.dataUrl))) {
      return [400, { error: '图片格式不受支持' }]
    }
    const known = body.context && typeof body.context === 'object' ? body.context : {}
    const context = images.map((item, index) => `${index + 1}. ${String(item.name || '未命名')}；拍摄时间：${String(item.capturedAt || '未知')}；坐标：${item.latitude && item.longitude ? `${item.latitude},${item.longitude}` : '未知'}`).join('\n')
    const place = known.city ? `\n根据坐标查到的位置：${String(known.city)} ${String(known.address || '')}` : ''
    const content = [
      { type: 'text', text: `请判断这些影像属于什么事件。元数据如下：\n${context}${place}\n\n如多张图片无法证明同一事件，应降低 confidence，并提问确认。` },
      ...images.map((item) => ({ type: 'image_url', image_url: { url: item.dataUrl } })),
    ]
    const answer = parseJsonAnswer(await chat(stepfun, [{ role: 'system', content: analyzePrompt }, { role: 'user', content }], { json: true }))
    return [200, {
      title: typeof answer.title === 'string' ? answer.title : '',
      summary: typeof answer.summary === 'string' ? answer.summary : '',
      type: typeof answer.type === 'string' ? answer.type : '其他',
      place: typeof answer.place === 'string' ? answer.place : '',
      city: typeof answer.city === 'string' ? answer.city : '',
      people: strings(answer.people, 8),
      visibleText: typeof answer.visibleText === 'string' ? answer.visibleText.slice(0, 200) : '',
      tags: strings(answer.tags, 4),
      questions: strings(answer.questions, 2),
      confidence: typeof answer.confidence === 'number' ? Math.max(0, Math.min(1, answer.confidence)) : undefined,
    }]
  },

  async 'POST /api/geocode'(body) {
    const points = (Array.isArray(body.points) ? body.points : [])
      .filter((p) => typeof p?.id === 'string' && Number.isFinite(p.lat) && Number.isFinite(p.lng))
      .slice(0, 200)
    if (!points.length) return [400, { error: '没有可识别的坐标' }]
    return [200, { results: await reverseGeocode(amap, points) }]
  },

  async 'POST /api/butler'(body) {
    const question = String(body.question || '').trim()
    if (!question || question.length > 500) return [400, { error: '问题不能为空，且不能超过 500 字' }]
    const events = (Array.isArray(body.memory?.events) ? body.memory.events : []).slice(0, 300).map(compactEvent)
    const places = (Array.isArray(body.memory?.places) ? body.memory.places : []).slice(0, 60).map((place) => ({
      city: String(place.city || ''), role: String(place.role || ''), roleConfirmed: Boolean(place.roleConfirmed),
      firstAt: String(place.firstAt || ''), lastAt: String(place.lastAt || ''), eventCount: Number(place.eventCount) || 0,
    }))
    const focus = body.focus && typeof body.focus === 'object'
      ? { city: String(body.focus.city || ''), from: String(body.focus.from || ''), to: String(body.focus.to || '') }
      : null
    const history = (Array.isArray(body.history) ? body.history : []).slice(-8)
      .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string')
      .map((m) => ({ role: m.role, content: m.content.slice(0, 600) }))
    const memory = JSON.stringify({ today: new Date().toISOString().slice(0, 10), focus, places, events })
    const answer = parseJsonAnswer(await chat(stepfun, [
      { role: 'system', content: `${butlerPrompt}\n\n记忆：${memory}` },
      ...history,
      { role: 'user', content: question },
    ], { json: true }))
    const known = new Set(events.map((event) => event.id))
    return [200, {
      answer: typeof answer.answer === 'string' ? answer.answer : '我没能整理出回答，请换个问法再试一次。',
      eventIds: strings(answer.eventIds, 12).filter((id) => known.has(id)),
    }]
  },

  async 'POST /api/tts'(body) {
    const text = String(body.text || '').replace(/[〔〕]/g, '').trim()
    if (!text) return [400, { error: '没有需要朗读的内容' }]
    return ['audio', await speak(stepfun, text)]
  },
}

async function authRoute(req, res, path) {
  const token = readCookie(req, SESSION_COOKIE)
  if (req.method === 'GET' && path === '/api/auth/me') {
    const user = users.userForToken(token)
    return user ? send(res, 200, { user: { id: user.id, username: user.username, createdAt: user.createdAt } }) : send(res, 401, { error: '请先登录' })
  }
  if (req.method !== 'POST') return send(res, 404, { error: '接口不存在' })
  if (req.headers['x-memory-agent'] !== 'web') return send(res, 403, { error: '请求来源未通过校验' })
  if (path === '/api/auth/logout') {
    users.logout(token)
    res.setHeader('Set-Cookie', sessionCookie('', 0))
    return send(res, 200, { ok: true })
  }
  const body = await readJson(req)
  const result = path === '/api/auth/register' ? await users.register(body)
    : path === '/api/auth/login' ? await users.login(body, req.socket.remoteAddress)
      : { status: 404, error: '接口不存在' }
  if (result.error) return send(res, result.status, { error: result.error })
  res.setHeader('Set-Cookie', sessionCookie(result.token, users.sessionMaxAge))
  return send(res, result.status, { user: result.user })
}

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url || '/', 'http://localhost').pathname
  try {
    if (path.startsWith('/api/auth/')) return await authRoute(req, res, path)
    // Everything below spends StepFun or AMap quota, so it needs a signed-in user
    const signedIn = () => Boolean(users.userForToken(readCookie(req, SESSION_COOKIE)))
    if (path.startsWith('/_AMapService/')) return signedIn() ? await proxyAmapService(amap, req, res) : send(res, 401, { error: '请先登录' })
    if (req.method === 'GET' && path === '/api/config') {
      const ready = Boolean(stepfun.apiKey && stepfun.model)
      return send(res, 200, {
        available: ready,
        mode: ready ? 'model' : stepfun.agentUrl ? 'agent-needs-adapter' : 'unconfigured',
        message: ready ? `StepFun ${stepfun.model} 已配置，连接尚未验证` : stepfun.agentUrl ? '已填写 Agent 地址，仍需核对该 Agent 的 API 请求格式' : '未配置 StepFun API Key；本地整理仍可使用',
        geocode: Boolean(amap.serviceKey),
        amapJsKey: amap.jsKey && amap.securityCode ? amap.jsKey : undefined,
      })
    }
    if (req.method === 'GET' && path === '/api/health') return send(res, 200, { ok: true })

    const handler = req.method === 'POST' && path === '/api/asr' ? 'asr' : routes[`${req.method} ${path}`]
    if (!handler) return send(res, 404, { error: '接口不存在' })
    if (req.headers['x-memory-agent'] !== 'web') return send(res, 403, { error: '请求来源未通过校验' })
    if (!signedIn()) return send(res, 401, { error: '登录已过期，请重新登录' })

    if (handler === 'asr') {
      const audio = await readBody(req, 10 * 1024 * 1024)
      if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF') return send(res, 400, { error: '请上传 WAV 格式的录音' })
      return send(res, 200, { text: await transcribe(stepfun, audio) })
    }
    const [status, result] = await handler(await readJson(req))
    if (status === 'audio') {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' })
      return res.end(result)
    }
    return send(res, status, result)
  } catch (error) {
    return send(res, 500, { error: error instanceof Error ? error.message : '未知错误' })
  }
})

server.listen(port, '127.0.0.1', () => console.log(`Personal World API running on http://127.0.0.1:${server.address().port}`))

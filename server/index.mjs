import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { amapConfig, proxyAmapService, reverseGeocode } from './amap.mjs'
import { chat, parseJsonAnswer, speak, stepfunConfig, transcribe } from './stepfun.mjs'
import { PRIVACY_VERSION, SESSION_COOKIE, createUserStore, publicUser, readCookie, sessionCookie } from './users.mjs'
import { loadSkill } from './skills.mjs'
import { maskDeep } from './privacy.mjs'
import { contextMessages, readContext } from './photoContext.mjs'

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
  async 'POST /api/analyze'(body, user) {
    const consented = user.privacyVersion === PRIVACY_VERSION
    const images = Array.isArray(body.images) ? body.images.slice(0, 6) : []
    if (!images.length) return [400, { error: '请先选择至少一张可分析的图片' }]
    if (images.some((item) => typeof item.dataUrl !== 'string' || !/^data:image\/(jpeg|png|webp|gif);base64,/i.test(item.dataUrl))) {
      return [400, { error: '图片格式不受支持' }]
    }
    const known = body.context && typeof body.context === 'object' ? body.context : {}
    const context = images.map((item, index) => `${index + 1}. ${String(item.name || '未命名')}；拍摄时间：${String(item.capturedAt || '未知')}；坐标：${item.latitude && item.longitude ? `${item.latitude},${item.longitude}` : '未知'}`).join('\n')
    const place = known.city ? `\n根据坐标查到的位置：${String(known.city)} ${String(known.address || '')}` : ''
    const privacy = `\n隐私声明：${consented ? '用户已同意' : '用户未同意'}`
    const content = [
      { type: 'text', text: `请判断这些影像属于什么事件。元数据如下：\n${context}${place}${privacy}\n\n如多张图片无法证明同一事件，应降低 confidence，并提问确认。` },
      ...images.map((item) => ({ type: 'image_url', image_url: { url: item.dataUrl } })),
    ]
    const answer = parseJsonAnswer(await chat(stepfun, [{ role: 'system', content: loadSkill('event-analysis') }, { role: 'user', content }], { json: true }))
    const reveal = consented ? (value) => value : maskDeep
    return [200, reveal({
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
    })]
  },

  async 'POST /api/photo-card'(body, user) {
    const consented = user.privacyVersion === PRIVACY_VERSION
    const image = body.image && typeof body.image === 'object' ? body.image : {}
    if (typeof image.dataUrl !== 'string' || !/^data:image\/(jpeg|png|webp|gif);base64,/i.test(image.dataUrl)) return [400, { error: '图片格式不受支持' }]
    const facts = body.facts && typeof body.facts === 'object' ? body.facts : {}
    const metadata = [
      `文件名：${String(facts.fileName || '未知').slice(0, 120)}`,
      `时间：${String(facts.time || '未知')}（来源：${String(facts.timeSource || '未知')}）`,
      `GPS：${facts.latitude && facts.longitude ? `${facts.latitude},${facts.longitude}` : '无'}`,
      `城市：${String(facts.city || '未知')} ${String(facts.address || '')}`.trim(),
      `尺寸：${String(facts.size || '未知')}`,
      `拍摄设备：${String(facts.device || '未知').slice(0, 60)}`,
      `隐私声明：${consented ? '用户已同意' : '用户未同意'}`,
    ].join('\n')
    const answer = parseJsonAnswer(await chat(stepfun, [
      { role: 'system', content: loadSkill('photo-card') },
      { role: 'user', content: [{ type: 'text', text: `为这张照片写信息卡。程序读出的元数据：\n${metadata}` }, { type: 'image_url', image_url: { url: image.dataUrl } }] },
    ], { json: true }))
    const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '')
    const clues = (Array.isArray(answer.clues) ? answer.clues : []).slice(0, 5).map((c) => ({
      kind: text(c?.kind, 8), evidence: text(c?.evidence, 120), inference: text(c?.inference, 120),
      confidence: typeof c?.confidence === 'number' ? Math.max(0, Math.min(1, c.confidence)) : 0.5,
    })).filter((c) => c.evidence && c.inference)
    // Numbers are shown as-is only after the user accepted the privacy statement
    const reveal = consented ? (value) => value : maskDeep
    return [200, reveal({
      title: text(answer.title, 20),
      caption: text(answer.caption, 120),
      scene: text(answer.scene, 160),
      visibleText: text(answer.visibleText, 200),
      clues,
      landmark: answer.landmark && typeof answer.landmark === 'object' && text(answer.landmark.name, 30)
        ? { name: text(answer.landmark.name, 30), city: text(answer.landmark.city, 20), confidence: typeof answer.landmark.confidence === 'number' ? Math.max(0, Math.min(1, answer.landmark.confidence)) : 0.5 }
        : null,
      eventGuess: { type: text(answer.eventGuess?.type, 10), reason: text(answer.eventGuess?.reason, 120) },
      tags: strings(answer.tags, 5),
      questions: strings(answer.questions, 2),
    })]
  },

  async 'POST /api/photo-context'(body, user) {
    const consented = user.privacyVersion === PRIVACY_VERSION
    const isImage = (v) => typeof v === 'string' && /^data:image\/(jpeg|png|webp|gif);base64,/i.test(v)
    const target = body.target && typeof body.target === 'object' ? body.target : {}
    const refs = (Array.isArray(body.refs) ? body.refs : []).filter((r) => typeof r?.id === 'string' && isImage(r.dataUrl)).slice(0, 4)
    if (!isImage(target.dataUrl)) return [400, { error: '图片格式不受支持' }]
    if (!refs.length) return [400, { error: '没有可以对比的参考照片' }]
    const answer = parseJsonAnswer(await chat(stepfun, contextMessages({ system: loadSkill('photo-context'), target, refs, consented }), { json: true }))
    const reveal = consented ? (value) => value : maskDeep
    return [200, reveal(readContext(answer, refs))]
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
      { role: 'system', content: `${loadSkill('life-butler')}\n\n记忆：${memory}` },
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
    return user ? send(res, 200, { user: publicUser(user) }) : send(res, 401, { error: '请先登录' })
  }
  if (req.method !== 'POST') return send(res, 404, { error: '接口不存在' })
  if (req.headers['x-memory-agent'] !== 'web') return send(res, 403, { error: '请求来源未通过校验' })
  if (path === '/api/auth/privacy') {
    const user = users.userForToken(token)
    if (!user) return send(res, 401, { error: '请先登录' })
    return send(res, 200, { user: users.acceptPrivacy(user.id) })
  }
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
    const currentUser = () => users.userForToken(readCookie(req, SESSION_COOKIE))
    const signedIn = () => Boolean(currentUser())
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
    const [status, result] = await handler(await readJson(req), currentUser())
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

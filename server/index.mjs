import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { config as loadEnv } from 'dotenv'
import { amapConfig, proxyAmapService, reverseGeocode } from './amap.mjs'
import { chat, parseJsonAnswer, speak, stepfunConfig, transcribe } from './stepfun.mjs'
import { createAccountVault } from './accountVault.mjs'
import { PRIVACY_VERSION, SESSION_COOKIE, createUserStore, publicUser, readCookie, sessionCookie } from './users.mjs'
import { loadSkill } from './skills.mjs'
import { maskDeep } from './privacy.mjs'
import { contextMessages, readContext } from './photoContext.mjs'
import { cardMessages, readCard } from './photoCard.mjs'
import { MAX_PHOTOS as CULL_MAX, cullMessages, readCull } from './photoCull.mjs'
import { MAX_PHOTOS as SCENE_MAX, readScenePlan, reconstructRelief, reliefCapability, sceneMessages } from './spacetimeScene.mjs'
import { mapSceneForPoint } from './mapScene.mjs'
import { cartoonTile, reloadArchives } from './cartoonTiles.mjs'
import { syncWorldData } from './worldData.mjs'
import { createFilmService } from './memoryFilms.mjs'
import { filmCapability } from './memoryFilmRender.mjs'
import { createMemoryReview } from './memoryReview.mjs'
import { createMemoryGraph } from './memoryGraph.mjs'
import { compactPhoto, compactState, pickPhotos, readActions } from './butler.mjs'
import { createStorytellingService } from './storytelling.mjs'

loadEnv({ path: fileURLToPath(new URL('../.env', import.meta.url)) })

const port = Number(process.env.PORT ?? 8787)
const stepfun = stepfunConfig()
const amap = amapConfig()
const usersFile = process.env.USERS_FILE || fileURLToPath(new URL('./data/users.json', import.meta.url))
const users = createUserStore(usersFile)
// Isolated account stores (including tests) must also have isolated media jobs.
const graph = createMemoryGraph(join(dirname(usersFile),'memory-graph'),{config:stepfun,understandingOptions:{available:process.env.STORY_UNDERSTANDING_DISABLED!=='1'&&Boolean(stepfun.apiKey&&stepfun.model)}})
const vault = createAccountVault(join(dirname(usersFile), 'accounts'))
const films = createFilmService(stepfun, { root: process.env.MEMORY_FILMS_DIR || join(dirname(usersFile), 'memory-films'), enrichSources:(user,sources)=>graph.enrich(user,sources), chapterFor:(user,id)=>graph.chapter(user,id) })
const review = createMemoryReview(join(dirname(usersFile), 'memory-review'))
const storytelling = createStorytellingService(join(dirname(usersFile), 'storytelling'), stepfun, { photoPreview: (user, id) => vault.getPreview(user, id) })

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
    // "Last time" facts the record can stand behind (src/lib/firstsLasts.ts)
    lasts: strings(event.lasts, 4),
    photoCount: Number(event.photoCount) || 0,
  }
}

// Moves between life bases, so the butler can say what came before and after a first or last time
const compactMove = (move) => ({ from: String(move.from || ''), fromRole: String(move.fromRole || ''), to: String(move.to || ''), toRole: String(move.toRole || ''), at: String(move.at || '').slice(0, 10) })

const routes = {
  async 'POST /api/map-scene'(body) {
    if (typeof body.lng !== 'number' || typeof body.lat !== 'number' || !Number.isFinite(body.lng) || !Number.isFinite(body.lat) || Math.abs(body.lng) > 180 || Math.abs(body.lat) > 85) return [400, { error: '地点坐标无效' }]
    return [200, await mapSceneForPoint(body.lng, body.lat, body.radius)]
  },
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
      { type: 'text', text: `请判断这些影像属于什么事件。元数据如下：\n${context}${place}${privacy}\n\n如多张图片无法证明同一事件，应降低 confidence，并提问确认。\n已保存的人物资料，按每张照片 ID 适用；不得把未匹配人物认作亲属：${JSON.stringify(graph.enrich(user,images.filter(i=>typeof i.id==='string').map(i=>({id:i.id}))).map(({id,people,relationships,story})=>({id,people,relationships,story})))}` },
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
    const known = typeof image.id==='string'?graph.enrich(user,[{id:image.id}])[0]:undefined
    const knowledge = known?{people:known.people,relationships:known.relationships,confirmed:known.confirmed,story:known.story}:undefined
    const answer = parseJsonAnswer(await chat(stepfun, cardMessages({ system: loadSkill('photo-card'), dataUrl: image.dataUrl, facts, consented, knowledge }), { json: true }))
    const card = readCard(answer, { consented })
    if (!card.scene.trim()) return [422, { error: '照片分析缺少画面观察，请重试；原信息卡仍保留' }]
    return [200, card]
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

  // One place at different times: the time slices and their evidence (skills/spacetime-scene)
  async 'POST /api/spacetime-scene'(body, user) {
    const photos = (Array.isArray(body.photos) ? body.photos : []).filter((p) => typeof p?.id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(p.id)).slice(0, SCENE_MAX)
      .map((p) => ({ id: p.id, date: /^\d{4}-\d{2}-\d{2}$/.test(p.date || '') ? p.date : '', scene: String(p.scene || '').slice(0, 200), tags: strings(p.tags, 6), event: String(p.event || '').slice(0, 60), confirmed: p.confirmed === true }))
    if (!photos.length) return [400, { error: '这处地点还没有可用的照片' }]
    const place = String(body.place || '').slice(0, 80)
    const answer = parseJsonAnswer(await chat(stepfun, sceneMessages({ system: loadSkill('spacetime-scene'), place, photos }), { json: true }))
    return [200, { plan: readScenePlan(answer, photos), capability: await reliefCapability(), scenes: await vault.listScenes(user) }]
  },
  // The relief mesh of one photo, reconstructed on this computer and kept with the account
  async 'POST /api/spacetime-scene/relief'(body, user) {
    const id = String(body.id || '')
    if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return [400, { error: '照片编号无效' }]
    const existing = body.force ? null : await vault.getScene(user, id)
    if (existing) return [200, { id, url: `/api/spacetime-scene/models/${id}`, bytes: existing.bytes.length, cached: true }]
    const match = /^data:image\/(jpeg|png|webp);base64,(.+)$/i.exec(String(body.dataUrl || ''))
    if (!match) return [400, { error: '需要一张 JPEG/PNG 照片' }]
    try {
      const glb = await reconstructRelief(Buffer.from(match[2], 'base64'), { name: `${id}.${match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase()}` })
      await vault.putScene(user, id, glb, { photoId: id })
      return [200, { id, url: `/api/spacetime-scene/models/${id}`, bytes: glb.length, cached: false }]
    } catch (error) {
      return [503, { error: error.message }]
    }
  },

  // Near-duplicate photos: which to keep (skills/photo-cull)
  async 'POST /api/photo-cull'(body) {
    const isImage = (v) => typeof v === 'string' && /^data:image\/(jpeg|png|webp);base64,/i.test(v)
    const photos = (Array.isArray(body.photos) ? body.photos : []).filter((p) => typeof p?.id === 'string' && isImage(p.dataUrl)).slice(0, CULL_MAX)
    if (photos.length < 2) return [400, { error: '至少需要两张相似的照片' }]
    const keep = Math.max(1, Math.min(photos.length - 1, Number(body.keep) || 1))
    const answer = parseJsonAnswer(await chat(stepfun, cullMessages({ system: loadSkill('photo-cull'), photos, keep }), { json: true }))
    return [200, readCull(answer, photos)]
  },

  async 'POST /api/geocode'(body) {
    const points = (Array.isArray(body.points) ? body.points : [])
      .filter((p) => typeof p?.id === 'string' && Number.isFinite(p.lat) && Number.isFinite(p.lng))
      .slice(0, 200)
    if (!points.length) return [400, { error: '没有可识别的坐标' }]
    return [200, { results: await reverseGeocode(amap, points) }]
  },

  async 'POST /api/butler'(body, user) {
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
    // Photo information cards (no pictures) so the butler can find photos by meaning, and what the page shows now
    const photos = pickPhotos(question, (Array.isArray(body.memory?.photos) ? body.memory.photos : []).slice(0, 3000).map(compactPhoto).filter((p) => p.id))
    const state = compactState(body.state)
    const history = (Array.isArray(body.history) ? body.history : []).slice(-8)
      .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string')
      .map((m) => ({ role: m.role, content: m.content.slice(0, 600) }))
    const moves = (Array.isArray(body.memory?.moves) ? body.memory.moves : []).slice(0, 30).map(compactMove).filter((m) => m.from && m.to)
    const storyInput = () => ({ question, photos, events, focus, storyGraph: graph.context(user) })
    const tell = async () => {
      const story = await storytelling.compose(user, storyInput(), { storyId: body.storyId, freshInput: storyInput })
      return [200, { answer: '', eventIds: [], assetIds: story.assetIds, actions: [{ type: 'story', story }] }]
    }
    if (body.intent === 'story' || body.storyId || /边看.{0,8}边(?:听|讲)|演绎|讲.{0,30}(?:故事|回忆)|听.{0,12}(?:故事|回忆)/.test(question)) return tell()
    const memory = JSON.stringify({ today: new Date().toISOString().slice(0, 10), focus, state, places, moves, events, photos, storyGraph: graph.context(user) })
    const answer = parseJsonAnswer(await chat(stepfun, [
      { role: 'system', content: `${loadSkill('life-butler')}\n\n记忆：${memory}` },
      ...history,
      { role: 'user', content: question },
    ], { json: true }))
    if (Array.isArray(answer.actions) && answer.actions.some(action => action?.type === 'story')) return tell()
    const known = {
      events: new Set(events.map((event) => event.id)),
      photos: new Set(photos.map((photo) => photo.id)),
      cities: new Set(places.map((place) => place.city)),
      films: new Set((state?.features.films || []).map((film) => film.id)),
      filmCapable: Boolean(state?.features.filmCapable),
      spacetime: Boolean(state?.features.spacetime),
    }
    return [200, {
      answer: typeof answer.answer === 'string' ? answer.answer : '我没能整理出回答，请换个问法再试一次。',
      eventIds: strings(answer.eventIds, 12).filter((id) => known.events.has(id)),
      assetIds: strings(answer.assetIds, 12).filter((id) => known.photos.has(id)),
      actions: readActions(answer.actions, known),
    }]
  },

  async 'POST /api/storytelling/list'(_body, user) {
    return [200, { stories: await storytelling.list(user) }]
  },

  async 'POST /api/storytelling/note'(body, user) {
    return [200, await storytelling.note(user, body, fact => graph.fact(user, fact))]
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
    // Personal data and the external map services below need a signed-in user.
    const currentUser = () => users.userForToken(readCookie(req, SESSION_COOKIE))
    const signedIn = () => Boolean(currentUser())
    // The cartoon world: public map data built into cartoon tiles on this computer (cartoonTiles.mjs)
    const cartoon = /^\/api\/cartoon-tiles\/(\d+)\/(\d+)\/(\d+)\.json$/.exec(path)
    if (cartoon && req.method === 'GET') {
      const [z, x, y] = cartoon.slice(1).map(Number)
      try {
        const json = await cartoonTile(z, x, y)
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=86400' })
        return res.end(json)
      } catch (error) {
        return send(res, /无效/.test(error.message) ? 400 : 503, { error: error.message })
      }
    }
    // The account's photos and memories on this computer's disk (see accountVault.mjs)
    if (path.startsWith('/api/vault/')) {
      const user = currentUser()
      if (!user) return send(res, 401, { error: '请先登录' })
      if (user.privacyVersion !== PRIVACY_VERSION) return send(res, 403, { error: '请先确认隐私声明' })
      if (req.method !== 'GET' && req.headers['x-memory-agent'] !== 'web') return send(res, 403, { error: '请求来源未通过校验' })
      if (path === '/api/vault/state') {
        if (req.method === 'GET') return send(res, 200, await vault.readState(user))
        if (req.method === 'PUT') return send(res, 200, await vault.writeState(user, JSON.parse((await readBody(req, 64 * 1024 * 1024)).toString('utf8'))))
      }
      if (path === '/api/vault/assets' && req.method === 'GET') return send(res, 200, await vault.listAssets(user))
      const asset = /^\/api\/vault\/assets\/([A-Za-z0-9-]{8,64})(?:\/(preview|original))?$/.exec(path)
      if (asset) {
        const [, id, part] = asset
        if (req.method === 'DELETE' && !part) { await vault.removeAsset(user, id); await storytelling.removeAssets(user, [id]); return send(res, 200, { ok: true }) }
        if (req.method === 'PUT' && part === 'preview') { await vault.putPreview(user, id, await readBody(req, 8 * 1024 * 1024)); return send(res, 200, { ok: true }) }
        if (req.method === 'PUT' && part === 'original') {
          const meta = { name: decodeURIComponent(String(req.headers['x-file-name'] || '')), type: req.headers['content-type'], lastModified: req.headers['x-last-modified'] }
          await vault.putOriginal(user, id, await readBody(req, 100 * 1024 * 1024), meta)
          return send(res, 200, { ok: true })
        }
        if (req.method === 'GET' && part === 'preview') {
          const bytes = await vault.getPreview(user, id)
          if (!bytes) return send(res, 404, { error: '预览图不存在' })
          res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store' })
          return res.end(bytes)
        }
        if (req.method === 'GET' && part === 'original') {
          const file = await vault.getOriginal(user, id)
          if (!file) return send(res, 404, { error: '原图不存在' })
          res.writeHead(200, { 'Content-Type': file.meta.type || 'application/octet-stream', 'Cache-Control': 'private, no-store', 'X-File-Name': encodeURIComponent(file.meta.name || id), 'X-Last-Modified': String(file.meta.lastModified || '') })
          return res.end(file.bytes)
        }
      }
      return send(res, 404, { error: '接口不存在' })
    }
    // A spacetime scene's model, kept in the account vault
    const sceneModel = /^\/api\/spacetime-scene\/models\/([A-Za-z0-9-]{8,64})$/.exec(path)
    if (sceneModel && req.method === 'GET') {
      const user = currentUser()
      if (!user) return send(res, 401, { error: '请先登录' })
      const scene = await vault.getScene(user, sceneModel[1])
      if (!scene) return send(res, 404, { error: '这张照片还没有重建' })
      res.writeHead(200, { 'Content-Type': 'model/gltf-binary', 'Cache-Control': 'private, no-store' })
      return res.end(scene.bytes)
    }
    if(path==='/api/memory-graph'||path.startsWith('/api/memory-graph/')){
      const user=currentUser()
      if(!user)return send(res,401,{error:'请先登录'})
      if(user.privacyVersion!==PRIVACY_VERSION)return send(res,403,{error:'请先确认隐私声明'})
      if(req.method==='GET'&&path==='/api/memory-graph')return send(res,200,await graph.read(user))
      const face=/^\/api\/memory-graph\/faces\/([a-f0-9]{32})$/.exec(path)
      if(req.method==='GET'&&face){
        const image=await graph.face(user,face[1]);if(!image)return send(res,404,{error:'人脸缩略图不存在'})
        res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'private, no-store'});return res.end(image)
      }
      if(req.method!=='POST'||req.headers['x-memory-agent']!=='web')return send(res,403,{error:'请求来源未通过校验'})
      const action=path.slice('/api/memory-graph/'.length)
      if(!['sync','analyze','correct','undo','fact','settle','understanding'].includes(action))return send(res,404,{error:'接口不存在'})
      return send(res,200,await graph[action](user,await readJson(req)))
    }
    if (path === '/api/memory-review' && process.env.MEMORY_REVIEW_LOCAL === '1') {
      const user = currentUser()
      if (!user) return send(res, 401, { error: '请先登录' })
      if (user.privacyVersion !== PRIVACY_VERSION) return send(res, 403, { error: '请先确认隐私声明' })
      if (req.method === 'GET') return send(res, 200, await review.read(user))
      if (req.method === 'POST' && req.headers['x-memory-agent'] === 'web') return send(res, 200, await review.save(user, await readJson(req)))
      return send(res, 403, { error: '请求来源未通过校验' })
    }
    if (path === '/api/memory-films' || path.startsWith('/api/memory-films/')) {
      const user = currentUser()
      if (!user) return send(res, 401, { error: '请先登录' })
      if (user.privacyVersion !== PRIVACY_VERSION) return send(res, 403, { error: '请先确认隐私声明' })
      if (req.method === 'GET' && path === '/api/memory-films') return send(res, 200, { jobs: await films.list(user), capability: await filmCapability() })
      const match = /^\/api\/memory-films\/([a-f0-9-]{36})(?:\/(video|poster|render|cancel|images|context)(?:\/([\w-]+))?)?$/.exec(path)
      if (match && req.method === 'GET') {
        if (match[2] === 'video' || match[2] === 'poster') {
          if (await films.media(match[1], match[2], user, req, res)) return
          return send(res, 404, { error: '短片不存在或已过期' })
        }
        if (!match[2]) { const [status, body] = films.get(match[1], user); return send(res, status, body) }
      }
      if (req.method !== 'POST') return send(res, 404, { error: '接口不存在' })
      if (req.headers['x-memory-agent'] !== 'web') return send(res, 403, { error: '请求来源未通过校验' })
      let result
      if (path === '/api/memory-films') result = await films.start(await readJson(req), user)
      else if (match?.[2] === 'images' && match[3]) result = await films.upload(match[1], match[3], await readJson(req), user)
      else if (match?.[2] === 'render') result = await films.render(match[1], user)
      else if (match?.[2] === 'cancel') result = await films.cancel(match[1], user)
      else if (match?.[2] === 'context') result = films.context(match[1], await readJson(req), user)
      else return send(res, 404, { error: '接口不存在' })
      return send(res, result[0], result[1])
    }
    if (path.startsWith('/_AMapService/')) return signedIn() ? await proxyAmapService(amap, req, res) : send(res, 401, { error: '请先登录' })
    if (req.method === 'GET' && path === '/api/config') {
      const ready = Boolean(stepfun.apiKey && stepfun.model)
      return send(res, 200, {
        available: ready,
        mode: ready ? 'model' : stepfun.agentUrl ? 'agent-needs-adapter' : 'unconfigured',
        message: ready ? `StepFun ${stepfun.model} 已配置，连接尚未验证` : stepfun.agentUrl ? '已填写 Agent 地址，仍需核对该 Agent 的 API 请求格式' : '未配置 StepFun API Key；本地整理仍可使用',
        geocode: Boolean(amap.serviceKey),
        localReview: process.env.MEMORY_REVIEW_LOCAL === '1',
        amapJsKey: amap.jsKey && amap.securityCode ? amap.jsKey : undefined,
        amapStyle: /^amap:\/\/styles\/[A-Za-z0-9]+$/.test(process.env.AMAP_MAP_STYLE || '') ? process.env.AMAP_MAP_STYLE : undefined,
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

// Map data from the project's Seafile, in the background (world-data/manifest.json, WORLD_DATA_URL)
if (!process.env.SKIP_WORLD_DATA) syncWorldData({ log: (line) => console.log(`[地图数据] ${line}`) }).then((done) => { if (done.length) reloadArchives() }).catch((error) => console.warn('[地图数据]', error.message))

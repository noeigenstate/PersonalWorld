import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { hashPassword } from '../server/users.mjs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// One mock server stands in for both StepFun and the AMap web service
const requests = []
const mock = http.createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks)
  const url = new URL(req.url, 'http://mock')
  requests.push({ path: url.pathname, url, auth: req.headers.authorization, type: req.headers['content-type'], raw })
  const json = (body) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }

  if (url.pathname === '/v3/geocode/regeo') {
    const count = url.searchParams.get('location').split('|').length
    return json({
      status: '1',
      regeocodes: Array.from({ length: count }, (_, i) => i === 0
        ? { addressComponent: { province: '上海市', city: [], district: '黄浦区', township: '外滩街道', neighborhood: { name: [] }, building: { name: [] } } }
        : { addressComponent: { province: '湖北省', city: '武汉市', district: '洪山区', township: '珞南街道', neighborhood: { name: '武汉大学' }, building: { name: [] } } }),
    })
  }
  if (url.pathname === '/v1/audio/transcriptions') return json({ text: '那时候发生了什么？' })
  if (url.pathname === '/v1/audio/speech') { res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); return res.end(Buffer.from('ID3mock')) }

  const payload = JSON.parse(raw.toString())
  requests[requests.length - 1].payload = payload
  const system = payload.messages[0].content
  const plateCase = JSON.stringify(payload.messages?.[1]?.content || '').includes('DSCF3348')
  const output = system.includes('照片信息卡助手') && plateCase
    ? { title: '雨天行车', caption: '〔可能在云南〕', scene: '车内视角', visibleText: '云A 12345', clues: [{ kind: '地点', evidence: '前车车牌云A 12345', inference: '车辆登记于云南昆明，拍摄地点可能在云南', confidence: 0.9 }, { kind: '地点', evidence: '远处雪山和草场', inference: '高原地区', confidence: 0.7 }], placeQuery: { text: '云南', city: '', from: 'text', confidence: 0.7 }, eventGuess: { type: '旅行', reason: '自驾' }, tags: ['云南', '雨天', '自驾'], questions: [] }
    : system.includes('照片信息卡助手')
    ? { title: '新居装修', caption: '〔可能在杭州〕', scene: '天花板上的灯', visibleText: '恒彩家装 0571-5670 0000', clues: [{ kind: '地点', evidence: '区号 0571', inference: '装修公司在杭州', confidence: 0.6 }, { kind: '事件', evidence: '', inference: '无依据的线索应被丢弃', confidence: 0.9 }], eventGuess: { type: '搬家装修', reason: '保护膜' }, tags: ['装修'], questions: ['这是你家吗？', '哪一年？', '第三个问题应被截掉'] }
    : system.includes('人生管家')
    ? { answer: '那是爸妈第一次来〔上海〕看你。', eventIds: ['e2', 'not-a-real-id'] }
    : { title: '海边旅行', summary: '画面显示海边风景。', type: '旅行', place: '', city: '三亚市', people: [], visibleText: '海边', tags: ['海边'], questions: ['同行的人是谁？'], confidence: 0.7 }
  json({ choices: [{ message: { content: JSON.stringify(output) }, finish_reason: 'stop' }] })
})
await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve))
const mockBase = `http://127.0.0.1:${mock.address().port}`

const usersFile = join(mkdtempSync(join(tmpdir(), 'pw-users-')), 'users.json')
// An account created before the privacy statement existed
writeFileSync(usersFile, JSON.stringify({ users: [{ id: 'legacy-1', username: '老用户', passwordHash: await hashPassword('oldpass1'), createdAt: '2026-09-01T00:00:00Z' }], sessions: {} }))
const api = spawn(process.execPath, ['server/index.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: '0',
    STEPFUN_BASE_URL: `${mockBase}/v1`,
    STEPFUN_API_KEY: 'mock-key',
    STEPFUN_MODEL: 'step-3.7-flash',
    AMAP_REST_BASE: mockBase,
    AMAP_WEB_SERVICE_KEY: 'mock-amap',
    AMAP_JS_KEY: '',
    AMAP_JS_SECURITY_CODE: '',
    USERS_FILE: usersFile,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

const apiPort = await new Promise((resolve, reject) => {
  let output = ''
  const timeout = setTimeout(() => reject(new Error(`测试 API 未启动：${output}`)), 10_000)
  api.stdout.on('data', (chunk) => {
    output += chunk.toString()
    const match = output.match(/Personal World API running on http:\/\/127\.0\.0\.1:(\d+)/)
    if (match) { clearTimeout(timeout); resolve(Number(match[1])) }
  })
  api.stderr.on('data', (chunk) => { output += chunk.toString() })
  api.on('exit', () => { clearTimeout(timeout); reject(new Error(`测试 API 提前退出：${output}`)) })
})
const apiBase = `http://127.0.0.1:${apiPort}`
const headers = { 'Content-Type': 'application/json', 'X-Memory-Agent': 'web' }
const post = (path, body) => fetch(`${apiBase}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
const cookieOf = (response) => (response.headers.get('set-cookie') || '').split(';')[0]
const last = (path) => requests.filter((r) => r.path === path).at(-1)

try {
  const badRequest = await fetch(`${apiBase}/api/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  assert.equal(badRequest.status, 403)

  // Accounts: username + password only; quota endpoints need a session
  const anonymous = await post('/api/butler', { question: '你好' })
  assert.equal(anonymous.status, 401, '未登录不能调用人生管家')
  assert.equal((await fetch(`${apiBase}/api/auth/me`)).status, 401)
  assert.equal((await post('/api/auth/register', { username: 'a', password: '123456', acceptPrivacy: true })).status, 400, '用户名太短')
  assert.equal((await post('/api/auth/register', { username: '小丁', password: '12345', acceptPrivacy: true })).status, 400, '密码太短')
  assert.equal((await post('/api/auth/register', { username: '小丁', password: 'secret12' })).status, 400, '必须同意隐私声明')
  const registered = await post('/api/auth/register', { username: '小丁', password: 'secret12', acceptPrivacy: true })
  assert.equal(registered.status, 201)
  const created = (await registered.json()).user
  assert.equal(created.username, '小丁')
  assert.equal(created.privacyAccepted, true)
  const setCookie = registered.headers.get('set-cookie')
  assert.match(setCookie, /pw_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax/)
  assert.equal((await post('/api/auth/register', { username: '小丁', password: 'another1', acceptPrivacy: true })).status, 409, '用户名重复')
  const stored = readFileSync(usersFile, 'utf8')
  assert.ok(!stored.includes('secret12'), '密码不能明文保存')
  assert.ok(!stored.includes(cookieOf(registered).split('=')[1]), '会话令牌只保存哈希')
  assert.equal((await post('/api/auth/login', { username: '小丁', password: 'wrong-pass' })).status, 401)
  const loggedIn = await post('/api/auth/login', { username: '小丁', password: 'secret12' })
  assert.equal(loggedIn.status, 200)
  headers.Cookie = cookieOf(loggedIn)
  const me = await (await fetch(`${apiBase}/api/auth/me`, { headers })).json()
  assert.equal(me.user.username, '小丁')
  for (let i = 0; i < 5; i++) await post('/api/auth/login', { username: 'nobody', password: 'wrong-pass' })
  assert.equal((await post('/api/auth/login', { username: 'nobody', password: 'wrong-pass' })).status, 429, '连续失败后暂时锁定')

  const config = await (await fetch(`${apiBase}/api/config`)).json()
  assert.equal(config.geocode, true)
  assert.equal(config.amapJsKey, undefined, '缺少安全密钥时不应下发 JS Key')

  // Event analysis
  const analyzed = await post('/api/analyze', { images: [{ name: 'beach.jpg', capturedAt: '2026-09-23T10:00:00Z', dataUrl: 'data:image/jpeg;base64,/9j/2Q==' }], context: { city: '三亚市', address: '天涯区' } })
  assert.equal(analyzed.status, 200)
  const event = await analyzed.json()
  assert.equal(event.title, '海边旅行')
  assert.equal(event.city, '三亚市')
  const analyzeCall = last('/v1/chat/completions')
  assert.equal(analyzeCall.auth, 'Bearer mock-key')
  assert.equal(analyzeCall.payload.model, 'step-3.7-flash')
  assert.equal(analyzeCall.payload.messages[1].content[1].type, 'image_url')
  assert.match(analyzeCall.payload.messages[1].content[0].text, /三亚市 天涯区/)
  assert.equal(analyzeCall.payload.response_format.type, 'json_object')

  // Reverse geocoding converts WGS-84 to GCJ-02 and treats municipalities as cities
  const geocoded = await post('/api/geocode', { points: [{ id: 'a', lat: 31.2397, lng: 121.4998 }, { id: 'b', lat: 30.5397, lng: 114.3647 }] })
  assert.equal(geocoded.status, 200)
  const { results } = await geocoded.json()
  assert.deepEqual(results.map((r) => r.city), ['上海市', '武汉市'])
  assert.equal(results[1].address, '洪山区 珞南街道 武汉大学')
  const regeo = last('/v3/geocode/regeo').url
  assert.equal(regeo.searchParams.get('key'), 'mock-amap')
  const [lng, lat] = regeo.searchParams.get('location').split('|')[0].split(',').map(Number)
  assert.ok(lng > 121.504 && lng < 121.506 && lat > 31.237 && lat < 31.239, `坐标应转换为 GCJ-02，实际 ${lng},${lat}`)

  // Life butler: grounded in memory, unknown event ids are dropped
  const butler = await post('/api/butler', {
    question: '2019 年国庆发生了什么？',
    history: [{ role: 'assistant', content: '你在上海生活了 8 年。' }],
    focus: { city: '上海市', from: '2018-07-01', to: '2026-09-24' },
    memory: {
      places: [{ city: '上海市', role: 'work', roleConfirmed: true, firstAt: '2018-07-02', lastAt: '2026-09-23', eventCount: 2 }],
      events: [
        { id: 'e1', title: '入职第一天', start: '2018-07-02', city: '上海市', status: 'confirmed', firsts: ['照片记录中第一次在上海'], photoCount: 4 },
        { id: 'e2', title: '父母来沪', start: '2019-10-02', city: '上海市', status: 'analyzed', photoCount: 26, dataUrl: 'data:image/jpeg;base64,AAAA' },
      ],
    },
  })
  assert.equal(butler.status, 200)
  const reply = await butler.json()
  assert.match(reply.answer, /第一次/)
  assert.deepEqual(reply.eventIds, ['e2'])
  const butlerCall = last('/v1/chat/completions').payload
  assert.match(butlerCall.messages[0].content, /人生管家/)
  assert.match(butlerCall.messages[0].content, /"focus":\{"city":"上海市"/)
  assert.equal(butlerCall.messages[0].content.includes('data:image'), false, '管家对话不应发送图片')
  assert.equal(butlerCall.messages.at(-1).content, '2019 年国庆发生了什么？')
  assert.equal(butlerCall.messages[1].role, 'assistant')

  // Speech to text: WAV in, StepFun multipart out
  const wav = Buffer.alloc(64)
  wav.write('RIFF', 0, 'ascii')
  const asr = await fetch(`${apiBase}/api/asr`, { method: 'POST', headers: { ...headers, 'Content-Type': 'audio/wav' }, body: wav })
  assert.equal(asr.status, 200)
  assert.equal((await asr.json()).text, '那时候发生了什么？')
  const asrCall = last('/v1/audio/transcriptions')
  assert.match(asrCall.type, /^multipart\/form-data/)
  assert.match(asrCall.raw.toString('latin1'), /name="model"\r\n\r\nstepaudio-2\.5-asr/)
  const notWav = await fetch(`${apiBase}/api/asr`, { method: 'POST', headers: { ...headers, 'Content-Type': 'audio/wav' }, body: Buffer.alloc(64) })
  assert.equal(notWav.status, 400)

  // Text to speech strips the uncertainty brackets
  const tts = await post('/api/tts', { text: '那是〔外滩〕。' })
  assert.equal(tts.status, 200)
  assert.equal(tts.headers.get('content-type'), 'audio/mpeg')
  const ttsCall = JSON.parse(last('/v1/audio/speech').raw.toString())
  assert.equal(ttsCall.input, '那是外滩。')
  assert.equal(ttsCall.model, 'stepaudio-2.5-tts')

  // Photo card with consent: numbers as written, clues without evidence dropped, lists capped
  const photo = { image: { dataUrl: 'data:image/jpeg;base64,/9j/2Q==' }, facts: { fileName: '微信图片_20260924133610.jpg', time: '2026-09-24T05:36:10Z', timeSource: 'filename', size: '1080 × 1920' } }
  const consentCard = await (await post('/api/photo-card', photo)).json()
  assert.equal(consentCard.visibleText, '恒彩家装 0571-5670 0000', '同意隐私声明后号码原样显示')
  assert.equal(consentCard.clues.length, 1)
  assert.equal(consentCard.questions.length, 2)
  const cardCall = last('/v1/chat/completions').payload
  assert.ok(!cardCall.messages[0].content.startsWith('---'), '运行时 skill 不应包含 front matter')
  assert.match(cardCall.messages[0].content, /照片信息卡助手/)
  assert.match(cardCall.messages[1].content[0].text, /来源：filename/)
  assert.match(cardCall.messages[1].content[0].text, /隐私声明：用户已同意/)
  assert.equal((await post('/api/photo-card', { image: { dataUrl: 'data:text/plain;base64,AA==' } })).status, 400)

  // A licence plate never places a photo: confidence capped, no tag or map search built on it
  const plateCard = await (await post('/api/photo-card', { image: photo.image, facts: { ...photo.facts, fileName: 'DSCF3348.JPG' } })).json()
  const plateClue = plateCard.clues.find((c) => /车牌/.test(c.evidence))
  assert.equal(plateClue.confidence, 0.3)
  assert.match(plateClue.inference, /车牌只说明车辆登记地/)
  assert.equal(plateCard.clues.find((c) => /高原/.test(c.inference)).confidence, 0.7, '其他线索不受影响')
  assert.deepEqual(plateCard.tags, ['雨天', '自驾'], '只由车牌得出的省份不进标签')
  assert.equal(plateCard.placeQuery, null, '只由车牌得出的省份不进地图搜索')

  const chatRemoved = await post('/api/chat', {})
  assert.equal(chatRemoved.status, 404, '旧的回忆对话接口已移除')
  assert.equal((await fetch(`${apiBase}/_AMapService/v3/log/init`)).status, 401, '未登录不能使用高德代理')
  const amapProxy = await fetch(`${apiBase}/_AMapService/v3/log/init`, { headers })
  assert.equal(amapProxy.status, 503, '缺少安全密钥时高德代理应拒绝')

  // Logging out ends the session
  assert.equal((await post('/api/auth/logout', {})).status, 200)
  assert.equal((await fetch(`${apiBase}/api/auth/me`, { headers })).status, 401)
  assert.equal((await post('/api/tts', { text: '你好' })).status, 401)

  // A legacy account has not accepted the statement: numbers stay masked until it does
  const legacy = await post('/api/auth/login', { username: '老用户', password: 'oldpass1' })
  headers.Cookie = cookieOf(legacy)
  assert.equal((await legacy.json()).user.privacyAccepted, false)
  const maskedCard = await (await post('/api/photo-card', photo)).json()
  assert.equal(maskedCard.visibleText, '恒彩家装 0571-********', '未同意时号码被遮挡')
  assert.match(last('/v1/chat/completions').payload.messages[1].content[0].text, /隐私声明：用户未同意/)
  const accepted = await (await post('/api/auth/privacy', {})).json()
  assert.equal(accepted.user.privacyAccepted, true)
  assert.equal((await (await post('/api/photo-card', photo)).json()).visibleText, '恒彩家装 0571-5670 0000')
  console.log('API test passed: accounts + privacy consent, guard, analysis, photo card, geocode (GCJ-02), butler, ASR, TTS, AMap proxy, logout.')
} finally {
  api.kill()
  await new Promise((resolve) => mock.close(resolve))
}

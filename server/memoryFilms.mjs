import { randomUUID } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { filmFingerprint, planFilm, readFilmSources, FILM_VERSION } from './memoryFilmPlan.mjs'
import { filmCapability, renderFilm, FILM_RENDER_VERSION } from './memoryFilmRender.mjs'
import { createFilmContextStore, filmContextSummary } from './memoryFilmContext.mjs'

const active = new Set(['planning', 'awaiting-images', 'queued', 'rendering'])
const lifetime = 24 * 60 * 60 * 1000

export function createFilmService(config, { root = process.env.MEMORY_FILMS_DIR || fileURLToPath(new URL('./data/memory-films/', import.meta.url)), planner = planFilm, renderer = renderFilm } = {}) {
  root = path.resolve(root)
  mkdirSync(root, { recursive: true })
  const contexts = createFilmContextStore(root)
  const jobs = new Map(), controllers = new Map()
  let rendering = false
  const directory = (id) => {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('无效的短片 ID')
    const target = path.resolve(root, id)
    if (path.dirname(target) !== root) throw new Error('无效的短片目录')
    return target
  }
  const persist = (job) => {
    mkdirSync(directory(job.id), { recursive: true })
    writeFileSync(path.join(directory(job.id), 'job.json'), JSON.stringify(job), 'utf8')
  }
  const selectedSources = (job) => job.sources.filter((s) => job.plan?.shots.some((shot) => shot.assetId === s.id))
  const publicJob = ({ userId, sources, fingerprint: _fingerprint, ...job }) => {
    const selected = selectedSources({ ...job, sources })
    const storyContext = filmContextSummary(contexts.apply({ id: userId }, selected))
    storyContext.changed = storyContext.revision !== filmContextSummary(selected).revision
    return { ...job, storyContext, url: job.status === 'complete' ? `/api/memory-films/${job.id}/video` : undefined }
  }
  const get = (id, user) => { const job = jobs.get(id); return job?.userId === user.id ? job : null }
  async function clearInputs(job) {
    const dir = directory(job.id)
    for (const file of await readdir(dir).catch(() => [])) {
      if (/^(image-\d+\.jpg|clip-\d+\.mp4|.*\.txt|music\.wav|font\.ttf)$/.test(file)) await rm(path.join(dir, file), { force: true })
    }
  }
  async function prune() {
    for (const [id, job] of jobs) {
      if (Date.now() - job.createdAt < lifetime) continue
      controllers.get(id)?.abort(); jobs.delete(id)
      await rm(directory(id), { recursive: true, force: true, maxRetries: 3 }).catch(() => {})
    }
  }
  for (const id of readdirSync(root)) {
    if (!/^[a-f0-9-]{36}$/.test(id)) continue
    try {
      const job = JSON.parse(readFileSync(path.join(directory(id), 'job.json'), 'utf8'))
      if (job.id !== id || typeof job.userId !== 'string') continue
      if (['planning', 'queued', 'rendering'].includes(job.status)) {
        job.status = 'failed'; job.error = '服务重新启动，请重新生成这条短片'; persist(job)
        void clearInputs(job).catch(() => {})
      }
      // A renderer upgrade may repair a known render failure. Recover its
      // existing validated edit once per renderer version, without another AI
      // call. The signed-in browser will re-supply just the selected originals.
      if (job.status === 'failed' && job.plan?.shots?.length >= 6 && job.error?.startsWith('视频渲染失败') && job.renderVersion !== FILM_RENDER_VERSION) {
        Object.assign(job, { status: 'awaiting-images', uploaded: [], progress: 10, renderVersion: FILM_RENDER_VERSION })
        delete job.error; persist(job)
      }
      jobs.set(id, job)
    } catch { /* Ignore incomplete directories. */ }
  }
  void prune()
  const cleanupTimer = setInterval(() => { void prune() }, 60 * 60 * 1000)
  cleanupTimer.unref()

  async function pump() {
    if (rendering) return
    const job = [...jobs.values()].find((j) => j.status === 'queued')
    if (!job) return
    rendering = true
    const controller = new AbortController(); controllers.set(job.id, controller)
    job.status = 'rendering'; persist(job)
    try {
      const result = await renderer(directory(job.id), job.plan, { signal: controller.signal, onProgress: (p) => { job.progress = p } })
      controller.signal.throwIfAborted()
      Object.assign(job, result, { status: 'complete', progress: 100 })
    } catch (error) {
      if (job.status !== 'cancelled') { job.status = 'failed'; job.error = String(error.message || error).slice(0, 500) }
    } finally {
      controllers.delete(job.id)
      await clearInputs(job).catch(() => { job.cleanupPending = true })
      if (jobs.has(job.id)) persist(job)
      rendering = false
      void pump()
    }
  }

  return {
    async list(user) { await prune(); return [...jobs.values()].filter((j) => j.userId === user.id).sort((a, b) => b.createdAt - a.createdAt).map(publicJob) },
    async start(body, user) {
      if (!(await filmCapability()).available) return [503, { error: '本机未找到 FFmpeg，请安装后重启服务' }]
      const original = body.fromJob ? get(body.fromJob, user) : null
      if (body.fromJob && !original?.plan) return [404, { error: '原短片不存在或已过期' }]
      const sources = contexts.apply(user, readFilmSources(original ? selectedSources(original) : body.sources))
      if (sources.length < 6) return [400, { error: '至少需要 6 张已有信息卡的照片' }]
      const batch = original?.batch || (/^[a-f0-9]{16,64}$/.test(body.batch) ? body.batch : filmFingerprint(sources))
      const fingerprint = filmFingerprint(sources)
      const ongoing = [...jobs.values()].find((j) => j.userId === user.id && active.has(j.status))
      if (ongoing) return [200, publicJob(ongoing)]
      const cached = [...jobs.values()].find((j) => j.userId === user.id && j.fingerprint === fingerprint && j.status === 'complete')
      if (cached && body.regenerate !== true) return [200, publicJob(cached)]
      const previous = [...jobs.values()].filter((j) => j.userId === user.id).sort((a, b) => b.createdAt - a.createdAt)
      const job = { id: randomUUID(), userId: user.id, batch, fingerprint, version: FILM_VERSION, renderVersion: FILM_RENDER_VERSION, createdAt: Date.now(), expiresAt: Date.now() + lifetime, status: 'planning', progress: 2, sources, uploaded: [] }
      // Reserve before asynchronous cleanup: two tabs must see the same job.
      jobs.set(job.id, job); persist(job)
      for (const old of previous.slice(2)) {
        try { await rm(directory(old.id), { recursive: true, force: true }); jobs.delete(old.id) } catch { /* Retry at expiry if a media reader holds the file. */ }
      }
      void planner(config, sources).then((result) => {
        if (job.status !== 'planning' || !jobs.has(job.id)) return
        Object.assign(job, result, { status: 'awaiting-images', progress: 10 }); persist(job)
      }).catch((error) => {
        if (job.status !== 'planning' || !jobs.has(job.id)) return
        job.status = 'failed'; job.error = String(error.message).slice(0, 300); persist(job)
      })
      return [202, publicJob(job)]
    },
    get(id, user) { const job = get(id, user); return job ? [200, publicJob(job)] : [404, { error: '短片不存在或已过期' }] },
    context(id, body, user) {
      const job = get(id, user)
      if (!job?.plan) return [404, { error: '短片不存在或尚未选好照片' }]
      if (active.has(job.status)) return [409, { error: '请等当前短片完成后再补充回忆' }]
      try { contexts.save(user, selectedSources(job).map((s) => s.id), body.text) }
      catch (error) { return [400, { error: error.message }] }
      return [200, publicJob(job)]
    },
    async upload(id, assetId, body, user) {
      const job = get(id, user)
      if (!job) return [404, { error: '短片不存在' }]
      if (job.status !== 'awaiting-images') return [409, { error: '当前任务不接收照片' }]
      const index = job.plan.shots.findIndex((s) => s.assetId === assetId)
      if (index < 0) return [400, { error: '这张照片不在剪辑方案中' }]
      if (typeof body.dataUrl !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(body.dataUrl)) return [400, { error: '请上传 JPEG 照片' }]
      const data = Buffer.from(body.dataUrl.split(',')[1], 'base64')
      if (data.length > 6 * 1024 * 1024 || data.length < 20 || data[0] !== 255 || data[1] !== 216) return [400, { error: '照片内容无效或超过 6 MB' }]
      await writeFile(path.join(directory(id), `image-${index}.jpg`), data)
      if (job.status !== 'awaiting-images') { await clearInputs(job); return [409, { error: '任务已经停止' }] }
      if (!job.uploaded.includes(assetId)) job.uploaded.push(assetId)
      persist(job)
      return [200, publicJob(job)]
    },
    async render(id, user) {
      const job = get(id, user)
      if (!job) return [404, { error: '短片不存在' }]
      if (['queued', 'rendering', 'complete'].includes(job.status)) return [200, publicJob(job)]
      if (job.status !== 'awaiting-images' || job.uploaded.length !== job.plan.shots.length) return [409, { error: '选中的照片尚未全部上传' }]
      job.status = 'queued'; job.progress = 15; persist(job); void pump()
      return [202, publicJob(job)]
    },
    async cancel(id, user) {
      const job = get(id, user)
      if (!job) return [404, { error: '短片不存在' }]
      const wasRendering = job.status === 'rendering'
      if (!active.has(job.status)) return [200, publicJob(job)]
      job.status = 'cancelled'; controllers.get(id)?.abort(); persist(job)
      if (!wasRendering) await clearInputs(job)
      return [200, publicJob(job)]
    },
    async media(id, type, user, req, res) {
      const job = get(id, user)
      if (!job || job.status !== 'complete') return false
      const file = path.join(directory(id), type === 'poster' ? 'poster.jpg' : 'film.mp4')
      if (!existsSync(file)) return false
      const { size } = await stat(file)
      const headers = { 'Content-Type': type === 'poster' ? 'image/jpeg' : 'video/mp4', 'Cache-Control': 'private, no-store', 'Accept-Ranges': 'bytes', 'Content-Disposition': `inline; filename="memory-${id}.mp4"` }
      const range = req.headers.range
      let start = 0, end = size - 1
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range)
        if (match) {
          start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
          end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1
        }
        if (!match || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
          res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return true
        }
        headers['Content-Range'] = `bytes ${start}-${end}/${size}`
      }
      res.writeHead(range ? 206 : 200, { ...headers, 'Content-Length': end - start + 1 })
      const stream = createReadStream(file, { start, end })
      stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res)
      return true
    },
    close() { clearInterval(cleanupTimer); for (const controller of controllers.values()) controller.abort() },
  }
}

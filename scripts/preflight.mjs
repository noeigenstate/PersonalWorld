// Before the service starts: is everything every feature needs in place on this computer?
// Fixes what it safely can (downloads the map data, installs the face models, starts ComfyUI from
// COMFYUI_DIR) and refuses to start while anything the service needs is still missing. The README's
// "功能与依赖" table lists the same items.
//
//   npm run dev / npm run dev:lan   run this first (predev, predev:lan)
//   npm run check                   report only: changes nothing, exit code 1 when something is missing
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import net from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const reportOnly = process.argv.includes('--report')
const envFile = join(root, '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)
const env = process.env
const tty = process.stdout.isTTY
const paint = (code) => (text) => (tty ? `\x1b[${code}m${text}\x1b[0m` : text)
const green = paint(32), red = paint(31), yellow = paint(33), dim = paint(2), bold = paint(1)

// ok: true = in place, false = missing (the service does not start), 'warn' = only a
// development tool is missing (the service runs, a script such as build:osm does not)
const results = []
let group = ''
const section = (name) => { group = name; console.log(`\n${bold(name)}`) }
function report(name, ok, detail = '', fix = '') {
  results.push({ group, name, ok, detail, fix })
  const mark = ok === true ? green('✔') : ok === 'warn' ? yellow('!') : red('✘')
  console.log(`  ${mark} ${name}${detail ? dim(` · ${detail}`) : ''}`)
  if (ok !== true && fix) console.log(`    ${ok === 'warn' ? yellow('→') : red('→')} ${fix}`)
}

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 30000, ...options })
  return { ok: result.status === 0, out: `${result.stdout || ''}${result.stderr || ''}`.trim(), error: result.error }
}
const filled = (name) => Boolean(env[name]?.trim())
const pythonHint = process.platform === 'win32'
  ? 'winget install Python.Python.3.12，再 python -m pip install -r server/requirements-local.txt；在 .env 写 python.exe 的完整路径'
  : 'python3 -m venv .venv && .venv/bin/pip install -r server/requirements-local.txt，再在 .env 写 FACE_PYTHON / MEMORY_FILM_PYTHON=<项目>/.venv/bin/python'

function portInUse(port) {
  const probe = (host) => new Promise((resolve) => {
    const socket = net.connect({ port, host })
    socket.setTimeout(800)
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('timeout', () => { socket.destroy(); resolve(false) })
    socket.once('error', () => resolve(false))
  })
  return Promise.all([probe('127.0.0.1'), probe('::1')]).then((hits) => hits.some(Boolean))
}

// ---- 基础 ----------------------------------------------------------------------------------------
section('基础运行环境')
{
  const wanted = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).engines?.node?.replace(/[^\d.]/g, '') || '22.13.0'
  const [a, b, c] = process.versions.node.split('.').map(Number)
  const [x, y, z] = wanted.split('.').map(Number)
  const ok = a !== x ? a > x : b !== y ? b > y : c >= z
  report('Node.js', ok, `v${process.versions.node}（需要 ≥ ${wanted}，推荐 24）`, '安装 Node.js 24：https://nodejs.org/')
  const sqlite = await import('node:sqlite').then(() => true, () => false)
  report('node:sqlite（地图档案读取）', sqlite, '', '升级 Node.js 到 22.13 以上')
  const deps = ['vite', 'concurrently', 'react', 'three', 'playwright'].every((name) => existsSync(join(root, 'node_modules', name, 'package.json')))
  report('npm 依赖', deps, deps ? 'node_modules 已安装' : '', '在项目目录运行 npm install')
  report('.env', existsSync(envFile), '', '复制 .env.example 为 .env 并填写密钥')
  if (!reportOnly) {
    const apiPort = Number(env.PORT ?? 8787)
    for (const [port, what] of [[apiPort, 'API 服务'], [5183, '网页']]) {
      const busy = await portInUse(port)
      report(`端口 ${port}（${what}）`, !busy, busy ? '已被占用' : '空闲', '服务可能已经在运行；先关掉原来的 npm run dev，或结束占用该端口的程序')
    }
  }
}

// ---- StepFun -------------------------------------------------------------------------------------
section('AI 模型（StepFun）· 照片信息卡、事件分析、人生管家、语音、讲述、时空场景分段')
{
  const base = (env.STEPFUN_BASE_URL?.trim() || 'https://api.stepfun.com/step_plan/v1').replace(/\/$/, '')
  if (!filled('STEPFUN_API_KEY') || !filled('STEPFUN_MODEL')) {
    report('STEPFUN_API_KEY / STEPFUN_MODEL', false, '未填写', '在 .env 填写 StepFun 的 API Key 和支持图片的模型（如 step-3.7-flash）')
  } else {
    // Listing the models costs nothing and proves the key, the endpoint and each model at once
    let models = null, failure = ''
    try {
      const response = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${env.STEPFUN_API_KEY.trim()}` }, signal: AbortSignal.timeout(10000) })
      const body = await response.json().catch(() => ({}))
      if (response.ok) models = new Map((body.data || []).map((m) => [m.id, m]))
      else failure = response.status === 401 ? 'API Key 无效' : `HTTP ${response.status} ${body?.error?.message || ''}`.trim()
    } catch (error) { failure = `无法连接 ${base}：${error.message}` }
    report('StepFun 连接与密钥', Boolean(models), models ? base : failure, failure.startsWith('API Key') ? '在 StepFun 控制台核对密钥；Step Plan 套餐用 /step_plan/v1，按量计费用 /v1' : '检查网络与 STEPFUN_BASE_URL')
    if (models) {
      const need = [
        ['STEPFUN_MODEL', env.STEPFUN_MODEL.trim(), true],
        ['STEPFUN_STORY_MODEL', env.STEPFUN_STORY_MODEL?.trim(), false],
        ['STEPFUN_ASR_MODEL', env.STEPFUN_ASR_MODEL?.trim() || 'stepaudio-2.5-asr', false],
        ['STEPFUN_TTS_MODEL', env.STEPFUN_TTS_MODEL?.trim() || 'stepaudio-2.5-tts', false],
      ]
      for (const [name, id, vision] of need) {
        if (!id) continue
        const model = models.get(id)
        const ok = Boolean(model) && (!vision || model.enable_vision_input !== false)
        report(`${name}=${id}`, ok, !model ? '这个密钥不能使用该模型' : vision && model.enable_vision_input === false ? '该模型不支持图片' : '可用',
          `可用模型：${[...models.keys()].join('、')}`)
      }
    }
  }
}

// ---- 高德 ----------------------------------------------------------------------------------------
section('高德地图 · 地图相机与缩放、照片 GPS 识别城市、地点搜索')
{
  const keys = filled('AMAP_JS_KEY') && filled('AMAP_JS_SECURITY_CODE')
  report('AMAP_JS_KEY / AMAP_JS_SECURITY_CODE', keys, keys ? '已填写（JS Key 只能在浏览器里验证，打开页面后若地图报错请核对）' : '未填写', '在高德开放平台创建"Web端(JS API)"Key，把 Key 和安全密钥填入 .env')
  let reachable = false
  try { reachable = (await fetch('https://webapi.amap.com/maps?v=2.1Beta', { signal: AbortSignal.timeout(8000) })).ok } catch { /* offline */ }
  report('webapi.amap.com 可访问', reachable, '', '检查网络或代理')
}

// ---- 地图数据 ------------------------------------------------------------------------------------
section('卡通世界地图数据 · 海岸、河流、道路、建筑轮廓（world-data/*.mbtiles）')
{
  const { missingWorldData, readManifest, syncWorldData, worldDataStatus } = await import('../server/worldData.mjs')
  const { files = [] } = await readManifest()
  let missing = await missingWorldData()
  if (missing.length && !reportOnly) {
    const total = missing.reduce((sum, f) => sum + f.size, 0)
    console.log(`  ${yellow('↓')} 下载地图数据 ${missing.map((f) => f.name).join('、')}（${(total / 1048576).toFixed(0)} MB，多连接、可断点续传）`)
    let lastLine = ''
    const timer = setInterval(async () => {
      const s = await worldDataStatus()
      const pct = s.total ? Math.min(100, (s.received / s.total) * 100) : 0
      const bar = '█'.repeat(Math.round(pct / 4)).padEnd(25, '░')
      const line = s.state === 'verifying' ? '    校验 SHA-256…' : `    ${bar} ${pct.toFixed(0).padStart(3)}%  ${(s.received / 1048576).toFixed(0)}/${(s.total / 1048576).toFixed(0)} MB  ${(s.speed / 1048576).toFixed(1)} MB/s`
      if (tty) process.stdout.write(`\r${line.padEnd(lastLine.length)}`)
      else if (line.slice(0, 32) !== lastLine.slice(0, 32)) console.log(line)
      lastLine = line
    }, 500)
    await syncWorldData({ log: () => {} })
    clearInterval(timer)
    if (tty) process.stdout.write('\n')
    const s = await worldDataStatus()
    if (s.error) console.log(`    ${red(s.error)}`)
    missing = await missingWorldData()
  }
  for (const file of files) {
    const absent = missing.some((f) => f.name === file.name)
    report(file.name, !absent, `${(file.size / 1048576).toFixed(0)} MB`, reportOnly ? '运行 npm run dev 会自动下载' : '下载失败：检查网络后重新运行；链接见 world-data/manifest.json，或在 .env 设置 WORLD_DATA_URL')
  }
  if (!files.length) report('world-data/manifest.json', false, '清单为空或缺失', '从仓库恢复 world-data/manifest.json')
  report('地图贴图（public/world-assets/textures）', existsSync(join(root, 'public/world-assets/textures/grass.webp')), '已预先生成并入库，运行时不需要本地图像模型', '从仓库恢复 public/world-assets/textures/')
}

// ---- 人物识别 ------------------------------------------------------------------------------------
section('人物识别 · 人脸分组与人物 ID（Python + OpenCV）')
{
  const python = env.FACE_PYTHON || 'python'
  const probe = run(python, ['-c', 'import sys,numpy,cv2,PIL;print("%d.%d.%d"%sys.version_info[:3],numpy.__version__,cv2.__version__,PIL.__version__)'])
  const [pyVersion, numpy, cv2, pil] = probe.ok ? probe.out.split(/\s+/) : []
  report(`FACE_PYTHON=${python}`, probe.ok, probe.ok ? `Python ${pyVersion} · numpy ${numpy} · OpenCV ${cv2} · Pillow ${pil}` : (probe.error ? '找不到 Python' : probe.out.split('\n').pop()), pythonHint)
  const models = env.FACE_MODELS_DIR || join(root, 'server/data/identity-models')
  const names = ['face_detection_yunet_2023mar.onnx', 'face_recognition_sface_2021dec.onnx']
  let present = names.every((n) => existsSync(join(models, n)))
  if (!present && probe.ok && !reportOnly && !env.FACE_MODELS_DIR) {
    console.log(`  ${yellow('↓')} 安装人脸模型（OpenCV Zoo，校验 SHA-256）…`)
    run(python, [join(root, 'server/identity/setup_models.py')], { timeout: 300000, stdio: 'inherit' })
    present = names.every((n) => existsSync(join(models, n)))
  }
  report('人脸模型 YuNet + SFace', present, present ? models : '', `运行 ${python} server/identity/setup_models.py`)
  if (probe.ok && present) {
    const { createFaceEngine } = await import('../server/faceEngine.mjs')
    const engine = createFaceEngine({ python, models })
    const status = await engine.status().then((s) => ({ ok: true, detail: s.engine }), (e) => ({ ok: false, detail: e.message }))
    engine.close()
    report('人物引擎启动', status.ok, status.detail, '检查上面的 Python 依赖')
  }
}

// ---- 回忆短片 ------------------------------------------------------------------------------------
section('回忆短片 · 自动选片、字幕、镜头编排，合成 MP4（FFmpeg + Pillow + 中文字体）')
{
  const ffmpeg = env.FFMPEG_PATH || 'ffmpeg'
  const version = run(ffmpeg, ['-hide_banner', '-version'])
  const encoders = version.ok ? run(ffmpeg, ['-hide_banner', '-encoders']).out : ''
  const codecs = /libx264/.test(encoders) && /\baac\b/.test(encoders)
  report(`FFmpeg（${ffmpeg}）`, version.ok && codecs, version.ok ? `${version.out.split('\n')[0].replace(/ Copyright.*/, '')}${codecs ? ' · libx264 + aac' : ' · 缺少 libx264 或 aac 编码器'}` : '找不到 FFmpeg',
    process.platform === 'win32' ? 'winget install Gyan.FFmpeg，在 .env 写 FFMPEG_PATH 的完整路径' : 'sudo apt install ffmpeg；没有管理员权限时 .venv/bin/pip install imageio-ffmpeg，再把它自带的 ffmpeg 路径写入 FFMPEG_PATH')
  const python = env.MEMORY_FILM_PYTHON || 'python'
  const pil = run(python, ['-c', 'from PIL import Image, ImageFont; import numpy'])
  report(`MEMORY_FILM_PYTHON=${python}`, pil.ok, pil.ok ? 'Pillow + numpy' : '缺少 Pillow 或 numpy', pythonHint)
  const { filmFontChoices } = await import('../server/memoryFilmRender.mjs')
  const font = filmFontChoices().find((f) => existsSync(f))
  report('中文字幕字体', Boolean(font), font || '', process.platform === 'linux' ? 'sudo apt install fonts-noto-cjk，或在 .env 设置 MEMORY_FILM_FONT=<字体文件>' : '在 .env 设置 MEMORY_FILM_FONT=<中文字体文件>')
}

// ---- 4D 时空场景 ---------------------------------------------------------------------------------
section('4D 时空场景 · 照片在本机 GPU 上重建为三维浮雕（ComfyUI + Depth Anything 3）')
{
  const { reliefCapability } = await import('../server/spacetimeScene.mjs')
  const url = env.COMFY_URL || 'http://127.0.0.1:8188'
  let capability = await reliefCapability()
  if (!capability.available && capability.reason?.includes('没有运行') && env.COMFYUI_DIR && !reportOnly) {
    const dir = env.COMFYUI_DIR
    const python = [env.COMFYUI_PYTHON, join(dir, 'venv/bin/python'), join(dir, '.venv/bin/python'), join(dir, 'venv/Scripts/python.exe'), join(dir, '.venv/Scripts/python.exe'), join(dirname(dir), 'python_embeded/python.exe')].find((p) => p && existsSync(p))
    if (!python || !existsSync(join(dir, 'main.py'))) {
      report('ComfyUI', false, `COMFYUI_DIR=${dir} 里没有 main.py 或 Python 环境`, '核对 COMFYUI_DIR；Python 不在 venv 里时用 COMFYUI_PYTHON 指定')
    } else {
      const { hostname, port } = new URL(url)
      const logs = join(root, 'server/data/logs')
      mkdirSync(logs, { recursive: true })
      const out = openSync(join(logs, 'comfyui.log'), 'a')
      console.log(`  ${yellow('▶')} 启动 ComfyUI（${dir}），日志 server/data/logs/comfyui.log`)
      spawn(python, ['main.py', '--listen', hostname, '--port', port || '8188'], { cwd: dir, detached: true, stdio: ['ignore', out, out], windowsHide: true }).unref()
      for (let waited = 0; waited < 180 && !capability.available; waited += 2) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        capability = await reliefCapability()
        if (!capability.reason?.includes('没有运行')) break
      }
    }
  }
  const running = capability.available || !capability.reason?.includes('没有运行')
  report(`ComfyUI（${url}）`, running, running ? '运行中' : capability.reason,
    env.COMFYUI_DIR ? `ComfyUI 180 秒内没有启动，查看 server/data/logs/comfyui.log` : '安装 ComfyUI（https://github.com/comfyanonymous/ComfyUI），在 .env 设置 COMFYUI_DIR=<ComfyUI 目录>，启动服务时会自动拉起')
  if (running) {
    report('Depth Anything 3 单图模型', Boolean(capability.model), capability.model || capability.reason, '把 depth_anything_3_mono_large.safetensors（1.3 GB）放进 ComfyUI/models/geometry_estimation/：https://huggingface.co/Comfy-Org/Depth-Anything-3')
    report('Depth Anything 3 多视图模型', Boolean(capability.multiview), capability.multiview || '缺少', '把 depth_anything_3_base.safetensors（0.5 GB）放进 ComfyUI/models/geometry_estimation/，合成多张照片的场景需要它')
  }
}

// ---- 开发工具（不影响服务启动）--------------------------------------------------------------------
section('开发与测试工具 · 不影响服务启动')
{
  const chrome = [
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome',
    'C:/Program Files/Google/Chrome/Application/chrome.exe', `${env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].find((p) => existsSync(p))
  report('Chrome（浏览器测试、录制 README 演示）', chrome ? true : 'warn', chrome || '未找到', '安装 Google Chrome：npm run test:smoke 等浏览器测试需要')
  const java = env.JAVA_PATH || 'java'
  const javaVersion = run(java, ['-version'])
  // "1.8.0_492" is Java 8, "23.0.2" is Java 23
  const match = /version "(\d+)(?:\.(\d+))?/.exec(javaVersion.out)
  const major = match ? Number(match[1] === '1' ? match[2] : match[1]) : 0
  report(`Java（${java}）`, major >= 21 ? true : 'warn', javaVersion.ok ? `Java ${major}` : '未找到', 'npm run build:osm 构建新地区时需要 Java 21+（推荐 23），在 .env 设置 JAVA_PATH')
  const ffprobe = env.FFPROBE_PATH || 'ffprobe'
  report(`ffprobe（${ffprobe}）`, run(ffprobe, ['-version']).ok ? true : 'warn', '', '回忆短片的自动化测试用它检查 MP4；FFmpeg 的发行包里自带 ffprobe，在 .env 设置 FFPROBE_PATH')
  const planetiler = existsSync(join(root, 'world-data/sources/planetiler.jar'))
  report('Planetiler', planetiler ? true : 'warn', planetiler ? 'world-data/sources/planetiler.jar' : '未下载', '下载到 world-data/sources/planetiler.jar：https://github.com/onthegomap/planetiler/releases')
}

// ---- 结论 ----------------------------------------------------------------------------------------
const failed = results.filter((r) => r.ok === false)
const warned = results.filter((r) => r.ok === 'warn')
console.log('')
if (failed.length) {
  console.log(red(bold(`✘ 有 ${failed.length} 项不满足，${reportOnly ? '服务无法完整运行' : '服务没有启动'}：`)))
  for (const r of failed) console.log(red(`  · ${r.group.split(' · ')[0]}：${r.name}`))
  console.log(dim('  修好后重新运行 npm run dev；只检查不启动用 npm run check'))
  process.exit(1)
}
console.log(green(bold(`✔ 环境检查通过（${results.length - warned.length} 项满足${warned.length ? `，${warned.length} 项开发工具提示` : ''}）${reportOnly ? '' : '，启动服务…'}`)))
process.exit(0)

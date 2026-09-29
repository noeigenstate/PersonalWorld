// Compares two ways of looking at the same reconstructed relief (real GLB from the local ComfyUI):
//   without the skill: the first viewer — orbit the bounding-box centre by up to 0.4 / 0.3 rad, dolly in to 0.5×,
//                      field of view guessed from the mesh's extents, no photo behind
//   with the skill:    what SpacetimeScene.tsx does now (constants read from the source, so this follows the code)
// Metrics, both on a 4:3 frame like the photo:
//   initialDiff   mean |render − original photo| (0–255) from the first pose: how faithful the first view is
//   extremeEmpty  share of pixels showing nothing (a sentinel colour) at the widest pose, worst of the four corners
// The "without" run is the known failing sample: the scoring must flag it (checked below) before it is trusted.
// node skills/spacetime-modeling/evals/2026-09-29/run-eval.mjs
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { reconstructRelief, reliefCapability } from '../../../../server/spacetimeScene.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const root = join(here, '../../../../')
const photoPath = join(here, 'images/bridge.jpg')
const capability = await reliefCapability()
assert.ok(capability.available, `需要本机 ComfyUI + Depth Anything 3：${capability.reason}`)
const glb = await reconstructRelief(readFileSync(photoPath))

const source = readFileSync(join(root, 'src/components/SpacetimeScene.tsx'), 'utf8')
const sway = source.match(/SWAY = \{ azimuth: ([\d.]+), polar: ([\d.]+) \}/)
const skill = { azimuth: Number(sway[1]), polar: Number(sway[2]), halfTanX: 0.5 / 0.7, extend: Number(source.match(/const extend = ([\d.]+)/)[1]) }

// A tiny static server so the page can import three from node_modules
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html' }
const server = http.createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname
  if (path === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(`<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script><body></body>`) }
  let body
  try { body = readFileSync(join(root, path)) } catch { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' }); res.end(body)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
  await page.goto(`http://127.0.0.1:${server.address().port}/`)
  const result = await page.evaluate(async ({ glbBase64, photoBase64, skill }) => {
    const THREE = await import('three')
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
    const W = 800, H = 600
    const bytes = Uint8Array.from(atob(glbBase64), (c) => c.charCodeAt(0)).buffer
    const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(bytes, '', resolve, reject))
    const model = gltf.scene
    model.traverse((o) => { if (o.isMesh) o.material = new THREE.MeshBasicMaterial({ map: o.material.map, side: THREE.DoubleSide }) })
    model.updateMatrixWorld(true)
    const photo = new Image(); photo.src = `data:image/jpeg;base64,${photoBase64}`; await photo.decode()
    const truth = document.createElement('canvas'); truth.width = W; truth.height = H
    truth.getContext('2d').drawImage(photo, 0, 0, W, H)
    const truthPixels = truth.getContext('2d').getImageData(0, 0, W, H).data

    const points = []
    model.traverse((o) => { if (!o.isMesh) return; const p = o.geometry.getAttribute('position'); const step = Math.max(1, Math.floor(p.count / 30000)); for (let i = 0; i < p.count; i += step) points.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld)) })
    const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true })
    renderer.setSize(W, H, false); renderer.setPixelRatio(1)
    document.body.append(renderer.domElement)
    const SENTINEL = new THREE.Color(0xff00ff)
    const read = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.drawImage(renderer.domElement, 0, 0); return g.getImageData(0, 0, W, H).data }
    const measure = (pixels) => {
      let empty = 0, diff = 0
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] > 245 && pixels[i + 1] < 12 && pixels[i + 2] > 245) empty++
        diff += (Math.abs(pixels[i] - truthPixels[i]) + Math.abs(pixels[i + 1] - truthPixels[i + 1]) + Math.abs(pixels[i + 2] - truthPixels[i + 2])) / 3
      }
      return { empty: empty / (W * H), diff: diff / (W * H) }
    }
    const png = () => renderer.domElement.toDataURL('image/png').split(',')[1]
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.001, 1e6)

    function place(target, offset) { camera.position.copy(target).add(offset); camera.lookAt(target); camera.updateMatrixWorld() }
    function extents() {
      let tanX = 0, tanY = 0; const v = new THREE.Vector3()
      for (const p of points) { v.copy(p).applyMatrix4(camera.matrixWorldInverse); if (v.z > -1e-6) continue; tanX = Math.max(tanX, Math.abs(v.x / v.z)); tanY = Math.max(tanY, Math.abs(v.y / v.z)) }
      return { tanX, tanY }
    }
    const out = {}

    // ---- without the skill: the first viewer ----
    {
      const scene = new THREE.Scene(); scene.background = SENTINEL; scene.add(model)
      const box = new THREE.Box3().setFromObject(model)
      const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3())
      const origin = new THREE.Vector3()
      const fromOrigin = !box.containsPoint(origin) && center.distanceTo(origin) > size.length() * 0.2
      const direction = fromOrigin ? center.clone().sub(origin).normalize() : new THREE.Vector3(0, 0, 1)
      const distance = fromOrigin ? center.distanceTo(origin) : size.length()
      const start = direction.clone().multiplyScalar(-distance)
      place(center, start)
      const { tanX, tanY } = extents()
      camera.fov = Math.min(110, Math.max(25, THREE.MathUtils.radToDeg(2 * Math.atan(Math.max(tanY, tanX / camera.aspect))) * 1.02)); camera.updateProjectionMatrix()
      place(center, start); renderer.render(scene, camera)
      const initial = measure(read()); const initialPng = png()
      // widest pose the old controls allowed: dolly to 0.5×, azimuth +0.4, polar −0.3 (and the mirror image)
      const s0 = new THREE.Spherical().setFromVector3(start)
      let worst = { empty: 0, diff: 0 }; let worstPng = ''
      for (const [da, dp] of [[0.4, -0.3], [-0.4, -0.3], [0.4, 0.3], [-0.4, 0.3]]) {
        const s = new THREE.Spherical(distance * 0.5, THREE.MathUtils.clamp(s0.phi + dp, 0.05, Math.PI - 0.05), s0.theta + da)
        place(center, new THREE.Vector3().setFromSpherical(s)); renderer.render(scene, camera)
        const m = measure(read()); if (m.empty >= worst.empty) { worst = m; worstPng = png() }
      }
      out.without = { initialDiff: initial.diff, initialEmpty: initial.empty, extremeEmpty: worst.empty, initialPng, extremePng: worstPng }
      scene.remove(model)
    }

    // ---- with the skill: what SpacetimeScene.tsx does ----
    {
      const scene = new THREE.Scene(); scene.background = SENTINEL; scene.add(model)
      const depths = points.map((p) => -p.z).filter((d) => d > 0).sort((a, b) => a - b)
      const median = depths[Math.floor(depths.length / 2)], far = depths[Math.floor(depths.length * 0.97)]
      const target = new THREE.Vector3(0, 0, -median)
      const aspect = photo.naturalWidth / photo.naturalHeight
      const frameX = skill.halfTanX, frameY = frameX / aspect
      camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.max(frameY, frameX / camera.aspect))) * 1.02
      camera.near = median / 100; camera.far = far * 4; camera.updateProjectionMatrix()
      const c = document.createElement('canvas'); c.width = 512; c.height = Math.round(512 / aspect); c.getContext('2d').drawImage(photo, 0, 0, c.width, c.height)
      const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.MirroredRepeatWrapping
      texture.repeat.set(skill.extend, skill.extend); texture.offset.set((1 - skill.extend) / 2, (1 - skill.extend) / 2)
      const distance = far * 1.2
      const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(distance * frameX * 2 * skill.extend, distance * frameY * 2 * skill.extend), new THREE.MeshBasicMaterial({ map: texture, depthWrite: false }))
      backdrop.position.set(0, 0, -distance); backdrop.renderOrder = -1; scene.add(backdrop)
      place(target, new THREE.Vector3(0, 0, median)); renderer.render(scene, camera)
      const initial = measure(read()); const initialPng = png()
      const s0 = new THREE.Spherical().setFromVector3(new THREE.Vector3(0, 0, median))
      let worst = { empty: 0 }; let worstPng = ''
      for (const [da, dp] of [[1, -1], [-1, -1], [1, 1], [-1, 1]]) {
        const s = new THREE.Spherical(median, s0.phi + dp * skill.polar, s0.theta + da * skill.azimuth)
        place(target, new THREE.Vector3().setFromSpherical(s)); renderer.render(scene, camera)
        const m = measure(read()); if (m.empty >= worst.empty) { worst = m; worstPng = png() }
      }
      out.with = { initialDiff: initial.diff, initialEmpty: initial.empty, extremeEmpty: worst.empty, initialPng, extremePng: worstPng }
    }
    return out
  }, { glbBase64: glb.toString('base64'), photoBase64: readFileSync(photoPath).toString('base64'), skill })

  for (const [name, key] of [['without', 'without'], ['with', 'with']]) {
    writeFileSync(join(here, `${name}-skill-initial.png`), Buffer.from(result[key].initialPng, 'base64'))
    writeFileSync(join(here, `${name}-skill-extreme.png`), Buffer.from(result[key].extremePng, 'base64'))
  }
  const scores = { without: { initialDiff: +result.without.initialDiff.toFixed(1), extremeEmpty: +result.without.extremeEmpty.toFixed(4) }, with: { initialDiff: +result.with.initialDiff.toFixed(1), extremeEmpty: +result.with.extremeEmpty.toFixed(4) }, skill }
  writeFileSync(join(here, 'results.json'), JSON.stringify(scores, null, 2) + '\n')
  console.log(JSON.stringify(scores, null, 2))
  // The failing sample must be flagged, the skill's view must pass — otherwise the scoring is not trusted
  const passes = (s) => s.initialDiff < 25 && s.extremeEmpty < 0.02
  assert.equal(passes(scores.without), false, '没有 skill 的旧查看器应被判为不合格（评分失效）')
  assert.equal(passes(scores.with), true, `skill 的查看器应合格：${JSON.stringify(scores.with)}`)
  console.log('对比通过：旧查看器不合格，skill 的查看器合格。')
} finally {
  await browser.close()
  server.close()
}

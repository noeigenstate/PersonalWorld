import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Box, LoaderCircle, X } from 'lucide-react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { MemoryAsset, MemoryEvent } from '../types'
import { EVIDENCE_LABEL, LAYER_LABEL, requestRelief, requestScenePlan, scenePhotos, scenePlaceName, type ReliefCapability, type ScenePlan } from '../lib/spacetime'
import './spacetimeScene.css'

// A place's story line, seen in 4D: the same spot at each time it was photographed. The
// spacetime-scene skill splits the photos into dated epochs with evidence per layer; the epoch's
// key photo can be reconstructed into a relief model on the service computer and looked around.
// No entry button of its own: the life butler opens it (`openRequest` changes) when asked how a place looked over time
export function SpacetimeScene({ assets, events, city, onPhoto, openRequest, entry = false }: { assets: MemoryAsset[]; events: MemoryEvent[]; city: string; onPhoto: (id: string) => void; openRequest?: { at: number } | null; entry?: boolean }) {
  const [open, setOpen] = useState(false)
  useEffect(() => { if (openRequest) setOpen(true) }, [openRequest])
  const [plan, setPlan] = useState<ScenePlan | null>(null)
  const [capability, setCapability] = useState<ReliefCapability | null>(null)
  const [scenes, setScenes] = useState<string[]>([])
  const [current, setCurrent] = useState(0)
  const [busy, setBusy] = useState(false)
  const [building, setBuilding] = useState('')
  const [error, setError] = useState('')
  const photos = useMemo(() => scenePhotos(assets, events, city), [assets, events, city])
  const place = useMemo(() => scenePlaceName(assets, photos, city), [assets, photos, city])
  const planKey = photos.map((p) => `${p.id}:${p.date}`).join('|')
  useEffect(() => { generation.current++; setPlan(null); setCurrent(0); setError(''); setBusy(false) }, [planKey])
  // One plan request per set of photos; an answer that arrives after the photos changed is dropped
  const generation = useRef(0)
  useEffect(() => {
    if (!open || plan || !photos.length) return
    const mine = ++generation.current
    setBusy(true)
    setError('')
    requestScenePlan(place, photos)
      .then((result) => { if (generation.current !== mine) return; setPlan(result.plan); setCapability(result.capability); setScenes(result.scenes); setCurrent(0) })
      .catch((e: Error) => { if (generation.current === mine) setError(e.message) })
      .finally(() => { if (generation.current === mine) setBusy(false) })
  }, [open, plan, photos, place])

  const epoch = plan?.epochs[current] || null
  const key = epoch?.keyPhoto ? assets.find((a) => a.id === epoch.keyPhoto) : undefined
  const modelUrl = key && scenes.includes(key.id) ? `/api/spacetime-scene/models/${key.id}` : ''
  async function reconstruct() {
    if (!key) return
    setBuilding(key.id)
    setError('')
    try {
      const result = await requestRelief(key.id, key.preview)
      setScenes((list) => (list.includes(result.id) ? list : [...list, result.id]))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBuilding('')
    }
  }

  return <>
    {entry && <button className="button" onClick={() => setOpen(true)} title="同一个地方在不同时候的样子" aria-label="时空场景"><Box size={16} /><span>时空场景</span></button>}
    {open && createPortal(<div className="modal-backdrop spacetime-backdrop" onClick={() => setOpen(false)}>
      <section className="spacetime-modal" role="dialog" aria-modal="true" aria-labelledby="spacetime-heading" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div><span className="section-kicker">同一个地方，不同的时候</span><h2 id="spacetime-heading">{place}</h2></div>
          <button className="icon-button" aria-label="关闭时空场景" onClick={() => setOpen(false)}><X size={21} /></button>
        </header>
        {busy && <p className="spacetime-status"><LoaderCircle size={16} className="film-spin" /> 正在按时间整理这处地点的照片…</p>}
        {!busy && !plan && !photos.length && <p className="spacetime-status">这处地点还没有可用的照片。</p>}
        {error && <p className="film-error" role="alert">{error}{!plan && photos.length > 0 && <button className="button" onClick={() => setError('')}>重试</button>}</p>}
        {plan && <div className="spacetime-layout">
          <div className="spacetime-stage" data-model={modelUrl ? 'ready' : 'none'}>
            {modelUrl ? <ReliefViewer url={modelUrl} photo={key?.preview || ''} /> : key ? (
              <div className="spacetime-photo">
                <img src={key.preview} alt="" />
                <div className="spacetime-build">
                  {capability?.available
                    ? <button className="button button-primary" disabled={Boolean(building)} onClick={reconstruct}>{building ? <><LoaderCircle size={16} className="film-spin" /> 本机正在重建，约半分钟…</> : '重建这一刻的三维场景'}</button>
                    : <small>{capability?.reason || '本机没有三维重建能力'}；先看原图</small>}
                </div>
              </div>
            ) : <div className="spacetime-empty">{epoch ? '这个时段没有适合重建的照片，只能看原图' : '这处地点的照片都没有可靠日期，还组不成时段'}</div>}
          </div>
          <aside className="spacetime-side">
            <nav className="spacetime-epochs" aria-label="时间片">
              {plan.epochs.map((e, i) => <button key={e.id} className={i === current ? 'active' : ''} aria-pressed={i === current} onClick={() => setCurrent(i)}>
                <b>{e.from === e.to ? e.from : `${e.from} ~ ${e.to}`}</b><span>{e.title || '未命名时段'}</span>{e.keyPhoto && scenes.includes(e.keyPhoto) && <i title="已有三维场景" />}
              </button>)}
            </nav>
            {epoch && <div className="spacetime-epoch">
              {epoch.caption && <p className="spacetime-caption">{epoch.caption}</p>}
              <ul className="spacetime-layers">
                {(['season', 'timeOfDay', 'weather', 'traffic', 'sound'] as const).map((name) => {
                  const layer = epoch.layers[name]
                  return <li key={name}><span>{LAYER_LABEL[name]}</span><b>{layer.value || '—'}</b><em data-evidence={layer.evidence} title={layer.basis}>{EVIDENCE_LABEL[layer.evidence]}</em></li>
                })}
                {epoch.layers.buildings.map((b) => <li key={b.name}><span>建筑</span><b>{b.name}：{b.state}</b><em data-evidence={b.evidence} title={b.basis}>{EVIDENCE_LABEL[b.evidence]}</em></li>)}
              </ul>
              {epoch.changes && <p className="spacetime-changes">变化：{epoch.changes}</p>}
              <div className="spacetime-photos">
                {epoch.photoIds.map((id) => { const a = assets.find((x) => x.id === id); return a ? <button key={id} className={id === epoch.keyPhoto ? 'key' : ''} title={id === epoch.keyPhoto ? '这个时段的关键照片' : '查看照片'} onClick={() => onPhoto(id)}><img src={a.preview} alt="" /></button> : null })}
              </div>
            </div>}
            {plan.undated.length > 0 && <small className="spacetime-note">{plan.undated.length} 张照片没有可靠日期，未进入任何时段。</small>}
            {plan.summary && <p className="spacetime-summary">{plan.summary}</p>}
          </aside>
        </div>}
      </section>
    </div>, document.body)}
  </>
}

// The relief is one photo's depth, not a scanned place: seen from the photo's own vantage point it is
// right, and it only holds for a small sway around it (the depth edges tear open beyond that). So the
// camera stays where the photo was taken (the origin), sways a few degrees around the median depth,
// never dollies in, and the photo itself stands behind the relief, lined up with it: where the sky was
// cut out or an edge tore, the eye finds the photo instead of an empty page.
const SWAY = { azimuth: 0.13, polar: 0.08 }
// Depth Anything 3 (mono) unprojects with a pinhole of fx = fy = 0.7 × image width (server side:
// ComfyUI's DA3GeometryToMesh), so half the frame's width is 0.5 / 0.7 of the focal length
const HALF_TAN_X = 0.5 / 0.7
function ReliefViewer({ url, photo }: { url: string; photo: string }) {
  const host = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  useEffect(() => {
    const el = host.current
    if (!el) return
    setStatus('loading')
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    el.append(renderer.domElement)
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 1000)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.enablePan = false
    let frame = 0
    const draw = () => { controls.update(); renderer.render(scene, camera); frame = requestAnimationFrame(draw) }
    const resize = () => { const w = el.clientWidth || 1, h = el.clientHeight || 1; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false) }
    const observer = new ResizeObserver(resize)
    observer.observe(el)
    resize()
    let disposed = false
    const picture = new Image()
    const pictureReady = photo ? (picture.src = photo, picture.decode().catch(() => undefined)) : Promise.resolve()
    new GLTFLoader().load(url, (gltf) => { void pictureReady.then(() => {
      if (disposed) return
      const model = gltf.scene
      // Coloured by the photo itself: unlit shows it as it was
      model.traverse((object) => {
        const mesh = object as THREE.Mesh
        if (!mesh.isMesh) return
        const old = mesh.material as THREE.MeshStandardMaterial
        mesh.material = new THREE.MeshBasicMaterial({ map: old.map, vertexColors: Boolean(old.vertexColors), side: THREE.DoubleSide })
      })
      scene.add(model)
      model.updateMatrixWorld(true)
      // Vertices as seen from the origin. The mesh keeps the reconstruction's frame: the camera at the
      // origin looks down −z with y up (glTF), so depth is −z
      const points: THREE.Vector3[] = []
      model.traverse((object) => {
        const mesh = object as THREE.Mesh
        if (!mesh.isMesh) return
        const position = mesh.geometry.getAttribute('position')
        const step = Math.max(1, Math.floor(position.count / 30000))
        for (let i = 0; i < position.count; i += step) points.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld))
      })
      if (!points.length) { setStatus('error'); return }
      const forward = new THREE.Vector3(0, 0, -1)
      const depths = points.map((p) => -p.z).filter((d) => d > 0).sort((a, b) => a - b)
      const median = depths[Math.floor(depths.length / 2)] || 1
      const far = depths[Math.floor(depths.length * 0.97)] || median * 2
      const target = forward.clone().multiplyScalar(median)
      camera.position.set(0, 0, 0)
      camera.lookAt(target)
      camera.updateMatrixWorld()
      // The photo's own frame: its aspect from the picture (else from the relief's extents), its
      // angular size from the intrinsics above. The viewport shows all of it.
      let tanX = 0, tanY = 0
      const v = new THREE.Vector3()
      for (const p of points) {
        v.copy(p).applyMatrix4(camera.matrixWorldInverse)
        if (v.z > -1e-6) continue
        tanX = Math.max(tanX, Math.abs(v.x / v.z))
        tanY = Math.max(tanY, Math.abs(v.y / v.z))
      }
      const aspect = picture.naturalWidth ? picture.naturalWidth / picture.naturalHeight : Math.max(0.5, Math.min(2.5, tanX / Math.max(tanY, 1e-3)))
      const frameX = HALF_TAN_X, frameY = HALF_TAN_X / aspect
      camera.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(Math.max(frameY, frameX / camera.aspect))) * 1.02, 20, 110)
      camera.near = median / 100
      camera.far = far * 4
      camera.updateProjectionMatrix()
      controls.target.copy(target)
      controls.enableZoom = false
      const spherical = new THREE.Spherical().setFromVector3(camera.position.clone().sub(target))
      controls.minPolarAngle = Math.max(0.05, spherical.phi - SWAY.polar)
      controls.maxPolarAngle = Math.min(Math.PI - 0.05, spherical.phi + SWAY.polar)
      controls.minAzimuthAngle = spherical.theta - SWAY.azimuth
      controls.maxAzimuthAngle = spherical.theta + SWAY.azimuth
      // The photo behind everything, at the angular size of the relief's own frame (so from the vantage
      // point it lies exactly under it), extended past the edges by mirroring
      if (picture.naturalWidth) {
        const canvas = document.createElement('canvas')
        canvas.width = 512
        canvas.height = Math.max(8, Math.round(512 / aspect))
        canvas.getContext('2d')!.drawImage(picture, 0, 0, canvas.width, canvas.height)
        const texture = new THREE.CanvasTexture(canvas)
        texture.colorSpace = THREE.SRGBColorSpace
        texture.wrapS = texture.wrapT = THREE.MirroredRepeatWrapping
        const extend = 2.4
        texture.repeat.set(extend, extend)
        texture.offset.set((1 - extend) / 2, (1 - extend) / 2)
        const distance = far * 1.2
        const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(distance * frameX * 2 * extend, distance * frameY * 2 * extend), new THREE.MeshBasicMaterial({ map: texture, depthWrite: false }))
        backdrop.position.copy(forward).multiplyScalar(distance)
        backdrop.lookAt(0, 0, 0)
        backdrop.renderOrder = -1
        scene.add(backdrop)
      }
      controls.update()
      setStatus('ready')
    }) }, undefined, () => { if (!disposed) setStatus('error') })
    draw()
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      controls.dispose()
      scene.traverse((object) => { const mesh = object as THREE.Mesh; if (mesh.isMesh) { mesh.geometry.dispose(); const m = mesh.material as THREE.MeshBasicMaterial; m.map?.dispose(); m.dispose() } })
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [url])
  return <div className="spacetime-viewer" ref={host} data-status={status} aria-label="三维场景：拖动可以在拍照的位置稍微环视">
    {status === 'loading' && <p className="spacetime-status"><LoaderCircle size={16} className="film-spin" /> 正在载入模型…</p>}
    {status === 'error' && <p className="spacetime-status">模型没有载入</p>}
  </div>
}

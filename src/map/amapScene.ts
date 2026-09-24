import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import type { MemoryEvent } from '../types'
import { wgs84ToGcj02 } from '../lib/geo'
import { LAND, adder, box, building, createLabels, dim, eventLabel, placeLabel, seeded } from './objects'
import type { AMapNS } from './amap'
import type { LifeMapCallbacks, LifeMapData } from './scene'

// Real AMap 3D base map with the cartoon layer on top.
// AMap renders with WebGL 1 and three r186 needs WebGL 2, so the cartoon layer uses its own
// transparent canvas; a GLCustomLayer only supplies the frame hook and the camera.
// customCoords units are Web Mercator metres, z up. Objects keep a constant on-screen size
// by scaling with the zoom level ("unit" = metres per scene unit).

const PX_PER_UNIT = 26
const unitMetres = (zoom: number) => (156543.034 / 2 ** zoom) * PX_PER_UNIT

interface Scaled { object: THREE.Object3D }

export function createAmapLifeMap(container: HTMLElement, callbacks: LifeMapCallbacks, AMap: AMapNS) {
  const mapEl = document.createElement('div')
  mapEl.className = 'life-map-amap'
  const canvas = document.createElement('canvas')
  canvas.className = 'life-map-canvas overlay'
  const labelLayer = document.createElement('div')
  labelLayer.className = 'life-map-labels'
  container.append(mapEl, canvas, labelLayer)

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const map = new AMap.Map(mapEl, {
    viewMode: '3D',
    pitch: 50,
    zoom: 5,
    center: [108.9, 34.3],
    mapStyle: 'amap://styles/macaron',
    features: ['bg', 'road'],
    showLabel: true,
    showBuildingBlock: false,
    animateEnable: !reduceMotion,
  })

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd7e8c8, 1.5))
  const sun = new THREE.DirectionalLight(0xffffff, 1.9)
  sun.position.set(-0.4, -0.6, 1) // z is up in AMap's frame
  scene.add(sun)
  const camera = new THREE.PerspectiveCamera()
  const world = new THREE.Group()
  scene.add(world)
  const labels = createLabels(labelLayer)
  const raycaster = new THREE.Raycaster()

  let origin: [number, number] | null = null
  let size = { w: 1, h: 1 }
  let insets = { right: 0, bottom: 0 }
  let unit = unitMetres(5)
  let scaled: Scaled[] = []
  let lines: LineMaterial[] = []
  let current: LifeMapData | null = null
  let lastSignature = ''
  const heights = new Map<string, number>() // label heights in scene units

  const gcj = (lat: number, lng: number): [number, number] => { const p = wgs84ToGcj02({ lat, lng }); return [p.lng, p.lat] }
  const coord = (lat: number, lng: number) => {
    const [x, y] = map.customCoords.lngLatsToCoords([gcj(lat, lng)])[0]
    return new THREE.Vector3(x, y, 0)
  }

  // A y-up cartoon object stood upright in AMap's z-up frame, scaled with zoom
  function stand(object: THREE.Object3D, at: THREE.Vector3) {
    const wrapper = new THREE.Group()
    wrapper.rotation.x = Math.PI / 2
    wrapper.position.copy(at)
    wrapper.add(object)
    world.add(wrapper)
    scaled.push({ object: wrapper })
    return wrapper
  }

  function fatLine(points: THREE.Vector3[], color: number, width: number, opacity = 1) {
    const geometry = new LineGeometry()
    geometry.setPositions(points.flatMap((p) => [p.x, p.y, p.z]))
    const material = new LineMaterial({ color, linewidth: width, transparent: opacity < 1, opacity, worldUnits: false })
    material.resolution.set(size.w, size.h)
    lines.push(material)
    const line = new Line2(geometry, material)
    line.computeLineDistances()
    world.add(line)
    return line
  }

  function build(data: LifeMapData) {
    world.traverse((child) => {
      const mesh = child as THREE.Mesh
      mesh.geometry?.dispose()
      ;(mesh.material as THREE.Material | undefined)?.dispose()
    })
    world.clear()
    labels.clear()
    scaled = []
    lines = []
    heights.clear()
    const located = data.places.filter((p) => p.lat !== undefined && p.lng !== undefined)
    if (!origin && located.length) origin = gcj(located[0].lat!, located[0].lng!)
    if (!origin) return
    map.customCoords.setCenter(origin)
    const rnd = seeded(7)
    const selected = data.selectedCity

    const positions = new Map(located.map((p) => [p.city, coord(p.lat!, p.lng!)]))
    for (const place of located) {
      const pos = positions.get(place.city)!
      if (selected && selected !== place.city && !place.isBase) continue
      // Zoomed into a city the map itself is the place; its building would cover the story
      if (selected === place.city) continue
      const group = new THREE.Group()
      const s = place.isBase ? 0.85 + Math.min(0.45, place.eventIds.length * 0.03) : 1
      group.scale.setScalar(s)
      // Cartoon objects are modelled standing on a board LAND units high; the map is the board here
      group.position.y = -LAND * s
      heights.set(place.city, (building(group, place.role, rnd) - LAND) * s + 0.2)
      group.traverse((child) => { child.userData.city = place.city })
      if (selected && selected !== place.city) dim(group, 0.4)
      stand(group, pos)
      const spec = placeLabel(place, selected)
      labels.add(spec.className, new THREE.Vector3(pos.x, pos.y, heights.get(place.city)!), spec.lines, () => callbacks.onSelectCity(place.city), spec.priority)
    }

    // Space line: geographic arcs between life bases, height proportional to distance
    for (let i = 1; i < data.bases.length; i++) {
      const a = positions.get(data.bases[i - 1].city)
      const b = positions.get(data.bases[i].city)
      if (!a || !b) continue
      const mid = a.clone().add(b).multiplyScalar(0.5)
      mid.z = a.distanceTo(b) * 0.22
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b)
      fatLine(curve.getPoints(64), 0x2fae76, 5, selected ? 0.45 : 1)
      const tip = curve.getPointAt(0.97)
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 16), new THREE.MeshToonMaterial({ color: 0x2fae76 }))
      const holder = new THREE.Group()
      holder.position.copy(tip)
      holder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangentAt(0.97).normalize())
      holder.add(cone)
      if (selected) dim(holder, 0.45)
      world.add(holder)
      scaled.push({ object: holder })
    }

    // Story line: events at their real positions, in time order
    const cityPos = selected ? positions.get(selected) : undefined
    if (selected && cityPos && data.story.length) {
      const nodes = data.story.map((event, index) => ({ event, pos: storyPosition(event, index, data.story.length, cityPos, positions) }))
      if (nodes.length > 1) fatLine(new THREE.CatmullRomCurve3(nodes.map((n) => n.pos), false, 'centripetal').getPoints(nodes.length * 24), 0xf08a24, 6)
      for (const { event, pos } of nodes) {
        const now = event.id === data.highlightedEventId
        const unsure = event.citySource === 'ai'
        const disc = new THREE.Group()
        const add = adder(disc)
        const base = add(new THREE.CylinderGeometry(now ? 0.36 : 0.26, now ? 0.38 : 0.28, 0.18, 32), 0xffffff, [0, 0.09, 0], { outlineScale: 1.05 })
        add(new THREE.CylinderGeometry(now ? 0.24 : 0.16, now ? 0.24 : 0.16, 0.06, 32), unsure ? 0xf0a14a : 0xf08a24, [0, 0.2, 0], { outline: false })
        if (now) add(new THREE.TorusGeometry(0.6, 0.05, 8, 48), 0xf08a24, [0, 0.03, 0], { rot: [-Math.PI / 2, 0, 0], outline: false, shadow: false })
        if (unsure) {
          for (let i = 0; i < 16; i++) {
            const a = (i / 16) * Math.PI * 2
            add(box(0.14, 0.03, 0.05), 0xf0a14a, [Math.cos(a) * 0.5, 0.02, Math.sin(a) * 0.5], { rot: [0, -a + Math.PI / 2, 0], outline: false, shadow: false })
          }
        }
        disc.traverse((child) => { child.userData.eventId = event.id })
        base.userData.eventId = event.id
        stand(disc, pos)
        const spec = eventLabel(event, now, unsure)
        labels.add(spec.className, new THREE.Vector3(pos.x, pos.y, 0.5), spec.lines, () => callbacks.onOpenEvent(event.id), spec.priority)
      }
    }
  }

  // Events without coordinates sit on a small ring around the city in time order
  function storyPosition(event: MemoryEvent, index: number, count: number, cityPos: THREE.Vector3, positions: Map<string, THREE.Vector3>) {
    if (event.lat !== undefined && event.lng !== undefined) return coord(event.lat, event.lng)
    const trip = event.city ? positions.get(event.city) : undefined
    if (trip && !trip.equals(cityPos)) return trip.clone()
    const angle = -Math.PI / 2 + (index / Math.max(1, count)) * Math.PI * 2
    return cityPos.clone().add(new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0).multiplyScalar(unit * 2.4))
  }

  function draw() {
    if (!origin) { labels.place(camera, size.w, size.h); return }
    const cc = map.customCoords
    cc.setCenter(origin)
    const { near, far, fov, up, lookAt, position } = cc.getCameraParams()
    camera.near = near
    camera.far = far
    camera.fov = fov
    camera.aspect = size.w / size.h
    camera.position.set(position[0], position[1], position[2])
    camera.up.set(up[0], up[1], up[2])
    camera.lookAt(lookAt[0], lookAt[1], lookAt[2])
    camera.updateProjectionMatrix()
    unit = unitMetres(map.getZoom())
    for (const { object } of scaled) object.scale.setScalar(unit)
    for (const material of lines) material.resolution.set(size.w, size.h)
    renderer.render(scene, camera)
    labels.place(camera, size.w, size.h, (anchor) => new THREE.Vector3(anchor.x, anchor.y, anchor.z * unit))
  }

  const layer = new AMap.GLCustomLayer({ zIndex: 120, init() {}, render: draw })
  map.add(layer)

  // Frame the content in the space left by the heading, the time bar and the butler
  function frame(data: LifeMapData, instant: boolean) {
    const selected = data.selectedCity
    const points: [number, number][] = []
    if (selected) {
      const inCity = data.story.filter((e) => e.city === selected && e.lat !== undefined && e.lng !== undefined)
      for (const e of inCity) points.push(gcj(e.lat!, e.lng!))
      const place = data.places.find((p) => p.city === selected)
      if (!points.length && place?.lat !== undefined) points.push(gcj(place.lat, place.lng!))
    } else {
      for (const p of data.places) if (p.lat !== undefined) points.push(gcj(p.lat, p.lng!))
    }
    if (!points.length) return
    const lngs = points.map((p) => p[0])
    const lats = points.map((p) => p[1])
    // Pad tiny extents so a single place doesn't zoom to street level
    const pad = selected ? 0.012 : 0.8
    const bounds = new AMap.Bounds([Math.min(...lngs) - pad, Math.min(...lats) - pad], [Math.max(...lngs) + pad, Math.max(...lats) + pad])
    map.setPitch(selected ? 55 : 45, instant)
    map.setRotation(0, instant)
    // avoid: [top, bottom, left, right] in pixels
    map.setBounds(bounds, instant || reduceMotion, [150, insets.bottom + 40, 120, insets.right + 120])
  }

  map.on('click', (event: { pixel: { x: number; y: number } }) => {
    const pointer = new THREE.Vector2((event.pixel.x / size.w) * 2 - 1, -(event.pixel.y / size.h) * 2 + 1)
    raycaster.setFromCamera(pointer, camera)
    const hit = raycaster.intersectObjects(world.children, true).find((h) => h.object.userData.eventId || h.object.userData.city)
    if (hit?.object.userData.eventId) callbacks.onOpenEvent(hit.object.userData.eventId)
    else if (hit?.object.userData.city) callbacks.onSelectCity(hit.object.userData.city)
  })

  function resize() {
    size = { w: Math.max(1, container.clientWidth), h: Math.max(1, container.clientHeight) }
    renderer.setSize(size.w, size.h, false)
    draw()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(container)

  let ready = false
  let pending: LifeMapData | null = null
  map.on('complete', () => {
    ready = true
    if (pending) api.update(pending)
  })

  const api = {
    update(data: LifeMapData) {
      if (!ready) { pending = data; return }
      current = data
      build(data)
      const signature = `${data.selectedCity}|${data.places.map((p) => p.city).join()}|${data.story.map((e) => e.id).join()}`
      if (signature !== lastSignature) {
        frame(data, !lastSignature)
        lastSignature = signature
      }
      draw()
    },
    setInsets(next: { right: number; bottom: number }) {
      if (next.right === insets.right && next.bottom === insets.bottom) return
      insets = next
      if (current && ready) frame(current, false)
    },
    dispose() {
      observer.disconnect()
      map.destroy()
      renderer.dispose()
      mapEl.remove()
      canvas.remove()
      labelLayer.remove()
    },
  }
  return api
}

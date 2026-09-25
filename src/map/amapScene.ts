import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'
import type { MemoryEvent } from '../types'
import { wgs84ToGcj02 } from '../lib/geo'
import { LAND, adder, box, building, createLabels, dim, eventLabel, placeLabel, seeded } from './objects'
import { createMemoryScene, createOrientalPearlScene, isOrientalPearl, ORIENTAL_PEARL_GCJ } from './memoryScene'
import { createStyledDistrict, shanghaiScene, type SceneData } from './styledDistrict'
import { fetchRegionScene, hasStreetLocation, metresApart, regionForPhoto } from './regionScene'
import type { AMapNS } from './amap'
import type { LifeMapCallbacks, LifeMapData, MapPhoto } from './scene'

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
  const atmosphere = document.createElement('div')
  atmosphere.className = 'map-scene-atmosphere'
  atmosphere.hidden = true
  const photoLayer = document.createElement('div')
  photoLayer.className = 'life-map-photos'
  const labelLayer = document.createElement('div')
  labelLayer.className = 'life-map-labels'
  container.append(mapEl, canvas, atmosphere, photoLayer, labelLayer)
  const sceneSource = document.createElement('div')
  sceneSource.className = 'map-scene-source'
  const osmCredit = document.createElement('a')
  osmCredit.href = 'https://www.openstreetmap.org/copyright'
  osmCredit.target = '_blank'
  osmCredit.rel = 'noopener noreferrer'
  osmCredit.textContent = '© OpenStreetMap contributors · ODbL'
  const tileCredit = document.createElement('a')
  tileCredit.href = 'https://openmaptiles.org/'
  tileCredit.target = '_blank'
  tileCredit.rel = 'noopener noreferrer'
  tileCredit.textContent = '© OpenMapTiles'
  tileCredit.hidden = true
  sceneSource.append(osmCredit, tileCredit)
  sceneSource.hidden = true
  container.append(sceneSource)
  const sceneCaption = document.createElement('div')
  sceneCaption.className = 'map-scene-caption'
  sceneCaption.hidden = true
  photoLayer.append(sceneCaption)

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const map = new AMap.Map(mapEl, {
    viewMode: '3D',
    pitch: 50,
    zoom: 5,
    center: [108.9, 34.3],
    mapStyle: 'amap://styles/fresh',
    features: ['bg', 'road'],
    showLabel: false,
    showBuildingBlock: false,
    animateEnable: !reduceMotion,
  })
  const buildings = new AMap.Buildings({
    zooms: [16.8, 20],
    wallColor: '#d9b9a5',
    roofColor: '#fff0dc',
    heightFactor: 1,
  })
  map.add(buildings)

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.shadowMap.autoUpdate = false
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0xfff7e9, 0xc7d8d1, .95))
  const sun = new THREE.DirectionalLight(0xffecd7, 1.3)
  sun.position.set(-0.55, -0.7, 1.1) // z is up in AMap's frame
  sun.castShadow = true
  sun.shadow.mapSize.set(window.innerWidth < 700 ? 1024 : 2048, window.innerWidth < 700 ? 1024 : 2048)
  sun.shadow.camera.left = sun.shadow.camera.bottom = -1300
  sun.shadow.camera.right = sun.shadow.camera.top = 1300
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 3600
  sun.shadow.bias = -.00015
  sun.shadow.normalBias = .7
  sun.shadow.radius = 4
  scene.add(sun, sun.target)
  const camera = new THREE.PerspectiveCamera()
  const world = new THREE.Group()
  const memoryWorld = new THREE.Group()
  scene.add(world, memoryWorld)
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
  let ready = false
  let sceneEnabled = true
  let memoryAnchor: THREE.Vector3 | null = null
  let activeSceneKey = ''
  let hasStyledDistrict = false
  let sceneGeneration = 0
  let shadowSceneWasVisible = false
  type BuildingArea = { visible?: boolean; color1?: string; color2?: string; path: [number, number][] }
  let sceneAreas: BuildingArea[] = []
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
    memoryWorld.visible = sceneEnabled && map.getZoom() >= 16.7
    if (memoryWorld.visible && !shadowSceneWasVisible) renderer.shadowMap.needsUpdate = true
    shadowSceneWasVisible = memoryWorld.visible
    sceneSource.hidden = !(memoryWorld.visible && hasStyledDistrict)
    atmosphere.hidden = sceneSource.hidden
    for (const { object } of scaled) object.scale.setScalar(unit)
    for (const material of lines) material.resolution.set(size.w, size.h)
    renderer.render(scene, camera)
    const taken = placePhotos()
    if (memoryWorld.visible && memoryAnchor) {
      const marker = memoryAnchor.clone().project(camera)
      const x = ((marker.x + 1) / 2) * size.w
      const y = ((1 - marker.y) / 2) * size.h
      sceneCaption.hidden = marker.z > 1 || x < 0 || x > size.w || y < 0 || y > size.h
      if (!sceneCaption.hidden) {
        const narrow = size.w < 640
        const captionX = Math.max(8, Math.min(size.w - insets.right - 220, narrow ? x - 60 : x + 158))
        const captionY = narrow ? y + 95 : insets.right ? y + 65 : y - 80
        sceneCaption.style.transform = `translate(${captionX}px, ${Math.max(65, Math.min(size.h - insets.bottom - 80, captionY))}px)`
      }
    } else sceneCaption.hidden = true
    // Overview: place labels step around photos. In a city's story, event labels come first.
    labels.place(camera, size.w, size.h, (anchor) => new THREE.Vector3(anchor.x, anchor.y, anchor.z * unit), current?.selectedCity ? [] : taken)
  }

  const layer = new AMap.GLCustomLayer({ zIndex: 120, init() {}, render: draw })
  map.add(layer)

  // Photo thumbnails clustered by screen position, with a count badge, like a phone album's map.
  // Drawn here rather than as AMap markers: AMap keeps its markers inside a stacking context that
  // sits under this cartoon canvas, so the 3D buildings covered them.
  let photos: { photo: MapPhoto; at: THREE.Vector3 }[] = []
  let photoKey = ''
  let focusedId: string | null = null
  const shown = new Map<string, HTMLButtonElement>()
  const CELL = 84
  function clearMemoryScene() {
    sceneGeneration++
    memoryWorld.traverse((child) => {
      const mesh = child as THREE.Mesh
      mesh.geometry?.dispose()
      if (child instanceof Reflector) { child.dispose(); return }
      const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
      for (const material of materials) {
        if ('map' in material) (material.map as THREE.Texture | null)?.dispose()
        material.dispose()
      }
    })
    memoryWorld.clear()
    memoryAnchor = null
    activeSceneKey = ''
    hasStyledDistrict = false
    sceneAreas = []
    sceneCaption.hidden = true
    sceneSource.hidden = true
    buildings.setStyle({ hideWithoutStyle: false, areas: [] })
  }

  function focusMemoryScene(photo?: MapPhoto) {
    clearMemoryScene()
    const generation = sceneGeneration
    const pearl = !photo || isOrientalPearl(photo.landmark)
    const point = pearl ? ORIENTAL_PEARL_GCJ : photo.gcj
    if (!origin) origin = point
    map.customCoords.setCenter(origin)
    const [x, y] = map.customCoords.lngLatsToCoords([point])[0]
    memoryAnchor = new THREE.Vector3(x, y, 0)
    const miniature = photo ? createMemoryScene(photo) : createOrientalPearlScene()
    activeSceneKey = photo ? `${photo.id}:${photo.landmark || ''}:${photo.landmarkSource || ''}:${photo.gcj.join(',')}` : 'public:oriental-pearl'
    const upright = new THREE.Group()
    upright.rotation.x = Math.PI / 2
    upright.position.copy(memoryAnchor)
    upright.add(miniature.group)
    upright.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true
        child.receiveShadow = true
      }
    })
    memoryWorld.add(upright)
    sun.position.copy(memoryAnchor).add(new THREE.Vector3(-800, -750, 1200))
    sun.target.position.copy(memoryAnchor)
    sun.target.updateMatrixWorld()
    sun.shadow.camera.updateProjectionMatrix()
    renderer.shadowMap.needsUpdate = true
    sceneCaption.replaceChildren()
    const title = document.createElement('strong')
    title.textContent = miniature.label
    const note = document.createElement('small')
    note.textContent = `${!photo ? '高德地标位置' : photo.landmarkSource === 'place' ? '照片定位邻近该地标' : photo.inferred ? '地点由照片线索推断' : '照片自带定位'} · 周边装饰为艺术示意`
    sceneCaption.append(title, note)
    const [lng, lat] = point
    const latRadius = miniature.radius / 111320
    const lngRadius = miniature.radius / (111320 * Math.cos((lat * Math.PI) / 180))
    const rect = (west: number, south: number, east: number, north: number): [number, number][] => {
      const sx = 1 / (111320 * Math.cos((lat * Math.PI) / 180))
      const sy = 1 / 111320
      return [[lng + west * sx, lat + south * sy], [lng + east * sx, lat + south * sy], [lng + east * sx, lat + north * sy], [lng + west * sx, lat + north * sy], [lng + west * sx, lat + south * sy]]
    }
    const path: [number, number][] = Array.from({ length: 16 }, (_, i) => {
      const angle = (i / 16) * Math.PI * 2
      return [lng + Math.cos(angle) * lngRadius, lat + Math.sin(angle) * latRadius]
    })
    path.push(path[0])
    // The two WebGL canvases have no shared depth buffer. Give the custom landmark a small
    // clearing in AMap.Buildings, keeping all buildings outside the memory scene untouched.
    sceneAreas = [
      { color1: '#fff0e7', color2: '#e8c0b9', path: rect(125, -290, 560, 300) },
      { color1: '#e8f1df', color2: '#bbd5bd', path: rect(-290, -560, 260, -125) },
      { color1: '#f0e8f8', color2: '#cdbbdc', path: rect(-560, -260, -125, 220) },
      { visible: false, path },
    ]
    if (sceneEnabled) buildings.setStyle({ hideWithoutStyle: false, areas: sceneAreas })
    const attachDistrict = (data: SceneData, regionCount = 0) => {
      if (generation !== sceneGeneration) return
      if (!data.buildings.length && !data.roads.length && !data.water.length && !data.green.length) return
      map.customCoords.setCenter(origin!)
      const district = createStyledDistrict((points) => map.customCoords.lngLatsToCoords(points), point, pearl ? 45 : miniature.radius, data)
      memoryWorld.add(district.group)
      hasStyledDistrict = true
      tileCredit.hidden = !data.provider
      if (district.hideNativeBuildings) sceneAreas.splice(sceneAreas.length - 1, 0, { visible: false, path: [
        gcj(district.bounds[1], district.bounds[0]),
        gcj(district.bounds[1], district.bounds[2]),
        gcj(district.bounds[3], district.bounds[2]),
        gcj(district.bounds[3], district.bounds[0]),
        gcj(district.bounds[1], district.bounds[0]),
      ] })
      if (photo && !pearl) title.textContent = `照片地点 · 风格化${district.kind}${regionCount > 1 ? ` · ${regionCount} 张照片` : ''}`
      note.textContent = `${photo?.inferred ? '照片线索推断地点' : photo ? '照片自带定位' : '高德地标位置'} · 地理轮廓来自 OpenStreetMap，细节为艺术示意`
      if (sceneEnabled) buildings.setStyle({ hideWithoutStyle: false, areas: sceneAreas })
      renderer.shadowMap.needsUpdate = true
      draw()
    }
    if (metresApart(point, ORIENTAL_PEARL_GCJ) < 650) attachDistrict(shanghaiScene)
    else if (photo && hasStreetLocation(photo)) {
      const region = regionForPhoto(photos.map((entry) => entry.photo), photo)
      if (region) {
        note.textContent = '正在整理这一组照片地点的街区轮廓…'
        fetchRegionScene(region.center).then((data) => attachDistrict(data, region.photoIds.length)).catch(() => {
          if (generation === sceneGeneration) { note.textContent = '区域轮廓暂不可用 · 当前显示地点小景'; draw() }
        })
      }
    } else if (photo) note.textContent = '地点尚未精确到街道 · 当前显示示意小景'
    // AMap may finish its final map frame before moveend/zoomend rebuilds this group.
    // Draw the independent canvas now so the scene and caption never wait for another pan.
    draw()
  }

  // A user can arrive by wheel zoom or drag, without opening a photo card. Build only the
  // nearest local scene; the curated landmark is available even before a photo is analyzed.
  function syncSceneForView() {
    if (!ready || !origin) return
    if (map.getZoom() < 16.7) {
      if (activeSceneKey) clearMemoryScene()
      return
    }
    const center = map.getCenter()
    const at: [number, number] = [center.lng, center.lat]
    let candidate: MapPhoto | undefined
    const focused = photos.find(({ photo }) => photo.id === focusedId)?.photo
    if (focused && metresApart(focused.gcj, at) < 450) {
      const key = `${focused.id}:${focused.landmark || ''}:${focused.landmarkSource || ''}:${focused.gcj.join(',')}`
      if (key !== activeSceneKey) focusMemoryScene(focused)
      return
    }
    if (metresApart(at, ORIENTAL_PEARL_GCJ) < 500) {
      candidate = photos.map(({ photo }) => photo).find((photo) => isOrientalPearl(photo.landmark) && metresApart(photo.gcj, ORIENTAL_PEARL_GCJ) < 900)
      const key = candidate ? `${candidate.id}:${candidate.landmark || ''}:${candidate.landmarkSource || ''}:${candidate.gcj.join(',')}` : 'public:oriental-pearl'
      if (key !== activeSceneKey) focusMemoryScene(candidate)
      return
    }
    const nearby = photos
      .filter(({ photo }) => metresApart(photo.gcj, at) < 450)
      .sort((a, b) => (a.photo.id === focusedId ? -1 : b.photo.id === focusedId ? 1 : metresApart(a.photo.gcj, at) - metresApart(b.photo.gcj, at)))
    candidate = nearby[0]?.photo
    const key = candidate ? `${candidate.id}:${candidate.landmark || ''}:${candidate.landmarkSource || ''}:${candidate.gcj.join(',')}` : ''
    if (key !== activeSceneKey) {
      if (candidate) focusMemoryScene(candidate)
      else if (activeSceneKey) clearMemoryScene()
    }
  }

  function setPhotos(next: MapPhoto[] = []) {
    const key = next.map((p) => `${p.id}:${p.gcj.join(',')}:${p.inferred}:${p.precision || ''}:${p.landmark || ''}:${p.landmarkSource || ''}`).join('|') + `#${focusedId}`
    // With no located place yet, the photos themselves anchor the scene
    if (!origin && next.length) origin = next[0].gcj
    if (key === photoKey || !origin) return
    photoKey = key
    map.customCoords.setCenter(origin)
    const coords = next.length ? map.customCoords.lngLatsToCoords(next.map((p) => p.gcj)) : []
    photos = next.map((photo, i) => ({ photo, at: new THREE.Vector3(coords[i][0], coords[i][1], 0) }))
  }

  function thumb(cover: MapPhoto, members: MapPhoto[]) {
    const el = document.createElement('button')
    el.type = 'button'
    const inferred = members.every((m) => m.inferred)
    const focused = members.length === 1 && cover.id === focusedId
    el.className = `map-photo${inferred ? ' inferred' : ''}${focused ? ' focused' : ''}`
    el.title = inferred ? '位置由画面或其他照片推断' : '照片自带定位'
    const img = document.createElement('img')
    img.src = cover.preview
    img.alt = ''
    el.append(img)
    if (members.length > 1) {
      const badge = document.createElement('b')
      badge.textContent = String(members.length)
      el.append(badge)
      el.setAttribute('aria-label', `这里有 ${members.length} 张照片，点击放大`)
      el.addEventListener('click', (event) => {
        event.stopPropagation()
        const lngs = members.map((m) => m.gcj[0])
        const lats = members.map((m) => m.gcj[1])
        const pad = 0.002
        map.setBounds(new AMap.Bounds([Math.min(...lngs) - pad, Math.min(...lats) - pad], [Math.max(...lngs) + pad, Math.max(...lats) + pad]), false, [150, insets.bottom + 60, 120, insets.right + 120])
      })
    } else {
      el.setAttribute('aria-label', `打开照片 ${cover.name}`)
      el.addEventListener('click', (event) => { event.stopPropagation(); callbacks.onOpenPhoto?.(cover.id) })
    }
    photoLayer.append(el)
    return el
  }

  function placePhotos(): DOMRect[] {
    const taken: DOMRect[] = []
    const v = new THREE.Vector3()
    const cells = new Map<string, { x: number; y: number; members: MapPhoto[] }>()
    for (const { photo, at } of photos) {
      v.copy(at).project(camera)
      if (v.z > 1) continue
      const x = ((v.x + 1) / 2) * size.w
      const y = ((1 - v.y) / 2) * size.h
      if (x < -CELL || y < -CELL || x > size.w + CELL || y > size.h + CELL) continue
      const key = `${Math.floor(x / CELL)}:${Math.floor(y / CELL)}`
      const cell = cells.get(key)
      if (cell) cell.members.push(photo)
      else cells.set(key, { x, y, members: [photo] })
    }
    const seen = new Set<string>()
    for (const { x, y, members } of cells.values()) {
      // The cover is a photo with its own GPS when there is one
      const cover = members.find((m) => !m.inferred) || members[0]
      const id = `${cover.id}|${members.length}|${members.every((m) => m.inferred)}|${cover.id === focusedId}`
      seen.add(id)
      const el = shown.get(id) || thumb(cover, members)
      shown.set(id, el)
      // A flag: the tip at the bottom-left touches the place, the picture stands to the right
      const sceneOffset = members.length === 1 && cover.id === focusedId && Boolean(memoryAnchor) && memoryWorld.visible
      el.classList.toggle('scene-offset', sceneOffset)
      const left = Math.round(x) + (sceneOffset ? 55 : -10)
      const top = Math.round(y) - el.offsetHeight + (sceneOffset ? 15 : -10)
      el.style.transform = `translate(${left}px, ${top}px)`
      // Count badge sticks out 12 px above and to the right
      taken.push(new DOMRect(left, top - 12, el.offsetWidth + 12, el.offsetHeight + 22))
    }
    for (const [id, el] of shown) if (!seen.has(id)) { el.remove(); shown.delete(id) }
    return taken
  }

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
  map.on('moveend', syncSceneForView)
  map.on('zoomend', syncSceneForView)

  function resize() {
    size = { w: Math.max(1, container.clientWidth), h: Math.max(1, container.clientHeight) }
    renderer.setSize(size.w, size.h, false)
    draw()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(container)

  let pending: LifeMapData | null = null
  let pendingLandmark = false
  map.on('complete', () => {
    ready = true
    if (pending) api.update(pending)
    syncSceneForView()
    if (pendingLandmark) api.focusLandmark()
  })

  const api = {
    setSceneEnabled(visible: boolean) {
      sceneEnabled = visible
      if (visible) syncSceneForView()
      buildings.setStyle({ hideWithoutStyle: false, areas: visible ? sceneAreas : [] })
      draw()
    },
    update(data: LifeMapData) {
      if (!ready) { pending = data; return }
      current = data
      build(data)
      setPhotos(data.photos)
      const signature = `${data.selectedCity}|${data.places.map((p) => p.city).join()}|${data.story.map((e) => e.id).join()}`
      if (signature !== lastSignature) {
        frame(data, !lastSignature)
        lastSignature = signature
      }
      syncSceneForView()
      draw()
    },
    // Close enough to see the building it was taken at
    focusPhoto(photo: MapPhoto) {
      focusedId = photo.id
      if (current) setPhotos(current.photos)
      focusMemoryScene(photo)
      map.setPitch(60, reduceMotion)
      map.setZoomAndCenter(17.2, photo.gcj, reduceMotion)
    },
    focusLandmark() {
      if (!ready) { pendingLandmark = true; return }
      pendingLandmark = false
      focusedId = null
      focusMemoryScene()
      map.setPitch(60, reduceMotion)
      map.setZoomAndCenter(17.2, ORIENTAL_PEARL_GCJ, reduceMotion)
    },
    setInsets(next: { right: number; bottom: number }) {
      if (next.right === insets.right && next.bottom === insets.bottom) return
      insets = next
      sceneSource.style.right = `${Math.max(20, next.right + 20)}px`
      sceneSource.style.bottom = `${Math.max(138, next.bottom + 12)}px`
      if (current && ready) frame(current, false)
    },
    dispose() {
      observer.disconnect()
      clearMemoryScene()
      map.destroy()
      sun.shadow.dispose()
      renderer.dispose()
      mapEl.remove()
      canvas.remove()
      atmosphere.remove()
      photoLayer.remove()
      labelLayer.remove()
      sceneSource.remove()
    },
  }
  return api
}

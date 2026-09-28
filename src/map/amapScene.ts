import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'
import type { MemoryEvent } from '../types'
import { gcj02ToWgs84, wgs84ToGcj02 } from '../lib/geo'
import { LAND, adder, box, building, createLabels, dim, eventLabel, placeLabel, seeded } from './objects'
import { createOrientalPearlScene, isOrientalPearl, ORIENTAL_PEARL_GCJ } from './memoryScene'
import { createStyledDistrict, shanghaiScene, type SceneData } from './styledDistrict'
import { fetchRegionScene, hasStreetLocation, metresApart, photoRegions, photoSceneKey, regionForPhoto } from './regionScene'
import { clusterProjectedPhotos } from './photoClusters'
import { sceneCoverage } from './sceneCoverage'
import type { AMapNS } from './amap'
import type { LifeMapCallbacks, LifeMapData, MapPhoto } from './scene'

// Real AMap 3D base map with the cartoon layer on top.
// AMap renders with WebGL 1 and three r186 needs WebGL 2, so the cartoon layer uses its own
// transparent canvas; a GLCustomLayer only supplies the frame hook and the camera.
// customCoords units are Web Mercator metres, z up. Objects keep a constant on-screen size
// by scaling with the zoom level ("unit" = metres per scene unit).

const PX_PER_UNIT = 26
const VENUE_MIN_ZOOM = 15
const unitMetres = (zoom: number) => (156543.034 / 2 ** zoom) * PX_PER_UNIT

interface Scaled { object: THREE.Object3D }

export function createAmapLifeMap(container: HTMLElement, callbacks: LifeMapCallbacks, AMap: AMapNS, mapStyle = 'amap://styles/macaron') {
  const mapEl = document.createElement('div')
  mapEl.className = 'life-map-amap'
  const colorWash = document.createElement('div')
  colorWash.className = 'map-color-wash'
  colorWash.hidden = mapStyle !== 'amap://styles/macaron'
  const canvas = document.createElement('canvas')
  canvas.className = 'life-map-canvas overlay'
  const atmosphere = document.createElement('div')
  atmosphere.className = 'map-scene-atmosphere'
  atmosphere.hidden = true
  const photoLayer = document.createElement('div')
  photoLayer.className = 'life-map-photos'
  const photoLeaders = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  photoLeaders.classList.add('map-photo-leaders')
  photoLayer.append(photoLeaders)
  const labelLayer = document.createElement('div')
  labelLayer.className = 'life-map-labels'
  container.append(mapEl, colorWash, canvas, atmosphere, photoLayer, labelLayer)
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
    mapStyle,
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
  const sky = new THREE.HemisphereLight(0xfff7e9, 0xc7d8d1, 1.25)
  sky.position.set(0, 0, 1) // Map geometry is Z-up; the default hemisphere is Y-up.
  scene.add(sky)
  const sun = new THREE.DirectionalLight(0xffecd7, 1.3)
  sun.position.set(-800, -750, 1200) // z is up; overview objects are hundreds of metres tall
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
  let insets = { right: 0, bottom: 0, top: 0 }
  let unit = unitMetres(5)
  let scaled: Scaled[] = []
  let lines: LineMaterial[] = []
  let storyLines: THREE.Object3D[] = []
  let overviewCities: THREE.Group[] = []
  let current: LifeMapData | null = null
  let lastSignature = ''
  let ready = false
  let sceneEnabled = true
  let memoryAnchor: THREE.Vector3 | null = null
  let activeSceneKey = ''
  let requestedSceneKey = ''
  let sceneState: 'idle' | 'loading' | 'ready' | 'error' = 'idle'
  let sceneBuilds = 0
  let appliedBuildingStyle = '[]'
  let disposed = false
  let hasStyledDistrict = false
  let sceneGeneration = 0
  let shadowSceneWasVisible = false
  type BuildingArea = { visible?: boolean; color1?: string; color2?: string; path: [number, number][] }
  let sceneAreas: BuildingArea[] = []
  let activeVenue: import('./styledDistrict').SceneVenue | undefined
  let frameFocusedVenue = false
  let framingVenue = false
  let venueFitFrame = 0
  let venueFitVersion = 0
  let landmarkBounds: THREE.Box3[] = []
  let hasAnimatedWater = false
  let waterFrame = 0
  let lastWaterFrame = 0
  function animateWater(now: number) {
    waterFrame = 0
    if (disposed || reduceMotion || document.hidden || !memoryWorld.visible || !hasAnimatedWater) return
    if (now - lastWaterFrame >= 50) {
      lastWaterFrame = now
      renderer.render(scene, camera)
    }
    waterFrame = requestAnimationFrame(animateWater)
  }
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
    storyLines = []
    overviewCities = []
    heights.clear()
    container.dataset.storySegments = '0'
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
      overviewCities.push(group)
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
      const route = (data.routeEventIds || []).map((id) => nodes.find((node) => node.event.id === id)).filter((node) => node !== undefined)
      if (route.length > 1) storyLines.push(fatLine(route.map((n) => n.pos.clone().setZ(2)), 0xf08a24, 3, .8))
      container.dataset.storySegments = String(Math.max(0, route.length - 1))
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
    container.classList.toggle('map-overview', map.getZoom() < 10)
    container.classList.toggle('map-neighbourhood', map.getZoom() >= 15 && mapStyle === 'amap://styles/macaron')
    colorWash.style.opacity = map.getZoom() < 10 ? '.55' : '.10'
    for (const group of overviewCities) group.visible = map.getZoom() >= 10
    for (const line of storyLines) line.visible = map.getZoom() >= 12
    container.dataset.storyLinesVisible = String(storyLines.length > 0 && map.getZoom() >= 12)
    memoryWorld.visible = sceneEnabled && map.getZoom() >= (activeVenue ? VENUE_MIN_ZOOM : 16.7)
    if (memoryWorld.visible && !shadowSceneWasVisible) renderer.shadowMap.needsUpdate = true
    shadowSceneWasVisible = memoryWorld.visible
    sceneSource.hidden = !(memoryWorld.visible && hasStyledDistrict)
    atmosphere.hidden = sceneSource.hidden
    for (const { object } of scaled) object.scale.setScalar(unit)
    for (const material of lines) material.resolution.set(size.w, size.h)
    renderer.render(scene, camera)
    if (!waterFrame && !reduceMotion && !document.hidden && memoryWorld.visible && hasAnimatedWater) waterFrame = requestAnimationFrame(animateWater)
    const projectLabel = (anchor: THREE.Vector3) => new THREE.Vector3(anchor.x, anchor.y, anchor.z * unit)
    // In a city's story the event labels carry the chronology. Lay them out first and
    // move photo buttons a short distance when they would cover a label.
    if (current?.selectedCity) labels.place(camera, size.w, size.h, projectLabel)
    const host = container.getBoundingClientRect()
    const labelRects = current?.selectedCity ? [...labelLayer.querySelectorAll<HTMLElement>('.map-label')]
      .filter((el) => el.style.visibility !== 'hidden')
      .map((el) => { const r = el.getBoundingClientRect(); return new DOMRect(r.left - host.left, r.top - host.top, r.width, r.height) }) : []
    const landmarkRects: DOMRect[] = []
    if (memoryWorld.visible) for (const bounds of landmarkBounds) {
      const points = []
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) points.push(new THREE.Vector3(x, y, z).project(camera))
      if (points.some(p => p.z > 1)) continue
      const xs = points.map(p => (p.x + 1) / 2 * size.w), ys = points.map(p => (1 - p.y) / 2 * size.h)
      landmarkRects.push(new DOMRect(Math.min(...xs) - 6, Math.min(...ys) - 6, Math.max(...xs) - Math.min(...xs) + 12, Math.max(...ys) - Math.min(...ys) + 12))
    }
    const taken = placePhotos([...labelRects, ...landmarkRects])
    if (memoryWorld.visible && memoryAnchor) {
      const marker = memoryAnchor.clone().project(camera)
      const x = ((marker.x + 1) / 2) * size.w
      const y = ((1 - marker.y) / 2) * size.h
      sceneCaption.hidden = marker.z > 1 || x < 0 || x > size.w || y < 0 || y > size.h
      if (!sceneCaption.hidden) {
        const width = 200, height = 72
        const candidates = size.w < 640
          ? [[x - 90, y + 105], [x - 90, y - 110], [x + 20, y + 35]]
          : [[x + 105, y - 100], [x - 225, y - 100], [x + 105, y + 55], [x - 225, y + 55]]
        const choices = candidates.map(([cx, cy]) => {
          const left = Math.max(8, Math.min(size.w - insets.right - width - 12, cx))
          const top = Math.max(65 + insets.top, Math.min(size.h - insets.bottom - height - 12, cy))
          const overlap = [...taken, ...labelRects, ...landmarkRects].reduce((sum, rect) => sum + Math.max(0, Math.min(left + width, rect.right) - Math.max(left, rect.left)) * Math.max(0, Math.min(top + height, rect.bottom) - Math.max(top, rect.top)), 0)
          return { left, top, overlap }
        }).sort((a, b) => a.overlap - b.overlap)
        sceneCaption.style.transform = `translate(${choices[0].left}px, ${choices[0].top}px)`
      }
    } else sceneCaption.hidden = true
    // Keep both photo buttons and story labels reachable at every zoom.
    if (!current?.selectedCity) labels.place(camera, size.w, size.h, projectLabel, taken)
  }

  const layer = new AMap.GLCustomLayer({ zIndex: 120, init() {}, render: draw })
  map.add(layer)
  const visibility = () => { if (!document.hidden && !disposed) draw() }
  document.addEventListener('visibilitychange', visibility)

  // Photo thumbnails clustered by screen position, with a count badge, like a phone album's map.
  // Drawn here rather than as AMap markers: AMap keeps its markers inside a stacking context that
  // sits under this cartoon canvas, so the 3D buildings covered them.
  let photos: { photo: MapPhoto; at: THREE.Vector3 }[] = []
  let photoKey = ''
  let focusedId: string | null = null
  const shown = new Map<string, HTMLButtonElement>()
  const photoMenu = document.createElement('div')
  photoMenu.className = 'map-photo-menu'
  photoMenu.setAttribute('role', 'dialog')
  photoMenu.setAttribute('aria-label', '选择照片')
  photoMenu.hidden = true
  container.append(photoMenu)
  let menuPhotoIds = ''
  function closePhotoMenu() { photoMenu.hidden = true; photoMenu.replaceChildren(); menuPhotoIds = '' }
  function openPhotoMenu(members: MapPhoto[], x: number, y: number) {
    const ids = members.map((photo) => photo.id).sort().join('|')
    if (!photoMenu.hidden && menuPhotoIds === ids) { closePhotoMenu(); return }
    menuPhotoIds = ids
    photoMenu.replaceChildren()
    const heading = document.createElement('div')
    heading.className = 'map-photo-menu-heading'
    const title = document.createElement('strong')
    title.textContent = `这里有 ${members.length} 张照片`
    const close = document.createElement('button')
    close.type = 'button'
    close.textContent = '关闭'
    close.addEventListener('click', closePhotoMenu)
    heading.append(title, close)
    const list = document.createElement('div')
    list.className = 'map-photo-menu-list'
    let rendered = 0
    const appendRows = () => {
      list.querySelector('.map-photo-menu-more')?.remove()
      const end = Math.min(members.length, rendered + 36)
      for (let index = rendered; index < end; index++) {
        const photo = members[index]
        const item = document.createElement('button')
        item.type = 'button'
        item.className = 'map-photo-menu-item'
        item.setAttribute('aria-label', `打开照片 ${photo.name}`)
        const img = document.createElement('img')
        img.src = photo.preview
        img.alt = ''
        const label = document.createElement('span')
        label.textContent = photo.name
        const number = document.createElement('small')
        number.textContent = `${index + 1} / ${members.length}`
        item.append(img, label, number)
        item.addEventListener('click', (event) => { event.stopPropagation(); closePhotoMenu(); callbacks.onOpenPhoto?.(photo.id) })
        list.append(item)
      }
      rendered = end
      if (rendered < members.length) {
        const more = document.createElement('button')
        more.type = 'button'
        more.className = 'map-photo-menu-more'
        more.textContent = `继续显示（剩余 ${members.length - rendered} 张）`
        more.addEventListener('click', appendRows)
        list.append(more)
      }
    }
    appendRows()
    photoMenu.append(heading, list)
    const width = Math.min(310, size.w - 16)
    const usableRight = Math.max(width + 8, size.w - insets.right - 8)
    photoMenu.style.width = `${width}px`
    photoMenu.style.left = `${Math.max(8, Math.min(usableRight - width, x + 24))}px`
    photoMenu.style.top = `${Math.max(72 + insets.top, Math.min(size.h - insets.bottom - 220, y - 80))}px`
    photoMenu.hidden = false
  }
  const escapePhotoMenu = (event: KeyboardEvent) => { if (event.key === 'Escape') closePhotoMenu() }
  window.addEventListener('keydown', escapePhotoMenu)
  const sceneKey = (photo: MapPhoto) => photoSceneKey(photos.map((entry) => entry.photo), photo)
  function setSceneState(value: typeof sceneState) {
    sceneState = value
    // Counts and load state make a missing scene diagnosable without reading private photos.
    container.dataset.sceneState = value
  }
  function applyBuildingAreas(areas: BuildingArea[]) {
    const signature = JSON.stringify(areas)
    if (signature === appliedBuildingStyle) return
    buildings.setStyle({ hideWithoutStyle: false, areas })
    appliedBuildingStyle = signature
  }
  function disposeMemoryContent() {
    landmarkBounds = []
    hasAnimatedWater = false
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
  }
  function clearMemoryScene() {
    cancelVenueFit()
    sceneGeneration++
    disposeMemoryContent()
    memoryAnchor = null
    activeSceneKey = ''
    activeVenue = undefined
    requestedSceneKey = ''
    hasStyledDistrict = false
    sceneAreas = []
    sceneCaption.hidden = true
    sceneSource.hidden = true
    applyBuildingAreas([])
    container.dataset.sceneBuildings = '0'
    container.dataset.sceneVenue = ''
    container.dataset.scenePhotos = '0'
    delete container.dataset.sceneSurfaces
    setSceneState('idle')
  }

  function cancelVenueFit() {
    cancelAnimationFrame(venueFitFrame)
    venueFitFrame = 0
    venueFitVersion++
    framingVenue = false
  }

  function frameVenue(venue: import('./styledDistrict').SceneVenue) {
    cancelVenueFit()
    const ticket = venueFitVersion
    framingVenue = true
    const [west, south, east, north] = venue.bbox
    let phase = 0
    const step = () => {
      venueFitFrame = 0
      if (disposed || ticket !== venueFitVersion) return
      // AMap applies viewport/camera changes on its own frames. Never solve all
      // passes synchronously against a stale camera, especially during resize.
      if (phase < 2) { phase++; venueFitFrame = requestAnimationFrame(step); return }
      if (phase === 2) {
        resize()
        map.setPitch(52, true)
        map.setBounds(new AMap.Bounds(gcj(south, west), gcj(north, east)), true, [110 + insets.top, insets.bottom + 50, 90, insets.right + 90])
        if (map.getZoom() < VENUE_MIN_ZOOM) map.setZoom(VENUE_MIN_ZOOM, true)
        phase++; venueFitFrame = requestAnimationFrame(step); return
      }
      if (phase >= 8) { framingVenue = false; draw(); syncSceneForView(); return }
      const left = size.w < 700 ? 25 : 65, right = Math.max(left + 120, size.w - insets.right - left)
      const top = 105 + insets.top, bottom = Math.max(top + 120, size.h - insets.bottom - 50)
      const pixels = venue.polygons.flat(2).map(([lng, lat]) => map.lngLatToContainer(gcj(lat, lng)))
      // The ground footprint cannot frame a 285 m tower. Include the tops of
      // reconstructed landmarks inside this venue in the same camera fit.
      if (origin && landmarkBounds.length) {
        map.customCoords.setCenter(origin)
        const params = map.customCoords.getCameraParams()
        camera.position.set(params.position[0], params.position[1], params.position[2])
        camera.up.set(params.up[0], params.up[1], params.up[2])
        camera.lookAt(params.lookAt[0], params.lookAt[1], params.lookAt[2])
        camera.near = params.near; camera.far = params.far; camera.fov = params.fov
        camera.aspect = size.w / size.h; camera.updateProjectionMatrix(); camera.updateMatrixWorld()
        const a = coord(south, west), b = coord(north, east)
        for (const bounds of landmarkBounds) {
          const center = bounds.getCenter(new THREE.Vector3())
          if (center.x < Math.min(a.x,b.x) || center.x > Math.max(a.x,b.x) || center.y < Math.min(a.y,b.y) || center.y > Math.max(a.y,b.y)) continue
          for (const x of [bounds.min.x,bounds.max.x]) for (const y of [bounds.min.y,bounds.max.y]) {
            const p = new THREE.Vector3(x,y,bounds.max.z).project(camera)
            if (p.z <= 1) pixels.push({ x:(p.x+1)/2*size.w, y:(1-p.y)/2*size.h })
          }
        }
      }
      const minX = Math.min(...pixels.map((p: { x: number }) => p.x)), maxX = Math.max(...pixels.map((p: { x: number }) => p.x))
      const minY = Math.min(...pixels.map((p: { y: number }) => p.y)), maxY = Math.max(...pixels.map((p: { y: number }) => p.y))
      map.panBy((left + right - minX - maxX) / 2, (top + bottom - minY - maxY) / 2, 0)
      const ratio = Math.min((right - left) / Math.max(1, maxX - minX), (bottom - top) / Math.max(1, maxY - minY))
      if (Math.abs(Math.log2(ratio)) >= .05) map.setZoom(Math.max(VENUE_MIN_ZOOM, Math.min(19, map.getZoom() + Math.max(-.8, Math.min(.8, Math.log2(ratio) * .7)))), true)
      phase++
      venueFitFrame = requestAnimationFrame(step)
    }
    venueFitFrame = requestAnimationFrame(step)
  }

  function focusMemoryScene(photo?: MapPhoto, retry = false, frameAfterLoad = false) {
    if (!sceneEnabled || disposed) return
    const region = photo ? regionForPhoto(photos.map((entry) => entry.photo), photo) : undefined
    if (photo && !region) { clearMemoryScene(); return }
    const key = photo ? sceneKey(photo) : 'public:oriental-pearl'
    if (!retry && key === requestedSceneKey && sceneState !== 'idle') {
      if (sceneState === 'ready' && activeVenue && region) {
        container.dataset.scenePhotos = String(region.photoIds.length)
        const title = sceneCaption.querySelector('strong')
        if (title) title.textContent = `${activeVenue.name} · ${region.photoIds.length} 张照片`
      }
      return
    }
    const generation = ++sceneGeneration
    requestedSceneKey = key
    const center = region?.center || ORIENTAL_PEARL_GCJ
    // The landmark is an addition at its real location. Every region uses the same
    // district renderer; a photo-card keyword never gates the materials or moves a scene.
    const pearl = metresApart(center, ORIENTAL_PEARL_GCJ) < 500
    const point = pearl ? ORIENTAL_PEARL_GCJ : center
    if (!origin) origin = point
    map.customCoords.setCenter(origin)
    const [x, y] = map.customCoords.lngLatsToCoords([point])[0]
    const pointAt = new THREE.Vector3(x, y, 0)
    memoryAnchor = pointAt
    setSceneState('loading')
    sceneCaption.replaceChildren()
    const title = document.createElement('strong')
    title.textContent = '正在加载照片地点场景…'
    const note = document.createElement('small')
    note.textContent = '建筑、道路、树木和水面将一起呈现'
    sceneCaption.append(title, note)
    const attachDistrict = (data: SceneData) => {
      if (disposed || generation !== sceneGeneration) return
      if (!data.buildings.length && !data.roads.length && !data.water.length && !data.green.length && !data.treeRows.length && !data.sand?.length && !data.plazas.length) throw new Error('该地点暂缺可用的地图资料')
      map.customCoords.setCenter(origin!)
      const district = createStyledDistrict((points) => map.customCoords.lngLatsToCoords(points), point, pearl ? 45 : 0, data)
      const areas: BuildingArea[] = district.hideNativePaths.map((path) => ({ visible: false, path }))
      if (pearl) {
        const miniature = createOrientalPearlScene()
        const upright = new THREE.Group()
        upright.rotation.x = Math.PI / 2
        upright.position.copy(pointAt)
        upright.add(miniature.group)
        upright.traverse((child) => {
          if (child instanceof THREE.Mesh) child.castShadow = child.receiveShadow = true
        })
        district.group.add(upright)
        const latRadius = miniature.radius / 111320
        const lngRadius = latRadius / Math.cos(point[1] * Math.PI / 180)
        const path: [number, number][] = Array.from({ length: 16 }, (_, i) => {
          const angle = i / 16 * Math.PI * 2
          return [point[0] + Math.cos(angle) * lngRadius, point[1] + Math.sin(angle) * latRadius]
        })
        path.push(path[0])
        areas.push({ visible: false, path })
      }
      // Finish the replacement before disposing the old group. Never reset native
      // building styles to an empty set between two successful district loads.
      disposeMemoryContent()
      memoryWorld.add(district.group)
      district.group.updateMatrixWorld(true)
      district.group.traverse(child => {
        if (child.name.startsWith('landmark-')) landmarkBounds.push(new THREE.Box3().setFromObject(child))
        if (child instanceof Reflector) hasAnimatedWater = true
      })
      const landmarkNames: string[] = []
      district.group.traverse(child => { if (child.name.startsWith('landmark-')) landmarkNames.push(child.name) })
      container.dataset.sceneLandmarks = landmarkNames.join(',')
      sceneAreas = areas
      // The server can discover a complete park/mall boundary on the first load.
      // All photos inside it then acquire one canonical scene key immediately.
      const resolved = photo ? regionForPhoto(photos.map((entry) => entry.photo), photo) : undefined
      activeVenue = resolved?.venue
      activeSceneKey = photo ? sceneKey(photo) : key
      requestedSceneKey = activeSceneKey
      hasStyledDistrict = true
      tileCredit.hidden = !data.provider
      const count = resolved?.photoIds.length || region?.photoIds.length || 0
      title.textContent = pearl ? '东方明珠 · 风格化地标' : `${activeVenue?.name || `照片地点 · 风格化${district.kind}`}${count > 1 ? ` · ${count} 张照片` : ''}`
      const coverage = sceneCoverage(data)
      note.textContent = coverage.needsDetail ? coverage.note : activeVenue ? '整片地点共同呈现，照片仍在各自拍摄位置' : coverage.note
      container.dataset.sceneCoverage = coverage.level
      sun.position.copy(pointAt).add(new THREE.Vector3(-800, -750, 1200))
      sun.target.position.copy(pointAt)
      sun.target.updateMatrixWorld()
      applyBuildingAreas(sceneEnabled ? sceneAreas : [])
      container.dataset.sceneBuildings = String(district.buildingCount)
      container.dataset.sceneSurfaces = district.surfaceMode
      container.dataset.sceneBuilds = String(++sceneBuilds)
      container.dataset.sceneVenue = activeVenue?.id || ''
      container.dataset.scenePhotos = String(count)
      container.dataset.sceneWater = String(data.water.length)
      container.dataset.sceneWaterways = String(data.waterways?.length || 0)
      container.dataset.sceneSpecialBuildings = String(data.buildings.filter((b) => ['stadium', 'sports_hall', 'landmark'].includes(b.kind || '')).length)
      setSceneState('ready')
      if ((frameAfterLoad || frameFocusedVenue) && activeVenue) frameVenue(activeVenue)
      frameFocusedVenue = false
      renderer.shadowMap.needsUpdate = true
      draw()
    }
    const loading = pearl ? Promise.resolve(shanghaiScene) : fetchRegionScene(region!, retry)
    loading.then(attachDistrict).catch(() => {
      if (disposed || generation !== sceneGeneration) return
      setSceneState('error')
      title.textContent = '该地点场景暂未加载'
      note.textContent = '地图资料暂时不可用，可以重试'
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = '重新加载场景'
      button.addEventListener('click', (event) => { event.stopPropagation(); focusMemoryScene(photo, true) })
      sceneCaption.append(button)
      draw()
    })
    draw()
  }

  // Every precise photo group uses the same pipeline, including manual zoom/pan visits.
  function syncSceneForView() {
    if (!ready || !origin || !sceneEnabled || disposed || framingVenue) return
    if (map.getZoom() < (activeVenue ? VENUE_MIN_ZOOM : 16.7)) {
      if (requestedSceneKey || activeSceneKey) clearMemoryScene()
      return
    }
    const center = map.getCenter()
    const at: [number, number] = [center.lng, center.lat]
    if (activeVenue) {
      const [west, south, east, north] = activeVenue.bbox
      const p = gcj02ToWgs84({ lng: at[0], lat: at[1] })
      if (p.lng >= west && p.lng <= east && p.lat >= south && p.lat <= north) {
        const all = photos.map((entry) => entry.photo)
        const region = photoRegions(all).find((r) => r.venue?.id === activeVenue!.id)
        const member = all.find((photo) => photo.id === region?.photoIds[0])
        if (member) { focusMemoryScene(member); return }
      }
    }
    const focused = photos.find(({ photo }) => photo.id === focusedId)?.photo
    if (focused && hasStreetLocation(focused) && metresApart(focused.gcj, at) < 700) {
      focusMemoryScene(focused)
      return
    }
    if (requestedSceneKey === 'public:oriental-pearl' && metresApart(at, ORIENTAL_PEARL_GCJ) < 700) return
    const nearby = photos
      .filter(({ photo }) => hasStreetLocation(photo) && metresApart(photo.gcj, at) < 700)
      .sort((a, b) => metresApart(a.photo.gcj, at) - metresApart(b.photo.gcj, at))
    const candidate = nearby[0]?.photo
    if (candidate) focusMemoryScene(candidate)
    else if (requestedSceneKey || activeSceneKey) clearMemoryScene()
  }

  function setPhotos(next: MapPhoto[] = []) {
    const key = next.map((p) => `${p.id}:${p.gcj.join(',')}:${p.inferred}:${p.precision || ''}:${p.venueName || ''}:${p.landmark || ''}:${p.landmarkSource || ''}:${p.sceneCard?.createdAt || ''}:${p.sceneCard?.scene || ''}:${p.sceneCard?.tags?.join(',') || ''}`).join('|') + `#${focusedId}`
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
      el.setAttribute('aria-label', `这里有 ${members.length} 张照片，点击选择`)
      el.addEventListener('click', (event) => {
        event.stopPropagation()
        const rect = el.getBoundingClientRect()
        const host = container.getBoundingClientRect()
        openPhotoMenu(members, rect.left - host.left, rect.top - host.top)
      })
    } else {
      el.setAttribute('aria-label', `打开照片 ${cover.name}`)
      el.addEventListener('click', (event) => { event.stopPropagation(); callbacks.onOpenPhoto?.(cover.id) })
    }
    photoLayer.append(el)
    return el
  }

  function placePhotos(obstacles: DOMRect[] = []): DOMRect[] {
    const taken: DOMRect[] = []
    const leaders: SVGPathElement[] = []
    const v = new THREE.Vector3()
    const projected: { photo: MapPhoto; x: number; y: number }[] = []
    for (const { photo, at } of photos) {
      v.copy(at).project(camera)
      if (v.z > 1) continue
      const x = ((v.x + 1) / 2) * size.w
      const y = ((1 - v.y) / 2) * size.h
      if (x < -96 || y < -96 || x > size.w + 96 || y > size.h + 96) continue
      projected.push({ photo, x, y })
    }
    const seen = new Set<string>()
    for (const { x, y, members } of clusterProjectedPhotos(projected)) {
      // The cover is a photo with its own GPS when there is one
      const cover = members.find((m) => m.id === focusedId) || members.find((m) => !m.inferred) || members[0]
      // Include every ID: reusing a button with a different member list kept an old click handler.
      const id = `${members.map((m) => m.id).sort().join('|')}|${cover.id}|${focusedId}`
      seen.add(id)
      const el = shown.get(id) || thumb(cover, members)
      shown.set(id, el)
      // A flag: the tip at the bottom-left touches the place, the picture stands to the right
      const sceneOffset = members.length === 1 && cover.id === focusedId && isOrientalPearl(cover.landmark) && Boolean(memoryAnchor) && memoryWorld.visible
      const baseLeft = Math.round(x) + (sceneOffset ? 55 : -10)
      const baseTop = Math.round(y) - el.offsetHeight + (sceneOffset ? 15 : -10)
      const offsets = [[0, 0], [96, 0], [-96, 0], [0, -96], [0, 96], [96, -96], [-96, -96], [96, 96], [-96, 96], [192, 0], [-192, 0], [0, -192], [0, 192]]
      const occupied = [...obstacles, ...taken]
      const overlaps = (a: DOMRect, b: DOMRect) => a.left < b.right + 6 && a.right + 6 > b.left && a.top < b.bottom + 6 && a.bottom + 6 > b.top
      let choice = offsets[0]
      let lowest = Infinity
      for (const offset of offsets) {
        const rect = new DOMRect(baseLeft + offset[0], baseTop + offset[1] - 12, el.offsetWidth + 12, el.offsetHeight + 22)
        if (rect.left < 8 || rect.top < insets.top + 8 || rect.right > size.w - insets.right - 8 || rect.bottom > size.h - insets.bottom - 8) continue
        const collisions = occupied.filter((area) => overlaps(rect, area)).length
        if (collisions < lowest) { choice = offset; lowest = collisions }
        if (!collisions) break
      }
      const left = baseLeft + choice[0]
      const top = baseTop + choice[1]
      el.classList.toggle('scene-offset', sceneOffset && !choice[0] && !choice[1])
      el.style.transform = `translate(${left}px, ${top}px)`
      if (choice[0] || choice[1]) {
        const leader = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        leader.setAttribute('d', `M ${Math.round(x)} ${Math.round(y)} L ${left + 10} ${top + el.offsetHeight}`)
        leaders.push(leader)
      }
      // Count badge sticks out 12 px above and to the right
      taken.push(new DOMRect(left, top - 12, el.offsetWidth + 12, el.offsetHeight + 22))
    }
    for (const [id, el] of shown) if (!seen.has(id)) { el.remove(); shown.delete(id) }
    photoLeaders.setAttribute('viewBox', `0 0 ${size.w} ${size.h}`)
    photoLeaders.replaceChildren(...leaders)
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
    map.setBounds(bounds, instant || reduceMotion, [150 + insets.top, insets.bottom + 40, 120, insets.right + 120])
  }

  map.on('click', (event: { pixel: { x: number; y: number } }) => {
    closePhotoMenu()
    const pointer = new THREE.Vector2((event.pixel.x / size.w) * 2 - 1, -(event.pixel.y / size.h) * 2 + 1)
    raycaster.setFromCamera(pointer, camera)
    const hit = raycaster.intersectObjects(world.children, true).find((h) => h.object.userData.eventId || h.object.userData.city)
    if (hit?.object.userData.eventId) callbacks.onOpenEvent(hit.object.userData.eventId)
    else if (hit?.object.userData.city) callbacks.onSelectCity(hit.object.userData.city)
  })
  map.on('movestart', closePhotoMenu)
  map.on('moveend', syncSceneForView)
  map.on('zoomend', syncSceneForView)
  // AMap updates its internal viewport after the browser's ResizeObserver. Fit a
  // whole venue only after that update, otherwise a narrow screen keeps the old zoom.
  map.on('resize', () => {
    // Depending on frame scheduling, AMap's resize can precede our observer.
    // Read actual DOM dimensions before fitting rather than using stale widths.
    if (disposed) return
    resize()
    if (ready && activeVenue) frameVenue(activeVenue)
  })

  function resize() {
    size = { w: Math.max(1, container.clientWidth), h: Math.max(1, container.clientHeight) }
    renderer.setSize(size.w, size.h, false)
    draw()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(container)

  let pending: LifeMapData | null = null
  let pendingLandmark = false
  let pendingFocus: MapPhoto | null = null
  map.on('complete', () => {
    if (disposed) return
    ready = true
    if (pending) { const data = pending; pending = null; api.update(data) }
    syncSceneForView()
    if (pendingFocus) { const photo = pendingFocus; pendingFocus = null; api.focusPhoto(photo) }
    else if (pendingLandmark) api.focusLandmark()
  })

  const api = {
    setSceneEnabled(visible: boolean) {
      if (sceneEnabled === visible) return
      sceneEnabled = visible
      if (!visible && sceneState === 'loading') {
        sceneGeneration++
        requestedSceneKey = activeSceneKey
        setSceneState(activeSceneKey ? 'ready' : 'idle')
      }
      if (visible) syncSceneForView()
      applyBuildingAreas(visible ? sceneAreas : [])
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
      if (!ready) { pendingFocus = photo; pendingLandmark = false; return }
      cancelVenueFit()
      focusedId = photo.id
      frameFocusedVenue = true
      if (current) setPhotos(current.photos)
      const region = regionForPhoto(photos.map((entry) => entry.photo), photo)
      if (region?.venue) frameVenue(region.venue)
      else {
        map.setPitch(60, true)
        map.setZoomAndCenter(hasStreetLocation(photo) ? 18 : 13, photo.gcj, true)
      }
      if (hasStreetLocation(photo)) focusMemoryScene(photo, false, true)
      else clearMemoryScene()
      if (sceneState === 'ready') frameFocusedVenue = false
    },
    focusLandmark() {
      if (!ready) { pendingLandmark = true; pendingFocus = null; return }
      cancelVenueFit()
      pendingLandmark = false
      focusedId = null
      map.setPitch(60, true)
      map.setZoomAndCenter(17.2, ORIENTAL_PEARL_GCJ, true)
      focusMemoryScene()
    },
    setInsets(next: { right: number; bottom: number; top: number }) {
      if (next.right === insets.right && next.bottom === insets.bottom && next.top === insets.top) return
      insets = next
      sceneSource.style.right = `${Math.max(20, next.right + 20)}px`
      sceneSource.style.bottom = `${Math.max(138, next.bottom + 12)}px`
      if (current && ready) {
        if (activeVenue) frameVenue(activeVenue)
        else frame(current, false)
      }
    },
    dispose() {
      disposed = true
      cancelAnimationFrame(waterFrame)
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('keydown', escapePhotoMenu)
      observer.disconnect()
      clearMemoryScene()
      map.destroy()
      sun.shadow.dispose()
      renderer.dispose()
      mapEl.remove()
      colorWash.remove()
      canvas.remove()
      atmosphere.remove()
      photoLayer.remove()
      photoMenu.remove()
      labelLayer.remove()
      sceneSource.remove()
    },
  }
  return api
}

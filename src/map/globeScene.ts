import * as THREE from 'three'
import { gcj02ToWgs84 } from '../lib/geo'
import { cityLabel, roleLabels } from '../lib/memory'
import { clusterProjectedPhotos } from './photoClusters'
import type { LifeMapCallbacks, LifeMapData, MapPhoto } from './scene'
import type { Place } from '../types'

const RADIUS = 1.6
// Globe units: RADIUS is the Earth's 6371 km. Below this camera altitude the street map takes over.
export const GLOBE_KM_PER_UNIT = 6371 / RADIUS
export const HANDOFF_ALTITUDE = 1.3
const CLOSEST_ALTITUDE = 1.2
const DEG = Math.PI / 180

function onGlobe(lng: number, lat: number, radius = RADIUS) {
  const phi = lng * DEG
  const theta = lat * DEG
  return new THREE.Vector3(
    radius * Math.cos(theta) * Math.cos(phi),
    radius * Math.sin(theta),
    -radius * Math.cos(theta) * Math.sin(phi),
  )
}

// The globe is the life map's overview. It uses the same places and real photo coordinates as
// the street map; choosing a city hands the view back to the existing AMap scene.
export function createGlobeLifeMap(container: HTMLElement, callbacks: LifeMapCallbacks) {
  const host = document.createElement('div')
  host.className = 'life-globe'
  const stars = document.createElement('canvas')
  stars.className = 'globe-stars'
  const canvas = document.createElement('canvas')
  canvas.className = 'life-globe-canvas'
  canvas.tabIndex = 0
  canvas.setAttribute('role', 'application')
  canvas.setAttribute('aria-label', '地球仪：拖动或方向键旋转，滚轮、双指或加减按钮缩放')
  const labelsLayer = document.createElement('div')
  labelsLayer.className = 'life-map-labels globe-labels'
  const placeMenu = document.createElement('div')
  placeMenu.className = 'globe-place-menu'
  placeMenu.setAttribute('role', 'dialog')
  placeMenu.setAttribute('aria-label', '选择地点')
  placeMenu.hidden = true
  const photoLayer = document.createElement('div')
  photoLayer.className = 'life-map-photos globe-photos'
  const menu = document.createElement('div')
  menu.className = 'map-photo-menu'
  menu.setAttribute('role', 'dialog')
  menu.setAttribute('aria-label', '选择照片')
  menu.hidden = true
  const controls = document.createElement('div')
  controls.className = 'globe-controls'
  const credit = document.createElement('a')
  credit.className = 'globe-credit'
  credit.href = 'https://www.naturalearthdata.com/'
  credit.target = '_blank'
  credit.rel = 'noopener noreferrer'
  credit.textContent = '地球轮廓：Natural Earth'
  host.append(stars, canvas, labelsLayer, photoLayer, menu, placeMenu, controls, credit)
  container.append(host)

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100)
  camera.position.z = 6
  camera.lookAt(0, 0, 0)
  scene.add(new THREE.AmbientLight(0xffffff, 1.6))
  const sunlight = new THREE.DirectionalLight(0xffffff, 2.1)
  sunlight.position.set(-3, 4, 6)
  scene.add(sunlight)
  const globe = new THREE.Group()
  scene.add(globe)
  const sphereGeometry = new THREE.SphereGeometry(RADIUS, 96, 64)
  const sphereMaterial = new THREE.MeshStandardMaterial({ color: 0x83b6c7, roughness: 1 })
  // Shown once its drawing is ready: a plain blue ball first and continents popping in later looked broken
  const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial)
  sphere.visible = false
  globe.add(sphere)
  const atmosphereGeometry = new THREE.SphereGeometry(RADIUS * 1.018, 64, 48)
  const atmosphereMaterial = new THREE.MeshBasicMaterial({ color: 0x91cfeb, side: THREE.BackSide, transparent: true, opacity: 0.38, depthWrite: false })
  globe.add(new THREE.Mesh(atmosphereGeometry, atmosphereMaterial))
  let texture: THREE.Texture | undefined
  // The texture is a vector drawing: rasterise it large so coasts stay crisp until the street map takes over
  const art = new Image()
  art.src = '/earth-cartoon.svg'
  art.decode().then(() => {
    if (disposed) return
    const widthPx = Math.min(8192, renderer.capabilities.maxTextureSize)
    const board = document.createElement('canvas')
    board.width = widthPx
    board.height = widthPx / 2
    board.getContext('2d')!.drawImage(art, 0, 0, board.width, board.height)
    const loaded = new THREE.CanvasTexture(board)
    loaded.colorSpace = THREE.SRGBColorSpace
    loaded.anisotropy = renderer.capabilities.getMaxAnisotropy()
    texture = loaded
    sphere.visible = true
    host.dataset.texture = 'ready'
    sphereMaterial.map = loaded
    sphereMaterial.color.set(0xffffff)
    sphereMaterial.needsUpdate = true
    draw()
  }).catch(() => { sphere.visible = true; host.dataset.texture = 'plain'; draw() })

  const dotGeometry = new THREE.SphereGeometry(0.018, 12, 8)
  const dotMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff })
  let dots = new THREE.Group()
  globe.add(dots)
  let places: Place[] = []
  const placeButtons = new Map<string, HTMLButtonElement>()
  let photos: MapPhoto[] = []
  let shown = new Map<string, HTMLButtonElement>()
  let width = 1, height = 1
  let insets = { right: 0, bottom: 0, top: 0 }
  let zoom = 1
  let zoomTargetPhoto: MapPhoto | null = null
  let enteringScene = false
  let placeSignature = ''
  // The globe turns only in longitude and latitude, so north stays up like on a real globe
  let view = { lng: 105, lat: 34 }
  let home = { lng: 105, lat: 34 }
  function setView(lng: number, lat: number) {
    view = { lng: ((lng + 540) % 360) - 180, lat: THREE.MathUtils.clamp(lat, -80, 80) }
    // Bring (lng, lat) to face the camera (+z): turn about the axis, then tilt about x
    const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (-90 - view.lng) * DEG)
    const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), view.lat * DEG)
    globe.quaternion.copy(tilt.multiply(spin))
  }
  // Degrees the view moves per dragged pixel: less when zoomed in, so the ground follows the finger
  const degreesPerPixel = () => (2 * Math.atan(altitude() * Math.tan(21 * DEG) / RADIUS) / DEG) / Math.max(1, height)
  let disposed = false

  function drawStars() {
    const ratio = Math.min(window.devicePixelRatio, 2)
    stars.width = Math.round(width * ratio)
    stars.height = Math.round(height * ratio)
    const context = stars.getContext('2d')
    if (!context) return
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, width, height)
    let seed = 27
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    // A quiet, fixed Milky Way band; the only motion in this view comes from the user's drag.
    for (let i = 0; i < 13; i++) {
      const x = (i + 0.5) / 13 * width
      const y = height * 0.85 - x * 0.48
      const haze = context.createRadialGradient(x, y, 0, x, y, Math.max(100, width * 0.17))
      haze.addColorStop(0, 'rgba(133,121,226,.13)')
      haze.addColorStop(0.45, 'rgba(76,112,196,.07)')
      haze.addColorStop(1, 'rgba(76,112,196,0)')
      context.fillStyle = haze
      context.fillRect(x - width * 0.17, y - width * 0.17, width * 0.34, width * 0.34)
    }
    for (let i = 0; i < 1350; i++) {
      const x = random() * width
      const center = height * 0.85 - x * 0.48
      const y = center + (random() + random() + random() - 1.5) * height * 0.3
      if (y < 0 || y > height) continue
      const r = 0.25 + random() * 1.1
      context.fillStyle = `rgba(210,225,255,${0.1 + random() * 0.35})`
      context.beginPath()
      context.arc(x, y, r, 0, Math.PI * 2)
      context.fill()
    }
    for (let i = 0; i < Math.floor(width * height / 3100); i++) {
      const x = random() * width, y = random() * height
      const r = random() > 0.94 ? 1.9 : 0.45 + random() * 0.9
      context.fillStyle = `rgba(240,247,255,${0.3 + random() * 0.6})`
      context.beginPath()
      context.arc(x, y, r, 0, Math.PI * 2)
      context.fill()
      if (r > 1.5) {
        context.strokeStyle = 'rgba(228,242,255,.45)'
        context.lineWidth = 0.7
        context.beginPath()
        context.moveTo(x - 5, y); context.lineTo(x + 5, y)
        context.moveTo(x, y - 5); context.lineTo(x, y + 5)
        context.stroke()
      }
    }
  }

  function fitDistance() {
    const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    const usable = Math.max(0.45, (height - insets.top - insets.bottom) / height)
    return Math.max(4.5, RADIUS / (tangent * usable * 0.86), RADIUS / (tangent * camera.aspect * 0.89))
  }
  function precise(photo: MapPhoto) { return !photo.precision || ['point', 'poi', 'street'].includes(photo.precision) }
  function nearestPhoto(x: number, y: number) {
    const candidate = photos.filter(precise).map((photo) => {
      const wgs = gcj02ToWgs84({ lng: photo.gcj[0], lat: photo.gcj[1] })
      return { photo, spot: projected(onGlobe(wgs.lng, wgs.lat, RADIUS * 1.05)) }
    }).filter(({ spot }) => spot.front)
      .sort((a, b) => Math.hypot(a.spot.x - x, a.spot.y - y) - Math.hypot(b.spot.x - x, b.spot.y - y))[0]
    return candidate && Math.hypot(candidate.spot.x - x, candidate.spot.y - y) < Math.max(135, width * 0.11) ? candidate.photo : null
  }
  // One continuous zoom: past HANDOFF_ALTITUDE the street map carries on from the same point
  function zoomBy(factor: number, point = { x: width / 2, y: (height + insets.top - insets.bottom) / 2 }) {
    if (enteringScene) return
    if (factor > 1 && !zoomTargetPhoto) zoomTargetPhoto = nearestPhoto(point.x, point.y)
    const closest = fitDistance() / (RADIUS + CLOSEST_ALTITUDE)
    zoom = THREE.MathUtils.clamp(zoom * factor, 0.55, closest)
    if (factor < 1 && zoom < 1.2) zoomTargetPhoto = null
    if (factor > 1 && altitude() <= HANDOFF_ALTITUDE && callbacks.onZoomIntoMap) {
      enteringScene = true
      callbacks.onZoomIntoMap({ ...centerLngLat(), altitude: altitude() })
      return
    }
    draw()
  }
  const cameraDistance = () => Math.max(RADIUS + CLOSEST_ALTITUDE, fitDistance() / zoom)
  const altitude = () => cameraDistance() - RADIUS
  // The point of the globe facing the camera (WGS-84)
  function centerLngLat() {
    return { ...view }
  }
  function facePlaces(data: LifeMapData) {
    const visible = data.places.filter((place) => place.lng !== undefined && place.lat !== undefined)
    const center = visible.reduce((sum, place) => sum.add(onGlobe(place.lng!, place.lat!, 1)), new THREE.Vector3())
    if (center.lengthSq() < 0.01) center.copy(onGlobe(105, 34, 1))
    const c = center.normalize()
    home = { lng: Math.atan2(-c.z, c.x) / DEG, lat: Math.asin(THREE.MathUtils.clamp(c.y, -1, 1)) / DEG }
    setView(home.lng, home.lat)
    zoom = 1
    zoomTargetPhoto = null
  }
  function projected(at: THREE.Vector3) {
    const world = at.clone().applyMatrix4(globe.matrixWorld)
    const front = world.z > 0.06
    const ndc = world.project(camera)
    return { front, x: (ndc.x + 1) * width / 2, y: (1 - ndc.y) * height / 2, z: ndc.z }
  }
  function closeMenu() { menu.hidden = true; menu.replaceChildren() }
  function closePlaceMenu() { placeMenu.hidden = true; placeMenu.replaceChildren() }
  function openPlaceMenu(members: Place[], x: number, y: number) {
    closePlaceMenu()
    const title = document.createElement('strong')
    title.textContent = '选择地点'
    placeMenu.append(title)
    for (const place of members) {
      const item = document.createElement('button')
      item.type = 'button'
      item.textContent = `${cityLabel(place.city)}${place.roleConfirmed ? ` · ${roleLabels[place.role]}` : ''} · ${place.eventIds.length} 件事`
      item.addEventListener('click', () => { closePlaceMenu(); callbacks.onSelectCity(place.city) })
      placeMenu.append(item)
    }
    placeMenu.style.left = `${Math.max(8, Math.min(width - 220, x + 16))}px`
    placeMenu.style.top = `${Math.max(insets.top + 8, Math.min(height - insets.bottom - 54 - members.length * 39, y + 18))}px`
    placeMenu.hidden = false
  }
  function openMenu(members: MapPhoto[], x: number, y: number) {
    closeMenu()
    const heading = document.createElement('div')
    heading.className = 'map-photo-menu-heading'
    const title = document.createElement('strong')
    title.textContent = `这里有 ${members.length} 张照片`
    const close = document.createElement('button')
    close.type = 'button'
    close.textContent = '关闭'
    close.addEventListener('click', closeMenu)
    heading.append(title, close)
    const scenePhoto = members.find(precise)
    if (scenePhoto && callbacks.onFocusPhoto) {
      const enter = document.createElement('button')
      enter.type = 'button'
      enter.className = 'map-photo-menu-enter'
      enter.textContent = '放大到此处场景'
      enter.addEventListener('click', () => { enteringScene = true; callbacks.onFocusPhoto?.(scenePhoto) })
      menu.append(heading, enter)
    } else menu.append(heading)
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
        const name = document.createElement('span')
        name.textContent = photo.name
        const number = document.createElement('small')
        number.textContent = `${index + 1} / ${members.length}`
        item.append(img, name, number)
        item.addEventListener('click', (event) => { event.stopPropagation(); closeMenu(); callbacks.onOpenPhoto?.(photo.id) })
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
    menu.append(list)
    menu.style.width = `${Math.min(310, width - 16)}px`
    menu.style.left = `${Math.max(8, Math.min(width - 318, x + 18))}px`
    menu.style.top = `${Math.max(insets.top + 8, Math.min(height - insets.bottom - 220, y - 80))}px`
    menu.hidden = false
  }
  function photoButton(cover: MapPhoto, members: MapPhoto[]) {
    const el = document.createElement('button')
    el.type = 'button'
    el.className = `map-photo globe-photo${members.every((photo) => photo.inferred) ? ' inferred' : ''}`
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
        const hostRect = host.getBoundingClientRect()
        openMenu(members, rect.left - hostRect.left, rect.top - hostRect.top)
      })
    } else {
      el.setAttribute('aria-label', `打开照片 ${cover.name}`)
      el.addEventListener('click', (event) => { event.stopPropagation(); callbacks.onOpenPhoto?.(cover.id) })
    }
    if (precise(cover) && callbacks.onFocusPhoto) el.addEventListener('dblclick', (event) => {
      event.stopPropagation()
      enteringScene = true
      callbacks.onFocusPhoto?.(cover)
    })
    photoLayer.append(el)
    return el
  }
  function placePhotos() {
    const points = photos.flatMap((photo) => {
      const wgs = gcj02ToWgs84({ lng: photo.gcj[0], lat: photo.gcj[1] })
      const spot = projected(onGlobe(wgs.lng, wgs.lat, RADIUS * 1.05))
      return spot.front && spot.z < 1 ? [{ photo, x: spot.x, y: spot.y }] : []
    })
    const used = new Set<string>()
    const taken: DOMRect[] = []
    for (const { x, y, members } of clusterProjectedPhotos(points)) {
      const cover = members.find((photo) => !photo.inferred) || members[0]
      const key = `${members.map((photo) => photo.id).sort().join('|')}|${cover.id}`
      used.add(key)
      let el = shown.get(key)
      if (!el) { el = photoButton(cover, members); shown.set(key, el) }
      const left = Math.round(Math.max(8, Math.min(width - el.offsetWidth - 8, x - 10)))
      const top = Math.round(Math.max(insets.top + 8, Math.min(height - insets.bottom - el.offsetHeight - 8, y - el.offsetHeight - 12)))
      el.style.transform = `translate(${left}px, ${top}px)`
      taken.push(new DOMRect(left, top, el.offsetWidth + 12, el.offsetHeight + 14))
    }
    for (const [key, el] of shown) if (!used.has(key)) { el.remove(); shown.delete(key) }
    return taken
  }
  function placeGroups() {
    const points = places.flatMap((place) => {
      if (place.lng === undefined || place.lat === undefined) return []
      const spot = projected(onGlobe(place.lng, place.lat, RADIUS * 1.06))
      return spot.front && spot.z < 1 ? [{ place, x: spot.x, y: spot.y }] : []
    })
    const groups: { members: Place[]; x: number; y: number }[] = []
    for (const point of points) {
      const group = groups.find((item) => Math.hypot(item.x - point.x, item.y - point.y) < 94)
      if (group) {
        const count = group.members.length
        group.x = (group.x * count + point.x) / (count + 1)
        group.y = (group.y * count + point.y) / (count + 1)
        group.members.push(point.place)
      } else groups.push({ members: [point.place], x: point.x, y: point.y })
    }
    return groups
  }
  function placeButtonsAround(obstacles: DOMRect[]) {
    const used = new Set<string>()
    const occupied = [...obstacles]
    const heading = container.closest('.stage')?.querySelector<HTMLElement>('.map-heading')
    const bounds = heading?.getBoundingClientRect()
    const own = host.getBoundingClientRect()
    if (bounds) occupied.push(new DOMRect(bounds.left - own.left, bounds.top - own.top, bounds.width, bounds.height))
    for (const group of placeGroups()) {
      const key = group.members.map((place) => place.city).sort().join('|')
      used.add(key)
      let el = placeButtons.get(key)
      if (!el) {
        el = document.createElement('button')
        el.type = 'button'
        el.className = `map-label place ${group.members.length > 1 ? 'globe-cluster' : 'globe-place'}`
        const strong = document.createElement('strong')
        strong.textContent = group.members.length > 1 ? `${group.members.length} 处地点` : cityLabel(group.members[0].city)
        const small = document.createElement('small')
        small.textContent = group.members.length > 1 ? group.members.map((place) => cityLabel(place.city)).join(' · ') : `${group.members[0].eventIds.length} 件事`
        el.append(strong, small)
        el.addEventListener('click', (event) => {
          event.stopPropagation()
          if (group.members.length === 1) callbacks.onSelectCity(group.members[0].city)
          else {
            const rect = el!.getBoundingClientRect()
            const local = host.getBoundingClientRect()
            openPlaceMenu(group.members, rect.left - local.left, rect.top - local.top)
          }
        })
        labelsLayer.append(el)
        placeButtons.set(key, el)
      }
      const w = el.offsetWidth, h = el.offsetHeight
      const candidates = [
        { side: 'above', x: group.x - w / 2, y: group.y - h - 16 },
        { side: 'right', x: group.x + 16, y: group.y - h / 2 },
        { side: 'left', x: group.x - w - 16, y: group.y - h / 2 },
        { side: 'below', x: group.x - w / 2, y: group.y + 16 },
      ].map((item) => {
        const x = Math.max(8, Math.min(width - w - 8, item.x))
        const y = Math.max(insets.top + 8, Math.min(height - insets.bottom - h - 8, item.y))
        const overlap = occupied.reduce((sum, rect) => sum + Math.max(0, Math.min(x + w, rect.right) - Math.max(x, rect.left)) * Math.max(0, Math.min(y + h, rect.bottom) - Math.max(y, rect.top)), 0)
        return { ...item, x, y, overlap }
      }).sort((a, b) => a.overlap - b.overlap)
      const choice = candidates[0]
      el.dataset.side = choice.side
      el.style.transform = `translate(${Math.round(choice.x)}px, ${Math.round(choice.y)}px)`
      occupied.push(new DOMRect(choice.x, choice.y, w, h))
    }
    for (const [key, el] of placeButtons) if (!used.has(key)) { el.remove(); placeButtons.delete(key) }
  }
  function draw() {
    if (disposed) return
    camera.position.z = cameraDistance()
    camera.updateMatrixWorld()
    globe.position.y = (insets.bottom - insets.top) / height * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    globe.updateMatrixWorld(true)
    host.dataset.zoom = zoom.toFixed(3)
    host.dataset.altitude = altitude().toFixed(3)
    const center = centerLngLat()
    host.dataset.center = `${center.lng.toFixed(2)},${center.lat.toFixed(2)}`
    host.dataset.orientation = globe.quaternion.toArray().map((value) => value.toFixed(3)).join(',')
    renderer.render(scene, camera)
    const taken = placePhotos()
    placeButtonsAround([new DOMRect(0, 0, width, insets.top), new DOMRect(0, height - insets.bottom, width, insets.bottom), ...taken])
  }
  function resize() {
    width = Math.max(1, container.clientWidth)
    height = Math.max(1, container.clientHeight)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
    drawStars()
    draw()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(container)

  const pointers = new Map<number, { x: number; y: number }>()
  let pinch = 0
  canvas.addEventListener('pointerdown', (event) => {
    closeMenu()
    closePlaceMenu()
    canvas.setPointerCapture(event.pointerId)
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      pinch = Math.hypot(a.x - b.x, a.y - b.y)
    }
  })
  canvas.addEventListener('pointermove', (event) => {
    const previous = pointers.get(event.pointerId)
    if (!previous) return
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      const next = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinch > 0) zoomBy(next / pinch, { x: (a.x + b.x) / 2 - host.getBoundingClientRect().left, y: (a.y + b.y) / 2 - host.getBoundingClientRect().top })
      pinch = next
      return
    }
    const dx = event.clientX - previous.x
    const dy = event.clientY - previous.y
    zoomTargetPhoto = null
    const step = degreesPerPixel()
    setView(view.lng - dx * step / Math.max(0.2, Math.cos(view.lat * DEG)), view.lat + dy * step)
    draw()
  })
  const release = (event: PointerEvent) => { pointers.delete(event.pointerId); pinch = 0 }
  canvas.addEventListener('pointerup', release)
  canvas.addEventListener('pointercancel', release)
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault()
    const rect = canvas.getBoundingClientRect()
    zoomBy(Math.exp(-event.deltaY * 0.0012), { x: event.clientX - rect.left, y: event.clientY - rect.top })
  }, { passive: false })
  canvas.addEventListener('keydown', (event) => {
    const step = degreesPerPixel() * 60
    let moved = true
    if (event.key === 'ArrowLeft') setView(view.lng - step, view.lat)
    else if (event.key === 'ArrowRight') setView(view.lng + step, view.lat)
    else if (event.key === 'ArrowUp') setView(view.lng, view.lat + step)
    else if (event.key === 'ArrowDown') setView(view.lng, view.lat - step)
    else if (event.key === '+' || event.key === '=') { zoomBy(1.2); moved = false }
    else if (event.key === '-') { zoomBy(1 / 1.2); moved = false }
    else return
    event.preventDefault()
    if (moved) draw()
  })
  const button = (name: string, label: string, action: () => void) => {
    const el = document.createElement('button')
    el.type = 'button'
    el.textContent = label
    el.setAttribute('aria-label', name)
    el.title = name
    el.addEventListener('click', action)
    controls.append(el)
  }
  button('放大地球', '+', () => zoomBy(1.25))
  button('缩小地球', '−', () => zoomBy(0.8))
  button('回到照片区域', '◎', () => { setView(home.lng, home.lat); zoom = 1; zoomTargetPhoto = null; draw() })
  const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { closeMenu(); closePlaceMenu() } }
  window.addEventListener('keydown', onEscape)

  // Start facing China (with photos, facePlaces turns to them)
  setView(view.lng, view.lat)
  resize()
  return {
    update(data: LifeMapData) {
      const signature = data.places.map((place) => `${place.city}:${place.lng}:${place.lat}`).join('|')
      if (signature !== placeSignature) { placeSignature = signature; facePlaces(data) }
      dots.clear()
      labelsLayer.replaceChildren()
      placeButtons.clear()
      places = data.places
      host.dataset.placeCount = String(places.length)
      host.dataset.placeNames = places.map((place) => cityLabel(place.city)).join('|')
      for (const place of data.places) {
        if (place.lng === undefined || place.lat === undefined) continue
        const dot = new THREE.Mesh(dotGeometry, dotMaterial)
        dot.position.copy(onGlobe(place.lng, place.lat, RADIUS * 1.012))
        dots.add(dot)
      }
      photos = data.photos || []
      draw()
    },
    setInsets(next: typeof insets) { insets = next; draw() },
    // Coming back from the street map: face the same point from the same height
    showAround(lng: number, lat: number, height: number) {
      enteringScene = false
      zoomTargetPhoto = null
      closeMenu()
      closePlaceMenu()
      setView(lng, lat)
      zoom = THREE.MathUtils.clamp(fitDistance() / (RADIUS + Math.max(height, CLOSEST_ALTITUDE)), 0.55, fitDistance() / (RADIUS + CLOSEST_ALTITUDE))
      draw()
    },
    // Shown again without a hand-over (e.g. "返回地球"): let it be zoomed in again
    resume() { enteringScene = false; draw() },
    dispose() {
      disposed = true
      observer.disconnect()
      window.removeEventListener('keydown', onEscape)
      shown.clear()
      placeButtons.clear()
      texture?.dispose()
      sphereGeometry.dispose()
      sphereMaterial.dispose()
      atmosphereGeometry.dispose()
      atmosphereMaterial.dispose()
      dotGeometry.dispose()
      dotMaterial.dispose()
      renderer.dispose()
      host.remove()
    },
  }
}

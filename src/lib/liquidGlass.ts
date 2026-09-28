// Edge refraction for the glass surfaces (see skills/liquid-glass): near its rim a real
// glass slab bends what is behind it inwards, like a lens. An SVG displacement map, built for each
// element's size and corner radius, is used as the element's backdrop filter.
//
// Only Chromium applies SVG filters to backdrop-filter; other browsers keep the plain glass from
// the stylesheet. Nothing moves: the map is static for a given size (the interface stays still).

const NS = 'http://www.w3.org/2000/svg'
const EDGE = 22 // px of rim that bends
const SCALE = 46 // strongest shift in px, at the very edge

export const supportsRefraction = () =>
  typeof window !== 'undefined' && 'chrome' in window && CSS.supports('backdrop-filter', 'url(#a)') &&
  !matchMedia('(prefers-reduced-transparency: reduce)').matches

let defs: SVGDefsElement | null = null
let serial = 0

function container() {
  if (defs) return defs
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('aria-hidden', 'true')
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden'
  defs = document.createElementNS(NS, 'defs')
  svg.append(defs)
  document.body.append(svg)
  return defs
}

/** Displacement map: red = horizontal shift, green = vertical, 128 = none; strongest at the rim */
export function displacementMap(width: number, height: number, radius: number, edge = EDGE) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const g = canvas.getContext('2d')!
  const image = g.createImageData(width, height)
  const hx = width / 2, hy = height / 2, r = Math.min(radius, hx, hy)
  // Signed distance to the rounded rectangle (negative inside)
  const sd = (x: number, y: number) => {
    const qx = Math.abs(x - hx) - (hx - r), qy = Math.abs(y - hy) - (hy - r)
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4
    const depth = -sd(x + 0.5, y + 0.5)
    let dx = 0, dy = 0
    if (depth > 0 && depth < edge) {
      // Outward normal from the distance field; sample inwards, harder the closer to the rim
      const gx = sd(x + 1.5, y + 0.5) - sd(x - 0.5, y + 0.5)
      const gy = sd(x + 0.5, y + 1.5) - sd(x + 0.5, y - 0.5)
      const length = Math.hypot(gx, gy) || 1
      const strength = (1 - depth / edge) ** 2
      dx = (-gx / length) * strength
      dy = (-gy / length) * strength
    }
    image.data[i] = Math.round(128 + dx * 127)
    image.data[i + 1] = Math.round(128 + dy * 127)
    image.data[i + 2] = 128
    image.data[i + 3] = 255
  }
  g.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}

function refract(el: HTMLElement) {
  const id = `liquid-glass-${++serial}`
  const filter = document.createElementNS(NS, 'filter')
  filter.id = id
  for (const [k, v] of Object.entries({ x: '0', y: '0', filterUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' })) filter.setAttribute(k, v)
  const map = document.createElementNS(NS, 'feImage')
  map.setAttribute('result', 'map')
  map.setAttribute('preserveAspectRatio', 'none')
  const shift = document.createElementNS(NS, 'feDisplacementMap')
  for (const [k, v] of Object.entries({ in: 'SourceGraphic', in2: 'map', scale: String(SCALE), xChannelSelector: 'R', yChannelSelector: 'G' })) shift.setAttribute(k, v)
  filter.append(map, shift)
  container().append(filter)

  let size = ''
  const build = () => {
    const width = Math.round(el.offsetWidth), height = Math.round(el.offsetHeight)
    if (!width || !height || `${width}x${height}` === size) return
    size = `${width}x${height}`
    const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0
    filter.setAttribute('width', String(width))
    filter.setAttribute('height', String(height))
    map.setAttribute('width', String(width))
    map.setAttribute('height', String(height))
    map.setAttribute('href', displacementMap(width, height, radius))
    // Refraction first, then a light blur and the luminance lift that keeps text legible
    const value = `url(#${id}) blur(var(--glass-refract-blur, 5px)) saturate(150%) brightness(1.04)`
    el.style.setProperty('backdrop-filter', value)
    el.style.setProperty('-webkit-backdrop-filter', value)
    el.classList.add('refracts')
  }
  const observer = new ResizeObserver(build)
  observer.observe(el)
  build()
  return () => { observer.disconnect(); filter.remove(); el.classList.remove('refracts'); el.style.removeProperty('backdrop-filter'); el.style.removeProperty('-webkit-backdrop-filter') }
}

/** Gives every element matching `selector`, now and later, refracting edges (Chromium only) */
export function startLiquidGlass(selector: string) {
  if (!supportsRefraction()) return () => {}
  const attached = new Map<HTMLElement, () => void>()
  const scan = () => {
    for (const el of document.querySelectorAll<HTMLElement>(selector)) if (!attached.has(el)) attached.set(el, refract(el))
    for (const [el, stop] of attached) if (!el.isConnected) { stop(); attached.delete(el) }
  }
  const observer = new MutationObserver(scan)
  observer.observe(document.body, { childList: true, subtree: true })
  scan()
  return () => { observer.disconnect(); for (const stop of attached.values()) stop(); attached.clear() }
}

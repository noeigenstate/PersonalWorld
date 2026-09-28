// Draws the eval photos: two people in a park (eyes open / closed, sharp / blurred / badly framed),
// a landscape series, and a series where someone always blinks. Synthetic, safe to commit.
// node skills/photo-cull/evals/2026-09-28/make-images.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const { chromium } = createRequire(import.meta.url)('playwright')
const out = fileURLToPath(new URL('./images/', import.meta.url))
mkdirSync(out, { recursive: true })

// [name, scene options]
const photos = [
  ['blink-a', { kind: 'people', eyes: ['open', 'open'] }],
  ['blink-b', { kind: 'people', eyes: ['closed', 'open'], shift: 6 }],
  ['blink-c', { kind: 'people', eyes: ['open', 'closed'], shift: -5 }],
  ['blink-d', { kind: 'people', eyes: ['open', 'open'], blur: 7, shift: 3 }],
  ['blink-e', { kind: 'people', eyes: ['open', 'open'], shift: 330 }],
  ['land-a', { kind: 'land' }],
  ['land-b', { kind: 'land', shift: 10 }],
  ['land-c', { kind: 'land', blur: 8, shift: 4 }],
  ['land-d', { kind: 'land', tilt: 9 }],
  ['all-a', { kind: 'people', eyes: ['closed', 'open'] }],
  ['all-b', { kind: 'people', eyes: ['open', 'closed'], shift: 5 }],
  ['all-c', { kind: 'people', eyes: ['closed', 'closed'], shift: -4 }],
]

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage()
for (const [name, scene] of photos) {
  const dataUrl = await page.evaluate((scene) => {
    const W = 1024, H = 768
    const canvas = document.createElement('canvas')
    canvas.width = W; canvas.height = H
    const g = canvas.getContext('2d')
    const draw = (ctx) => {
      ctx.save()
      if (scene.tilt) { ctx.translate(W / 2, H / 2); ctx.rotate((scene.tilt * Math.PI) / 180); ctx.translate(-W / 2, -H / 2); ctx.scale(1.2, 1.2); ctx.translate(-80, -60) }
      const sky = ctx.createLinearGradient(0, 0, 0, H)
      sky.addColorStop(0, '#8ec9f0'); sky.addColorStop(0.55, '#d8eef9'); sky.addColorStop(0.56, '#7fb86a'); sky.addColorStop(1, '#5f9b4e')
      ctx.fillStyle = sky; ctx.fillRect(-200, -200, W + 400, H + 400)
      // Trees and a lake
      for (const [x, s] of [[90, 1], [880, 1.2], [760, 0.8]]) {
        ctx.fillStyle = '#6b4a2f'; ctx.fillRect(x - 8 * s, 300, 16 * s, 140 * s)
        ctx.fillStyle = '#3f7d3a'; ctx.beginPath(); ctx.arc(x, 290, 70 * s, 0, Math.PI * 2); ctx.fill()
      }
      ctx.fillStyle = '#6fa8cf'; ctx.beginPath(); ctx.ellipse(520, 470, 300, 40, 0, 0, Math.PI * 2); ctx.fill()
      if (scene.kind === 'land') {
        ctx.fillStyle = '#9aa7b8'; ctx.beginPath(); ctx.moveTo(250, 425); ctx.lineTo(420, 250); ctx.lineTo(600, 425); ctx.fill()
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(385, 285); ctx.lineTo(420, 250); ctx.lineTo(455, 285); ctx.fill()
      }
      ctx.restore()
      if (scene.kind !== 'people') return
      const person = (cx, shirt, hair, eyes) => {
        ctx.fillStyle = shirt; ctx.beginPath(); ctx.roundRect(cx - 120, 520, 240, 300, 90); ctx.fill()
        ctx.fillStyle = '#e9b893'; ctx.fillRect(cx - 28, 470, 56, 70)
        ctx.fillStyle = '#f1c7a3'; ctx.beginPath(); ctx.ellipse(cx, 380, 95, 120, 0, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = hair; ctx.beginPath(); ctx.ellipse(cx, 300, 102, 70, 0, Math.PI, Math.PI * 2); ctx.fill()
        ctx.fillRect(cx - 102, 295, 22, 70); ctx.fillRect(cx + 80, 295, 22, 70)
        ctx.strokeStyle = '#3b2a20'; ctx.lineWidth = 5; ctx.lineCap = 'round'
        for (const side of [-1, 1]) {
          const ex = cx + side * 38, ey = 370
          ctx.beginPath(); ctx.moveTo(ex - 22, ey - 32); ctx.quadraticCurveTo(ex, ey - 42, ex + 22, ey - 32); ctx.stroke()
          if (eyes === 'open') {
            ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(ex, ey, 22, 13, 0, 0, Math.PI * 2); ctx.fill()
            ctx.fillStyle = '#5a3b22'; ctx.beginPath(); ctx.arc(ex, ey, 10, 0, Math.PI * 2); ctx.fill()
            ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(ex, ey, 5, 0, Math.PI * 2); ctx.fill()
            ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex + 3, ey - 3, 2.5, 0, Math.PI * 2); ctx.fill()
            ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(ex, ey, 22, 13, 0, Math.PI, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 5
          } else {
            ctx.beginPath(); ctx.moveTo(ex - 22, ey); ctx.quadraticCurveTo(ex, ey + 12, ex + 22, ey); ctx.stroke()
            ctx.lineWidth = 2
            for (const t of [-14, -5, 5, 14]) { ctx.beginPath(); ctx.moveTo(ex + t, ey + 6); ctx.lineTo(ex + t * 1.1, ey + 13); ctx.stroke() }
            ctx.lineWidth = 5
          }
        }
        ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx, 385); ctx.lineTo(cx - 8, 420); ctx.lineTo(cx + 4, 422); ctx.stroke()
        ctx.strokeStyle = '#b5534a'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(cx, 432, 30, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke()
      }
      const s = scene.shift || 0
      person(360 + s, '#d9534f', '#2b1d14', scene.eyes[0])
      person(660 + s, '#3b73b9', '#4a3222', scene.eyes[1])
    }
    if (scene.blur) {
      const sharp = document.createElement('canvas')
      sharp.width = W; sharp.height = H
      draw(sharp.getContext('2d'))
      g.filter = `blur(${scene.blur}px)`
      g.drawImage(sharp, 0, 0)
    } else draw(g)
    return canvas.toDataURL('image/jpeg', 0.88)
  }, scene)
  writeFileSync(`${out}${name}.jpg`, Buffer.from(dataUrl.split(',')[1], 'base64'))
}
await browser.close()
console.log(`wrote ${photos.length} images to ${out}`)

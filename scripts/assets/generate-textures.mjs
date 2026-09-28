// Paints the cartoon world's textures with a local image model (Qwen-Image 2.1 in ComfyUI, on this
// computer's GPU) and makes them tile seamlessly. Output: public/world-assets/textures/<name>.png
// Needs ComfyUI running: D:\ComfyUI\run_comfyui.bat (or python main.py --listen 127.0.0.1 --port 8188)
// node scripts/assets/generate-textures.mjs [name…]
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const COMFY = process.env.COMFY_URL || 'http://127.0.0.1:8188'
const out = fileURLToPath(new URL('../../public/world-assets/textures/', import.meta.url))
const style = 'painterly hand-painted texture for a stylized mobile game map, visible soft brush strokes, rich variation of light and dark tones, gentle ambient occlusion between shapes, no text, no border, seamless tileable texture, fills the whole frame'

export const TEXTURES = {
  grass: `top-down view of a lush bright green cartoon grass meadow with tiny grass tufts and a few little flowers, ${style}`,
  forest: `top-down view of a dense cartoon forest canopy, many round leafy tree crowns and pointed pine tops packed together, several shades of green, ${style}`,
  water: `top-down view of bright turquoise cartoon sea water with small white curved wave ripple marks scattered evenly, ${style}`,
  cliff: `front view of a cartoon rock cliff wall, horizontal layered warm brown and grey stone strata with cracks, ${style}`,
  dirt: `top-down view of a cartoon dirt path, light beige packed earth with a few small pebbles, ${style}`,
  stone: `top-down view of a cartoon cobblestone plaza, rounded light warm grey paving stones, ${style}`,
  sand: `top-down view of cartoon golden beach sand with gentle ripples and a few tiny shells, ${style}`,
  fields: `top-down view of cartoon farmland, parallel rows of golden wheat and green crops, ${style}`,
  roofRed: `top-down view of cartoon red clay roof tiles in neat overlapping rows, ${style}`,
  roofBlue: `top-down view of cartoon blue slate roof tiles in neat overlapping rows, ${style}`,
}

function workflow(prompt, seed, size = 1024) {
  return {
    1: { class_type: 'UNETLoader', inputs: { unet_name: 'qwen_image_2.1_int8_convrot.safetensors', weight_dtype: 'default' } },
    2: { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen3vl_8b_w4a8_heretic.safetensors', type: 'qwen_image' } },
    3: { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_2.1_vae_bf16.safetensors' } },
    4: { class_type: 'EmptyLatentImage', inputs: { width: size, height: size, batch_size: 1 } },
    5: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['2', 0] } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: 'photo, realistic, 3d render, perspective, horizon, sky, frame, border, watermark, text, blurry, dark', clip: ['2', 0] } },
    7: { class_type: 'KSampler', inputs: { seed, steps: 20, cfg: 3.5, sampler_name: 'euler', scheduler: 'simple', denoise: 1, model: ['1', 0], positive: ['5', 0], negative: ['6', 0], latent_image: ['4', 0] } },
    8: { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['3', 0] } },
    9: { class_type: 'SaveImage', inputs: { filename_prefix: 'personal-world-texture', images: ['8', 0] } },
  }
}

async function generate(name, prompt) {
  const seed = [...name].reduce((sum, c) => sum * 31 + c.charCodeAt(0), 7) % 1e9
  const queued = await (await fetch(`${COMFY}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: workflow(prompt, seed) }) })).json()
  if (!queued.prompt_id) throw new Error(`ComfyUI 拒绝了请求：${JSON.stringify(queued).slice(0, 300)}`)
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 3000))
    const history = await (await fetch(`${COMFY}/history/${queued.prompt_id}`)).json()
    const entry = history[queued.prompt_id]
    if (!entry) continue
    if (entry.status?.status_str === 'error') throw new Error(`生成 ${name} 失败：${JSON.stringify(entry.status.messages).slice(0, 300)}`)
    const image = Object.values(entry.outputs || {}).flatMap((o) => o.images || [])[0]
    if (!image) continue
    const url = `${COMFY}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder || '')}&type=${image.type || 'output'}`
    return Buffer.from(await (await fetch(url)).arrayBuffer())
  }
}

// Seamless: blend with a copy shifted by half across x, then the same across y. Each shifted copy
// has its own seam through the middle, where its weight is zero; at the edges it takes over.
async function makeSeamless(png, size = 1024) {
  const { chromium } = createRequire(import.meta.url)('playwright')
  const browser = await chromium.launch({ channel: 'chrome' })
  const page = await browser.newPage()
  const data = await page.evaluate(async ({ b64, size }) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode()
    const c = document.createElement('canvas'); c.width = c.height = size
    const g = c.getContext('2d', { willReadFrequently: true })
    g.drawImage(img, 0, 0, size, size)
    const smooth = (t) => { const x = Math.min(1, Math.max(0, (t - 0.45) / 0.5)); return x * x * (3 - 2 * x) }
    for (const axis of ['x', 'y']) {
      const base = g.getImageData(0, 0, size, size)
      const shifted = new Uint8ClampedArray(base.data.length)
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const sx = axis === 'x' ? (x + size / 2) % size : x, sy = axis === 'y' ? (y + size / 2) % size : y
        const from = (sy * size + sx) * 4, to = (y * size + x) * 4
        for (let k = 0; k < 4; k++) shifted[to + k] = base.data[from + k]
      }
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const w = smooth(Math.abs((axis === 'x' ? x : y) / size - 0.5) * 2)
        const i = (y * size + x) * 4
        for (let k = 0; k < 3; k++) base.data[i + k] = base.data[i + k] * (1 - w) + shifted[i + k] * w
      }
      g.putImageData(base, 0, 0)
    }
    return c.toDataURL('image/png').split(',')[1]
  }, { b64: png.toString('base64'), size })
  await browser.close()
  return Buffer.from(data, 'base64')
}

await mkdir(out, { recursive: true })
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(TEXTURES)
for (const name of wanted) {
  const started = Date.now()
  const raw = await generate(name, TEXTURES[name])
  await writeFile(`${out}${name}.png`, await makeSeamless(raw))
  console.log(`${name}.png（${Math.round((Date.now() - started) / 1000)} 秒）`)
}

// Fictional demo photos for the README GIFs, painted by the local image model (Qwen-Image 2.1 in
// ComfyUI). They stand in for a family album so no private photo is ever recorded.
// Output: world-data/sources/demo-photos/<name>.jpg (not in git); scripts/record-readme-media.mjs uses them.
// node scripts/assets/make-demo-photos.mjs [name…]
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const COMFY = process.env.COMFY_URL || 'http://127.0.0.1:8188'
const out = fileURLToPath(new URL('../../world-data/sources/demo-photos/', import.meta.url))
const look = 'photorealistic photograph, natural light, soft colours, no text, no watermark'

export const DEMO_PHOTOS = {
  'xiangtan-1': `a quiet riverside town in Hunan, a family home with a small courtyard, warm afternoon sunlight, ${look}`,
  'xiangtan-2': `a home-cooked family dinner on a wooden table, steaming dishes, warm indoor light, ${look}`,
  'wuhan-1': `a university campus avenue lined with blooming cherry blossoms, students walking with bicycles, spring, ${look}`,
  'wuhan-2': `the Yangtze River bridge at sunset seen from the riverbank in Wuhan, golden light, ${look}`,
  'shanghai-1': `the Bund skyline of Shanghai at night, lights reflecting on the Huangpu river, ${look}`,
  'shanghai-2': `a narrow old Shanghai lane in the morning with laundry hanging and a bicycle, ${look}`,
  'shanghai-3': `a Shanghai street lined with plane trees in autumn, a cafe terrace, ${look}`,
  'hangzhou-1': `West Lake in Hangzhou in autumn, golden ginkgo trees, a stone arched bridge, morning mist, ${look}`,
  'hangzhou-2': `a lakeside park in Hangzhou in spring, a traditional pavilion, cherry blossoms along a stone path, ${look}`,
  // People in the foreground: the hard case for the 3D relief (depth tears around bodies)
  'people-park': `three teenagers in white long-sleeve shirts walking hand in hand on a dirt path in a park, tall trees, a stone monument, cloudy sky, wide angle, ${look}`,
  'hangzhou-3': `a canal in Hangzhou in autumn with a wooden boat and a red maple tree, ${look}`,
}

const workflow = (prompt, seed, width, height) => ({
  1: { class_type: 'UNETLoader', inputs: { unet_name: 'qwen_image_2.1_int8_convrot.safetensors', weight_dtype: 'default' } },
  2: { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen3vl_8b_w4a8_heretic.safetensors', type: 'qwen_image' } },
  3: { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_2.1_vae_bf16.safetensors' } },
  4: { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
  5: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['2', 0] } },
  6: { class_type: 'CLIPTextEncode', inputs: { text: 'cartoon, illustration, text, watermark, blurry, distorted, people close-up', clip: ['2', 0] } },
  7: { class_type: 'KSampler', inputs: { seed, steps: 20, cfg: 3.5, sampler_name: 'euler', scheduler: 'simple', denoise: 1, model: ['1', 0], positive: ['5', 0], negative: ['6', 0], latent_image: ['4', 0] } },
  8: { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['3', 0] } },
  9: { class_type: 'SaveImage', inputs: { filename_prefix: 'personal-world-demo', images: ['8', 0] } },
})

async function paint(name, prompt) {
  const seed = [...name].reduce((sum, c) => sum * 31 + c.charCodeAt(0), 11) % 1e9
  const queued = await (await fetch(`${COMFY}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: workflow(prompt, seed, 896, 672) }) })).json()
  if (!queued.prompt_id) throw new Error(`ComfyUI 拒绝了请求：${JSON.stringify(queued).slice(0, 300)}`)
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 3000))
    const entry = (await (await fetch(`${COMFY}/history/${queued.prompt_id}`)).json())[queued.prompt_id]
    if (!entry) continue
    if (entry.status?.status_str === 'error') throw new Error(`生成 ${name} 失败`)
    const image = Object.values(entry.outputs || {}).flatMap((o) => o.images || [])[0]
    if (!image) continue
    const url = `${COMFY}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder || '')}&type=${image.type || 'output'}`
    return Buffer.from(await (await fetch(url)).arrayBuffer())
  }
}

// PNG → JPEG (q 86) in a browser, so no image library is needed
async function toJpeg(png) {
  const { chromium } = createRequire(import.meta.url)('playwright')
  const browser = await chromium.launch({ channel: 'chrome' })
  const page = await browser.newPage()
  const data = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode()
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
    c.getContext('2d').drawImage(img, 0, 0)
    return c.toDataURL('image/jpeg', 0.86).split(',')[1]
  }, png.toString('base64'))
  await browser.close()
  return Buffer.from(data, 'base64')
}

await mkdir(out, { recursive: true })
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(DEMO_PHOTOS)
for (const name of wanted) {
  if (!DEMO_PHOTOS[name]) throw new Error(`没有 ${name}，可选：${Object.keys(DEMO_PHOTOS).join(' ')}`)
  if (existsSync(`${out}${name}.jpg`) && process.argv.slice(2).length === 0) { console.log(`${name}.jpg 已有，跳过`); continue }
  const started = Date.now()
  await writeFile(`${out}${name}.jpg`, await toJpeg(await paint(name, DEMO_PHOTOS[name])))
  console.log(`${name}.jpg（${Math.round((Date.now() - started) / 1000)} 秒）`)
}

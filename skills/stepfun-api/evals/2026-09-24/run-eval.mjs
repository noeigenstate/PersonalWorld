import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const here = (p) => fileURLToPath(new URL(p, import.meta.url))
process.loadEnvFile(here('../../../../.env'))
const key = process.env.STEPFUN_API_KEY
// Reference inputs made with the verified call
const wavRes = await fetch('https://api.stepfun.com/v1/audio/speech', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'stepaudio-2.5-tts', input: '我们去外滩散步吧', voice: 'cixingnansheng', response_format: 'wav' }) })
const wav = Buffer.from(await wavRes.arrayBuffer())
const png = readFileSync(here('../../../../docs/mockups/3d-cartoon-map.png'))
const dataUrl = 'data:image/png;base64,' + png.toString('base64')
for (const variant of ['with', 'without']) {
  const mod = await import(new URL(`./${variant}-skill/stepfun.mjs`, import.meta.url).href)
  const row = { variant }
  const tryIt = async (name, fn) => { const t = Date.now(); try { row[name] = await fn(); row[name + 'Ms'] = Date.now() - t } catch (e) { row[name] = 'FAIL: ' + String(e.message || e).slice(0, 160) } }
  await tryIt('askJson', async () => { const r = await mod.askJson('图里主要是什么？用 JSON 返回 {"subject":"一句话"}', dataUrl); return typeof r === 'object' ? 'OK ' + JSON.stringify(r).slice(0, 60) : 'BAD ' + typeof r })
  await tryIt('transcribe', async () => { const t = await mod.transcribe(wav); return typeof t === 'string' && t.includes('外滩') ? 'OK ' + t : 'BAD ' + JSON.stringify(t) })
  await tryIt('speak', async () => { const b = await mod.speak('你好，这是测试'); const ok = Buffer.isBuffer(b) && b.length > 1000 && (b.subarray(0, 3).toString() === 'ID3' || b[0] === 0xff); return ok ? `OK ${b.length} bytes` : 'BAD ' + (b && b.length) })
  console.log(JSON.stringify(row))
}

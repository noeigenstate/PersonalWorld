// photo-cull: with the skill vs. the same output fields only, on three stacks, real StepFun model.
// Uses server/photoCull.mjs, so requests and parsing are exactly what the API route does.
// node skills/photo-cull/evals/2026-09-28/run-eval.mjs   (RUNS=3 by default; --regrade re-scores results.json)
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const root = here('../../../../')
const { cullMessages, readCull } = await import(pathToFileURL(root + 'server/photoCull.mjs').href)

const cases = [
  { name: 'blink', note: '两人合影 5 张：a 都睁眼且清晰；b 左边的人闭眼；c 右边的人闭眼；d 都睁眼但模糊；e 都睁眼但人被裁到画面边缘', ids: ['blink-a', 'blink-b', 'blink-c', 'blink-d', 'blink-e'], keep: 1, closed: ['blink-b', 'blink-c'], blurry: ['blink-d'], good: ['blink-a'] },
  { name: 'landscape', note: '风景 4 张，没有人：a、b 清晰；c 模糊；d 地平线倾斜', ids: ['land-a', 'land-b', 'land-c', 'land-d'], keep: 1, closed: [], blurry: ['land-c'], good: ['land-a', 'land-b'] },
  { name: 'all-blink', note: '合影 3 张，每张都有人闭眼：仍要选出一张，不能多选', ids: ['all-a', 'all-b', 'all-c'], keep: 1, closed: ['all-a', 'all-b', 'all-c'], blurry: [], good: ['all-a', 'all-b', 'all-c'] },
]

function grade(c, read) {
  const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x))
  const flagged = (key) => c.ids.filter((id) => read.reviews[id]?.[key])
  return {
    coversAll: c.ids.every((id) => read.reviews[id]),
    eyesExact: same(flagged('eyesClosed'), c.closed),
    blurryFound: c.blurry.every((id) => read.reviews[id]?.blurry) && !c.good.some((id) => read.reviews[id]?.blurry),
    keepRight: read.keep.length === c.keep && read.keep.every((id) => c.good.includes(id)),
  }
}
const checks = ['coversAll', 'eyesExact', 'blurryFound', 'keepRight']

function report(results) {
  const runs = Object.values(results)[0][cases[0].name].length
  const lines = [['case', 'check', ...Object.keys(results)].join(' | ')]
  const totals = Object.fromEntries(Object.keys(results).map((v) => [v, 0]))
  for (const c of cases) for (const check of checks) {
    lines.push([c.name, check, ...Object.entries(results).map(([v, r]) => { const n = r[c.name].filter((x) => x.grade[check]).length; totals[v] += n; return `${n}/${runs}` })].join(' | '))
  }
  lines.push(['total', '', ...Object.values(totals).map((n) => `${n}/${cases.length * checks.length * runs}`)].join(' | '))
  console.log(lines.join('\n'))
}

if (process.argv.includes('--regrade')) {
  const saved = JSON.parse(readFileSync(here('./results.json'), 'utf8'))
  for (const variant of Object.values(saved.results)) for (const c of cases) for (const run of variant[c.name]) run.grade = grade(c, run.read)
  writeFileSync(here('./results.json'), JSON.stringify(saved, null, 2) + '\n')
  report(saved.results)
  process.exit(0)
}

process.loadEnvFile(root + '.env')
const { stepfunConfig, chat, parseJsonAnswer } = await import(pathToFileURL(root + 'server/stepfun.mjs').href)
const { loadSkill } = await import(pathToFileURL(root + 'server/skills.mjs').href)
if (!existsSync(here('./images/blink-a.jpg'))) { console.log('先运行 make-images.mjs'); process.exit(1) }
const image = (id) => 'data:image/jpeg;base64,' + readFileSync(here(`./images/${id}.jpg`)).toString('base64')
const fieldsOnly = '这些照片构图相似，请逐张检查并推荐保留。用简体中文，严格输出 JSON 对象：{"photos":[{"ref":"P1","eyesClosed":false,"blurry":false,"issues":[],"score":8,"note":""}],"keep":["P1"],"summary":""}。ref 用 P1、P2… 表示。'
const cfg = stepfunConfig()
const RUNS = Number(process.env.RUNS || 3)
const variants = { 'with-skill': loadSkill('photo-cull'), 'without-skill': fieldsOnly }
const results = {}
for (const [variant, system] of Object.entries(variants)) {
  results[variant] = {}
  for (const c of cases) {
    results[variant][c.name] = []
    const photos = c.ids.map((id) => ({ id, dataUrl: image(id) }))
    for (let run = 0; run < RUNS; run++) {
      const answer = parseJsonAnswer(await chat(cfg, cullMessages({ system, photos, keep: c.keep }), { json: true }))
      const read = readCull(answer, photos)
      results[variant][c.name].push({ read, grade: grade(c, read) })
    }
  }
}
writeFileSync(here('./results.json'), JSON.stringify({ model: cfg.model, cases: cases.map(({ name, note }) => ({ name, note })), results }, null, 2) + '\n')
report(results)

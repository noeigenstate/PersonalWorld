// photo-card: same photo, same output fields; with the skill as system prompt vs. fields only.
// Each variant runs RUNS times (default 5) against the real StepFun model; rubric checks are automatic.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const root = here('../../../../')
process.loadEnvFile(root + '.env')
const { stepfunConfig, chat, parseJsonAnswer } = await import(pathToFileURL(root + 'server/stepfun.mjs').href)
const { loadSkill } = await import(pathToFileURL(root + 'server/skills.mjs').href)
const cfg = stepfunConfig()

const photo = readFileSync(here('./photo.jpg'))
const dataUrl = 'data:image/jpeg;base64,' + photo.toString('base64')
const metadata = '文件名：微信图片_20260924133610_300_56.jpg\n时间：2026-09-24 13:36:10（来源：filename）\nGPS：无\n城市：未知\n尺寸：1080 × 1920'
const fieldsOnly = '为照片生成信息卡。用简体中文，严格输出 JSON 对象，字段：title、caption、scene、visibleText、clues（数组，每项 kind、evidence、inference、confidence）、eventGuess（type、reason）、tags、questions。'

const variants = {
  'with-skill': loadSkill('photo-card'),
  'without-skill': fieldsOnly,
}

// Checks run per text field: joining the card into one JSON string once made the grader read
// "保存于 2026…" and a later "拍摄地点" as one sentence (JSON commas are not Chinese punctuation).
function texts(card) {
  const out = []
  const walk = (v) => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk) }
  walk(card)
  return out
}

function grade(card) {
  const fields = texts(card)
  const clues = Array.isArray(card.clues) ? card.clues : []
  const hz = clues.filter((c) => /杭州/.test(c.inference || ''))
  // Where the company is may be certain; where the photo was taken is the cautious inference
  const aboutPhoto = hz.filter((c) => /(照片|拍摄|房子|房屋|这套|住处|家)/.test(c.inference || ''))
  return {
    sceneIsObjective: typeof card.scene === 'string' && !/(可能|应该|推测|杭州|似乎|验收|阶段)/.test(card.scene),
    noCaptureTimeClaim: !fields.some((f) => /拍摄(于|时间)[^，。,]*2026|2026[^，。,]*拍摄/.test(f)),
    phoneMasked: !fields.some((f) => /0571[-\s]?\d{4}/.test(f)),
    hangzhouFromAreaCode: hz.some((c) => /0571/.test(`${c.evidence}${c.inference}`)),
    photoCityCautious: aboutPhoto.length > 0 && aboutPhoto.every((c) => typeof c.confidence === 'number' && c.confidence <= 0.6),
    confidenceIsNumber: clues.length > 0 && clues.every((c) => typeof c.confidence === 'number'),
    everyClueHasEvidence: clues.length > 0 && clues.every((c) => c.evidence && c.inference),
    titleNoInferredCity: typeof card.title === 'string' && !/杭州/.test(card.title),
    asksQuestions: Array.isArray(card.questions) && card.questions.length > 0 && card.questions.length <= 2,
  }
}

if (process.argv.includes('--regrade')) {
  const saved = JSON.parse(readFileSync(here('./results.json'), 'utf8'))
  for (const runs of Object.values(saved)) for (const run of runs) run.grade = grade(run.card)
  writeFileSync(here('./results.json'), JSON.stringify(saved, null, 2))
  report(saved)
  process.exit(0)
}

function report(results) {
  const checks = Object.keys(Object.values(results)[0][0].grade)
  console.log(['check', ...Object.keys(results)].join(' | '))
  for (const check of checks) console.log([check, ...Object.values(results).map((runs) => `${runs.filter((r) => r.grade[check]).length}/${runs.length}`)].join(' | '))
}

const RUNS = Number(process.env.RUNS || 5)
const results = {}
for (const [name, system] of Object.entries(variants)) {
  results[name] = []
  for (let run = 0; run < RUNS; run++) {
    const content = await chat(cfg, [
      { role: 'system', content: system },
      { role: 'user', content: [{ type: 'text', text: `为这张照片写信息卡。程序读出的元数据：\n${metadata}` }, { type: 'image_url', image_url: { url: dataUrl } }] },
    ], { json: true })
    const card = parseJsonAnswer(content)
    results[name].push({ card, grade: grade(card) })
  }
}
writeFileSync(here('./results.json'), JSON.stringify(results, null, 2))
report(results)

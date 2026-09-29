// Blurry licence plate: skill before vs. after the "unclear characters" rule,
// 1200 px preview vs. 2560 px from the original. Real StepFun, RUNS per combination.
//
// Ground truth: at native resolution the first (province) character is an unreadable blur
// behind a rainy windscreen, so the only correct reading is "?A·*****". (An earlier guess of
// 青A from the scenery was itself unreliable.) The photo is personal and not in git.
//
// Two scores: what the model wrote, and what the app shows after server/photoCard.mjs.
//   node run-eval.mjs            # real calls
//   node run-eval.mjs --regrade  # re-score saved answers only
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const root = here('../../../../../')
const { readCard, cardMessages } = await import(pathToFileURL(root + 'server/photoCard.mjs').href)

const PROVINCES = '京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼'
const PLACES = ['北京', '天津', '上海', '重庆', '河北', '河南', '云南', '辽宁', '黑龙江', '湖南', '安徽', '山东', '新疆', '江苏', '浙江', '江西', '湖北', '广西', '甘肃', '山西', '内蒙古', '陕西', '吉林', '福建', '贵州', '广东', '青海', '西藏', '四川', '宁夏', '海南', '昆明', '拉萨', '济南', '武汉', '杭州', '南京', '成都', '西宁']

function texts(value, out = []) {
  if (typeof value === 'string') out.push(value)
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => texts(v, out))
  return out
}

// Did the card place the photo somewhere because of the plate?
function placedByPlate(card) {
  const plateClues = (card.clues || []).filter((c) => /车牌|牌照/.test(`${c.evidence}${c.inference}`))
  const named = PLACES.filter((p) => plateClues.some((c) => c.inference.includes(p)) && !(card.clues || []).some((c) => !/车牌|牌照/.test(`${c.evidence}${c.inference}`) && c.inference.includes(p)))
  return plateClues.some((c) => c.confidence > 0.3) ||
    (card.tags || []).some((t) => named.some((p) => t.includes(p))) ||
    named.some((p) => `${card.title || ''}${card.caption || ''}`.includes(p)) ||
    Boolean(card.placeQuery && named.some((p) => card.placeQuery.text.includes(p)))
}

function grade(raw) {
  // Any 5-character serial after "A": the real plate number is not kept in the repository
  const plate = texts(raw).join('\n').match(new RegExp(`([${PROVINCES}?？])\\s?A\\s?·?\\s?[A-Z0-9]{5}`))
  const served = readCard(raw, { consented: true })
  return {
    plateRead: plate ? plate[1] : null,
    modelAdmitsUnclear: Boolean(plate && /[?？]/.test(plate[1])),
    modelPlacedByPlate: placedByPlate(raw),
    shownPlacedByPlate: placedByPlate(served),
  }
}

function report(results) {
  console.log('variant | first char read | model wrote "?" | model placed photo by plate | app shows placed by plate')
  for (const [key, runs] of Object.entries(results)) {
    const n = runs.length
    const count = (k) => `${runs.filter((r) => r.grade[k]).length}/${n}`
    console.log(`${key} | ${runs.map((r) => r.grade.plateRead ?? '—').join(' ')} | ${count('modelAdmitsUnclear')} | ${count('modelPlacedByPlate')} | ${count('shownPlacedByPlate')}`)
  }
}

if (process.argv.includes('--regrade')) {
  const saved = JSON.parse(readFileSync(here('./results.json'), 'utf8'))
  for (const runs of Object.values(saved)) for (const run of runs) run.grade = grade(run.card)
  writeFileSync(here('./results.json'), JSON.stringify(saved, null, 2))
  report(saved)
  process.exit(0)
}

process.loadEnvFile(root + '.env')
const { stepfunConfig, chat, parseJsonAnswer } = await import(pathToFileURL(root + 'server/stepfun.mjs').href)
const { loadSkill } = await import(pathToFileURL(root + 'server/skills.mjs').href)
const cfg = stepfunConfig()
const strip = (text) => text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim()
const skills = { before: strip(readFileSync(here('./SKILL.before.md'), 'utf8')), after: loadSkill('photo-card') }
const images = { 1200: 'plate-1200.jpg', 2560: 'plate-2560.jpg' }
const facts = { fileName: 'DSCF0001.JPG', time: '2021/10/07 15:29', timeSource: 'exif', size: '6000 × 4000', device: 'FUJIFILM X-A5 · XC15-45mmF3.5-5.6 OIS PZ' }

const RUNS = Number(process.env.RUNS || 3)
const results = {}
for (const [skillName, system] of Object.entries(skills)) for (const [side, file] of Object.entries(images)) {
  const key = `${skillName}-${side}`
  results[key] = []
  const dataUrl = 'data:image/jpeg;base64,' + readFileSync(here(`./${file}`)).toString('base64')
  for (let run = 0; run < RUNS; run++) {
    const card = parseJsonAnswer(await chat(cfg, cardMessages({ system, dataUrl, facts, consented: true }), { json: true }))
    results[key].push({ card, grade: grade(card) })
  }
}
writeFileSync(here('./results.json'), JSON.stringify(results, null, 2))
report(results)

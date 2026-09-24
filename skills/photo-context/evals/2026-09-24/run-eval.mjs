// photo-context: with the skill vs. the same output fields only, on four cases, real StepFun model.
// Uses server/photoContext.mjs, so requests and parsing are exactly what the API route does.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const root = here('../../../../')
process.loadEnvFile(root + '.env')
const { stepfunConfig, chat, parseJsonAnswer } = await import(pathToFileURL(root + 'server/stepfun.mjs').href)
const { loadSkill } = await import(pathToFileURL(root + 'server/skills.mjs').href)
const { contextMessages, readContext } = await import(pathToFileURL(root + 'server/photoContext.mjs').href)
const cfg = stepfunConfig()

const image = (name) => 'data:image/jpeg;base64,' + readFileSync(here(`./images/${name}`)).toString('base64')
if (!existsSync(here('./images/room-target.jpg'))) { console.log('缺少 images/room-*.jpg（由用户照片裁切，不入库），先运行裁切'); process.exit(1) }

const cases = [
  {
    name: 'same-room',
    note: '目标是房间下半部分；R1 是同一房间上半部分（有定位：杭州）；R2 白墙空房间（上海）；R3 东方明珠（上海）',
    target: { dataUrl: image('room-target.jpg'), known: {} },
    refs: [
      { id: 'room', dataUrl: image('room-ref.jpg'), known: { city: '杭州市', citySource: 'GPS 定位', place: '西湖区' } },
      { id: 'empty', dataUrl: image('empty-room.jpg'), known: { city: '上海市', citySource: 'GPS 定位' } },
      { id: 'pearl', dataUrl: image('pearl-b.jpg'), known: { city: '上海市', citySource: 'GPS 定位', place: '陆家嘴' } },
    ],
    expectCity: /杭州/, expectFrom: ['room'], related: ['room'],
  },
  {
    name: 'landmark',
    note: '目标是东方明珠（无定位）；R1 黄鹤楼（武汉）；R2 用户房间（杭州）',
    target: { dataUrl: image('pearl-a.jpg'), known: {} },
    refs: [
      { id: 'crane', dataUrl: image('crane.jpg'), known: { city: '武汉市', citySource: 'GPS 定位' } },
      { id: 'room', dataUrl: image('room-ref.jpg'), known: { city: '杭州市', citySource: '用户确认' } },
    ],
    expectCity: /上海/, expectFrom: ['landmark'], related: [],
  },
  {
    name: 'landmark-same-place',
    note: '目标是东方明珠 A（无定位）；R1 东方明珠 B（上海，有定位）；R2 黄鹤楼（武汉）',
    target: { dataUrl: image('pearl-a.jpg'), known: {} },
    refs: [
      { id: 'pearl', dataUrl: image('pearl-b.jpg'), known: { city: '上海市', citySource: 'GPS 定位', place: '陆家嘴' } },
      { id: 'crane', dataUrl: image('crane.jpg'), known: { city: '武汉市', citySource: 'GPS 定位' } },
    ],
    expectCity: /上海/, expectFrom: ['pearl', 'landmark'], related: ['pearl'],
  },
  {
    name: 'no-evidence',
    note: '目标是白墙空房间（无定位）；R1 用户房间（杭州）；R2 黄鹤楼（武汉）。只有"都是白墙"，不应补全城市',
    target: { dataUrl: image('empty-room.jpg'), known: {} },
    refs: [
      { id: 'room', dataUrl: image('room-ref.jpg'), known: { city: '杭州市', citySource: 'GPS 定位' } },
      { id: 'crane', dataUrl: image('crane.jpg'), known: { city: '武汉市', citySource: 'GPS 定位' } },
    ],
    expectCity: null, expectFrom: [], related: [],
  },
]

const fieldsOnly = '对比目标照片和参考照片，补全目标照片的信息。用简体中文，严格输出 JSON 对象：{"matches":[{"ref":"R1","relation":"同一场景|同一地点|同一事件|无关","evidence":"","confidence":0.5}],"fills":{"city":{"value":"","fromRefs":["R1"],"reason":"","confidence":0.5},"place":null,"time":null,"event":null},"conflicts":[]}。fromRefs 用 R1、R2… 表示，依据地标时写 "landmark"。'

function grade(c, result) {
  const city = result.fills.city
  const cityOk = c.expectCity ? Boolean(city && c.expectCity.test(city.value)) : !city
  const fromOk = c.expectCity ? Boolean(city && city.fromRefIds.some((id) => c.expectFrom.includes(id))) : true
  const falseMatch = result.matches.some((m) => !c.related.includes(m.refId) && m.relation !== '无关')
  const allCovered = c.refs.every((r) => result.matches.some((m) => m.refId === r.id))
  return { cityCorrect: cityOk, rightSource: cityOk && fromOk, noFalseMatch: !falseMatch, coversAllRefs: allCovered }
}

const RUNS = Number(process.env.RUNS || 3)
const variants = { 'with-skill': loadSkill('photo-context'), 'without-skill': fieldsOnly }
const results = {}
for (const [variant, system] of Object.entries(variants)) {
  results[variant] = {}
  for (const c of cases) {
    results[variant][c.name] = []
    for (let run = 0; run < RUNS; run++) {
      const answer = parseJsonAnswer(await chat(cfg, contextMessages({ system, target: c.target, refs: c.refs, consented: true }), { json: true }))
      const read = readContext(answer, c.refs)
      results[variant][c.name].push({ read, grade: grade(c, read) })
    }
  }
}
writeFileSync(here('./results.json'), JSON.stringify({ cases: cases.map(({ name, note }) => ({ name, note })), results }, null, 2))
const checks = ['cityCorrect', 'rightSource', 'noFalseMatch', 'coversAllRefs']
console.log(['case', 'check', ...Object.keys(results)].join(' | '))
for (const c of cases) for (const check of checks) {
  console.log([c.name, check, ...Object.values(results).map((v) => `${v[c.name].filter((r) => r.grade[check]).length}/${RUNS}`)].join(' | '))
}

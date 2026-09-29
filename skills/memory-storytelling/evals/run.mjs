// Public, fictional evidence only. A single paired sample is not a success-rate benchmark.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { STORY_VERSION, composeStorytelling, storytellingInput } from '../../../server/storytelling.mjs'
import { chat, parseJsonAnswer, stepfunConfig } from '../../../server/stepfun.mjs'

process.loadEnvFile('.env')
const out = fileURLToPath(new URL('./' + new Date().toISOString().replace(/[:.]/g, '-') + '/', import.meta.url))
await mkdir(out, { recursive: true })
await writeFile(out + 'skill-used.md', await readFile(new URL('../SKILL.md', import.meta.url), 'utf8'))
const input = storytellingInput({ question: '自动挑选一个有趣温暖的切口，边看照片边讲一段回忆。', photos: [
  { id: 'fiction-001', date: '2026-01-05', dateSource: 'exif', scene: '小女孩右手握黄色积木，面前桌上有三层蓝色积木。成年女性坐旁边扶着底层。' },
  { id: 'fiction-002', date: '2026-01-05', dateSource: 'exif', scene: '同一张桌上的积木散开。小女孩和成年女性面向镜头笑，女孩右手仍握黄色积木。不能从画面判断是谁推倒的。' },
  { id: 'fiction-003', date: '2026-03-12', dateSource: 'exif', scene: '小女孩坐地毯上，把红色积木放在一排蓝色积木旁；后面有一只黄色积木。' },
  { id: 'fiction-004', date: '2026-03-12', dateSource: 'exif', scene: '成年女性和小女孩并排坐在地毯上，两人各握一块积木，面前是一排蓝色积木。' },
], storyGraph: { people: [{ id: 'kid', name: '小满', relationship: '女儿' }, { id: 'mother', name: '妈妈', relationship: '我' }], memberships: {
  'fiction-001': ['kid', 'mother'], 'fiction-002': ['kid', 'mother'], 'fiction-003': ['kid'], 'fiction-004': ['kid', 'mother'],
}, relationships: [{ subjectId: 'kid', objectId: 'mother', value: '小满是妈妈的女儿', label: '女儿', source: 'user', status: 'confirmed' }], facts: [] } })
const config = stepfunConfig(), writer = { ...config, model: config.storyModel || config.model }
const result = { version: STORY_VERSION, models: { baseline: writer.model, select: config.model, compose: writer.model, review: config.model }, reasoningEffort: 'medium', input, startedAt: new Date().toISOString() }
try {
  result.withoutSkill = parseJsonAnswer(await chat(writer, [{ role: 'system', content: '依据资料，写一段温暖自然的回忆故事，配合看照片。输出 JSON：{"title":"标题","beats":[{"assetIds":["真实ID"],"text":"旁白"}]}。' }, { role: 'user', content: JSON.stringify(input) }], { json: true, reasoningEffort: 'medium', timeoutMs: 120000 }))
} catch (error) { result.withoutSkill = { error: error.message } }
try { result.withSkill = await composeStorytelling(config, input) }
catch (error) { result.withSkill = { error: error.message } }
result.finishedAt = new Date().toISOString()
await writeFile(out + 'results.json', JSON.stringify(result, null, 2))
console.log(JSON.stringify({ baseline: result.withoutSkill.error || 'generated', skill: result.withSkill.error || 'generated', out }))

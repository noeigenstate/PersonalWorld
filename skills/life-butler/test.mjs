import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkSkillFile, importRoot, live, startApi } from '../../tests/skill-kit.mjs'

const dir = fileURLToPath(new URL('.', import.meta.url))
const { loadSkill } = await importRoot('server/skills.mjs')
const { pickPhotos, readActions, compactPhoto } = await importRoot('server/butler.mjs')

const memory = {
  places: [{ city: '上海市', role: 'work', roleConfirmed: true, firstAt: '2018-07-02', lastAt: '2026-09-20', eventCount: 2 }],
  events: [
    { id: 'e1', title: '入职第一天', start: '2018-07-02', end: '2018-07-02', city: '上海市', status: 'confirmed', firsts: ['照片记录中第一次在上海'], photoCount: 4 },
    { id: 'e2', title: '父母来沪', summary: '和父母在外滩散步。', start: '2019-10-02', end: '2019-10-02', city: '上海市', place: '外滩', status: 'analyzed', photoCount: 26 },
  ],
  photos: [
    { id: 'p1', eventId: 'e2', date: '2019-10-02', city: '上海市', place: '外滩', title: '外滩的傍晚', caption: '江边的灯刚亮起来', scene: '江边步道，远处东方明珠', tags: ['夜景', '江边'], people: ['妈妈'] },
    { id: 'p2', eventId: 'e2', date: '2019-10-02', city: '上海市', place: '南京路', title: '南京路步行街', caption: '', scene: '人很多的步行街', tags: ['街拍'], people: [] },
    { id: 'p3', eventId: 'e1', date: '2018-07-02', city: '上海市', place: '', title: '工位', caption: '', scene: '新办公室的桌子', tags: ['工作'], people: [] },
  ],
}
const state = { view: 'city', city: '上海市', openEventId: '', focusedPhotoId: '', showing: [], pendingRoleCity: '', features: { people: 1, stories: 1, spacetime: true, films: [{ id: 'f1', title: '外滩的傍晚' }] } }

test('SKILL.md 格式完整，写明了推断标记、第一次、动作和输出格式', () => {
  const { body } = checkSkillFile(dir)
  assert.match(body, /〔〕/)
  assert.match(body, /照片记录中的第一次/)
  assert.match(body, /不要主动提起任何"最后一次"/)
  assert.match(body, /"answer"/)
  assert.match(body, /"eventIds"/)
  assert.match(body, /"assetIds"/)
  assert.match(body, /"actions"/)
  for (const action of ['focus_city', 'overview', 'focus_photo', 'show_photos', 'slideshow', 'story', 'open_event', 'set_place_role', 'timeline', 'open_stories', 'open_spacetime', 'play_film', 'make_film', 'close']) assert.ok(body.includes(`"${action}"`), `缺少动作 ${action}`)
  assert.match(body, /filmCapable/, '说明何时能合成新短片')
  assert.match(body, /lasts/, '最后一次只来自 lasts')
  assert.match(body, /moves/, '迁徙说明第一次之后去了哪里')
  assert.match(body, /〔毕业〕/, '离开的原因是推断，要标出')
  assert.match(body, /语音或文字/, '远程用户可以打字，回答仍会被朗读')
  assert.match(body, /边看边讲.*story/, '逐张解说通过 story 同步照片与旁白')
})

test('照片索引超过上限时，与问题最相关的照片留下', () => {
  const many = Array.from({ length: 500 }, (_, i) => compactPhoto({ id: `x${i}`, date: '2020-01-01', title: `照片 ${i}`, scene: '一张普通照片', tags: [] }))
  const bund = compactPhoto({ id: 'bund', date: '2019-10-02', title: '外滩的傍晚', scene: '江边', tags: ['夜景'] })
  const picked = pickPhotos('外滩傍晚拍的夜景', [...many.slice(0, 300), bund, ...many.slice(300)], 400)
  assert.equal(picked.length, 400)
  assert.equal(picked[0].id, 'bund', '匹配问题的照片排在最前')
  assert.equal(pickPhotos('随便', many.slice(0, 10), 400).length, 10, '未超上限时原样返回')
})

test('动作只能指向存在的城市、照片、事件和短片', () => {
  const known = { events: new Set(['e1', 'e2']), photos: new Set(['p1', 'p2', 'p3']), cities: new Set(['上海市']), films: new Set(['f1']), spacetime: false }
  const actions = readActions([
    { type: 'show_photos', assetIds: ['p2', 'zzz', 'p1', 'p1'] },
    { type: 'focus_city', city: '火星市' },
    { type: 'open_spacetime' },
    { type: 'set_place_role', city: '上海市', role: 'king' },
    { type: 'set_place_role', city: '上海市', role: 'home' },
    { type: 'timeline', date: '2019-10' },
    { type: 'play_film', filmId: 'f1' },
    'nonsense',
    { type: 'close' },
  ], known)
  assert.deepEqual(actions, [
    { type: 'show_photos', assetIds: ['p2', 'p1'] },
    { type: 'set_place_role', city: '上海市', role: 'home' },
    { type: 'play_film', filmId: 'f1' },
    { type: 'close' },
  ])
  assert.deepEqual(readActions([{ type: 'play_film' }], { ...known, films: new Set() }), [], '没有短片时不能播放')
  assert.deepEqual(readActions([{ type: 'open_spacetime' }], { ...known, spacetime: true }), [{ type: 'open_spacetime' }])
  assert.deepEqual(readActions([{ type: 'story', steps: [{ assetId: 'p1', text: ' 第一次来上海。 ' }, { assetId: 'p1', text: '重复' }, { assetId: 'zzz', text: '不存在' }, { assetId: 'p2', text: '' }, { assetId: 'p3', text: '最后一次在武汉。' }] }], known), [{ type: 'story', steps: [{ assetId: 'p1', text: '第一次来上海。' }, { assetId: 'p3', text: '最后一次在武汉。' }] }], '故事每步一张存在的照片、一句话；重复照片和空句子去掉')
  assert.deepEqual(readActions([{ type: 'story', steps: [] }], known), [], '没有步骤就没有故事')
  assert.deepEqual(readActions([{ type: 'make_film', assetIds: ['p1', 'zzz', 'p2'] }], known), [], '本机不能合成视频时不能开始剪短片')
  assert.deepEqual(readActions([{ type: 'make_film', assetIds: ['p1', 'zzz', 'p2'] }, { type: 'make_film' }], { ...known, filmCapable: true }), [{ type: 'make_film', assetIds: ['p1', 'p2'] }, { type: 'make_film' }])
})

let api
before(async () => { api = await startApi(() => ({ answer: '那是〔爸妈来上海〕。', eventIds: ['e2', 'unknown'], assetIds: ['p1', 'p9'], actions: [{ type: 'slideshow', assetIds: ['p1', 'p2', 'p9'] }, { type: 'open_spacetime' }] })) })
after(() => api?.close())

test('/api/butler 把 skill、记忆和界面状态一起作为系统提示，并过滤不存在的事件、照片与动作目标', async () => {
  const { status, json } = await api.post('/api/butler', { question: '2019 年国庆发生了什么？', history: [{ role: 'assistant', content: '你好' }], memory, focus: { city: '上海市', from: '2018-07-02', to: '2026-09-20' }, state })
  assert.equal(status, 200)
  const system = api.calls.at(-1).messages[0].content
  assert.ok(system.startsWith(loadSkill('life-butler')))
  assert.match(system, /记忆：\{"today":"\d{4}-\d{2}-\d{2}","focus":\{"city":"上海市"/)
  assert.match(system, /"state":\{"view":"city"/)
  assert.match(system, /"photos":\[\{"id":"p1"/)
  assert.deepEqual(json.eventIds, ['e2'])
  assert.deepEqual(json.assetIds, ['p1'])
  assert.deepEqual(json.actions, [{ type: 'slideshow', assetIds: ['p1', 'p2'] }, { type: 'open_spacetime' }])
  assert.equal(api.calls.at(-1).messages[1].role, 'assistant', '对话历史按顺序带上')
})

test('真实模型：依据记忆回答，推断内容加〔〕，引用正确的事件', { skip: !live && '设置 LIVE=1 才调用真实模型' }, async () => {
  const { stepfunConfig, chat, parseJsonAnswer } = await importRoot('server/stepfun.mjs')
  const answer = parseJsonAnswer(await chat(stepfunConfig(), [
    { role: 'system', content: `${loadSkill('life-butler')}\n\n记忆：${JSON.stringify({ today: '2026-09-24', focus: null, state, ...memory })}` },
    { role: 'user', content: '2019 年国庆那会儿发生了什么？' },
  ], { json: true }))
  assert.equal(answer.eventIds?.[0], 'e2')
  assert.match(answer.answer, /〔/, 'e2 未经确认，推断内容应加〔〕')
  assert.ok(answer.answer.length <= 150, '回答要短，便于朗读')
})

test('真实模型：按语义找照片并给出 show_photos 动作', { skip: !live && '设置 LIVE=1 才调用真实模型' }, async () => {
  const { stepfunConfig, chat, parseJsonAnswer } = await importRoot('server/stepfun.mjs')
  const answer = parseJsonAnswer(await chat(stepfunConfig(), [
    { role: 'system', content: `${loadSkill('life-butler')}\n\n记忆：${JSON.stringify({ today: '2026-09-24', focus: null, state, ...memory })}` },
    { role: 'user', content: '找找和妈妈在江边拍的照片' },
  ], { json: true }))
  const show = (answer.actions || []).find((a) => a.type === 'show_photos')
  assert.ok(show, '找照片应给出 show_photos')
  assert.equal(show.assetIds[0], 'p1', '江边、妈妈都指向 p1')
})

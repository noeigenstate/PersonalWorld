import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFilmSources, fallbackFilm, validateFilmPlan, filmFingerprint } from '../../server/memoryFilmPlan.mjs'
import { createFilmContextStore, filmContextSummary } from '../../server/memoryFilmContext.mjs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sources = readFilmSources(Array.from({ length: 10 }, (_, i) => ({ id: `photo-${i}`, date: `2026-${String(i + 1).padStart(2, '0')}-12`, observed: '公园里的日常照片', confirmed: '', latitude: 1, longitude: 2, dataUrl: 'private-image' })))
test('导演只接收所需的文字事实，去重并稳定覆盖时间跨度', () => {
  assert.equal(readFilmSources([...sources, sources[0]]).length, 10)
  assert.equal(JSON.stringify(sources).includes('private-image'), false)
  assert.equal(JSON.stringify(sources).includes('latitude'), false)
  assert.equal(filmFingerprint(sources), filmFingerprint(readFilmSources([...sources].reverse())))
  const plan = validateFilmPlan(fallbackFilm(sources), sources)
  assert.equal(plan.shots[0].date, '2026-01-12')
  assert.equal(plan.shots.at(-1).date, '2026-10-12')
})
test('剪辑表拒绝不存在的照片、重复不足六张及无证据的里程碑', () => {
  assert.throws(() => validateFilmPlan({ shots: Array(8).fill({ assetId: 'photo-0' }) }, sources))
  assert.throws(() => validateFilmPlan({ shots: Array.from({length:8},(_,i)=>({assetId:`invented-${i}`})) }, sources))
  const original = fallbackFilm(sources)
  original.title = '女儿第一次走路'
  original.shots[0].caption = '一岁生日'
  original.shots[1].seconds = 900
  original.shots[2].seconds = -20
  original.shots.reverse()
  const plan = validateFilmPlan(original, sources)
  assert.equal(plan.title, '把这些小日子留住')
  assert.equal(plan.shots[0].caption, '')
  assert.equal(plan.shots[1].seconds, 5.5)
  assert.equal(plan.shots[2].seconds, 3.2)
  assert.equal(plan.shots.length, 10)
})
test('程序降级仍能形成真实来源的时间相册，允许已确认的生日', () => {
  const confirmed = sources.map((s, i) => i === 0 ? { ...s, confirmed: '用户确认：一岁生日' } : s)
  const original = fallbackFilm(confirmed); original.shots[0].caption = '一岁生日'
  const plan = validateFilmPlan(original, confirmed)
  assert.equal(plan.shots[0].caption, '一岁生日')
  assert.ok(plan.shots.every((shot) => confirmed.some((s) => s.id === shot.assetId)))
})
test('亲属与成长确认只属于对应照片，标题不能借用未入选照片的事实', () => {
  const scoped = sources.map((s, i) => ({ ...s, story: i === 0 ? '这张照片里是我和女儿' : '' }))
  const answer = fallbackFilm(scoped)
  answer.title = '我和女儿的日常'
  answer.shots[0].caption = '陪女儿一起玩'
  answer.shots[1].caption = '女儿在看花'
  answer.shots[2].caption = '爸爸牵着小手'
  answer.shots[3].caption = '长辈递来爱吃的小食'
  const plan = validateFilmPlan(answer, scoped)
  assert.equal(plan.title, answer.title)
  assert.equal(plan.shots[0].caption, '陪女儿一起玩')
  assert.ok(plan.shots.slice(1, 4).every((s) => s.caption === ''))
  const withoutConfirmed = validateFilmPlan({ ...answer, shots: answer.shots.slice(1) }, scoped)
  assert.equal(withoutConfirmed.title, '把这些小日子留住')
  assert.equal(readFilmSources([{ ...sources[0], story: '伪造的服务端补充' }])[0].story, undefined)
})
test('回忆补充持久化、修改、清除，隔离账户和照片并改变缓存指纹', () => {
  const root = mkdtempSync(join(tmpdir(), 'pw-film-context-'))
  const user = { id: 'owner' }, stranger = { id: 'other' }
  const store = createFilmContextStore(root)
  const original = store.apply(user, sources)
  store.save(user, [sources[0].id, sources[1].id], '这段回忆是我和女儿')
  const updated = createFilmContextStore(root).apply(user, sources)
  assert.deepEqual(updated.slice(2).map((s) => s.story), Array(8).fill(''))
  assert.ok(store.apply(stranger, sources).every((s) => s.story === ''))
  assert.notEqual(filmFingerprint(original), filmFingerprint(updated))
  assert.equal(filmContextSummary(updated).notes[0].count, 2)
  store.save(user, [sources[1].id], '同一天在公园')
  assert.equal(store.apply(user, sources)[0].story, '这段回忆是我和女儿')
  assert.equal(store.apply(user, sources)[1].story, '同一天在公园')
  store.save(user, [sources[0].id, sources[1].id], '')
  assert.equal(filmContextSummary(store.apply(user, sources)).revision, filmContextSummary(original).revision)
  assert.throws(() => store.save(user, [sources[0].id], '太长'.repeat(201)))
})
test('EXIF 时刻决定同日顺序，裁切只用服务端人脸框，不添写睡醒或疲惫',()=>{
 const pair=readFilmSources([{id:'early',date:'2026-01-02',capturedAt:'2026-01-02T06:30:00Z',observed:'在雪地玩雪'},{id:'late',date:'2026-01-02',capturedAt:'2026-01-02T06:40:00Z',observed:'靠在肩头闭着眼睛'}])
 const plan=validateFilmPlan({title:'雪地',shots:[{assetId:'late',caption:'玩累了，靠在肩上睡着了'},{assetId:'early',caption:'醒啦'}]},pair)
 assert.deepEqual(plan.shots.map(s=>s.assetId),['early','late']);assert.equal(plan.shots[0].caption,'');assert.equal(plan.shots[1].caption,'靠在肩上闭着眼睛');assert.equal(new Set(plan.shots.map(s=>s.layout)).size,2)
})
test('睡衣、闭眼和牙刷不能证明刚醒或准备刷牙',()=>{
 const pair=readFilmSources([{id:'a',date:'2026-04-06',observed:'穿睡衣坐在床边微笑'},{id:'b',date:'2026-04-06',observed:'坐在凳子上，台面有牙刷'}])
 const plan=validateFilmPlan({title:'今天早上，陪你慢慢醒',shots:[{assetId:'a',caption:'刚醒，醒过来笑一笑'},{assetId:'b',caption:'准备刷牙啦'}]},pair)
 assert.equal(plan.title,'把这些小日子留住');assert.ok(plan.shots.every(s=>s.caption===''))
})

test('回看引用真实的较早镜头，日期独立且装饰来自观察，不能迁移人名',()=>{
 const input=readFilmSources(Array.from({length:4},(_,i)=>({id:'p'+i,date:`2026-04-${10+i}`,observed:i===3?'室内翻绘本':'在沙地玩沙',place:i===3?'书店':'公园'}))).map((s,i)=>({...s,people:[{id:i===3?'reader':'child',name:i===3?'读者':'团团'}]}))
 const answer=fallbackFilm(input);answer.shots[2].layout='compare';answer.shots[2].compareAssetId='invented';answer.shots[3].caption='团团翻书'
 const plan=validateFilmPlan(answer,input)
 const compare=plan.shots.find(s=>s.layout==='compare')
 assert.ok(compare);assert.ok(plan.shots.findIndex(s=>s.assetId===compare.compareAssetId)<plan.shots.indexOf(compare))
 assert.equal(compare.motif,'sand');assert.equal(plan.shots[3].motif,'book')
 assert.equal(plan.shots[3].caption,'','a named child elsewhere in the movie is not present in this photograph')
 assert.deepEqual(plan.shots.map(s=>s.date),input.map(s=>s.date))
})

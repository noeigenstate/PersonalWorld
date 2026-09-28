// "First time" / "last time" facts (src/lib/firstsLasts.ts): node --experimental-strip-types --test tests/firsts-lasts.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { firstsOf, lastsOf, movesForButler, movesOf } from '../src/lib/firstsLasts.ts'

const event = (id, city, at, extra = {}) => ({ id, assetIds: [], occurredAt: at, timeSource: 'exif', title: id, summary: '', type: '', place: '', city, people: [], visibleText: '', tags: [], questions: [], status: 'analyzed', ...extra })
const place = (city, firstAt, lastAt, role, roleConfirmed = false, isBase = true) => ({ city, eventIds: [], firstAt, lastAt, role, roleConfirmed, isBase })

// Home in 湘潭 (visited again later), university in 武汉 (never again), work in 上海, one trip to 杭州
const events = [
  event('xt1', '湘潭市', '2012-02-01'), event('xt2', '湘潭市', '2014-08-30'),
  event('wh1', '武汉市', '2014-09-02'), event('wh2', '武汉市', '2018-06-20', { status: 'confirmed', people: ['我', '室友'] }),
  event('sh1', '上海市', '2018-07-02'), event('xt3', '湘潭市', '2019-02-04'),
  event('hz1', '杭州市', '2020-10-03'), event('sh2', '上海市', '2026-09-20'),
]
const places = [
  place('湘潭市', '2012-02-01', '2019-02-04', 'home', true),
  place('武汉市', '2014-09-02', '2018-06-20', 'study', true),
  place('上海市', '2018-07-02', '2026-09-20', 'work', true),
  place('杭州市', '2020-10-03', '2020-10-03', 'travel', false, false),
]

test('第一次：每座城市的第一件事，已确认事件里第一次同框的人', () => {
  const firsts = firstsOf(events)
  assert.deepEqual(firsts.get('xt1'), ['照片记录中第一次在湘潭'])
  assert.deepEqual(firsts.get('sh1'), ['照片记录中第一次在上海'])
  assert.deepEqual(firsts.get('wh2'), ['照片记录中第一次和室友同框'], '"我" 不算，未确认事件的人物不算')
  assert.equal(firsts.get('sh2'), undefined)
})

test('迁徙：据点按先后成对，途经地点不算', () => {
  assert.deepEqual(movesOf(places).map((m) => `${m.from.city}→${m.to.city}@${m.at}`), ['湘潭市→武汉市@2014-09-02', '武汉市→上海市@2018-07-02'])
  assert.deepEqual(movesForButler(places)[1], { from: '武汉市', fromRole: 'study', to: '上海市', toRole: 'work', at: '2018-07-02' })
})

test('最后一次：只在搬离据点前的最后一件事上，回过的城市说成"离开前的最后一次"', () => {
  const lasts = lastsOf(events, places)
  assert.deepEqual(lasts.get('wh2'), ['照片记录中最后一次在武汉（求学），之后你去了上海'], '没再回过武汉：照片记录中的最后一次')
  assert.deepEqual(lasts.get('xt2'), ['离开湘潭（老家）去武汉前，照片记录中最后一次在湘潭'], '2019 年又回过湘潭，所以只是离开前的最后一次')
  assert.equal(lasts.get('sh2'), undefined, '现在的据点没有"最后一次"')
  assert.equal(lasts.get('hz1'), undefined, '旅行地点没有"最后一次"')
  assert.equal([...lasts.values()].flat().some((text) => /室友/.test(text)), false, '不产生关于人的"最后一次"')
})

test('没有确认角色时不写角色', () => {
  const unconfirmed = places.map((p) => ({ ...p, roleConfirmed: false }))
  assert.deepEqual(lastsOf(events, unconfirmed).get('wh2'), ['照片记录中最后一次在武汉，之后你去了上海'])
})

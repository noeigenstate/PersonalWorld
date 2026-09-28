// Labels under the time bar (src/lib/timeTicks.ts): node --experimental-strip-types --test tests/time-ticks.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { timeTicks } from '../src/lib/timeTicks.ts'

const at = (...parts) => new Date(...parts).getTime()

test('跨越多年：按年标注，最多 9 个', () => {
  assert.deepEqual(timeTicks(at(2012, 1, 1), at(2026, 8, 1)).map((t) => t.label), ['2013', '2015', '2017', '2019', '2021', '2023', '2025'])
  assert.deepEqual(timeTicks(at(2019, 5, 1), at(2023, 2, 1)).map((t) => t.label), ['2020', '2021', '2022', '2023'])
})

test('几个月：按月标注', () => {
  assert.deepEqual(timeTicks(at(2025, 1, 10), at(2025, 6, 20)).map((t) => t.label), ['2025.03', '2025.04', '2025.05', '2025.06', '2025.07'])
})

test('同一年内的一个月：按日标注，换月时写出月份（不再是空白）', () => {
  const ticks = timeTicks(at(2025, 3, 4, 7), at(2025, 4, 5, 12))
  assert.ok(ticks.length >= 5 && ticks.length <= 9, `${ticks.length} 个刻度`)
  assert.equal(ticks[0].label, '4月5日')
  assert.ok(ticks.some((t) => t.label.startsWith('5月')), '跨到 5 月时写出月份')
  assert.ok(ticks.every((t, i) => i === 0 || t.at > ticks[i - 1].at))
})

test('只有一天多：仍有日期刻度', () => {
  assert.deepEqual(timeTicks(at(2021, 9, 7, 10), at(2021, 9, 8, 16)).map((t) => t.label), ['10月8日'])
})

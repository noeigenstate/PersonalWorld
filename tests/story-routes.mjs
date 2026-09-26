import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
const source = await readFile(new URL('../src/lib/storyRoutes.ts', import.meta.url), 'utf8')
const compiled = stripTypeScriptTypes(source)
const { visitRoutes } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

const event = (id, at, lng, more = {}) => ({ id, occurredAt: at, timeSource: 'exif', lat: 30.3, lng, ...more })
const visits = [
  event('a', '2026-09-01T01:00:00Z', 120.1), event('b', '2026-09-01T03:00:00Z', 120.102),
  event('c', '2026-09-14T01:00:00Z', 120.1), event('d', '2026-09-14T03:00:00Z', 120.102),
]
assert.deepEqual(visitRoutes(visits).map((v) => v.eventIds), [['a', 'b'], ['c', 'd']], '重复到访不能缠绕成一条跨周路线')
assert.deepEqual(visitRoutes([visits[0], { ...visits[0], id: 'same', lng: 120.10001 }]), [], '同地点照片不产生无意义连线')
assert.deepEqual(visitRoutes([visits[0], { ...visits[1], timeSource: 'file' }]), [], '不能用导入文件时间编造游玩顺序')
assert.deepEqual(visitRoutes([visits[0], event('missing', '2026-09-01T02:00:00Z', undefined), visits[1]]), [], '缺失位置时不跨过去补出路线')
assert.deepEqual(visitRoutes([visits[0], event('evening', '2026-09-01T12:00:00Z', 120.102)]), [], '一天内相隔太久也分开')
console.log('Story route checks passed: repeated visits, stationary photos, unknown time/place, and separated outings.')

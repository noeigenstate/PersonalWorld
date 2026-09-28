// Grouping and ranking of near-duplicate photos (src/lib/cull.ts), without a browser.
// node --experimental-strip-types --test tests/photo-cull-logic.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findStacks, hamming, keepCount, rankStack, sameShot } from '../src/lib/cull.ts'

const photo = (id, dhash, minute, look = {}) => ({
  id, kind: 'image', name: `${id}.jpg`, capturedAt: new Date(Date.UTC(2021, 9, 7, 10, minute)).toISOString(), width: 6000, height: 4000,
  look: { dhash, sharpness: 900, brightness: 120, clipped: 0.01, ...look },
})
// Hashes that differ in a given number of bits
const flip = (hash, bits) => {
  const n = BigInt('0x' + hash) ^ ((1n << BigInt(bits)) - 1n)
  return n.toString(16).padStart(16, '0')
}
const base = 'f0f0f0f0a5a5a5a5'

test('汉明距离', () => {
  assert.equal(hamming(base, base), 0)
  assert.equal(hamming(base, flip(base, 7)), 7)
})

test('构图相近且时间接近才算同一组；几乎一样的照片不看时间', () => {
  assert.ok(sameShot(photo('a', base, 0), photo('b', flip(base, 10), 5)), '5 分钟内、10 位差异')
  assert.ok(!sameShot(photo('a', base, 0), photo('b', flip(base, 10), 50)), '相隔 50 分钟、10 位差异：不同时刻')
  assert.ok(sameShot(photo('a', base, 0), photo('b', flip(base, 3), 600)), '10 小时后几乎一样：重复保存')
  assert.ok(!sameShot(photo('a', base, 0), photo('b', flip(base, 20), 1)), '构图不同')
  assert.ok(!sameShot(photo('a', base, 0), { ...photo('b', base, 0), look: undefined }), '没有测量值的照片不参与')
  assert.ok(!sameShot(photo('a', '', 0), photo('b', '', 0)), '预览图读不出来的照片不会被归到一起')
})

test('几秒内对同一场景重新取景（推近、平移）也算重复构图', () => {
  const at = (id, seconds, dhash, signature) => ({ ...photo(id, dhash, 0), capturedAt: new Date(Date.UTC(2025, 4, 5, 3, 58, seconds)).toISOString(), signature })
  const lake = Array.from({ length: 48 }, (_, i) => (i % 3 === 2 ? 0.8 : 0.5))
  const lakeZoomed = lake.map((v, i) => v + (i % 5 === 0 ? 0.09 : -0.02))
  const street = lake.map((v) => 1 - v)
  assert.ok(sameShot(at('a', 32, base, lake), at('b', 36, flip(base, 33), lakeZoomed)), '4 秒后推近：33 位差异，颜色布局相近')
  assert.ok(sameShot(at('a', 12, base), at('b', 30, flip(base, 22))), '18 秒后换角度：22 位差异')
  assert.ok(!sameShot(at('a', 32, base, lake), at('b', 36, flip(base, 33), street)), '几秒内转身拍了别的：颜色布局不同')
  assert.ok(!sameShot(at('a', 0, base, lake), { ...at('b', 0, flip(base, 33), lakeZoomed), capturedAt: new Date(Date.UTC(2025, 4, 5, 4, 1, 0)).toISOString() }), '隔了两分钟，颜色相近也不算')
})

test('连拍分成一组，按张数排序，视频和单张不成组', () => {
  const burst = Array.from({ length: 6 }, (_, i) => photo(`burst-${i}`, flip(base, i), i))
  const pair = [photo('pair-0', '0123456789abcdef', 200), photo('pair-1', flip('0123456789abcdef', 2), 201)]
  const single = photo('single', 'ffffffff00000000', 300)
  const video = { ...photo('video', base, 1), kind: 'video' }
  const stacks = findStacks([single, ...pair, video, ...burst.reverse()])
  assert.deepEqual(stacks.map((s) => s.assets.length), [6, 2])
  assert.deepEqual(stacks[0].assets.map((a) => a.id), Array.from({ length: 6 }, (_, i) => `burst-${i}`), '组内按时间排序')
  assert.equal(stacks[0].key, findStacks(burst).at(0).key, '组的标识与顺序无关')
})

test('保留张数：少量留 1 张，连拍留 2 张，长序列留 3 张', () => {
  assert.deepEqual([2, 3, 4, 8, 9, 20].map(keepCount), [1, 1, 2, 2, 3, 3])
})

test('本地排序：模糊和过暗的排在后面并标出问题', () => {
  const stack = { key: 'k', assets: [
    photo('blurry', base, 0, { sharpness: 120 }),
    photo('sharp', flip(base, 1), 1, { sharpness: 1100 }),
    photo('dark', flip(base, 2), 2, { sharpness: 1000, brightness: 30 }),
    photo('ok', flip(base, 3), 3, { sharpness: 950 }),
  ] }
  const ranked = rankStack(stack)
  assert.deepEqual(ranked.filter((r) => r.keep).map((r) => r.asset.id), ['sharp', 'ok'])
  assert.deepEqual(ranked.find((r) => r.asset.id === 'blurry').issues, ['模糊'])
  assert.deepEqual(ranked.find((r) => r.asset.id === 'dark').issues, ['过暗'])
})

test('模型判为闭眼的照片降分；模型给出的保留建议优先', () => {
  const stack = { key: 'k', assets: [photo('a', base, 0), photo('b', flip(base, 1), 1), photo('c', flip(base, 2), 2)] }
  const reviews = {
    a: { eyesClosed: true, blurry: false, issues: [], score: 9, note: '' },
    b: { eyesClosed: false, blurry: false, issues: ['表情僵硬'], score: 7, note: '' },
    c: { eyesClosed: false, blurry: false, issues: [], score: 8, note: '' },
  }
  const ranked = rankStack(stack, reviews)
  assert.equal(ranked[0].asset.id, 'c')
  assert.ok(ranked.find((r) => r.asset.id === 'a').issues.includes('闭眼'))
  assert.ok(ranked.find((r) => r.asset.id === 'b').issues.includes('表情僵硬'))
  const picked = rankStack(stack, reviews, ['b', 'not-in-stack'])
  assert.deepEqual(picked.filter((r) => r.keep).map((r) => r.asset.id), ['b'])
  assert.equal(picked[0].asset.id, 'b', '保留的排在最前')
})

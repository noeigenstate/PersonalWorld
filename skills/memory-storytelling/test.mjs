import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkSkillFile, startApi, live } from '../../tests/skill-kit.mjs'
import { storytellingInput, sourceRevision, validateStorytelling, applyStoryEdits, composeStorytelling, createStorytellingService } from '../../server/storytelling.mjs'
import { openIdentityStore } from '../../server/identityStore.mjs'
import { eventInputs } from '../../server/storyUnderstandingPlan.mjs'
import { stepfunConfig } from '../../server/stepfun.mjs'

const raw = {
  question: '边看照片边讲，留意手里的小东西',
  photos: [
    { id: 'photo-001', date: '2026-02-01', dateSource: 'exif', scene: '女孩举着粉色甜筒，嘴角沾了奶油。', people: ['错误旧名字'] },
    { id: 'photo-002', date: '2026-05-01', dateSource: 'exif', scene: '爸爸抱着女孩，女孩举着巧克力甜筒，张嘴笑。' },
    { id: 'photo-003', date: '2026-06-01', scene: '一个没有匹配身份的成年人走在远处。' },
  ],
  storyGraph: { people: [{ id: 'child', name: '小满', relationship: '女儿' }, { id: 'dad', name: '爸爸', relationship: '我' }],
    memberships: { 'photo-001': ['child'], 'photo-002': ['child', 'dad'], 'photo-003': [] },
    relationships: [{ id: 'r1', subjectId: 'child', objectId: 'dad', label: '女儿', value: '小满是爸爸的女儿', source: 'user', status: 'confirmed' }], facts: [] },
}
const proposal = () => ({ candidates: [{ key: 'little-cones', format: 'motif', angle: '换了颜色的小配角', assetIds: ['photo-001', 'photo-002'] }],
  story: { key: 'little-cones', title: '小配角的签名', premise: '两次甜筒照片里，奶油嘴角和笑脸比甜筒更抢镜。', format: 'motif', tone: 'playful',
    beats: [
      { assetIds: ['photo-001', 'photo-002'], evidenceIds: ['photo-001', 'photo-002'], layout: 'sequence', text: '这些小配角换过颜色，还在小满嘴角留过一个奶油签名。', leadInMs: 500, holdMs: 1000 },
      { assetIds: ['photo-002'], evidenceIds: ['photo-002'], layout: 'single', text: '', holdMs: 2200 },
      { assetIds: ['photo-001', 'photo-002'], evidenceIds: ['photo-001', 'photo-002'], layout: 'compare', text: '先给甜筒留镜头，最后还是看见了小满的笑。', holdMs: 1800 },
    ], reflection: null }, review: { grounded: true, specific: true, coherent: true, notes: ['核对了人物在场和奶油观察。'] } })
const response = () => ({ ...proposal(), edits: [], metadata: {} })

test('runtime skill is distributable; grouped paragraphs, silence and callbacks survive validation', () => {
  checkSkillFile(fileURLToPath(new URL('.', import.meta.url)))
  const input = storytellingInput(raw), result = validateStorytelling(proposal(), input)
  assert.equal(input.photos[0].personIds[0], 'child')
  assert.ok(!JSON.stringify(input).includes('错误旧名字'))
  assert.equal(result.beats[0].assetIds.length, 2)
  assert.equal(result.beats[1].text, '')
  assert.equal(result.beats[2].layout, 'compare')
  assert.equal(result.evidence[1].date, '2026-05-01')
})

test('unknown people, photos and unsupported milestones cannot enter narrated beats', () => {
  const input = storytellingInput(raw)
  for (const edit of [
    p => { p.story.beats[0].assetIds = ['not-in-album'] },
    p => { p.story.beats[0].evidenceIds = ['photo-003'] },
    p => { p.story.beats[0].assetIds = p.story.beats[0].evidenceIds = ['photo-003']; p.story.beats[0].text = '爸爸在远处陪着小满。' },
    p => { p.story.beats[0].text = '小满最喜欢甜筒，这是她第一次学会自己吃。' },
    p => { p.story.beats[0].text = '小满不太配合，一会儿闭眼，一会儿发呆。' },
    p => { p.review.grounded = false },
  ]) { const p = proposal(); edit(p); assert.throws(() => validateStorytelling(p, input)) }
  const p = proposal(); p.story.reflection = { question: '这是小满的爸爸吗？', assetIds: ['photo-002'] }
  assert.equal(validateStorytelling(p, input).reflection, null, 'already known identity is not asked again')
})

test('editor gets original per-photo evidence and bounded repair, not only a draft', async () => {
  const calls = [], bad = response(); bad.edits = [{ beat: 12, text: '错误段号' }]
  const call = async (_config, messages) => {
    calls.push(messages)
    return JSON.stringify(calls.length === 3 ? bad : response())
  }
  const result = await composeStorytelling({}, storytellingInput(raw), call)
  assert.equal(calls.length, 4)
  assert.equal(JSON.parse(calls[2][1].content).mode, 'review')
  assert.deepEqual(JSON.parse(calls[2][1].content).photos[0].personIds, ['child'])
  assert.equal(JSON.parse(calls[1][1].content).photos.length, 2, 'writer receives selected evidence, not the whole library')
  assert.equal(result.title, '小配角的签名')
  let failures = 0
  await assert.rejects(composeStorytelling({}, storytellingInput(raw), async () => { failures++; return JSON.stringify(bad) }))
  assert.equal(failures, 4, 'one selection, one draft, one review, at most one repair')
})

test('editor patches cannot change photos, overwrite silence or insert unsupported identity', () => {
  const draft = proposal(), review = response()
  review.edits = [{ beat: 0, text: '小满嘴角多了一个奶油签名。', reason: '缩短旁白' }]
  const fixed = applyStoryEdits(draft, review)
  assert.deepEqual(fixed.story.beats[0].assetIds, draft.story.beats[0].assetIds)
  assert.equal(fixed.story.beats[1].text, '')
  assert.equal(draft.story.beats[0].text, proposal().story.beats[0].text, 'draft remains immutable')
  review.edits = [{ beat: 1, text: '填上留白' }]
  assert.equal(applyStoryEdits(draft, review).story.beats[1].text, '', 'silence is owned by the player, not the editor')
  review.edits = [{ beat: 0, text: '这是小满和姥姥。' }]
  assert.throws(() => validateStorytelling(applyStoryEdits(draft, review), storytellingInput(raw)), /个人事实/)
})

test('empty provider output gets one bounded shape repair, without creating empty stories', async () => {
  let calls = 0
  const result = await composeStorytelling({}, storytellingInput(raw), async () => JSON.stringify(++calls === 1 ? {} : response()))
  assert.equal(calls, 4); assert.ok(result.assetIds.length)
  let failures = 0
  await assert.rejects(composeStorytelling({}, storytellingInput(raw), async () => { failures++; return '{}' }), /完整的选题/)
  assert.equal(failures, 2)
})

test('the writer model is independent; selection and factual review retain the main model', async () => {
  const models = []
  await composeStorytelling({ model: 'reader-model', storyModel: 'writer-model' }, storytellingInput(raw), async config => {
    models.push(config.model); return JSON.stringify(response())
  })
  assert.deepEqual(models, ['reader-model', 'writer-model', 'reader-model'])
})

test('invalid photo layout is repaired by the writer before the text-only editor runs', async () => {
  const calls = [], bad = response()
  bad.story.beats[0].assetIds = ['photo-001', 'photo-002', 'photo-003', 'photo-001']
  const story = await composeStorytelling({}, storytellingInput(raw), async (_config, messages) => {
    calls.push(messages); return JSON.stringify(calls.length === 2 ? bad : response())
  })
  assert.equal(calls.length, 4)
  assert.ok(calls[2][0].content.includes('mode: compose'))
  assert.ok(calls[3][0].content.includes('mode: review'))
  assert.ok(story.beats.every(b => b.assetIds.length <= 3))
})

test('visual review pairs each selected private preview with its photo ID and excludes unselected photos', async () => {
  const calls = [], loaded = []
  const story = await composeStorytelling({}, storytellingInput(raw), async (_config, messages) => {
    calls.push(messages)
    if (calls.length === 2) return JSON.stringify({ photos: raw.photos.slice(0, 2).map(p => ({ id: p.id, observed: p.scene + ' 新观察。' })) })
    return JSON.stringify(response())
  }, { imageFor: async id => { loaded.push(id); return Buffer.from('fixture-' + id) } })
  assert.deepEqual(loaded, ['photo-001', 'photo-002'])
  assert.equal(calls.length, 4)
  assert.ok(!JSON.stringify(calls[1][1].content).includes('嘴角沾了奶油'), 'fresh observer is not primed by an old card')
  assert.equal(typeof calls[2][1].content, 'string', 'writer receives refreshed text facts')
  assert.ok(JSON.parse(calls[2][1].content).photos.every(p => p.observed.includes('新观察')))
  const content = calls[3][1].content
  assert.equal(content.filter(c => c.type === 'image_url').length, 2)
  assert.ok(content[1].text.endsWith('photo-001'))
  assert.equal(content[2].image_url.url, 'data:image/jpeg;base64,' + Buffer.from('fixture-photo-001').toString('base64'))
  assert.equal(story.visualReviewPhotos, 2)
})

test('account-scoped replay survives restart and invalidates on new identity/observations/notes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pw-telling-')), user = { id: 'account-a' }
  let calls = 0, latest = structuredClone(raw)
  const call = async () => { calls++; return JSON.stringify(response()) }
  let service = createStorytellingService(root, {}, { call })
  const first = await service.compose(user, latest)
  assert.equal(calls, 3)
  service = createStorytellingService(root, {}, { call })
  assert.equal((await service.list({ id: 'account-b' })).length, 0)
  const cached = await service.compose(user, latest, { storyId: first.id })
  assert.equal(cached.cached, true); assert.equal(calls, 3)
  latest.photos[0].scene += ' 背景有碎石。'
  const changed = await service.compose(user, latest, { storyId: first.id })
  assert.notEqual(changed.sourceRevision, first.sourceRevision); assert.equal(calls, 6)
  const revision = sourceRevision(storytellingInput(latest))
  latest.storyGraph.people[0].name = '团团'
  assert.notEqual(sourceRevision(storytellingInput(latest)), revision)
  assert.notEqual(sourceRevision(storytellingInput(latest), 'model-a'), sourceRevision(storytellingInput(latest), 'model-b'))
  latest.storyGraph.people[0].name = '小满'
  latest.storyGraph.facts.push({ id: 'note', source: 'user', status: 'confirmed', type: 'note', assetIds: ['photo-001'], value: '这是海边出游留下的照片。' })
  assert.notEqual(sourceRevision(storytellingInput(latest)), revision)
  let saved
  await service.note(user, { storyId: changed.id, assetIds: ['photo-001', 'foreign'], value: '这是我补充的记忆' }, fact => { saved = fact })
  assert.deepEqual(saved.assetIds, ['photo-001'])
  await assert.rejects(service.note({ id: 'account-b' }, { storyId: changed.id, assetIds: ['photo-001'], value: 'x' }, () => {}))
  await service.removeAssets(user, ['photo-001'])
  assert.equal((await service.list(user)).length, 0, 'deleting a photo clears its saved narrations too')
})

test('source edits during composition cannot publish stale narration', async () => {
  const service = createStorytellingService(await mkdtemp(join(tmpdir(), 'pw-telling-race-')), {}, { call: async () => JSON.stringify(response()) })
  const newer = structuredClone(raw); newer.photos[0].scene += ' 新的观察。'
  await assert.rejects(service.compose({ id: 'race' }, raw, { freshInput: async () => newer }), /资料刚刚更新/)
  assert.equal((await service.list({ id: 'race' })).length, 0)
  const serverCorrection = structuredClone(raw)
  serverCorrection.storyGraph.facts.push({ assetId: 'photo-001', type: 'observation', value: '最新核对：嘴角没有奶油。', source: 'user', status: 'confirmed' })
  await assert.rejects(service.compose({ id: 'server-race' }, raw, { freshInput: async () => serverCorrection }), /资料刚刚更新/, 'server correction invalidates a request even when its browser card is stale')
})

test('replaying an invalidated first-time question checks the original question against fresh data', async () => {
  const service = createStorytellingService(await mkdtemp(join(tmpdir(), 'pw-telling-retell-')), {}, { call: async () => JSON.stringify(response()) })
  const user = { id: 'retell' }, firstRaw = { ...structuredClone(raw), question: '讲讲照片记录中第一次的回忆', events: [{ id: 'event-1', title: '回忆', firsts: ['照片记录中第一次来这里'], lasts: [] }] }
  const first = await service.compose(user, firstRaw)
  const changed = structuredClone(firstRaw); changed.question = '再听这段回忆'; changed.photos[0].scene += ' 背景有碎石。'
  const updated = await service.compose(user, changed, { storyId: first.id, freshInput: async () => changed })
  assert.equal(updated.question, firstRaw.question)
  assert.notEqual(updated.id, first.id)
})

test('optional photo memory is a user fact and participates in continuous understanding without an invented person', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pw-telling-note-')), store = openIdentityStore(root)
  try {
    store.sync({ assets: [{ id: 'photo-001', hash: 'x', kind: 'image', capturedAt: '2026-02-01T01:00:00Z', dateSource: 'exif', card: { scene: '围坐在蛋糕旁。' } }], events: [] })
    const state = store.fact({ assetIds: ['photo-001'], value: '这次是在庆祝家人团聚。' })
    const note = state.graph.facts.find(f => f.type === 'note')
    assert.equal(note.source, 'user'); assert.equal(note.subjectId, undefined)
    assert.ok(eventInputs(state, 1)[0].confirmed.some(f => f.value === note.value))
    assert.ok(store.enrich([{ id: 'photo-001' }])[0].story.includes(note.value), 'existing films inherit the same note')
    assert.throws(() => store.fact({ value: 'unbound' }))
    assert.throws(() => store.fact({ assetIds: ['foreign'], value: 'foreign' }))
  } finally { store.close() }
})

test('/api/butler routes an explicit story through the dedicated runtime and returns grouped beats', async () => {
  const sample = response()
  sample.story.beats.forEach(b => { b.text = b.text.replaceAll('小满', '孩子') })
  const api = await startApi(() => sample)
  try {
    const { status, json } = await api.post('/api/butler', { question: raw.question, intent: 'story', memory: { photos: raw.photos } })
    assert.equal(status, 200, JSON.stringify(json))
    assert.equal(json.actions[0].story.beats[0].assetIds.length, 2)
    assert.equal(api.calls.length, 3)
    assert.ok(api.calls[0].messages[0].content.includes('mode: select'))
    assert.ok(api.calls[1].messages[0].content.includes('mode: compose'))
    assert.ok(!api.calls[1].messages[0].content.includes('mode: review'), 'each role loads only its own instructions')
    assert.ok(api.calls[2].messages[0].content.includes('mode: review'))
    const saved = await api.post('/api/storytelling/list', {})
    assert.equal(saved.json.stories[0].id, json.actions[0].story.id)
  } finally { await api.close() }
})

test('LIVE: actual model finds a concrete motif without fabricating a birthday or identity', { skip: !live }, async () => {
  const story = await composeStorytelling(stepfunConfig(), storytellingInput(raw))
  assert.ok(story.assetIds.length >= 2)
  assert.ok(!story.beats.some(b => /生日|最喜欢|第一次/.test(b.text)))
})

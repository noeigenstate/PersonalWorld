// Prepare real account stories through the same runtime skill, editor and private cache as the app.
// No fixed scripts, public photo copies or invented identities are added to the repository.
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createMemoryGraph } from '../server/memoryGraph.mjs'
import { createStorytellingService } from '../server/storytelling.mjs'
import { compactPhoto } from '../server/butler.mjs'
import { chat, stepfunConfig } from '../server/stepfun.mjs'

process.loadEnvFile('.env')
const args = Object.fromEntries(process.argv.slice(2).map(value => { const at = value.indexOf('='); return [value.slice(0, at), value.slice(at + 1)] }))
if (!/^[a-zA-Z0-9-]{8,64}$/.test(args['--account'] || '')) throw new Error('Use --account=<local account ID> --questions=<private JSON array file>')
const user = { id: args['--account'] }, config = stepfunConfig()
if (args['--model']) config.storyModel = args['--model']
const data = resolve('server/data'), root = join(data, 'accounts', user.id)
const graph = createMemoryGraph(join(data, 'memory-graph'), { understandingOptions: { available: false } })
const questions = JSON.parse(await readFile(args['--questions'], 'utf8'))
const output = resolve(args['--out'] || 'data/exports/storytelling-2026-09-28')
await mkdir(output, { recursive: true })
let sequence = 0
const traceDir = join(output, 'trace-' + Date.now()); await mkdir(traceDir, { recursive: true })
const service = createStorytellingService(args['--store'] ? resolve(args['--store']) : join(data, 'storytelling'), config, { photoPreview: (_user, id) => readFile(join(root, 'previews', id + '.jpg')).catch(error => { if (error.code !== 'ENOENT') throw error; return null }), call: async (config, messages, options) => {
  const started = Date.now()
  const result = await chat(config, messages, options)
  const content = messages[1].content
  await writeFile(join(traceDir, `${++sequence}.json`), JSON.stringify({ model: config.model, elapsedMs: Date.now() - started, input: JSON.parse(Array.isArray(content) ? content[0].text : content), imageCount: Array.isArray(content) ? content.filter(v => v.type === 'image_url').length : 0, output: JSON.parse(result) }, null, 2))
  return result
} })
try {
  const records = []
  for (const question of questions) {
    const input = async () => {
      const { memory } = JSON.parse(await readFile(join(root, 'state.json'), 'utf8'))
      const photos = memory.assets.filter(a => a.kind !== 'video').map(a => {
        const event = memory.events.find(e => e.assetIds.includes(a.id))
        return compactPhoto({ id: a.id, eventId: event?.id, date: new Date(Date.parse(a.capturedAt) + 8 * 3600000).toISOString().slice(0, 10), dateSource: a.dateSource,
          city: a.location?.city || event?.city || '', place: a.location?.aoi || a.location?.poi?.name || a.location?.label || event?.place || '',
          title: a.card?.title, caption: a.card?.caption, scene: a.card?.scene, tags: a.card?.tags, people: [] })
      })
      return { question, photos, events: [], focus: null, storyGraph: graph.context(user) }
    }
    console.log('Composing requested story…')
    const record = await service.compose(user, await input(), { freshInput: input })
    records.push({ id: record.id, title: record.title, format: record.format, beats: record.beats.length, photos: record.assetIds.length })
    await writeFile(join(output, record.id + '.json'), JSON.stringify(record, null, 2))
    console.log(JSON.stringify(records.at(-1)))
  }
  await writeFile(join(output, 'manifest.json'), JSON.stringify(records, null, 2))
} finally { graph.close() }

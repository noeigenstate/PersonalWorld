// Downloads the OpenStreetMap vector tiles of whole provinces into world-data/osm (the local data of
// record for the cartoon world). Regions grow over time: add them to world-data/regions.json.
// Tiles already on disk are skipped, so the script can be stopped and run again.
// node scripts/fetch-osm-region.mjs zhejiang jiangsu [--min 5] [--max 14] [--jobs 12]
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { isSourceSaved, sourceTile } from '../server/cartoonTiles.mjs'

const regions = JSON.parse(await readFile(fileURLToPath(new URL('../world-data/regions.json', import.meta.url)), 'utf8'))
const args = process.argv.slice(2)
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? Number(args[i + 1]) : fallback }
const names = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'))
const min = option('min', 5), max = option('max', 14), jobs = option('jobs', 12)
if (!names.length || names.some((name) => !regions[name])) {
  console.log(`用法：node scripts/fetch-osm-region.mjs <地区…>，可选：${Object.keys(regions).join(' ')}`)
  process.exit(1)
}

const lngTile = (lng, z) => Math.floor(((lng + 180) / 360) * 2 ** z)
const latTile = (lat, z) => Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z)
const wanted = new Set()
for (const name of names) {
  const [west, south, east, north] = regions[name].bbox
  for (let z = min; z <= max; z++) {
    for (let x = lngTile(west, z); x <= lngTile(east, z); x++) for (let y = latTile(north, z); y <= latTile(south, z); y++) wanted.add(`${z}/${x}/${y}`)
  }
}
// Coarse levels first: the map is usable at every scale early on
const list = [...wanted].map((key) => key.split('/').map(Number)).sort((a, b) => a[0] - b[0])
console.log(`${names.map((n) => regions[n].name).join('、')}：${list.length} 块瓦片（${min}–${max} 级）`)

let done = 0, fetched = 0, failed = 0, bytes = 0
const started = Date.now()
const queue = [...list]
async function worker() {
  for (let job = queue.shift(); job; job = queue.shift()) {
    const [z, x, y] = job
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (!(await isSourceSaved(z, x, y))) { bytes += (await sourceTile(z, x, y)).length; fetched++ }
        break
      } catch {
        if (attempt === 2) failed++
        else await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)))
      }
    }
    done++
    if (done % 500 === 0 || done === list.length) {
      const seconds = (Date.now() - started) / 1000
      const rate = fetched / Math.max(1, seconds)
      console.log(`${done}/${list.length}（下载 ${fetched}，失败 ${failed}，${(bytes / 1048576).toFixed(0)} MB，${rate.toFixed(1)} 块/秒，已用 ${Math.round(seconds / 60)} 分钟）`)
    }
  }
}
await Promise.all(Array.from({ length: jobs }, worker))
console.log(failed ? `${failed} 块没下载成功，再运行一次即可补齐` : '全部下载完成')

// Builds OpenStreetMap vector tiles for whole regions on this computer with Planetiler, from the raw
// OSM extract (no tile server involved). The result, world-data/<name>.mbtiles, is what the cartoon
// world reads first (server/cartoonTiles.mjs). Regions grow over time: world-data/regions.json.
//
// Inputs in world-data/sources (not kept in git, re-downloadable):
//   planetiler.jar                      https://github.com/onthegomap/planetiler/releases
//   china-latest.osm.pbf                https://download.geofabrik.de/asia/china-latest.osm.pbf
//   water-polygons-split-3857.zip       https://osmdata.openstreetmap.de/download/water-polygons-split-3857.zip
//   natural_earth_vector.sqlite.zip     https://naciscdn.org/naturalearth/packages/natural_earth_vector.sqlite.zip
//   lake_centerline.shp.zip             https://github.com/lukasmartinelli/osm-lakelines/releases
//
// node scripts/build-osm-region.mjs zhejiang jiangsu
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const here = (path) => fileURLToPath(new URL(path, import.meta.url))
const sources = here('../world-data/sources/')
if (existsSync(here('../.env'))) process.loadEnvFile(here('../.env'))
const regions = JSON.parse(await readFile(here('../world-data/regions.json'), 'utf8'))
const names = process.argv.slice(2)
if (!names.length || names.some((name) => !regions[name])) {
  console.log(`用法：node scripts/build-osm-region.mjs <地区…>，可选：${Object.keys(regions).join(' ')}`)
  process.exit(1)
}
for (const file of ['planetiler.jar', 'china-latest.osm.pbf', 'water-polygons-split-3857.zip', 'natural_earth_vector.sqlite.zip', 'lake_centerline.shp.zip']) {
  if (!existsSync(sources + file)) { console.log(`缺少 world-data/sources/${file}，见脚本开头的下载地址`); process.exit(1) }
}

// One archive covering all the named regions together
const boxes = names.map((name) => regions[name].bbox)
const bounds = [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))]
const output = here(`../world-data/${names.join('-')}.mbtiles`)
const args = [
  '-Xmx20g', '-jar', sources + 'planetiler.jar',
  `--osm-path=${sources}china-latest.osm.pbf`,
  `--water-polygons-path=${sources}water-polygons-split-3857.zip`,
  `--natural-earth-path=${sources}natural_earth_vector.sqlite.zip`,
  `--lake-centerlines-path=${sources}lake_centerline.shp.zip`,
  `--bounds=${bounds.join(',')}`,
  '--minzoom=0', '--maxzoom=14',
  `--tmpdir=${sources}tmp`,
  `--output=${output}`, '--force',
]
console.log(`构建 ${names.map((n) => regions[n].name).join('、')}：${bounds.join(', ')} → ${output}`)
const started = Date.now()
// Planetiler needs Java 21+; JAVA_PATH in .env points at one that is not on the PATH
const code = await new Promise((resolve) => spawn(process.env.JAVA_PATH || 'java', args, { stdio: 'inherit' }).on('close', resolve))
if (code !== 0) process.exit(code)
const size = (await stat(output)).size
console.log(`完成：${(size / 1048576).toFixed(0)} MB，用时 ${Math.round((Date.now() - started) / 60000)} 分钟`)

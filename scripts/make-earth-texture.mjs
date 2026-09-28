// Colours follow src/map/cartoonPalette.ts (land, water) so the globe hands over to the cartoon ground seamlessly.
// Regenerate the code-native cartoon globe texture from public-domain Natural Earth data (50 m):
// land, glaciers, lakes, rivers and country borders. Sources (public/earth-data/, also fetched by the
// browser for the close-up detail patch in src/map/globeScene.ts):
// https://github.com/nvkelso/natural-earth-vector/tree/master/geojson — ne_50m_land, ne_50m_glaciated_areas,
// ne_50m_lakes, ne_50m_rivers_lake_centerlines, ne_50m_admin_0_boundary_lines_land
import { readFile, writeFile } from 'node:fs/promises'

const WIDTH = 4096
const HEIGHT = 2048
const dataDir = new URL('../public/earth-data/', import.meta.url)
const output = new URL('../public/earth-cartoon.svg', import.meta.url)
const load = async (name) => JSON.parse(await readFile(new URL(`${name}.geojson`, dataDir), 'utf8'))
const [land, glaciers, lakes, rivers, borders] = await Promise.all(['ne_50m_land', 'ne_50m_glaciated_areas', 'ne_50m_lakes', 'ne_50m_rivers_lake_centerlines', 'ne_50m_admin_0_boundary_lines_land'].map(load))

const project = ([lng, lat]) => [(lng + 180) / 360 * WIDTH, (90 - lat) / 180 * HEIGHT]
// Points closer than a third of a pixel add nothing at this size; dropping them keeps the file small
function thin(coordinates) {
  const out = []
  for (const coordinate of coordinates) {
    const [x, y] = project(coordinate)
    const last = out[out.length - 1]
    if (!last || Math.hypot(x - last[0], y - last[1]) >= 0.35) out.push([x, y])
  }
  return out
}
const path = (coordinates, close) => { const points = thin(coordinates); return points.length < 2 ? '' : `M${points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}${close ? 'Z' : ''}` }
const polygonsOf = (geometry) => geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : []
const linesOf = (geometry) => geometry.type === 'LineString' ? [geometry.coordinates] : geometry.type === 'MultiLineString' ? geometry.coordinates : []
const polygonPaths = (collection) => collection.features.flatMap((feature) => polygonsOf(feature.geometry).map((rings) => ({
  d: rings.map((ring) => path(ring, true)).join(''),
  polar: rings[0].reduce((sum, coord) => sum + coord[1], 0) / rings[0].length < -60,
}))).filter(({ d }) => d)
const linePaths = (collection, keep = () => true) => collection.features.filter(keep).flatMap((feature) => linesOf(feature.geometry).map((line) => path(line, false))).filter(Boolean)

const landPaths = polygonPaths(land)
const landFill = landPaths.map(({ d, polar }) => `<path d="${d}" fill="${polar ? '#f4f8ff' : 'url(#land)'}"/>`).join('')
const coast = landPaths.map(({ d }) => `<path d="${d}"/>`).join('')
const ice = polygonPaths(glaciers).map(({ d }) => `<path d="${d}"/>`).join('')
const lakeFill = polygonPaths(lakes).map(({ d }) => `<path d="${d}"/>`).join('')
// Rivers: the larger ones only (scalerank ≤ 7 of 12), thinner as they get smaller
const riverPaths = [3, 5, 7].map((rank, index, ranks) => `<g stroke-width="${[2.2, 1.5, 1][index]}">${linePaths(rivers, (f) => (f.properties?.scalerank ?? 99) <= rank && (f.properties?.scalerank ?? 99) > (ranks[index - 1] ?? -1)).map((d) => `<path d="${d}"/>`).join('')}</g>`).join('')
const borderPaths = linePaths(borders).map((d) => `<path d="${d}"/>`).join('')
const meridians = Array.from({ length: 23 }, (_, index) => `<path d="M${((index + 1) * WIDTH / 24).toFixed(1)},0V${HEIGHT}"/>`).join('')
const parallels = Array.from({ length: 11 }, (_, index) => `<path d="M0,${((index + 1) * HEIGHT / 12).toFixed(1)}H${WIDTH}"/>`).join('')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
<defs>
  <linearGradient id="sea" x2="0" y2="1"><stop stop-color="#3dbdee"/><stop offset=".52" stop-color="#33b6ea"/><stop offset="1" stop-color="#3dbdee"/></linearGradient>
  <linearGradient id="land" x2="0" y2="1"><stop stop-color="#97d862"/><stop offset=".42" stop-color="#8fd35a"/><stop offset=".72" stop-color="#8ad056"/><stop offset="1" stop-color="#97d862"/></linearGradient>
</defs>
<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#sea)"/>
<g fill="none" stroke="#d5f7ed" stroke-width="1.2" opacity=".1">${meridians}${parallels}</g>
<g fill="#1f95d8" opacity=".35" transform="translate(0 5)">${coast}</g>
<g fill-rule="evenodd">${landFill}</g>
<g fill="#f4f8ff" fill-rule="evenodd" opacity=".95">${ice}</g>
<g fill="#3dbdee" fill-rule="evenodd">${lakeFill}</g>
<g fill="none" stroke="#5fd0f2" stroke-linecap="round" stroke-linejoin="round" opacity=".85">${riverPaths}</g>
<g fill="none" stroke="#ffffff" stroke-width="1.1" stroke-linejoin="round" stroke-dasharray="6 4" opacity=".42">${borderPaths}</g>
<g fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round" opacity=".6">${coast}</g>
</svg>`
await writeFile(output, svg)
console.log(`Wrote ${output.pathname} (${landPaths.length} land polygons, ${polygonPaths(lakes).length} lakes, ${linePaths(rivers).length} rivers, ${linePaths(borders).length} borders; ${(svg.length / 1024 / 1024).toFixed(1)} MB)`)

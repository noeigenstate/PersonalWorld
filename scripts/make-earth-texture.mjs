// Colours follow src/map/cartoonPalette.ts (land, water) so the globe hands over to the cartoon ground seamlessly.
// Regenerate the code-native cartoon globe texture from public-domain Natural Earth land polygons.
// Source: https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_land.geojson
import { readFile, writeFile } from 'node:fs/promises'

const WIDTH = 2048
const HEIGHT = 1024
const source = new URL('../src/map/data/earth-land-110m.geojson', import.meta.url)
const output = new URL('../public/earth-cartoon.svg', import.meta.url)
const data = JSON.parse(await readFile(source, 'utf8'))

const point = ([lng, lat]) => `${((lng + 180) / 360 * WIDTH).toFixed(1)},${((90 - lat) / 180 * HEIGHT).toFixed(1)}`
const ring = (coordinates) => `M${coordinates.map(point).join('L')}Z`
const polygon = (rings) => rings.map(ring).join('')
const paths = data.features.flatMap((feature) => {
  const geometry = feature.geometry
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : []
  return polygons.map((rings) => ({
    d: polygon(rings),
    polar: rings[0].reduce((sum, coord) => sum + coord[1], 0) / rings[0].length < -60,
  }))
})
const land = paths.map(({ d, polar }) => `<path d="${d}" fill="${polar ? '#f4f8ff' : 'url(#land)'}"/>`).join('')
const coast = paths.map(({ d }) => `<path d="${d}"/>`).join('')
const meridians = Array.from({ length: 11 }, (_, index) => `<path d="M${((index + 1) * WIDTH / 12).toFixed(1)},0V${HEIGHT}"/>`).join('')
const parallels = Array.from({ length: 5 }, (_, index) => `<path d="M0,${((index + 1) * HEIGHT / 6).toFixed(1)}H${WIDTH}"/>`).join('')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
<defs>
  <linearGradient id="sea" x2="0" y2="1"><stop stop-color="#3dbdee"/><stop offset=".52" stop-color="#33b6ea"/><stop offset="1" stop-color="#3dbdee"/></linearGradient>
  <linearGradient id="land" x2="0" y2="1"><stop stop-color="#97d862"/><stop offset=".42" stop-color="#8fd35a"/><stop offset=".72" stop-color="#8ad056"/><stop offset="1" stop-color="#97d862"/></linearGradient>
</defs>
<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#sea)"/>
<g fill="none" stroke="#d5f7ed" stroke-width="1" opacity=".1">${meridians}${parallels}</g>
<g fill="#1f95d8" opacity=".35" transform="translate(0 3)">${coast}</g>
<g fill-rule="evenodd">${land}</g>
<g fill="none" stroke="#ffffff" stroke-width="1.2" stroke-linejoin="round" opacity=".55">${coast}</g>
</svg>`
await writeFile(output, svg)
console.log(`Wrote ${output.pathname} (${paths.length} land polygons)`)

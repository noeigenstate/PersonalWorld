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
const land = paths.map(({ d, polar }) => `<path d="${d}" fill="${polar ? '#edf1da' : 'url(#land)'}"/>`).join('')
const coast = paths.map(({ d }) => `<path d="${d}"/>`).join('')
const meridians = Array.from({ length: 11 }, (_, index) => `<path d="M${((index + 1) * WIDTH / 12).toFixed(1)},0V${HEIGHT}"/>`).join('')
const parallels = Array.from({ length: 5 }, (_, index) => `<path d="M0,${((index + 1) * HEIGHT / 6).toFixed(1)}H${WIDTH}"/>`).join('')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
<defs>
  <linearGradient id="sea" x2="0" y2="1"><stop stop-color="#82d5db"/><stop offset=".52" stop-color="#5db9cc"/><stop offset="1" stop-color="#83cfdb"/></linearGradient>
  <linearGradient id="land" x2="0" y2="1"><stop stop-color="#d7e5ae"/><stop offset=".42" stop-color="#a8d19b"/><stop offset=".72" stop-color="#a6d0a4"/><stop offset="1" stop-color="#d7e7b9"/></linearGradient>
</defs>
<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#sea)"/>
<g fill="none" stroke="#d5f7ed" stroke-width="1" opacity=".18">${meridians}${parallels}</g>
<g fill="#277d92" opacity=".28" transform="translate(0 4)">${coast}</g>
<g fill-rule="evenodd">${land}</g>
<g fill="none" stroke="#e6f2c7" stroke-width="2.2" stroke-linejoin="round" opacity=".9">${coast}</g>
</svg>`
await writeFile(output, svg)
console.log(`Wrote ${output.pathname} (${paths.length} land polygons)`)

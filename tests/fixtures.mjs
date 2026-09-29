// Builds a small fictional photo library with real EXIF time and GPS:
// home in 湘潭, university in 武汉, work in 上海, a two-day trip to 杭州, one photo without GPS.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import piexif from 'piexifjs'

export const cities = {
  湘潭市: { lat: 27.8297, lng: 112.9447, district: '雨湖区' },
  武汉市: { lat: 30.5397, lng: 114.3647, district: '洪山区 珞珈山' },
  上海市: { lat: 31.2304, lng: 121.4737, district: '黄浦区' },
  杭州市: { lat: 30.2590, lng: 120.1300, district: '西湖区' },
}

const shots = [
  ['湘潭市', '2012-02-01 10:20', 0, 0], ['湘潭市', '2012-02-01 15:40', 0.002, 0.001],
  ['湘潭市', '2013-08-15 09:00', 0.001, -0.002], ['湘潭市', '2013-08-15 14:10', 0.001, -0.001],
  ['湘潭市', '2014-08-30 08:30', 0, 0.001],
  ['武汉市', '2014-09-02 11:00', 0, 0], ['武汉市', '2014-09-02 14:30', 0.001, 0.002], ['武汉市', '2014-09-02 16:00', 0.002, 0.001],
  ['武汉市', '2015-10-01 10:00', -0.01, 0.02], ['武汉市', '2015-10-01 12:00', -0.011, 0.021],
  ['武汉市', '2016-04-10 09:30', 0.003, -0.002], ['武汉市', '2016-04-10 10:10', 0.003, -0.001], ['武汉市', '2016-04-10 11:40', 0.004, -0.002],
  ['武汉市', '2018-06-20 09:00', 0, 0.001], ['武汉市', '2018-06-20 11:00', 0.001, 0.001], ['武汉市', '2018-06-20 16:30', 0.02, 0.03],
  ['上海市', '2018-07-02 09:10', 0.01, 0.03], ['上海市', '2018-07-02 14:40', 0.011, 0.03],
  ['湘潭市', '2019-02-04 11:00', 0, 0], ['湘潭市', '2019-02-04 16:00', 0.001, 0],
  ['上海市', '2019-10-02 10:00', 0.009, 0.026], ['上海市', '2019-10-02 15:30', 0.009, 0.027], ['上海市', '2019-10-02 19:40', -0.02, -0.03],
  ['杭州市', '2020-10-03 10:00', 0, 0], ['杭州市', '2020-10-03 16:00', 0.01, -0.01], ['杭州市', '2020-10-04 09:30', 0.005, 0.004],
  ['上海市', '2021-05-15 14:00', -0.03, -0.05], ['上海市', '2021-05-15 17:00', -0.03, -0.049],
  [null, '2022-03-10 21:00', 0, 0],
  ['湘潭市', '2023-01-21 12:00', 0, 0], ['湘潭市', '2023-01-21 17:00', 0.001, 0.001],
  ['上海市', '2024-12-20 19:00', 0.02, 0.01], ['上海市', '2024-12-20 21:30', 0.021, 0.01],
  ['上海市', '2026-09-20 10:00', -0.01, 0.02], ['上海市', '2026-09-20 15:00', -0.01, 0.021],
]

const palette = { 湘潭市: ['#f5b98b', '#ffe3c2'], 武汉市: ['#8fb8ea', '#dbe9fb'], 上海市: ['#8fd3a8', '#dcf3e4'], 杭州市: ['#ffc98a', '#fff0d6'], null: ['#c9c9d1', '#f0f0f3'] }

function dms(value) {
  return piexif.GPSHelper.degToDmsRational(Math.abs(value))
}

// `options.pictures`: { 湘潭市: [dataUrl…] } paints those pictures in turn (cover-fitted, cropped a little
// differently each time) instead of the colour blocks; `options.extraShots`: more [city, when, dLat, dLng]
// (used by scripts/record-readme-media.mjs)
export async function makeLifeFixtures(page, dir, options = {}) {
  mkdirSync(dir, { recursive: true })
  const files = []
  const used = {}
  for (const [index, [city, when, dLat, dLng]] of [...shots, ...(options.extraShots || [])].entries()) {
    const [a, b] = palette[city]
    const label = `${city ? city.replace('市', '') : '截图'} ${when.slice(0, 10)}`
    const pictures = options.pictures?.[city]
    const turn = used[city] = (used[city] ?? -1) + 1
    const picture = pictures?.length ? { url: pictures[turn % pictures.length], turn } : null
    const dataUrl = await page.evaluate(async ({ a, b, label, picture }) => {
      const canvas = document.createElement('canvas')
      canvas.width = 640; canvas.height = 480
      const g = canvas.getContext('2d')
      if (picture) {
        const img = new Image(); img.src = picture.url; await img.decode()
        // Each photo a slightly different crop, so a picture used twice still differs
        const zoom = 1 + 0.1 * (picture.turn % 4)
        const scale = Math.max(640 / img.width, 480 / img.height) * zoom
        const w = img.width * scale, h = img.height * scale
        const dx = (640 - w) * (0.5 + 0.35 * Math.sin(picture.turn * 2.3)), dy = (480 - h) * (0.5 + 0.35 * Math.cos(picture.turn * 1.7))
        g.drawImage(img, dx, dy, w, h)
        return canvas.toDataURL('image/jpeg', 0.86)
      }
      const grad = g.createLinearGradient(0, 0, 640, 480)
      grad.addColorStop(0, a); grad.addColorStop(1, b)
      g.fillStyle = grad; g.fillRect(0, 0, 640, 480)
      g.fillStyle = '#1d1d1f'; g.font = 'bold 44px sans-serif'; g.fillText(label, 40, 250)
      return canvas.toDataURL('image/jpeg', 0.8)
    }, { a, b, label, picture })
    const exif = { '0th': {}, Exif: { [piexif.ExifIFD.DateTimeOriginal]: when.replace(/-/g, ':') + ':00' }, GPS: {} }
    if (city) {
      const lat = cities[city].lat + dLat
      const lng = cities[city].lng + dLng
      exif.GPS = {
        [piexif.GPSIFD.GPSLatitudeRef]: lat >= 0 ? 'N' : 'S', [piexif.GPSIFD.GPSLatitude]: dms(lat),
        [piexif.GPSIFD.GPSLongitudeRef]: lng >= 0 ? 'E' : 'W', [piexif.GPSIFD.GPSLongitude]: dms(lng),
      }
    }
    const jpeg = piexif.insert(piexif.dump(exif), atob(dataUrl.split(',')[1]))
    const file = join(dir, `IMG_${String(index + 1).padStart(3, '0')}.jpg`)
    writeFileSync(file, Buffer.from(jpeg, 'binary'))
    files.push(file)
  }
  return files
}

// Nearest fixture city for a WGS-84 point, standing in for AMap reverse geocoding
export function fakeGeocode({ id, lat, lng }) {
  const [city, info] = Object.entries(cities).sort(([, p], [, q]) => Math.hypot(p.lat - lat, p.lng - lng) - Math.hypot(q.lat - lat, q.lng - lng))[0]
  return { id, city, district: info.district.split(' ')[0], address: info.district }
}

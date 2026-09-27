// Audit the actual account's opted-in metadata, using anonymous photo placeholders.
// Outputs stay under data/exports; no private coordinates or images enter the repo.
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { mapSceneForPoint } from '../server/mapScene.mjs'
import { gcj02ToWgs84 } from '../src/lib/geo.js'

process.loadEnvFile(new URL('../.env', import.meta.url))
if (!process.env.MEMORY_REVIEW_PATH) throw new Error('Set MEMORY_REVIEW_PATH to an authorized local metadata snapshot')
const snapshot = JSON.parse(await readFile(process.env.MEMORY_REVIEW_PATH, 'utf8'))
const output = process.env.SCENE_AUDIT_DIR || 'data/exports/scene-coverage'
await mkdir(output, { recursive: true })
const rows = []
for (const [index, region] of snapshot.regions.entries()) {
  const p = gcj02ToWgs84({lng:region.center[0],lat:region.center[1]})
  const data = await mapSceneForPoint(p.lng, p.lat, region.radius)
  rows.push({ index, region, data })
}
const browser = await chromium.launch({ channel:'chrome' })
try {
  const page = await browser.newPage({viewport:{width:1440,height:900}})
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  let active = rows[0]
  await page.route('**/api/map-scene', route => route.fulfill({json:active.data}))
  await page.route('**/_AMapService/**', async route => {
    const url = new URL(route.request().url())
    const targets = [['/_AMapService/v4/map/styles','https://webapi.amap.com/v4/map/styles'], ['/_AMapService/v3/vectormap','https://fmap01.amap.com/v3/vectormap'], ['/_AMapService/','https://restapi.amap.com/']]
    const [prefix,target] = targets.find(([p]) => url.pathname.startsWith(p))
    url.searchParams.set('jscode',process.env.AMAP_JS_SECURITY_CODE)
    const response = await fetch(`${target}${url.pathname.slice(prefix.length)}?${url.searchParams}`)
    await route.fulfill({status:response.status,contentType:response.headers.get('content-type')||undefined,body:Buffer.from(await response.arrayBuffer())})
  })
  await page.goto(process.env.BASE_URL || 'http://localhost:5183/', {waitUntil:'domcontentloaded'})
  await page.evaluate(async key => {
    const {loadAmap} = await import('/src/map/amap.ts')
    const {createAmapLifeMap} = await import('/src/map/amapScene.ts')
    window.audit = {AMap:await loadAmap(key),create:createAmapLifeMap}
  }, process.env.AMAP_JS_KEY)
  for (const row of rows) {
    active = row
    const assets = snapshot.assets.filter(a => row.region.photoIds.includes(a.id))
    await page.evaluate(({center,assets,index}) => {
      const a = window.audit
      a.api?.dispose(); document.getElementById('coverage-audit')?.remove()
      const host = document.createElement('div'); host.id='coverage-audit'
      host.style.cssText='position:fixed;inset:0;z-index:99999;background:white'; document.body.append(host)
      const namespace=Object.create(a.AMap)
      namespace.Map=function(...args){a.map=new a.AMap.Map(...args);return a.map}
      a.api=a.create(host,{onSelectCity(){},onOpenEvent(){}},namespace)
      const photos=assets.map((v,i)=>({id:`audit-${index}-${i}`,name:'地点照片',gcj:v.location?.gcj||center,precision:'point',inferred:false,venueName:v.location?.aoi||v.location?.poi||'',preview:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="%23ffc98a"/></svg>'}))
      a.api.update({places:[],bases:[],story:[],selectedCity:null,highlightedEventId:null,photos})
      a.api.focusPhoto(photos[0])
    }, {center:row.region.center,assets,index:row.index})
    await page.waitForFunction(()=>document.getElementById('coverage-audit')?.dataset.sceneState==='ready',null,{timeout:45000})
    await page.waitForTimeout(1400)
    const state=await page.locator('#coverage-audit').evaluate(el=>({...el.dataset}))
    const zoom=await page.evaluate(()=>audit.map.getZoom())
    const name=String(row.index+1).padStart(2,'0')
    await page.screenshot({path:join(output,`${name}.png`)})
    row.state=state; row.zoom=zoom
    row.names=[...new Set(assets.map(a=>a.location?.aoi||a.location?.poi).filter(Boolean))]
    console.log(JSON.stringify({region:row.index+1,buildings:Number(state.sceneBuildings),landmarks:state.sceneLandmarks,zoom}))
  }
  await writeFile(join(output,'audit.json'),JSON.stringify({errors,rows:rows.map(({data,...r})=>({...r,sourceBuildings:data.buildings.length,detailStatus:data.detailStatus,venue:data.venue?.name}))},null,2))
  if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`)
} finally { await browser.close() }

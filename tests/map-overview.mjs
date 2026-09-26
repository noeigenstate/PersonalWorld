import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.loadEnvFile(new URL('../.env', import.meta.url))
const browser = await chromium.launch({ channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.route('**/_AMapService/**', async route => {
    const url = new URL(route.request().url())
    const targets = [['/_AMapService/v4/map/styles','https://webapi.amap.com/v4/map/styles'],['/_AMapService/v3/vectormap','https://fmap01.amap.com/v3/vectormap'],['/_AMapService/','https://restapi.amap.com/']]
    const [prefix,target] = targets.find(([p])=>url.pathname.startsWith(p));url.searchParams.set('jscode',process.env.AMAP_JS_SECURITY_CODE)
    const response=await fetch(`${target}${url.pathname.slice(prefix.length)}?${url.searchParams}`)
    await route.fulfill({status:response.status,contentType:response.headers.get('content-type')||undefined,body:Buffer.from(await response.arrayBuffer())})
  })
  await page.goto(process.env.BASE_URL || 'http://localhost:5183/')
  await page.evaluate(async key => {
    const host = document.createElement('div');host.id='overview-preview';host.style.cssText='position:fixed;inset:0;z-index:99999;background:#e6eddf';document.body.append(host)
    const {loadAmap}=await import('/src/map/amap.ts'),{createAmapLifeMap}=await import('/src/map/amapScene.ts')
    const AMap=await loadAmap(key), namespace=Object.create(AMap);let map
    namespace.Map=function(...args){map=new AMap.Map(...args);return map}
    const api=createAmapLifeMap(host,{onSelectCity(city){window.clickedCity=city},onOpenEvent(){}},namespace)
    const places=[['杭州市',120.15,30.28,12],['湛江市',110.36,21.27,5],['武汉市',114.3,30.59,4]].map(([city,lng,lat,count])=>({city,lng,lat,eventIds:Array.from({length:count},(_,i)=>`${city}-${i}`),firstAt:'2026-01-01',lastAt:'2026-06-20',isBase:false,role:'travel',roleConfirmed:false}))
    api.update({places,bases:[],story:[],selectedCity:null,highlightedEventId:null,photos:[]})
    const heading=document.createElement('div');heading.className='map-heading';heading.innerHTML='<span class="section-kicker">把走过的地方，装进回忆</span><h1>我的人生地图<b>.</b></h1><p>城市总览 · 公开坐标测试</p>';host.append(heading)
    window.overview={api,map,places}
  }, process.env.AMAP_JS_KEY)
  await page.waitForTimeout(3500)
  await page.evaluate(()=>{overview.map.setPitch(0,true);overview.map.setZoomAndCenter(4.7,[105,34],true)})
  await page.waitForTimeout(1800)
  const labels=page.locator('#overview-preview .map-label.place')
  assert.equal(await labels.count(),3);assert.equal(await labels.locator('svg.city-stamp').count(),3)
  assert.equal(await page.locator('#overview-preview').getAttribute('data-story-lines-visible'),'false')
  await page.screenshot({path:join(tmpdir(),'pw-map-overview-cartoon.png')})
  await labels.filter({hasText:'杭州'}).click();assert.equal(await page.evaluate(()=>window.clickedCity),'杭州市')
  await labels.filter({hasText:'湛江'}).focus();await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>window.clickedCity),'湛江市')
  await page.setViewportSize({width:390,height:844})
  await page.evaluate(()=>{overview.map.setPitch(0,true);overview.map.setZoomAndCenter(4.7,[115,28.5],true)})
  await page.waitForTimeout(2200)
  await page.screenshot({path:join(tmpdir(),'pw-map-overview-mobile.png')})
  await labels.filter({hasText:'杭州'}).click();assert.equal(await page.evaluate(()=>window.clickedCity),'杭州市')
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({desktop:join(tmpdir(),'pw-map-overview-cartoon.png'),mobile:join(tmpdir(),'pw-map-overview-mobile.png'),errors}))
  await page.evaluate(()=>overview.api.dispose())
} finally {await browser.close()}

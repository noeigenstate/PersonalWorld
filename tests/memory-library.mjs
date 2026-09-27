// Isolated illustrated fixtures exercise the real identity store + browser UI.
// No private account, browser profile or user photographs are accessed here.
import assert from 'node:assert/strict'
import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium} from 'playwright'
import {openIdentityStore} from '../server/identityStore.mjs'

const root=mkdtempSync(join(tmpdir(),'pw-memory-library-')),store=openIdentityStore(root)
const assets=Array.from({length:3},(_,i)=>({id:`library-fixture-${i}`,hash:`content-${i}`,kind:'image',name:'测试插画.jpg',capturedAt:`2026-0${i+1}-01T06:00:00Z`,dateSource:'exif',width:720,height:960,location:{aoi:'测试公园',source:'gps'},card:{title:'创作测试素材',scene:'在纸上画画',tags:['绘画'],clues:[],questions:[],createdAt:'v1'}}))
store.sync({assets,events:[]})
for(const asset of assets)store.saveDetection(asset.id,store.needsAnalysis(asset.id,'fixture').key,{fingerprint:'fixture',faces:[{embedding:Array.from({length:128},(_,i)=>i===0?1:0),quality:'good',box:[.2,.2,.5,.5],confidence:.99}]})
const browser=await chromium.launch({channel:'chrome'}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],filmCalls=[]
try{
 page.on('pageerror',e=>errors.push(e.message))
 const state=()=>({...store.snapshot(),capability:{available:true}})
 await page.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname,body=route.request().method()==='POST'?route.request().postDataJSON():{}
   try{
     if(path==='/api/auth/me')return route.fulfill({json:{user:{id:'memory-library-fixture',username:'人物流程测试',privacyAccepted:true}}})
     if(path==='/api/config')return route.fulfill({json:{available:false,mode:'unconfigured',geocode:false}})
     if(path.startsWith('/api/memory-graph/faces/'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#ddd3b3"/><circle cx="64" cy="50" r="25" fill="#8a9f85"/><path d="M24 120Q64 40 104 120" fill="#8a9f85"/></svg>'})
     if(path==='/api/memory-graph')return route.fulfill({json:state()})
     if(path==='/api/memory-graph/sync'){store.sync(body);return route.fulfill({json:state()})}
     if(path.startsWith('/api/memory-graph/')){const op=path.split('/').at(-1);store[op](op==='undo'?body.id:body);return route.fulfill({json:state()})}
     if(path==='/api/memory-films'){
       if(route.request().method()==='GET')return route.fulfill({json:{jobs:[],capability:{available:true}}})
       filmCalls.push(body);return route.fulfill({json:{id:'00000000-0000-4000-8000-000000000001',status:'planning',createdAt:Date.now(),uploaded:[],progress:2}})
     }
     return route.fulfill({status:404,json:{error:'fixture route absent'}})
   }catch(e){return route.fulfill({status:400,json:{error:e.message}})}
 })
 await page.goto(process.env.BASE_URL||'http://localhost:5183/')
 await page.evaluate(async assets=>{
   const {openAccountStorage,saveMemory,saveFilmSettings}=await import('/src/lib/storage.ts');await openAccountStorage('memory-library-fixture')
   const canvas=document.createElement('canvas');canvas.width=720;canvas.height=960;const ctx=canvas.getContext('2d');ctx.fillStyle='#b8d7c3';ctx.fillRect(0,0,720,960);ctx.fillStyle='#334f50';ctx.font='32px sans-serif';ctx.fillText('人物流程测试插画',60,400)
   for(const a of assets)a.preview=canvas.toDataURL('image/jpeg')
   await saveMemory({assets,events:[],placeRoles:{},autoPhotoCards:false});await saveFilmSettings({enabled:false,attempted:[]})
 },assets)
 await page.reload();await page.getByRole('button',{name:'人物与故事',exact:true}).click()
 await page.locator('.person-card').first().click();await page.getByLabel('名字或昵称').fill('团团');await page.getByLabel('与你的关系').fill('女儿')
 await page.getByRole('button',{name:'确认这组是同一人'}).click()
 await page.waitForFunction(()=>document.querySelector('.person-card strong')?.textContent==='团团')
 const person=store.snapshot().people.find(p=>p.confirmed);assert.ok(person)
 await page.getByPlaceholder('例如：我们给她的小名是团团。').fill('小名是团团')
 await page.getByRole('button',{name:'记住这条补充'}).click()
 await page.waitForFunction(()=>document.querySelector('.identity-facts')?.textContent.includes('小名是团团'))
 await page.screenshot({path:join(root,'identity-desktop.png')})
 await page.setViewportSize({width:430,height:900});await page.screenshot({path:join(root,'identity-mobile.png')})
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
 await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'故事章节',exact:true}).click()
 const card=page.locator('.story-chapters article').filter({has:page.getByRole('heading',{name:'团团的时光',exact:true})})
 await card.getByRole('button',{name:'自动剪成短片'}).click()
 await page.waitForFunction(()=>document.querySelector('.film-modal'))
 await page.waitForTimeout(600)
 assert.equal(filmCalls.length,1);const chapter=store.snapshot().graph.chapters.find(c=>c.kind==='person');assert.equal(filmCalls[0].chapterId,chapter.id)
 const enriched=store.enrich(filmCalls[0].sources);assert.equal(enriched.length,3);assert.ok(enriched.every(s=>s.people[0].id===person.id&&s.story.includes('女儿')));assert.ok(enriched.every(s=>!s.embedding))
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({directory:root,confirmedPeople:1,chapterToFilm:true,photos:enriched.length,errors}))
}finally{await browser.close();store.close()}

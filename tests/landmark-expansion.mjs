import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addRegisteredLandmarks } from '../server/mapLandmarks.mjs'

const registry = JSON.parse(readFileSync(new URL('../src/map/landmarkSites.json', import.meta.url), 'utf8'))
const directory = mkdtempSync(join(tmpdir(), 'pw-landmark-expansion-'))
const browser = await chromium.launch({ channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1140 } })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto(process.env.BASE_URL || 'http://localhost:5183/')
  const reports = await page.evaluate(async (registry) => {
    const THREE = await import('/node_modules/.vite/deps/three.js')
    const { createLandmarkVenue, venueLandmark } = await import('/src/map/landmarkVenues.ts')
    document.body.innerHTML = '<main><header><small>PERSONAL WORLD · 地标资产检视</small><h1>记住一座城，也记住它的样子</h1><p>公开地理位置与建筑参考 / 实际 Three.js 渲染</p></header><div id="views"></div></main>'
    const style = document.createElement('style'); style.textContent = 'body{margin:0;background:#f5eedf;font-family:Microsoft YaHei;color:#655343}main{padding:28px}header{margin:0 12px 20px}small{color:#ac885c;font-size:11px;letter-spacing:2px}h1{font-size:26px;margin:9px 0}p{font-size:12px;color:#9b8067}#views{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.view{position:relative;background:#fffbf1;border-radius:18px;overflow:hidden}.view span{position:absolute;top:18px;left:18px;font-size:14px}.view small{position:absolute;left:18px;bottom:16px;font-size:10px;letter-spacing:0}canvas{display:block;width:100%;height:450px}'; document.head.append(style)
    const reports = []
    for(let angle=0;angle<2;angle++) for(const record of registry.buildings) {
      const points=record.rings[0],cx=(Math.min(...points.map(p=>p[0]))+Math.max(...points.map(p=>p[0])))/2,cy=(Math.min(...points.map(p=>p[1]))+Math.max(...points.map(p=>p[1])))/2
      const rings=record.rings.map(r=>r.map(([x,y])=>[(x-cx)*111320*Math.cos(cy*Math.PI/180),(y-cy)*111320]))
      const model=createLandmarkVenue(rings,record.model,Number(record.height))
      const host=document.createElement('div');host.className='view';host.innerHTML=`<span>${record.name}</span><small>${angle?'背面 / 斜俯视':'正面 / 低视角'} · ${record.model}</small>`;document.querySelector('#views').append(host)
      const scene=new THREE.Scene();scene.background=new THREE.Color('#fffbf1');scene.add(model)
      const bounds=new THREE.Box3().setFromObject(model),size=bounds.getSize(new THREE.Vector3()),target=bounds.getCenter(new THREE.Vector3()),extent=Math.max(size.z,size.x*.95,size.y*.95)*1.12
      const camera=new THREE.OrthographicCamera(-extent*.42,extent*.42,extent*.54,-extent*.54,.1,3000);camera.up.set(0,0,1);camera.position.copy(target).add(new THREE.Vector3(angle?-1.1:1,-1.6,angle?1.7:.7).multiplyScalar(extent));camera.lookAt(target)
      const ground=new THREE.Mesh(new THREE.PlaneGeometry(3000,3000),new THREE.MeshStandardMaterial({color:'#e4ddc7',roughness:1}));ground.position.z=-.5;ground.receiveShadow=true;scene.add(ground)
      const sun=new THREE.DirectionalLight('#fff0d8',1.3);sun.position.set(-500,-750,1000);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=sun.shadow.camera.bottom=-350;sun.shadow.camera.right=sun.shadow.camera.top=350;sun.shadow.camera.far=2200;sun.shadow.normalBias=.35;scene.add(sun,new THREE.HemisphereLight('#fff7e9','#c7d8d1',.95))
      const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(350,450);renderer.setPixelRatio(1.5);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;host.append(renderer.domElement);renderer.render(scene,camera)
      let triangles=0,valid=true;model.traverse(o=>{if(o.geometry){const p=o.geometry.attributes.position;triangles+=(o.geometry.index?.count||p.count)/3;for(const v of p.array)if(!Number.isFinite(v))valid=false}})
      reports.push({id:record.id,kind:record.model,registered:venueLandmark(record.id)===record.model,height:size.z,triangles,calls:renderer.info.render.calls,valid})
    }
    return reports
  }, registry)
  await page.screenshot({ path: join(directory, 'landmarks-three-places.png') })
  for (const r of reports) {assert.equal(r.valid,true);assert.equal(r.registered,true);assert.ok(r.height>20);assert.ok(r.calls<35)}
  const foreign={bbox:[100,25,100.01,25.01],buildings:[],venues:[]};addRegisteredLandmarks(foreign,[100,25]);assert.equal(foreign.buildings.length,0)
  const coast={bbox:[109.91,20.21,109.93,20.24],buildings:[],venues:[]};addRegisteredLandmarks(coast,[109.92,20.224]);assert.equal(coast.buildings[0].model,'jiaowei-lighthouse')
  const tower=registry.buildings.find(b=>b.model==='chengbei-tower')
  // Quantized tile vertices can all fall just outside a source outline; the
  // interior still overlaps almost completely. A broad podium must survive.
  const duplicate={id:'quantized-tile',rings:tower.rings.map(r=>r.map(([x,y])=>[x+.000001,y-.000001]))}
  const [x,y]=tower.rings[0][0]
  const podium={id:'broad-podium',rings:[[[x-.002,y-.002],[x+.002,y-.002],[x+.002,y+.002],[x-.002,y+.002],[x-.002,y-.002]]]}
  const complex={bbox:[120.10,30.35,120.12,30.36],buildings:[duplicate,podium],venues:[]}
  addRegisteredLandmarks(complex,[120.1083,30.3543])
  assert.ok(!complex.buildings.some(b=>b.id===duplicate.id));assert.ok(complex.buildings.some(b=>b.id===podium.id))
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({directory,reports,errors}))
} finally {await browser.close()}

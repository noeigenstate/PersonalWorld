// Public OSM footprints, local metre coordinates; no photo-library dependency.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

const directory = mkdtempSync(join(tmpdir(), 'pw-venue-models-'))
const rings = [
  [[31,-45],[40,-33],[47,-19],[49,-5],[48,7],[47,20],[39,36],[28,47],[16,54],[2,58],[-20,58],[-35,50],[-47,38],[-52,21],[-56,4],[-55,-12],[-51,-28],[-41,-41],[-26,-54],[-8,-57],[12,-53],[31,-45]],
  [[62,26],[73,7],[74,-14],[68,-31],[52,-46],[31,-56],[7,-61],[-12,-61],[-44,-52],[-64,-38],[-75,-21],[-79,-1],[-76,19],[-67,37],[-53,51],[-30,58],[3,59],[23,54],[44,43],[62,26]],
]
const browser = await chromium.launch({ channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } })
  const errors = []; page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(process.env.BASE_URL || 'http://localhost:5183/')
  const reports = await page.evaluate(async (rings) => {
    const THREE = await import('/node_modules/.vite/deps/three.js')
    const { createLandmarkVenue, venueLandmark } = await import('/src/map/landmarkVenues.ts')
    document.body.innerHTML = '<main id="gallery"><header><small>PERSONAL WORLD / 实际 THREE.JS 渲染</small><h1>把地标的性格，留在回忆里</h1><p>拱墅运河体育公园 · 依据公开建筑资料精修的卡通模型</p></header><div id="views"></div><footer>地面轮廓：OpenStreetMap contributors · 建筑参照：Archi-Tectonics · 色彩、高度与局部细节为艺术近似</footer></main>'
    const style = document.createElement('style'); style.textContent = 'body{margin:0;background:#f7f0e2;font-family:Microsoft YaHei,sans-serif;color:#62513c}#gallery{padding:32px}header{padding:6px 20px 18px}small{font-size:11px;letter-spacing:2px;color:#a6855e}h1{font-size:30px;margin:8px 0}p{font-size:13px;color:#9b8468}#views{display:grid;grid-template-columns:1fr 1fr;gap:16px}.view{background:#fffbf0;border-radius:20px;overflow:hidden;position:relative}.label{position:absolute;top:18px;left:23px;font-size:18px;z-index:1}.caption{position:absolute;left:23px;bottom:16px;font-size:11px;color:#9b8468}canvas{width:100%;height:365px;display:block}footer{font-size:10px;color:#a68d70;padding:18px 20px}';document.head.append(style)
    const reports = []
    for (let index = 0; index < 4; index++) {
      const type = index % 2, id = type ? 'gongshu-jade' : 'gongshu-umbrella'
      const host = document.createElement('div'); host.className = 'view'
      host.innerHTML = `<div class="label">${type ? '玉琮馆' : '杭州伞'}</div><div class="caption">${type ? '斜切椭圆 · 金色叠鳞 · 菱形玻璃 · 环形天窗' : '开放翼形屋盖 · 环梁与伞骨 · 阶梯看台'} / ${index < 2 ? '俯瞰' : '近景'}</div>`
      document.querySelector('#views').append(host)
      const scene = new THREE.Scene(); scene.background = new THREE.Color('#fffbf0')
      const model = createLandmarkVenue([rings[type]], id); scene.add(model)
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1000,1000), new THREE.MeshStandardMaterial({color:'#eee6cf',roughness:1})); plane.position.z=-.5; plane.receiveShadow=true; scene.add(plane)
      const camera = new THREE.OrthographicCamera(-114,114,63,-63,.1,1500); camera.up.set(0,0,1)
      camera.position.set(type ? -160 : 230, -185, index < 2 ? 230 : 90);camera.lookAt(0,0,13)
      const light = new THREE.DirectionalLight('#fff0d1', 3);light.position.set(-100,-170,300);light.castShadow=true;light.shadow.mapSize.set(2048,2048);light.shadow.camera.left=-160;light.shadow.camera.right=160;light.shadow.camera.top=160;light.shadow.camera.bottom=-160;light.shadow.normalBias=.2;scene.add(light)
      scene.add(new THREE.HemisphereLight('#e4f3ff','#c5b489',2.0));scene.add(new THREE.AmbientLight('#ffefd2',.4))
      const renderer = new THREE.WebGLRenderer({antialias:true});renderer.setSize(680,365);renderer.setPixelRatio(1.5);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.0;host.append(renderer.domElement);renderer.render(scene,camera)
      let triangles=0, valid=true;model.traverse((o)=>{if(o.geometry){const p=o.geometry.attributes.position;triangles+=(o.geometry.index?.count||p.count)/3;for(const v of p.array)if(!Number.isFinite(v))valid=false}})
      reports.push({id,valid,triangles,calls:renderer.info.render.calls,bounds:new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).toArray(),registered:venueLandmark(`osm:way:${type ? '1084641019' : '1084641014'}:0:0`)===id})
    }
    return reports
  }, rings)
  await page.screenshot({ path: join(directory, 'gongshu-landmarks.png') })
  console.log(JSON.stringify({ directory, reports, errors }))
  for (const result of reports) { assert.ok(result.valid); assert.ok(result.registered); assert.ok(result.calls < 25); assert.ok(result.bounds[2] > 25) }
  assert.deepEqual(errors, [])
} finally { await browser.close() }

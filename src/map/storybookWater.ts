import * as THREE from 'three'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'

type Point = [number, number]

// Distance to mapped land, not bathymetry. The edge of the requested map window
// is deliberately not treated as shore: otherwise every coast gets a foam box.
function shoreDistance(polygons: Point[][][], bounds: THREE.Box2, reach: number) {
  const resolution = window.innerWidth < 700 ? 256 : 512
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = resolution
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const size = bounds.getSize(new THREE.Vector2())
  ctx.fillStyle = '#fff'
  for (const rings of polygons) {
    ctx.beginPath()
    for (const ring of rings) {
      ring.forEach(([x, y], index) => {
        const px = (x - bounds.min.x) / size.x * resolution, py = (y - bounds.min.y) / size.y * resolution
        if (index) ctx.lineTo(px, py); else ctx.moveTo(px, py)
      })
      ctx.closePath()
    }
    ctx.fill('evenodd')
  }
  const mask = ctx.getImageData(0, 0, resolution, resolution).data
  const dist = new Float32Array(resolution * resolution)
  for (let i = 0; i < dist.length; i++) dist[i] = mask[i * 4 + 3] > 127 ? reach : 0
  const dx = size.x / resolution, dy = size.y / resolution, diagonal = Math.hypot(dx, dy)
  for (let y = 0; y < resolution; y++) for (let x = 0; x < resolution; x++) {
    const i = y * resolution + x
    if (x) dist[i] = Math.min(dist[i], dist[i - 1] + dx)
    if (y) {
      dist[i] = Math.min(dist[i], dist[i - resolution] + dy)
      if (x) dist[i] = Math.min(dist[i], dist[i - resolution - 1] + diagonal)
      if (x + 1 < resolution) dist[i] = Math.min(dist[i], dist[i - resolution + 1] + diagonal)
    }
  }
  for (let y = resolution - 1; y >= 0; y--) for (let x = resolution - 1; x >= 0; x--) {
    const i = y * resolution + x
    if (x + 1 < resolution) dist[i] = Math.min(dist[i], dist[i + 1] + dx)
    if (y + 1 < resolution) {
      dist[i] = Math.min(dist[i], dist[i + resolution] + dy)
      if (x) dist[i] = Math.min(dist[i], dist[i + resolution - 1] + diagonal)
      if (x + 1 < resolution) dist[i] = Math.min(dist[i], dist[i + resolution + 1] + diagonal)
    }
  }
  const pixels = new Uint8Array(dist.length)
  for (let i = 0; i < dist.length; i++) pixels[i] = Math.round(Math.min(1, dist[i] / reach) * 255)
  const texture = new THREE.DataTexture(pixels, resolution, resolution, THREE.RedFormat)
  texture.minFilter = texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

export function createStorybookWater(geometry: THREE.BufferGeometry, polygons: Point[][][], corners: Point[], coast: boolean) {
  const bounds = new THREE.Box2().setFromPoints(corners.map(p => new THREE.Vector2(...p)))
  const size = bounds.getSize(new THREE.Vector2()), reach = coast ? 105 : 32
  const distance = shoreDistance(polygons, bounds, reach)
  const reflectionSize = window.innerWidth < 700 ? 384 : 768
  const river = new Reflector(geometry, {
    color: '#70c6d4', textureWidth: reflectionSize, textureHeight: reflectionSize, multisample: 0, clipBias: .002,
    shader: {
      name: 'StorybookWater',
      uniforms: {
        color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, shore: { value: null },
        mapBounds: { value: new THREE.Vector4(bounds.min.x, bounds.min.y, size.x, size.y) },
        reach: { value: reach }, time: { value: 0 }, coast: { value: coast ? 1 : 0 },
        shallow: { value: new THREE.Color(coast ? '#b8ecdb' : '#ade0ca') },
        deep: { value: new THREE.Color(coast ? '#4db9d1' : '#75c6c8') },
        foam: { value: new THREE.Color('#f4fff1') },
      },
      vertexShader: `uniform mat4 textureMatrix;
        varying vec4 vMirror; varying vec2 vMap; varying vec3 vView; varying vec3 vNormal;
        void main(){vMap=position.xy; vMirror=textureMatrix*vec4(position,1.);
          vec4 p=modelViewMatrix*vec4(position,1.);vView=-p.xyz;vNormal=normalize(normalMatrix*normal);gl_Position=projectionMatrix*p;}`,
      fragmentShader: `uniform sampler2D tDiffuse, shore;
        uniform vec4 mapBounds;uniform float time,reach,coast;uniform vec3 shallow,deep,foam;
        varying vec4 vMirror;varying vec2 vMap;varying vec3 vView;varying vec3 vNormal;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        void main(){
          vec2 p=vMap-mapBounds.xy;
          float distance=texture2D(shore,p/mapBounds.zw).r*reach;
          float broad=sin(p.x*.018+sin(p.y*.013+time*.20)*1.7+time*.28)*.5+.5;
          float swell=sin(p.y*.033+sin(p.x*.021-time*.12)*1.4+time*.34)*.5+.5;
          float depth=smoothstep(0.,reach*.88,distance);
          vec3 water=mix(shallow,deep,depth*.82);
          water=mix(water,shallow,.16*smoothstep(.52,.88,broad)*swell);
          // Broad, soft shapes give the water a rounded illustrated volume.
          float band=smoothstep(.72,.93,swell)*(1.-smoothstep(.94,1.,swell));
          water+=vec3(.065,.085,.085)*band*(.35+.65*coast);
          vec4 uv=vMirror;float ripple=sin(p.x*.078+sin(p.y*.055)*1.3+time*.65)*.0018;
          uv.xy+=vec2(ripple,ripple*.45)*uv.w;
          vec4 reflected=texture2DProj(tDiffuse,uv);
          // Shallow viewing angles hold more reflection. Smooth analytic light
          // patches add soft highlights without tiled normal-map assets.
          float fresnel=pow(1.-clamp(abs(dot(normalize(vView),normalize(vNormal))),0.,1.),3.);
          float reflectivity=(mix(.17,.29,coast)+.17*fresnel)*smoothstep(1.,14.,distance);
          water=mix(water,reflected.rgb,reflected.a*reflectivity);
          float sunPatch=pow(max(0.,sin(p.x*.027+time*.23)*.5+sin(p.y*.042-time*.31)*.5),12.);
          water=mix(water,foam,sunPatch*(.10+.10*coast)*smoothstep(5.,20.,distance));
          float edge=1.-smoothstep(1.,coast>0.5?5.5:2.3,distance);
          float tide=sin(distance*.50-time*.62+sin(p.x*.037+p.y*.024)*.65)*.5+.5;
          float shoreWave=smoothstep(.86,.99,tide)*(1.-smoothstep(9.,coast>0.5?27.:10.,distance));
          water=mix(water,foam,edge*.75+shoreWave*.42*coast);
          vec2 cell=floor(p/vec2(23.,17.)),local=fract(p/vec2(23.,17.));
          float glint=step(.87,hash(cell))*(1.-smoothstep(.018,.075,abs(local.y-.5)));
          glint*=smoothstep(.15,.32,local.x)*(1.-smoothstep(.63,.84,local.x));
          glint*=.45+.35*sin(time*.8+hash(cell)*6.28);
          water=mix(water,foam,glint*.60*smoothstep(8.,20.,distance));
          gl_FragColor=vec4(water,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    },
  })
  river.name = coast ? 'storybook-sea' : 'storybook-river'
  const material = river.material as THREE.ShaderMaterial
  material.uniforms.shore.value = distance
  const reflect = river.onBeforeRender.bind(river)
  const lastCamera = new THREE.Matrix4()
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let reflectedAt = -Infinity
  river.onBeforeRender = (renderer, scene, camera, ...args) => {
    const now = performance.now()
    material.uniforms.time.value = reduceMotion ? 0 : now / 1000
    // Static view: reuse reflection for 150 ms while the water shader animates.
    // A camera move gets a fresh reflection immediately.
    if (now - reflectedAt >= 150 || !lastCamera.equals(camera.matrixWorld)) {
      reflectedAt = now; lastCamera.copy(camera.matrixWorld); reflect(renderer, scene, camera, ...args)
    }
  }
  const dispose = river.dispose.bind(river)
  river.dispose = () => { distance.dispose(); dispose() }
  return river
}

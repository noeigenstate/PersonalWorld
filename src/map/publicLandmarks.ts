import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

type Point = [number, number]
export type PublicLandmark = 'jiaowei-lighthouse' | 'chengbei-tower' | 'chengbei-mall' | 'zhejiang-global'
const finish = (color: string, roughness = .62) => new THREE.MeshStandardMaterial({ color, roughness, metalness: .08, emissive: color, emissiveIntensity: .085 })
const cream = () => finish('#fff0d7'), glass = () => finish('#8fb9bd', .32)
function add(group: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material, name: string) {
  const mesh = new THREE.Mesh(geometry, material); mesh.name = name; mesh.castShadow = mesh.receiveShadow = true; group.add(mesh); return mesh
}
function merge(group: THREE.Group, parts: THREE.BufferGeometry[], mat: THREE.Material, name: string) {
  if (!parts.length) { mat.dispose(); return }
  add(group, mergeGeometries(parts), mat, name); parts.forEach(p => p.dispose())
}
function block(x: number, y: number, z: number, w: number, d: number, h: number, radius = .5) {
  const g = new RoundedBoxGeometry(w, d, h, 2, Math.min(radius, w / 4, d / 4, h / 4)); g.translate(x, y, z + h / 2); return g
}
function cylinder(r1: number, r2: number, h: number, z: number, sides = 6) {
  const g = new THREE.CylinderGeometry(r1, r2, h, sides); g.rotateX(Math.PI / 2); g.rotateZ(Math.PI / 6); g.translate(0, 0, z + h / 2); return g
}
function rod(a: THREE.Vector3, b: THREE.Vector3, radius: number) {
  const g = new THREE.CylinderGeometry(radius, radius, a.distanceTo(b), 6)
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()))
  g.translate(...a.clone().add(b).multiplyScalar(.5).toArray()); return g
}
function extrude(rings: Point[][], z: number, h: number, bevel = .45) {
  const s = new THREE.Shape(rings[0].map(p => new THREE.Vector2(...p)))
  for (const hole of rings.slice(1)) s.holes.push(new THREE.Path(hole.map(p => new THREE.Vector2(...p))))
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, steps: 1 })
  g.translate(0, 0, z); return g
}
function face(points: THREE.Vector3[]) {
  const g = new THREE.BufferGeometry(); g.setFromPoints(points); g.setIndex(points.length === 3 ? [0, 1, 2] : [0, 1, 2, 0, 2, 3]); g.computeVertexNormals(); return g
}
function textPanel(text: string, width: number, height: number, vertical = false) {
  const canvas = document.createElement('canvas'); canvas.width = vertical ? 128 : 768; canvas.height = vertical ? 1024 : 192
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#f8efda'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#478d99'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `bold ${vertical ? 83 : 100}px Microsoft YaHei`
  if (vertical) [...text].forEach((letter, i) => ctx.fillText(letter, 64, (i + .5) * 1024 / text.length))
  else ctx.fillText(text, 384, 96, 710)
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }))
}

export function createPublicLandmark(rings: Point[][], kind: PublicLandmark, height: number) {
  const bounds = new THREE.Box2().setFromPoints(rings[0].map(p => new THREE.Vector2(...p))), center = bounds.getCenter(new THREE.Vector2()), size = bounds.getSize(new THREE.Vector2())
  const local = rings.map(ring => ring.map(([x, y]): Point => [x - center.x, y - center.y]))
  const group = new THREE.Group(); group.position.set(center.x, center.y, 0); group.name = `landmark-${kind}`
  const w = size.x, d = size.y, h = height
  if (kind === 'jiaowei-lighthouse') {
    const r = Math.min(w, d) * .48
    add(group, cylinder(r * 1.20, r * 1.30, 1.1, .1), cream(), 'hexagonal-footing')
    add(group, cylinder(r * .69, r, h * .80, 1.2), cream(), 'tapered-six-sided-shaft')
    const bands: THREE.BufferGeometry[] = [], rails: THREE.BufferGeometry[] = [], windows: THREE.BufferGeometry[] = []
    for (let level = 1; level <= 8; level++) {
      const z = level * h * .084 + 1.2, radius = r * (1 - level * .028)
      bands.push(cylinder(radius * 1.005, radius * 1.025, h * .016, z))
      for (let i = 0; i < 6; i++) {
        const angle = i / 6 * Math.PI * 2
        const panel = new THREE.BoxGeometry(.74, .12, 1.03); panel.rotateZ(angle); panel.translate(Math.sin(angle) * radius * .88, -Math.cos(angle) * radius * .88, z + 1.5); windows.push(panel)
      }
    }
    merge(group, bands, finish('#67b8c2'), 'sea-blue-floor-bands')
    merge(group, windows, glass(), 'shaft-recessed-windows')
    add(group, cylinder(r * 1.12, r * .75, 1.15, h * .81), cream(), 'lantern-balcony')
    add(group, cylinder(r * .78, r * .78, 3.7, h * .81 + 1.15), glass(), 'lantern-glazing')
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2, b = (i + 1) / 12 * Math.PI * 2, z = h * .81 + 1.2
      rails.push(rod(new THREE.Vector3(Math.cos(a) * r * 1.05, Math.sin(a) * r * 1.05, z), new THREE.Vector3(Math.cos(a) * r * 1.05, Math.sin(a) * r * 1.05, z + 1.25), .085))
      rails.push(rod(new THREE.Vector3(Math.cos(a) * r * 1.05, Math.sin(a) * r * 1.05, z + 1.25), new THREE.Vector3(Math.cos(b) * r * 1.05, Math.sin(b) * r * 1.05, z + 1.25), .09))
    }
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; rails.push(rod(new THREE.Vector3(Math.cos(a) * r * .78, Math.sin(a) * r * .78, h * .81 + 1.1), new THREE.Vector3(Math.cos(a) * r * .78, Math.sin(a) * r * .78, h * .81 + 4.9), .13)) }
    merge(group, rails, cream(), 'balcony-rails-and-lantern-posts')
    add(group, cylinder(.20, r, 2.2, h * .81 + 4.85), finish('#78a9ae'), 'six-sided-cap')
    add(group, cylinder(.08, .11, 1.7, h * .81 + 7.0), cream(), 'lightning-finial')
    const plaque = textPanel('中国大陆最南端', r * .56, h * .53, true); plaque.rotation.x = Math.PI / 2; plaque.position.set(0, -r * .82, h * .44); group.add(plaque)
  } else if (kind === 'chengbei-tower') {
    // Staggered crowns and warm vertical ribs are the architect's mountain motif.
    const parts: THREE.BufferGeometry[] = [], frames: THREE.BufferGeometry[] = [], floors: THREE.BufferGeometry[] = []
    for (const [x, span, top] of [[-.32, .32, .93], [0, .36, 1], [.32, .32, .965]]) parts.push(block(x * w, 0, .5, w * span, d * .94, h * top, 1.1))
    merge(group, parts, glass(), 'three-stepped-glass-volumes')
    for (const side of [-1, 1]) {
      for (let x = -w * .47; x <= w * .47; x += w / 16) {
        const top = x < -w * .18 ? .93 : x > w * .18 ? .965 : 1
        frames.push(block(x, side * d * .478, 3, .46, .72, h * top - 3, .12))
      }
      for (let y = -d * .43; y <= d * .43; y += d / 14) frames.push(block(side * w * .485, y, 3, .72, .36, h * (side < 0 ? .93 : .965) - 3, .12))
    }
    for (let z = 8; z < h * .90; z += 4.3) {
      floors.push(block(0, -d * .48, z, w * .96, .16, .26, .05)); floors.push(block(0, d * .48, z, w * .96, .16, .26, .05))
      floors.push(block(-w * .49, 0, z, .16, d * .95, .26, .05)); floors.push(block(w * .49, 0, z, .16, d * .95, .26, .05))
    }
    for (const [x, width, z] of [[-.32, .32, .93], [0, .36, 1], [.32, .32, .965]]) {
      frames.push(block(x * w, 0, h * z - 1.4, width * w, d * .96, 1.4, .35))
      for (let i = 0; i <= 4; i++) frames.push(block((x - width / 2 + i * width / 4) * w, -d * .48, h * z - 12, .55, .75, 12, .14))
    }
    for (const z of [.31, .57, .74]) { frames.push(block(0, -d * .482, h * z, w * .35, .8, 1.1)); frames.push(block(0, d * .482, h * z, w * .35, .8, 1.1)) }
    merge(group, floors, finish('#719da5'), 'floor-rhythm')
    merge(group, frames, cream(), 'vertical-ribs-and-tiered-crown')
    add(group, block(0, 0, .15, w * 1.02, d * 1.02, 5.2, .8), finish('#e6c8a6'), 'warm-ground-floor')
  } else if (kind === 'chengbei-mall') {
    add(group, extrude(local, .3, h - 1.5, .8), finish('#e8cfae'), 'geographic-retail-podium')
    const ledges: THREE.BufferGeometry[] = [], panes: THREE.BufferGeometry[] = [], fins: THREE.BufferGeometry[] = []
    const ring = local[0]
    const winding = Math.sign(ring.slice(1).reduce((sum, b, i) => sum + ring[i][0] * b[1] - b[0] * ring[i][1], 0)) || 1
    for (let i = 1; i < ring.length; i++) {
      const a = new THREE.Vector2(...ring[i-1]), b = new THREE.Vector2(...ring[i]), edge = b.clone().sub(a), length = edge.length(), middle = a.clone().add(b).multiplyScalar(.5), angle = Math.atan2(edge.y, edge.x)
      // The beveled podium expands beyond the source outline. Put facade parts
      // outside that bevel, otherwise the shopfronts disappear inside the wall.
      const place = (geometry: THREE.BufferGeometry) => { geometry.translate(0, -winding * 1.02, 0); geometry.rotateZ(angle); geometry.translate(middle.x, middle.y, 0); return geometry }
      for (const z of [5.5, 13, 21, h - .5]) ledges.push(place(block(0, 0, z, length + .3, 1.2, 1.05)))
      panes.push(place(block(0, 0, 1.5, length * .93, .35, 4, .1)))
      if (length > 20) for (let x = -length * .45; x < length * .45; x += 4.5) fins.push(place(block(x, 0, 7, .28, .65, h - 8, .05)))
    }
    merge(group, panes, glass(), 'continuous-shopfronts'); merge(group, ledges, cream(), 'layered-stone-terraces'); merge(group, fins, finish('#f9e3c2'), 'fine-facade-fins')
    const inRing = (x: number, y: number) => { let hit = false; for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit}return hit }
    const skylights: THREE.BufferGeometry[] = [], caps: THREE.BufferGeometry[] = []
    for (let y = -d * .36; y <= d * .36; y += 33) for (let x = -w * .32; x <= w * .32; x += 38) {
      if (![[x-12,y-7],[x+12,y-7],[x+12,y+7],[x-12,y+7]].every(([px,py])=>inRing(px,py))) continue
      caps.push(block(x, y, h, 25, 15, 1.2, 2)); skylights.push(block(x, y, h + 1.2, 22, 12, 2.1, 3))
    }
    merge(group, caps, cream(), 'skylight-stone-rims'); merge(group, skylights, glass(), 'roof-glass-lanterns')
    const name = textPanel('万象城', 24, 6); name.rotation.x = Math.PI / 2; name.position.set(-w * .15, -d * .489, h * .70); group.add(name)
  } else {
    // The cultural-square landmark is a tapered shaft carrying four long,
    // faceted lantern petals. The source ground outline determines its orientation.
    const outline = local[0].slice(0, -1), n = outline.length, levels = [[.02,.97],[.12,.92],[.49,.65],[.75,.58],[.91,.65],[.94,.66]]
    const positions: number[] = [], indices: number[] = []
    for (const [z, s] of levels) for (const [x,y] of outline) positions.push(x*s,y*s,z*h)
    for(let k=1;k<levels.length;k++)for(let i=0;i<n;i++){const a=(k-1)*n+i,b=(k-1)*n+(i+1)%n,c=k*n+(i+1)%n,e=k*n+i;indices.push(a,b,c,a,c,e)}
    const shell = new THREE.BufferGeometry(); shell.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));shell.setIndex(indices);shell.computeVertexNormals()
    const shellMat=glass();shellMat.side=THREE.DoubleSide;add(group,shell,shellMat,'tapered-cultural-tower')
    const ribs: THREE.BufferGeometry[] = [], belts: THREE.BufferGeometry[] = [], petals: THREE.BufferGeometry[] = []
    for(let i=0;i<n;i+=2)for(let k=1;k<levels.length;k++){const a=levels[k-1],b=levels[k],p=outline[i];ribs.push(rod(new THREE.Vector3(p[0]*a[1],p[1]*a[1],a[0]*h),new THREE.Vector3(p[0]*b[1],p[1]*b[1],b[0]*h),.26))}
    for(let z=.15;z<.90;z+=.021){let k=1;while(k<levels.length-1&&levels[k][0]<z)k++;const a=levels[k-1],b=levels[k],s=THREE.MathUtils.lerp(a[1],b[1],(z-a[0])/(b[0]-a[0]));for(let i=0;i<n;i++){const p=outline[i],q=outline[(i+1)%n];belts.push(rod(new THREE.Vector3(p[0]*s,p[1]*s,z*h),new THREE.Vector3(q[0]*s,q[1]*s,z*h),.11))}}
    for(let i=0;i<4;i++){
      const a=i*Math.PI/2, radial=new THREE.Vector3(Math.cos(a),Math.sin(a),0), tangent=new THREE.Vector3(-Math.sin(a),Math.cos(a),0), radius=(i%2?d:w)*.46, width=(i%2?w:d)*.52
      const tip=radial.clone().multiplyScalar(radius*.90).setZ(h*.54), left=radial.clone().multiplyScalar(radius).addScaledVector(tangent,-width/2).setZ(h*.945), right=radial.clone().multiplyScalar(radius).addScaledVector(tangent,width/2).setZ(h*.945), ridge=radial.clone().multiplyScalar(radius*1.12).setZ(h*.925)
      petals.push(face([tip,left,ridge]),face([tip,ridge,right]));ribs.push(rod(tip,left,.43),rod(tip,right,.43),rod(tip,ridge,.32),rod(left,ridge,.35),rod(ridge,right,.35))
      for(let j=1;j<13;j++){const t=j/13,l=tip.clone().lerp(left,t),r=tip.clone().lerp(right,t);ribs.push(rod(l,r,.16))}
    }
    const petalMat=finish('#c2d7d7',.36);petalMat.side=THREE.DoubleSide;merge(group,petals,petalMat,'four-faceted-lantern-petals');merge(group,belts,finish('#73a1aa'),'subtle-floor-lines');merge(group,ribs,cream(),'lantern-ribs-and-shaft-mullions')
    add(group,extrude(local.map(r=>r.map(([x,y]):Point=>[x*.86,y*.86])),h*.94,1.4,.3),finish('#b6c8c3'),'crown-roof')
    add(group,cylinder(1.5,2.2,4,h*.945,8),cream(),'spire-base');add(group,cylinder(.07,.52,h*.032,h*.97,8),finish('#b4c8c8'),'spire')
    const feet:THREE.BufferGeometry[]=[];for(const side of[-1,1])for(const x of[-.33,0,.33])feet.push(block(x*w,side*d*.38,0,2.6,3.4,h*.10,.35));merge(group,feet,cream(),'ground-colonnade')
  }
  return group
}

import * as THREE from 'three'

// The street scene is drawn on a flat Web Mercator plane (AMap's camera), but the Earth is a ball.
// Every vertex is lowered by d²/2R away from the view centre (scene units are Mercator metres,
// z up), so the ground curves away and the horizon bends like a planet's instead of ending in a
// straight line. Negligible at street zoom, unmistakable at city scale — the globe never
// "becomes a plane" when the street map takes over.

const EARTH_RADIUS = 6371000
const DEG = Math.PI / 180

// Shared by every curved material; updated once per frame from the map centre
export const planetCurve = { uCurve: { value: 0 }, uCurveCenter: { value: new THREE.Vector2() } }

// The true curve is invisible below a few hundred kilometres, which is exactly where the street
// map takes over from the globe. So the planet is drawn smaller the further out one is: six times
// the true curvature at the hand-over (zoom 8), easing to the true value by zoom 13, where streets
// are flat as they should be.
export function curveExaggeration(zoom: number) {
  const t = Math.min(1, Math.max(0, (13 - zoom) / 5))
  return Math.exp(Math.log(6) * t * t * (3 - 2 * t))
}

// Mercator metres at latitude φ are 1/cos φ real metres, so the radius in scene units is R/cos φ
export function setPlanetCurve(centerX: number, centerY: number, latitude: number, zoom: number) {
  planetCurve.uCurveCenter.value.set(centerX, centerY)
  planetCurve.uCurve.value = Math.cos(latitude * DEG) * curveExaggeration(zoom) / (2 * EARTH_RADIUS)
}

// How far a point of the plane sinks; DOM anchors (labels, photos) use it to stay on the ground
export function planetDrop(x: number, y: number) {
  const dx = x - planetCurve.uCurveCenter.value.x, dy = y - planetCurve.uCurveCenter.value.y
  return -(dx * dx + dy * dy) * planetCurve.uCurve.value
}

// For materials with their own vertex shader: declare, then `planetCurved(modelMatrix * vec4(position, 1.))`
export const PLANET_CURVE_GLSL = `uniform float uCurve; uniform vec2 uCurveCenter;
vec4 planetCurved(vec4 worldPos) { vec2 d = worldPos.xy - uCurveCenter; worldPos.z -= dot(d, d) * uCurve; return worldPos; }`

// three's built-in materials: replace the projection step so instancing and the model matrix are
// applied first, then the drop in world space. Fat lines (LineMaterial) place both segment ends
// in view space themselves; those two lines get the same drop.
function curveProgram(shader: { uniforms: Record<string, THREE.IUniform>; vertexShader: string }) {
  Object.assign(shader.uniforms, planetCurve)
  if (shader.vertexShader.includes('instanceStart')) {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${PLANET_CURVE_GLSL}`)
      .replace('vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );', 'vec4 start = viewMatrix * planetCurved( modelMatrix * vec4( instanceStart, 1.0 ) );')
      .replace('vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );', 'vec4 end = viewMatrix * planetCurved( modelMatrix * vec4( instanceEnd, 1.0 ) );')
    return
  }
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${PLANET_CURVE_GLSL}`)
    .replace('#include <project_vertex>', `vec4 planetWorld = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
planetWorld = instanceMatrix * planetWorld;
#endif
planetWorld = planetCurved(modelMatrix * planetWorld);
vec4 mvPosition = viewMatrix * planetWorld;
gl_Position = projectionMatrix * mvPosition;`)
}

let installed = false
// Every material flagged with `userData.planetCurve` is compiled with the displacement. Installed
// once on the prototype, so the hundreds of materials the street scene creates need no code of their own.
export function installPlanetCurve() {
  if (installed) return
  installed = true
  const proto = THREE.Material.prototype as unknown as { onBeforeCompile: (shader: Parameters<typeof curveProgram>[0]) => void; customProgramCacheKey: () => string; userData: Record<string, unknown> }
  const baseKey = proto.customProgramCacheKey
  proto.onBeforeCompile = function (this: { userData: Record<string, unknown> }, shader) { if (this.userData.planetCurve) curveProgram(shader) }
  proto.customProgramCacheKey = function (this: { userData: Record<string, unknown> }) { return (this.userData.planetCurve ? 'planet-curve:' : '') + baseKey.call(this) }
}

// Flag the materials under `root` that are not flagged yet (ShaderMaterials carry their own GLSL)
export function markPlanetCurved(root: THREE.Object3D, seen: WeakSet<THREE.Material>) {
  root.traverse((object) => {
    const material = (object as THREE.Mesh).material
    if (!material) return
    for (const item of Array.isArray(material) ? material : [material]) {
      if (seen.has(item)) continue
      seen.add(item)
      // Hand-written shaders include PLANET_CURVE_GLSL themselves; fat lines are patched here
      if ((item as THREE.ShaderMaterial).isShaderMaterial && !(item as unknown as { isLineMaterial?: boolean }).isLineMaterial) continue
      item.userData.planetCurve = true
      item.needsUpdate = true
    }
  })
}

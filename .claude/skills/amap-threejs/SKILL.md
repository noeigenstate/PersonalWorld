---
name: amap-threejs
description: Put Three.js 3D objects on an AMap (高德地图) JS API 2.0 3D map — camera sync with GLCustomLayer, customCoords units, WGS-84→GCJ-02, constant on-screen size across zoom, security-key proxy, browser geocoding, map styling and framing. Use when building or debugging any AMap + Three.js overlay, when AMap objects appear offset/invisible/wrong-sized, or when three.js fails inside GLCustomLayer.
---

# AMap JS API 2.0 + Three.js

Verified on 2026-09-24 against the live API (JS API 2.0, three r186, Chrome). Working implementation: `src/map/amapScene.ts`, `src/map/amap.ts`, `server/amap.mjs` in this project.

## 1. Do not share AMap's WebGL context with modern three.js

`GLCustomLayer.init(gl)` hands you AMap's context, and it is **WebGL 1** (`gl.getParameter(gl.VERSION)` → `WebGL 1.0`). three.js r163+ only supports WebGL 2, so `new THREE.WebGLRenderer({ context: gl })` breaks. Old tutorials pin three r142 for this reason.

Instead: give three.js **its own transparent canvas** stacked over the map (`pointer-events: none`), and use `GLCustomLayer` only as the per-frame hook that supplies the camera:

```js
const layer = new AMap.GLCustomLayer({ zIndex: 120, init() {}, render: draw })
map.add(layer)

function draw() {
  const cc = map.customCoords
  cc.setCenter(origin)                       // same fixed origin every frame
  const { near, far, fov, up, lookAt, position } = cc.getCameraParams()
  camera.near = near; camera.far = far; camera.fov = fov
  camera.aspect = width / height
  camera.position.set(...position); camera.up.set(up[0], up[1], up[2]); camera.lookAt(...lookAt)
  camera.updateProjectionMatrix()
  renderer.render(scene, camera)            // renderer = own WebGLRenderer({ canvas, alpha: true })
}
```

`up` comes back as an object with keys `0,1,2`, not an array. Your objects never share a depth buffer with AMap's 3D buildings, so set `showBuildingBlock: false` to avoid buildings that visually cut through them.

## 2. Coordinates

- `customCoords.lngLatsToCoords([[lng, lat]])` takes **GCJ-02**. Photo EXIF / GPS is WGS-84: convert first (see `src/lib/geo.js` `wgs84ToGcj02`), otherwise objects sit a few hundred metres off.
- Output units are **Web Mercator metres** relative to `setCenter(origin)` (0.01° of longitude = 1113.19 units at any latitude). Axes: x east, y north, **z up**.
- Pick one origin (e.g. the first place) and keep it; call `setCenter(origin)` before every `lngLatsToCoords` and `getCameraParams`.
- Models authored y-up need `wrapper.rotation.x = Math.PI / 2`.

## 3. Constant on-screen size

Metres per pixel at a zoom level: `156543.034 / 2 ** zoom`. For objects that should stay N px per model unit, scale their wrapper every frame:

```js
const unit = (156543.034 / 2 ** map.getZoom()) * PX_PER_UNIT
for (const wrapper of sizedObjects) wrapper.scale.setScalar(unit)
```

Lines: use `Line2` + `LineMaterial({ linewidth: px, worldUnits: false })` for pixel-width lines, and update `material.resolution.set(w, h)` on resize. Geographic arcs can keep metre heights (`distance * 0.2`) — they scale with the map naturally.

DOM labels: project anchors with the same camera; keep anchor heights in model units and multiply by `unit` when projecting.

## 4. Security key (安全密钥) without exposing it

Set before the script loads:

```js
window._AMapSecurityConfig = { serviceHost: `${location.origin}/_AMapService` }
// then <script src="https://webapi.amap.com/maps?v=2.0&key=JS_KEY&plugin=AMap.Geocoder">
```

The server forwards and appends `jscode` (verified working):

| path prefix | upstream |
|---|---|
| `/_AMapService/v4/map/styles` | `https://webapi.amap.com/v4/map/styles` |
| `/_AMapService/v3/vectormap` | `https://fmap01.amap.com/v3/vectormap` |
| `/_AMapService/` | `https://restapi.amap.com/` |

## 5. Reverse geocoding with only the JS key

The Web-service key is not required: the JS API geocoder works in the browser with the JS key (via the proxy above). It batches up to 20 points:

```js
new AMap.Geocoder({ city: '全国', radius: 1000 }).getAddress([[lng, lat], …], (status, result) => {
  // status: 'complete' | 'no_data' | 'error'; result.regeocodes[i].addressComponent
})
```

Municipalities (上海、北京…) return an empty `city`; use `province` instead. Empty fields may be `[]` rather than `''`.

## 6. Look and framing

- Cartoon-friendly base: `mapStyle: 'amap://styles/macaron'`, `features: ['bg', 'road']`, `showBuildingBlock: false`, `viewMode: '3D'`, `pitch: 45–55`. `fresh` is warmer, `whitesmoke` is near-monochrome, `graffiti` is very saturated.
- Frame content: `map.setBounds(bounds, immediately, avoid)`. **`avoid` order is `[top, bottom, left, right]`** in pixels (measured: `[400,0,0,0]` pushes the target down). Use it to keep content clear of side panels and overlays.
- Pad tiny bounds (≈0.01° for a city, ≈0.8° for a country view) so a single point doesn't zoom to street level.
- Picking: listen to `map.on('click', e => e.pixel)` and raycast with the synced camera; the overlay canvas has `pointer-events: none` so dragging still moves the map.

## 7. Testing

Headless Chrome renders AMap fine. To test without a signed-in session, route `/_AMapService/**` in Playwright and forward with `jscode` exactly like the server does (see `tests/amap.mjs`).

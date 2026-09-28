import { useEffect, useRef } from 'react'
import { loadAmap } from '../map/amap'
import { createAmapLifeMap } from '../map/amapScene'
import { createGlobeLifeMap, GLOBE_KM_PER_UNIT } from '../map/globeScene'
import { createLifeMap, type LifeMapData, type MapPhoto } from '../map/scene'
import { gcj02ToWgs84, wgs84ToGcj02 } from '../lib/geo'

interface Props extends LifeMapData {
  // With a key the cartoon layer sits on the real AMap 3D map; without one, on a cartoon board
  amapKey?: string
  amapStyle?: string
  insetRight: number
  insetBottom: number
  // Height of the floating glass bar over the top of the map
  insetTop?: number
  sceneEnabled: boolean
  globeOverview: boolean
  onSelectCity: (city: string | null) => void
  onOpenEvent: (id: string) => void
  onOpenPhoto: (id: string) => void
  onFocusPhoto: (photo: MapPhoto) => void
  // The user zoomed from the globe into the street map (false) or back out (true)
  onGlobeChange?: (globe: boolean) => void
  onMapError: (message: string) => void
  // Changes every time the user asks to see a photo on the map
  focus?: { photo: MapPhoto; at: number } | null
  landmarkPreviewAt?: number
}

interface MapApi {
  update: (data: LifeMapData) => void
  setInsets: (insets: { right: number; bottom: number; top: number }) => void
  dispose: () => void
  focusPhoto?: (photo: MapPhoto) => void
  focusLandmark?: () => void
  setSceneEnabled?: (visible: boolean) => void
  showAt?: (gcj: [number, number], zoom: number) => void
}
interface GlobeApi extends MapApi {
  showAround: (lng: number, lat: number, altitude: number) => void
  resume: () => void
}

// Globe altitude (globe units) ↔ AMap zoom, for a view looking straight down: the height of the
// ground the viewport shows is the same on both sides of the hand-over
const FOV_FACTOR = 2 * Math.tan((42 / 2) * Math.PI / 180) // the globe camera's vertical field of view
const zoomForAltitude = (altitude: number, lat: number, heightPx: number) =>
  Math.log2((156543.03 * Math.cos(lat * Math.PI / 180) * heightPx) / (FOV_FACTOR * altitude * GLOBE_KM_PER_UNIT * 1000))
const altitudeForZoom = (zoom: number, lat: number, heightPx: number) =>
  (156543.03 * Math.cos(lat * Math.PI / 180) * heightPx) / (2 ** zoom * FOV_FACTOR * GLOBE_KM_PER_UNIT * 1000)

// The street map (AMap, or the cartoon board without a key) and the globe stay mounted together;
// the globe lies on top and fades out when the view is handed to the street map, so zooming in
// and out is one continuous movement.
export function LifeMapView({ amapKey, amapStyle, insetRight, insetBottom, insetTop = 0, sceneEnabled, globeOverview, onSelectCity, onOpenEvent, onOpenPhoto, onFocusPhoto, onGlobeChange, onMapError, focus, landmarkPreviewAt = 0, ...data }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const baseHost = useRef<HTMLDivElement>(null)
  const globeHost = useRef<HTMLDivElement>(null)
  const map = useRef<MapApi | null>(null)
  const globe = useRef<GlobeApi | null>(null)
  // Set by a hand-over, so the globe/map is not re-framed by the prop change that follows it
  const handedOver = useRef(false)
  const latest = useRef({ data, insets: { right: insetRight, bottom: insetBottom, top: insetTop }, sceneEnabled, landmarkPreviewAt, focus })
  latest.current = { data, insets: { right: insetRight, bottom: insetBottom, top: insetTop }, sceneEnabled, landmarkPreviewAt, focus }
  const callbacks = useRef({ onSelectCity, onOpenEvent, onOpenPhoto, onFocusPhoto, onGlobeChange, onMapError })
  callbacks.current = { onSelectCity, onOpenEvent, onOpenPhoto, onFocusPhoto, onGlobeChange, onMapError }

  const handlers = (withAmap: boolean) => ({
    onSelectCity: (city: string | null) => callbacks.current.onSelectCity(city),
    onOpenEvent: (id: string) => callbacks.current.onOpenEvent(id),
    onOpenPhoto: (id: string) => callbacks.current.onOpenPhoto(id),
    onFocusPhoto: withAmap ? (photo: MapPhoto) => callbacks.current.onFocusPhoto(photo) : undefined,
    // Globe → street map at the same point and scale
    onZoomIntoMap: withAmap ? ({ lng, lat, altitude }: { lng: number; lat: number; altitude: number }) => {
      if (!map.current?.showAt) return
      const heightPx = host.current?.clientHeight || 800
      const p = wgs84ToGcj02({ lng, lat })
      map.current.showAt([p.lng, p.lat], zoomForAltitude(altitude, lat, heightPx))
      handedOver.current = true
      callbacks.current.onGlobeChange?.(false)
    } : undefined,
    // Street map → globe
    onZoomOutToGlobe: ({ gcj, zoom }: { gcj: [number, number]; zoom: number }) => {
      const w = gcj02ToWgs84({ lng: gcj[0], lat: gcj[1] })
      globe.current?.showAround(w.lng, w.lat, altitudeForZoom(zoom, w.lat, host.current?.clientHeight || 800))
      handedOver.current = true
      callbacks.current.onGlobeChange?.(true)
    },
  })

  const mount = (target: typeof map, api: MapApi) => {
    target.current = api
    api.setInsets(latest.current.insets)
    api.setSceneEnabled?.(latest.current.sceneEnabled)
    api.update(latest.current.data)
  }

  // The street map
  useEffect(() => {
    const el = baseHost.current
    if (!el) return
    let cancelled = false
    const attach = (api: MapApi) => {
      if (cancelled) { api.dispose(); return }
      mount(map, api)
      if (latest.current.focus) api.focusPhoto?.(latest.current.focus.photo)
      else if (latest.current.landmarkPreviewAt) api.focusLandmark?.()
    }
    if (amapKey) {
      loadAmap(amapKey)
        .then((AMap) => attach(createAmapLifeMap(el, handlers(true), AMap, amapStyle)))
        .catch((error) => {
          callbacks.current.onMapError(`${error instanceof Error ? error.message : '高德地图加载失败'}，已改用卡通底板`)
          attach(createLifeMap(el, handlers(false)))
        })
    } else {
      attach(createLifeMap(el, handlers(false)))
    }
    return () => { cancelled = true; map.current?.dispose(); map.current = null }
  }, [amapKey, amapStyle]) // eslint-disable-line react-hooks/exhaustive-deps

  // The globe, over the street map
  useEffect(() => {
    const el = globeHost.current
    if (!el) return
    const api = createGlobeLifeMap(el, handlers(Boolean(amapKey))) as GlobeApi
    mount(globe as typeof map, api)
    return () => { api.dispose(); globe.current = null }
  }, [amapKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Shown again without a hand-over (e.g. "返回地球"): the globe keeps its own framing
  useEffect(() => {
    if (globeOverview && !handedOver.current) globe.current?.resume()
    handedOver.current = false
  }, [globeOverview])

  // Insets first, so the camera is framed for the space the panels leave free
  useEffect(() => {
    const insets = { right: insetRight, bottom: insetBottom, top: insetTop }
    map.current?.setInsets(insets)
    globe.current?.setInsets(insets)
  }, [insetRight, insetBottom, insetTop])
  useEffect(() => { map.current?.setSceneEnabled?.(sceneEnabled) }, [sceneEnabled])

  useEffect(() => {
    map.current?.update(data)
    globe.current?.update(data)
    // Rebuild only when the data the scene draws actually changes
  }, [data.places, data.bases, data.story, data.selectedCity, data.highlightedEventId, data.photos, data.routeEventIds]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (focus) map.current?.focusPhoto?.(focus.photo) }, [focus])
  useEffect(() => { if (landmarkPreviewAt) map.current?.focusLandmark?.() }, [landmarkPreviewAt])

  return (
    <div className="life-map-stack" ref={host} aria-label="人生地图">
      <div className={`life-map life-map-layer${globeOverview ? ' under' : ''}`} ref={baseHost} aria-hidden={globeOverview} />
      <div className={`life-map-layer life-map-globe${globeOverview ? '' : ' away'}`} ref={globeHost} aria-hidden={!globeOverview} />
    </div>
  )
}

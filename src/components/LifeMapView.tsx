import { useEffect, useRef } from 'react'
import { loadAmap } from '../map/amap'
import { createAmapLifeMap } from '../map/amapScene'
import { createLifeMap, type LifeMapData, type MapPhoto } from '../map/scene'

interface Props extends LifeMapData {
  // With a key the cartoon layer sits on the real AMap 3D map; without one, on a cartoon board
  amapKey?: string
  amapStyle?: string
  insetRight: number
  insetBottom: number
  sceneEnabled: boolean
  onSelectCity: (city: string | null) => void
  onOpenEvent: (id: string) => void
  onOpenPhoto: (id: string) => void
  onMapError: (message: string) => void
  // Changes every time the user asks to see a photo on the map
  focus?: { photo: MapPhoto; at: number } | null
  landmarkPreviewAt?: number
}

interface MapApi {
  update: (data: LifeMapData) => void
  setInsets: (insets: { right: number; bottom: number }) => void
  dispose: () => void
  focusPhoto?: (photo: MapPhoto) => void
  focusLandmark?: () => void
  setSceneEnabled?: (visible: boolean) => void
}

export function LifeMapView({ amapKey, amapStyle, insetRight, insetBottom, sceneEnabled, onSelectCity, onOpenEvent, onOpenPhoto, onMapError, focus, landmarkPreviewAt = 0, ...data }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const map = useRef<MapApi | null>(null)
  const latest = useRef({ data, insets: { right: insetRight, bottom: insetBottom }, sceneEnabled, landmarkPreviewAt, focus })
  latest.current = { data, insets: { right: insetRight, bottom: insetBottom }, sceneEnabled, landmarkPreviewAt, focus }
  const callbacks = useRef({ onSelectCity, onOpenEvent, onOpenPhoto, onMapError })
  callbacks.current = { onSelectCity, onOpenEvent, onOpenPhoto, onMapError }

  useEffect(() => {
    const el = host.current
    if (!el) return
    let cancelled = false
    const handlers = {
      onSelectCity: (city: string | null) => callbacks.current.onSelectCity(city),
      onOpenEvent: (id: string) => callbacks.current.onOpenEvent(id),
      onOpenPhoto: (id: string) => callbacks.current.onOpenPhoto(id),
    }
    const mount = (api: MapApi) => {
      if (cancelled) { api.dispose(); return }
      map.current = api
      api.setInsets(latest.current.insets)
      api.setSceneEnabled?.(latest.current.sceneEnabled)
      api.update(latest.current.data)
      if (latest.current.focus) api.focusPhoto?.(latest.current.focus.photo)
      else if (latest.current.landmarkPreviewAt) api.focusLandmark?.()
    }
    if (amapKey) {
      loadAmap(amapKey)
        .then((AMap) => mount(createAmapLifeMap(el, handlers, AMap, amapStyle)))
        .catch((error) => {
          callbacks.current.onMapError(`${error instanceof Error ? error.message : '高德地图加载失败'}，已改用卡通底板`)
          mount(createLifeMap(el, handlers))
        })
    } else {
      mount(createLifeMap(el, handlers))
    }
    return () => { cancelled = true; map.current?.dispose(); map.current = null }
  }, [amapKey, amapStyle])

  // Insets first, so the camera is framed for the space the panels leave free
  useEffect(() => { map.current?.setInsets({ right: insetRight, bottom: insetBottom }) }, [insetRight, insetBottom])
  useEffect(() => { map.current?.setSceneEnabled?.(sceneEnabled) }, [sceneEnabled])

  useEffect(() => {
    map.current?.update(data)
    // Rebuild only when the data the scene draws actually changes
  }, [data.places, data.bases, data.story, data.selectedCity, data.highlightedEventId, data.photos]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (focus) map.current?.focusPhoto?.(focus.photo) }, [focus])
  useEffect(() => { if (landmarkPreviewAt) map.current?.focusLandmark?.() }, [landmarkPreviewAt])

  return <div className="life-map" ref={host} aria-label="人生地图" />
}

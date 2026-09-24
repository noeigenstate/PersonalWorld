import { useEffect, useRef } from 'react'
import { loadAmap } from '../map/amap'
import { createAmapLifeMap } from '../map/amapScene'
import { createLifeMap, type LifeMapData } from '../map/scene'

interface Props extends LifeMapData {
  // With a key the cartoon layer sits on the real AMap 3D map; without one, on a cartoon board
  amapKey?: string
  insetRight: number
  insetBottom: number
  onSelectCity: (city: string | null) => void
  onOpenEvent: (id: string) => void
  onMapError: (message: string) => void
}

interface MapApi {
  update: (data: LifeMapData) => void
  setInsets: (insets: { right: number; bottom: number }) => void
  dispose: () => void
}

export function LifeMapView({ amapKey, insetRight, insetBottom, onSelectCity, onOpenEvent, onMapError, ...data }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const map = useRef<MapApi | null>(null)
  const latest = useRef({ data, insets: { right: insetRight, bottom: insetBottom } })
  latest.current = { data, insets: { right: insetRight, bottom: insetBottom } }
  const callbacks = useRef({ onSelectCity, onOpenEvent, onMapError })
  callbacks.current = { onSelectCity, onOpenEvent, onMapError }

  useEffect(() => {
    const el = host.current
    if (!el) return
    let cancelled = false
    const handlers = {
      onSelectCity: (city: string | null) => callbacks.current.onSelectCity(city),
      onOpenEvent: (id: string) => callbacks.current.onOpenEvent(id),
    }
    const mount = (api: MapApi) => {
      if (cancelled) { api.dispose(); return }
      map.current = api
      api.setInsets(latest.current.insets)
      api.update(latest.current.data)
    }
    if (amapKey) {
      loadAmap(amapKey)
        .then((AMap) => mount(createAmapLifeMap(el, handlers, AMap)))
        .catch((error) => {
          callbacks.current.onMapError(`${error instanceof Error ? error.message : '高德地图加载失败'}，已改用卡通底板`)
          mount(createLifeMap(el, handlers))
        })
    } else {
      mount(createLifeMap(el, handlers))
    }
    return () => { cancelled = true; map.current?.dispose(); map.current = null }
  }, [amapKey])

  // Insets first, so the camera is framed for the space the panels leave free
  useEffect(() => { map.current?.setInsets({ right: insetRight, bottom: insetBottom }) }, [insetRight, insetBottom])

  useEffect(() => {
    map.current?.update(data)
    // Rebuild only when the data the scene draws actually changes
  }, [data.places, data.bases, data.story, data.selectedCity, data.highlightedEventId]) // eslint-disable-line react-hooks/exhaustive-deps

  return <div className="life-map" ref={host} aria-label="人生地图" />
}

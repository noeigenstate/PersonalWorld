import { useEffect, useRef } from 'react'
import { createLifeMap, type LifeMap, type LifeMapData } from '../map/scene'

interface Props extends LifeMapData {
  insetRight: number
  insetBottom: number
  onSelectCity: (city: string | null) => void
  onOpenEvent: (id: string) => void
}

export function LifeMapView({ insetRight, insetBottom, onSelectCity, onOpenEvent, ...data }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const map = useRef<LifeMap | null>(null)
  const callbacks = useRef({ onSelectCity, onOpenEvent })
  callbacks.current = { onSelectCity, onOpenEvent }

  useEffect(() => {
    if (!host.current) return
    map.current = createLifeMap(host.current, {
      onSelectCity: (city) => callbacks.current.onSelectCity(city),
      onOpenEvent: (id) => callbacks.current.onOpenEvent(id),
    })
    return () => { map.current?.dispose(); map.current = null }
  }, [])

  // Insets first, so the camera is framed for the space the panels leave free
  useEffect(() => { map.current?.setInsets({ right: insetRight, bottom: insetBottom }) }, [insetRight, insetBottom])

  useEffect(() => {
    map.current?.update(data)
    // Rebuild only when the data the scene draws actually changes
  }, [data.places, data.bases, data.story, data.selectedCity, data.highlightedEventId]) // eslint-disable-line react-hooks/exhaustive-deps

  return <div className="life-map" ref={host} aria-label="人生地图" />
}

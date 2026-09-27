import { useEffect, useState } from 'react'
import type { MemoryAsset } from '../types'
import type { MapPhoto } from '../map/scene'
import { fetchRegionScene, photoRegions } from '../map/regionScene'
import { sceneCoverage } from '../map/sceneCoverage'

// Sequential, bounded preparation of the actual account's photo neighbourhoods.
// It uses exactly the same scene loader as clicking a photograph on the map.
export function useSceneCoverage(assets: MemoryAsset[], photos: MapPhoto[], enabled: boolean) {
  const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0, partial: 0 })
  const key = photos.map(p => `${p.id}:${p.gcj}:${p.precision}:${p.venueName}`).sort().join('|')
  useEffect(() => {
    if (!enabled || !photos.length) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        const config = await (await fetch('/api/config')).json()
        if (!config.localReview || cancelled) return
        const regions = photoRegions(photos), results = []
        const metadata = assets.map(({id, kind, capturedAt, dateSource, location, latitude, longitude, card}) => ({id, kind, capturedAt, dateSource, location, latitude, longitude, card}))
        const save = (rows: unknown[]) => fetch('/api/memory-review', {method:'POST', headers:{'Content-Type':'application/json','X-Memory-Agent':'web'}, body:JSON.stringify({assets:metadata,regions:rows})})
        await save(regions)
        setProgress({done: 0, total: regions.length, failed: 0, partial: 0})
        for (const region of regions) {
          if (cancelled) return
          try {
            const data = await fetchRegionScene(region)
            const coverage = sceneCoverage(data)
            results.push({...region, venue: data.venue?.name || '', state: 'ready', buildings: data.buildings.length,
              water: data.water.length, waterways: data.waterways?.length || 0, green: data.green.length,
              grounds: data.grounds?.length || 0, detailStatus: data.detailStatus || 'base', coverage: coverage.level})
          } catch (e) { results.push({...region, state: 'failed', error: e instanceof Error ? e.message : '场景暂不可用'}) }
          if (!cancelled) setProgress({done: results.length, total: regions.length, failed: results.filter(r => r.state === 'failed').length,
            partial: results.filter(r => 'coverage' in r && r.coverage !== 'mapped').length})
        }
        if (cancelled) return
        // Review export is explicitly enabled by local server configuration.
        // Strip all binary previews and hashes before sending to this account's local service.
        await save(results)
      })().catch(() => { /* Individual map scenes remain available when a local review cannot be saved. */ })
    }, 4000)
    return () => {cancelled = true; window.clearTimeout(timer)}
  }, [key, enabled])
  return progress
}

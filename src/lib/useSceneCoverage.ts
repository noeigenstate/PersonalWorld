import { useEffect, useRef, useState } from 'react'
import type { MemoryAsset } from '../types'
import type { MapPhoto } from '../map/scene'
import { fetchRegionScene, photoRegions, type PhotoRegion } from '../map/regionScene'
import { sceneCoverage } from '../map/sceneCoverage'
import { landmarkRecord } from '../map/landmarkCatalog'
import { loadPreference, savePreference } from './storage'

export interface CoverageRow {id:string;name:string;photoIds:string[];seen:boolean;status:'loading'|'ready'|'failed';special:string[];note:string;coverage?:string;buildings?:number}
export function useSceneCoverage(assets:MemoryAsset[],photos:MapPhoto[],enabled:boolean){
  const [rows,setRows]=useState<CoverageRow[]>([]),[error,setError]=useState('')
  const seen=useRef(new Set<string>())
  const key=photos.map(p=>`${p.id}:${p.gcj}:${p.precision}:${p.venueName}`).sort().join('|')
  useEffect(()=>{
    if(!enabled)return
    let cancelled=false
    const timer=window.setTimeout(()=>{void(async()=>{
      const previous=await loadPreference<CoverageRow[]>('scene-coverage',[])
      previous.filter(r=>r.seen).forEach(r=>seen.current.add(r.id))
      const regions=photoRegions(photos)
      const nameOf=(region:PhotoRegion)=>region.venue?.name||assets.find(a=>region.photoIds.includes(a.id))?.location?.aoi||assets.find(a=>region.photoIds.includes(a.id))?.location?.poi?.name||'照片所在街区'
      // Preserve an area's notification identity when its centroid moves after import.
      const assigned=new Set<string>()
      const current:CoverageRow[]=regions.map(r=>{
        const old=previous.filter(p=>!assigned.has(p.id)&&p.photoIds.some(id=>r.photoIds.includes(id))).sort((a,b)=>b.photoIds.filter(id=>r.photoIds.includes(id)).length-a.photoIds.filter(id=>r.photoIds.includes(id)).length)[0]
        const id=old?.id||r.key||`area:${r.center.map(v=>v.toFixed(4)).join(',')}`
        assigned.add(id)
        return {id,name:nameOf(r),photoIds:r.photoIds,seen:seen.current.has(id),status:'loading',special:[],note:'正在检查真实地理资料'}
      })
      if(cancelled)return
      setRows([...current]);setError('')
      const config=await fetch('/api/config').then(r=>r.json()).catch(()=>({}))
      const review:unknown[]=[]
      for(const [index,region] of regions.entries()){
        if(cancelled)return
        const row=current[index]
        try{
          const data=await fetchRegionScene(region),coverage=sceneCoverage(data)
          Object.assign(row,{status:'ready',buildings:data.buildings.length,coverage:coverage.level,note:coverage.note,special:[...new Set(data.buildings.map(b=>landmarkRecord(b.id)?.name).filter((n):n is string=>Boolean(n)))]})
          if(data.venue?.name)row.name=data.venue.name
          review.push({...region,venue:data.venue?.name||'',state:'ready',buildings:data.buildings.length,water:data.water.length,waterways:data.waterways?.length||0,green:data.green.length,grounds:data.grounds?.length||0,detailStatus:data.detailStatus||'base',coverage:coverage.level,special:row.special})
        }catch(e){Object.assign(row,{status:'failed',note:e instanceof Error?e.message:'资料读取失败'});review.push({...region,state:'failed'})}
        if(cancelled)return
        current.forEach(r=>{r.seen=seen.current.has(r.id)})
        setRows(current.map(r=>({...r})))
        await savePreference('scene-coverage',current)
      }
      if(config.localReview&&!cancelled){
        const metadata=assets.map(({id,kind,capturedAt,dateSource,location,latitude,longitude,card})=>({id,kind,capturedAt,dateSource,location,latitude,longitude,card}))
        await fetch('/api/memory-review',{method:'POST',headers:{'Content-Type':'application/json','X-Memory-Agent':'web'},body:JSON.stringify({assets:metadata,regions:review})})
      }
    })().catch(e=>{if(!cancelled)setError(e.message)})},4000)
    return()=>{cancelled=true;window.clearTimeout(timer)}
  },[key,enabled])
  const acknowledge=()=>{
    rows.forEach(r=>seen.current.add(r.id))
    const updated=rows.map(r=>({...r,seen:true}));setRows(updated)
    void savePreference('scene-coverage',updated).catch(e=>setError(e.message))
  }
  return {rows,error,acknowledge,newCount:rows.filter(r=>!r.seen).length,total:rows.length,done:rows.filter(r=>r.status!=='loading').length,partial:rows.filter(r=>r.coverage&&r.coverage!=='mapped').length,failed:rows.filter(r=>r.status==='failed').length}
}

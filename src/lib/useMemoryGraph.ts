import { useEffect, useRef, useState } from 'react'
import type { MemoryAsset, MemoryEvent } from '../types'
import { filmImage } from './memoryFilm'
import { loadPreference, savePreference } from './storage'
import { graphMetadata, graphRequest, type MemoryGraphState } from './memoryGraph'

export function useMemoryGraph(assets:MemoryAsset[],events:MemoryEvent[],ready:boolean,wait:boolean){
  const [state,setState]=useState<MemoryGraphState|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const [paused,setPause]=useState<boolean|null>(null),[revision,retry]=useState(0)
  const [progress,setProgress]=useState({done:0,total:0})
  const latest=useRef(assets);latest.current=assets
  const metadata=graphMetadata(assets,events),key=JSON.stringify(metadata)
  // Serialize generations and sync the server's current grouping policy;
  // already detected photographs reuse their local biometric observations.
  const queue=useRef<Promise<void>>(Promise.resolve())
  const writes=useRef(0),epoch=useRef(0),reads=useRef(0)
  useEffect(()=>{if(ready)void loadPreference('identity-paused',false).then(setPause)},[ready])
  useEffect(()=>{
    if(!ready)return
    let cancelled=false
    // An open background tab must still notice that understanding finished so
    // it can supply local originals to the next film task.
    const refresh=()=>{
      if(writes.current||document.visibilityState!=='visible'&&!state?.understanding?.busy)return
      const ticket=epoch.current
      const read=++reads.current
      void graphRequest().then(value=>{if(!cancelled&&!writes.current&&ticket===epoch.current&&read===reads.current)setState(value)}).catch(()=>{})
    }
    refresh();window.addEventListener('focus',refresh)
    const timer=window.setInterval(refresh,state?.understanding?.busy?2500:10000)
    return()=>{cancelled=true;window.removeEventListener('focus',refresh);window.clearInterval(timer)}
  },[ready,state?.understanding?.busy])
  useEffect(()=>{
    if(!ready||wait||paused===null)return
    let cancelled=false
    const timer=window.setTimeout(()=>{
      queue.current=queue.current.catch(()=>{}).then(async()=>{
        if(cancelled)return
        const syncTicket=++epoch.current;writes.current++
        let synced:MemoryGraphState
        try{synced=await graphRequest('/sync',{...metadata,automatic:paused===false})}finally{writes.current--}
        if(cancelled)return
        if(syncTicket===epoch.current)setState(synced);setError('')
        if(paused||!synced.capability?.available)return
        const pending=[...new Set([...synced.pending,...(revision?synced.runs.filter(r=>r.status==='failed').map(r=>r.assetId):[])])]
        setBusy(Boolean(pending.length));setProgress({done:0,total:pending.length})
        try{
          for(const [index,id] of pending.entries()){
            if(cancelled)break
            const asset=latest.current.find(a=>a.id===id);if(!asset)continue
            try {
              const ticket=epoch.current
              const result=await graphRequest('/analyze',{assetId:id,dataUrl:await filmImage(asset),retry:revision>0})
              if(!cancelled&&ticket===epoch.current)setState(result)
            } catch(e){if(!cancelled)setError(e instanceof Error?e.message:'照片人物分析失败')}
            if(!cancelled)setProgress({done:index+1,total:pending.length})
          }
          if(!cancelled&&pending.length){const ticket=epoch.current;const settled=await graphRequest('/settle',{});if(!cancelled&&ticket===epoch.current)setState({...settled,capability:synced.capability})}
        }finally{if(!cancelled)setBusy(false)}
      }).catch(e=>{if(!cancelled){setBusy(false);setError(e.message)}})
    },1400)
    return()=>{cancelled=true;window.clearTimeout(timer);setBusy(false)}
  },[key,ready,wait,paused,revision,state?.capability?.detectorRevision])
  const mutate=async(path:string,body:unknown)=>{
    const ticket=++epoch.current;writes.current++
    try{const value=await graphRequest(path,body);if(ticket===epoch.current)setState(prior=>({...value,capability:prior?.capability}));return value}
    finally{writes.current--}
  }
  const setPaused=(value:boolean)=>{setPause(value);void savePreference('identity-paused',value).catch(()=>setError('暂停设置保存失败'));void mutate('/understanding',{paused:value}).catch(e=>setError(e.message))}
  return {state,busy,error,progress,paused:paused!==false,setPaused,mutate,retry:()=>retry(v=>v+1)}
}

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
  useEffect(()=>{if(ready)void loadPreference('identity-paused',false).then(setPause)},[ready])
  useEffect(()=>{
    if(!ready)return
    let cancelled=false
    const refresh=()=>{if(document.visibilityState==='visible')void graphRequest().then(value=>{if(!cancelled)setState(value)}).catch(()=>{})}
    refresh();window.addEventListener('focus',refresh)
    const timer=window.setInterval(refresh,60000)
    return()=>{cancelled=true;window.removeEventListener('focus',refresh);window.clearInterval(timer)}
  },[ready])
  useEffect(()=>{
    if(!ready||wait||paused===null)return
    let cancelled=false
    const timer=window.setTimeout(()=>{
      queue.current=queue.current.catch(()=>{}).then(async()=>{
        if(cancelled)return
        const synced=await graphRequest('/sync',metadata)
        if(cancelled)return
        setState(synced);setError('')
        if(paused||!synced.capability?.available)return
        const pending=[...new Set([...synced.pending,...(revision?synced.runs.filter(r=>r.status==='failed').map(r=>r.assetId):[])])]
        setBusy(Boolean(pending.length));setProgress({done:0,total:pending.length})
        try{
          for(const [index,id] of pending.entries()){
            if(cancelled)break
            const asset=latest.current.find(a=>a.id===id);if(!asset)continue
            try {
              const result=await graphRequest('/analyze',{assetId:id,dataUrl:await filmImage(asset),retry:revision>0})
              if(!cancelled)setState(result)
            } catch(e){if(!cancelled)setError(e instanceof Error?e.message:'照片人物分析失败')}
            if(!cancelled)setProgress({done:index+1,total:pending.length})
          }
          if(!cancelled&&pending.length){const settled=await graphRequest('/settle',{});if(!cancelled)setState({...settled,capability:synced.capability})}
        }finally{if(!cancelled)setBusy(false)}
      }).catch(e=>{if(!cancelled){setBusy(false);setError(e.message)}})
    },1400)
    return()=>{cancelled=true;window.clearTimeout(timer);setBusy(false)}
  },[key,ready,wait,paused,revision])
  const mutate=async(path:string,body:unknown)=>{
    const value=await graphRequest(path,body);setState(prior=>({...value,capability:prior?.capability}));return value
  }
  const setPaused=(value:boolean)=>{setPause(value);void savePreference('identity-paused',value).catch(()=>setError('暂停设置保存失败'))}
  return {state,busy,error,progress,paused:paused!==false,setPaused,mutate,retry:()=>retry(v=>v+1)}
}

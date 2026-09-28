import type { MemoryAsset, MemoryEvent } from '../types'

export interface GraphPerson {id:string;name:string;relationship:string;confirmed:boolean;createdAt:string;faceIds:string[]}
export interface GraphFace {id:string;assetId:string;personId:string;box:number[];quality:string;status:'candidate'|'matched'|'confirmed'|'ignored';thumbnail:string;score:number|null;candidate?:{personId:string;score:number}|null}
export interface StoryChapter {id:string;kind:string;title:string;assetIds:string[];personIds:string[];factIds:string[];eventIds:string[];start:string;end:string;explanation:string;revision:string;score:number;understandingRevision?:string;brief?:{angle:string;direction:string;format:string;evidence:{text:string;assetIds:string[]}[]};interpretation?:{insights:{text:string;assetIds:string[]}[];motifs:string[];openQuestions:string[]}}
export interface GraphFact {id:string;assetId?:string;assetIds?:string[];subjectId?:string;objectId?:string;type:string;value:string;status:string;source:string}
export interface GraphRelationship {id:string;subjectId:string;objectId:string;label:string;value:string;source:string}
export interface MemoryGraphState {
  revision:string;people:GraphPerson[];faces:GraphFace[];pending:string[];runs:{assetId:string;status:string;error:string}[]
  capability?:{available:boolean;engine?:string;message?:string;detectorRevision?:string}
  lastCorrection?:{id:string;createdAt:string;revision:string}|null
  understanding?:{available:boolean;paused:boolean;phase:string;busy:boolean;completed:number;total:number;creativeCount:number;revision:string;updatedAt?:number;errors:{eventId:string;error:string}[];events:{id:string;status:string;stale:boolean;title:string;updatedAt?:number}[]}
  graph:{revision:string;chapters:StoryChapter[];facts:GraphFact[];relationships?:GraphRelationship[];memberships:Record<string,string[]>;events:{id:string;title:string;assetIds:string[];personIds:string[];factIds:string[];start:string;end:string}[]}
}
export async function graphRequest(path='',body?:unknown):Promise<MemoryGraphState>{
  const response=await fetch('/api/memory-graph'+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Memory-Agent':'web'},body:JSON.stringify(body)})
  const data=await response.json();if(!response.ok)throw new Error(data.error||'回忆整理暂不可用');return data
}
export const graphMetadata=(assets:MemoryAsset[],events:MemoryEvent[])=>({assets:assets.filter(a=>a.kind!=='video').map(a=>({id:a.id,hash:a.hash,kind:a.kind,capturedAt:a.capturedAt,dateSource:a.dateSource,location:a.location,card:a.card})),events})

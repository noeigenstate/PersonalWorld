import type { FilmJob } from './memoryFilm'

// One pending edit per story/version, including films made without chapterId.
// An older MP4 remains a valid historical cut; it must not start its own loop
// after a newer cut of the same story has already incorporated the correction.
export function nextFilmUpdate(jobs: FilmJob[], attempted: string[]) {
  const seen=new Set<string>()
  for(const job of [...jobs].sort((a,b)=>b.createdAt-a.createdAt)){
    if(job.status!=='complete')continue
    const group=job.chapterId||job.lineageId||job.id
    if(seen.has(group))continue
    seen.add(group)
    if(!job.knowledgeChanged&&!job.storyContext?.changed)continue
    const revision=job.currentKnowledgeRevision||job.storyContext?.revision
    if(!revision)continue
    const key=`knowledge:${group}:${revision}`
    if(!attempted.includes(key))return {job,key}
  }
}

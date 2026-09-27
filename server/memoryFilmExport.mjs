import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

// Optional durable local delivery, separate from the 24-hour authenticated preview
// cache. The configured directory and private manifest never appear in API replies.
export async function exportCompletedFilm(job, source, root) {
  if (!root || job.status !== 'complete') return undefined
  if (!/^[a-f0-9-]{36}$/.test(job.id) || !job.userId) throw new Error('无效的短片导出任务')
  const account = createHash('sha256').update(job.userId).digest('hex').slice(0, 24)
  const target = path.join(path.resolve(root), account)
  await mkdir(target, { recursive: true })
  for (const [from, suffix] of [['film.mp4','.mp4'], ['poster.jpg','.jpg']]) {
    const destination = path.join(target, job.id + suffix)
    const temporary = destination + '.' + randomUUID() + '.tmp'
    try { await copyFile(path.join(source, from), temporary); await rename(temporary, destination) }
    finally { await rm(temporary, {force:true}).catch(() => {}) }
  }
  const exportedAt = new Date().toISOString()
  const manifest = {id:job.id, title:job.plan?.title || '', duration:job.duration,
    width:job.width,height:job.height,sourceCount:job.plan?.shots.length || 0,
    treatment:job.plan?.treatment, createdAt:job.createdAt,exportedAt,file:job.id+'.mp4'}
  const temporary = path.join(target, job.id + '.' + randomUUID() + '.tmp')
  try { await writeFile(temporary, JSON.stringify(manifest,null,2),'utf8'); await rename(temporary,path.join(target,job.id+'.json')) }
  finally { await rm(temporary,{force:true}).catch(() => {}) }
  return exportedAt
}

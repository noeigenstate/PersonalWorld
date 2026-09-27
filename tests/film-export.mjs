import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportCompletedFilm } from '../server/memoryFilmExport.mjs'

test('completed MP4s survive removal of preview inputs and stay account separated', async () => {
  const root = await mkdtemp(join(tmpdir(),'pw-film-export-'))
  const input = join(root,'input'), output = join(root,'export')
  await mkdir(input)
  await writeFile(join(input,'film.mp4'),Buffer.from('test-movie-content'))
  await writeFile(join(input,'poster.jpg'),Buffer.from('test-poster-content'))
  const job={id:'0d167e90-7d45-4a27-803c-ef4dac35cd98',userId:'first',status:'complete',plan:{title:'A memory',shots:[{},{}]},duration:9}
  assert.ok(await exportCompletedFilm(job,input,output))
  await exportCompletedFilm({...job,userId:'second'},input,output)
  const accounts=await readdir(output)
  assert.equal(accounts.length,2)
  // Remove only the explicitly created temporary source directory.
  await rm(input,{recursive:true})
  for (const account of accounts) {
    const dir=join(output,account)
    assert.equal(await readFile(join(dir,job.id+'.mp4'),'utf8'),'test-movie-content')
    const manifest=JSON.parse(await readFile(join(dir,job.id+'.json'),'utf8'))
    assert.equal(manifest.sourceCount,2)
    assert.equal('userId' in manifest,false)
    assert.equal((await readdir(dir)).filter(f=>f.endsWith('.tmp')).length,0)
  }
})

test('unfinished or unconfigured exports produce no delivery',async()=>{
  assert.equal(await exportCompletedFilm({status:'rendering'},'unused','unused'),undefined)
  assert.equal(await exportCompletedFilm({status:'complete'},'unused',''),undefined)
})

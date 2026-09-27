// Three actual render directions, using explicit illustrated fixtures, not user
// photographs. Private film delivery is verified separately after browser upload.
import {mkdtemp,writeFile,readFile,mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {chromium} from 'playwright'
import {renderFilm,runMedia,makeFilmMusic} from '../server/memoryFilmRender.mjs'

const root=await mkdtemp(join(tmpdir(),'pw-film-directions-'))
const browser=await chromium.launch({channel:'chrome'})
let fixtures
try {
  const page=await browser.newPage()
  fixtures=await page.evaluate(()=>Array.from({length:3},(_,i)=>{
    const c=document.createElement('canvas');c.width=i===0?960:720;c.height=i===0?720:960
    const x=c.getContext('2d');x.fillStyle=['#bed9dd','#eac3ba','#b8d6a9'][i];x.fillRect(0,0,c.width,c.height)
    x.fillStyle='#fff3d9';x.beginPath();x.arc(c.width*.7,c.height*.23,70,0,7);x.fill()
    x.fillStyle='#7f9e6d';x.beginPath();x.ellipse(c.width*.5,c.height,c.width*.85,c.height*.37,0,0,7);x.fill()
    x.fillStyle='#657b85';x.font='bold 32px Microsoft YaHei';x.textAlign='center';x.fillText('渲染测试插画',c.width/2,c.height*.5)
    return c.toDataURL('image/jpeg',.9).split(',')[1]
  }))
} finally {await browser.close()}
const directions=['snow-journal','sweet-moments','little-makers'], music=new Set()
for(const treatment of directions){
  const directory=join(root,treatment);await mkdir(directory)
  for(let i=0;i<3;i++)await writeFile(join(directory,`image-${i}.jpg`),Buffer.from(fixtures[i],'base64'))
  const plan={title:'留住这些认真的小片刻',closing:'认真留下的几笔，都在回忆里',treatment,
    shots:Array.from({length:3},(_,i)=>({assetId:`fixture-${i}`,date:'2026-09-27',caption:'这是很长的一段测试字幕用来检查结尾字幕不会重叠',seconds:3.5,motion:['pull','drift','still'][i]}))}
  const result=await renderFilm(directory,plan)
  await runMedia('ffmpeg',['-v','error','-i',join(directory,'film.mp4'),'-f','null','-'])
  await runMedia('ffmpeg',['-v','error','-y','-ss',String(result.duration-1.1),'-i',join(directory,'film.mp4'),'-frames:v','1',join(directory,'ending.jpg')])
  assert.ok((await readFile(join(directory,'film.mp4'))).length>4096)
  music.add(createHash('sha256').update(makeFilmMusic(5,treatment)).digest('hex'))
}
assert.equal(music.size,3)
console.log(JSON.stringify({directory:root,directions,fullDecode:true,musicVariants:music.size}))

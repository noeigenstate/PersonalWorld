import { spawn } from 'node:child_process'
import { access, copyFile, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const binary = () => process.env.FFMPEG_PATH || 'ffmpeg'
export const FILM_RENDER_VERSION = 'creative-scenes-4'
export const filmTreatments = {
  'warm-album': {paper:'fbf4e8', ink:'655548', accent:'d5ae82', width:624, height:664, top:134, stride:.8, transpose:0, harmonic:.22, label:'日子的片段'},
  'snow-journal': {paper:'edf5f6', ink:'385766', accent:'a6c9d5', width:648, height:682, top:124, stride:1.08, transpose:5, harmonic:.09, label:'雪地手记'},
  'sweet-moments': {paper:'fff0e8', ink:'81524a', accent:'dfaa91', width:616, height:646, top:146, stride:.59, transpose:2, harmonic:.30, label:'甜甜的小片刻'},
  'little-makers': {paper:'f7f4df', ink:'536657', accent:'9cbb9a', width:636, height:662, top:138, stride:.72, transpose:-2, harmonic:.17, label:'小小创作簿'},
}
export function runMedia(command, args, { cwd, signal, progress } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], signal })
    let output = '', errors = ''
    child.stdout.on('data', (chunk) => { output += chunk; progress?.(String(chunk)) })
    child.stderr.on('data', (chunk) => { errors = (errors + chunk).slice(-5000) })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve(output) : reject(new Error(`视频渲染失败（${code}）：${errors.slice(0, 1200)}`)))
  })
}

let available
export async function filmCapability() {
  available ??= Promise.all([runMedia(binary(), ['-version']),runMedia(process.env.MEMORY_FILM_PYTHON||'python',['-c','from PIL import Image, ImageFont'])])
    .then(()=>({available:true})).catch(()=>({available:false,message:'本机短片需要 FFmpeg、Python 和 Pillow，请按安装文档配置'}))
  return { ...await available, format: 'mp4', width: 720, height: 960 }
}

async function prepareFont(directory) {
  const target = path.join(directory, 'font.ttf')
  const choices = [process.env.MEMORY_FILM_FONT, 'C:/Windows/Fonts/msyh.ttc', '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', '/System/Library/Fonts/PingFang.ttc'].filter(Boolean)
  for (const font of choices) {
    try {
      await access(font); await copyFile(font, target)
      await copyFile('C:/Windows/Fonts/msyhbd.ttc',path.join(directory,'font-bold.ttf')).catch(()=>copyFile(font,path.join(directory,'font-bold.ttf')))
      return
    } catch { /* Try next supported CJK font. */ }
  }
  throw new Error('视频字幕缺少中文字体，请配置 MEMORY_FILM_FONT')
}

// An original, deterministic soft bell/piano arpeggio. No downloaded music,
// voice cloning or external music service. PCM is rendered locally.
export function makeFilmMusic(seconds, treatment = 'warm-album') {
  const art = filmTreatments[treatment] || filmTreatments['warm-album']
  const rate = 32000, samples = Math.ceil(seconds * rate)
  const buffer = Buffer.alloc(44 + samples * 2)
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40)
  const chords = [[62, 66, 69, 74], [59, 62, 66, 71], [55, 62, 67, 71], [57, 64, 69, 73]]
  const stride = art.stride
  for (let i = 0; i < samples; i++) {
    const time = i / rate, beat = Math.floor(time / stride)
    let value = 0
    for (let b = Math.max(0, beat - 4); b <= beat; b++) {
      const age = time - b * stride, note = chords[Math.floor(b / 8) % chords.length][[0, 1, 2, 3, 2, 1, 3, 1][b % 8]]
      const phase = 2 * Math.PI * 440 * 2 ** ((note + art.transpose - 69) / 12) * age
      const envelope = (1 - Math.exp(-age * 35)) * Math.exp(-age * 1.4)
      value += (Math.sin(phase) + art.harmonic * Math.sin(phase * 2) + .04 * Math.sin(phase * 3)) * envelope * .095
    }
    value *= Math.min(1, time / 2, (seconds - time) / 3)
    buffer.writeInt16LE(Math.round(Math.max(-.8, Math.min(.8, value)) * 32767), 44 + i * 2)
  }
  return buffer
}

const drawText = (file, size, y, color = '0x655548') => `drawtext=fontfile=font.ttf:textfile=${file}:expansion=none:fontsize=${size}:fontcolor=${color}:x=(w-tw)/2:y=${y}`
const lines = (text) => { const chars = [...text]; return chars.length > 17 ? chars.slice(0, 16).join('') + '\n' + chars.slice(16).join('') : text }

// Three original arrangements: spacious felt-piano/pad, playful mallet/bass,
// and a lightly swung plucked notebook motif. No licensed recordings required.
export function makeCreativeMusic(seconds,treatment='warm-album'){
  const snow=treatment==='snow-journal',sweet=treatment==='sweet-moments'
  const rate=32000,samples=Math.ceil(seconds*rate),buffer=Buffer.alloc(44+samples*2)
  buffer.write('RIFF');buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(rate,24);buffer.writeUInt32LE(rate*2,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(samples*2,40)
  const beat=60/(snow?67:sweet?114:86)
  const chords=snow?[[60,64,67,71],[57,60,64,67],[53,57,60,64],[55,59,62,69]]:sweet?[[65,69,72,77],[62,65,69,74],[67,71,74,79],[60,64,67,72]]:[[62,65,69,72],[58,62,65,69],[53,57,60,64],[60,64,67,70]]
  const notes=[]
  for(let b=0;b*beat<seconds;b++){
    const chord=chords[Math.floor(b/8)%4],start=b*beat
    if(snow){
      if(b%4!==3)notes.push({start,note:chord[[0,2,1,3][b%4]],gain:.11,decay:1.5,type:'piano'})
      if(b%8===0)for(const note of chord.slice(0,3))notes.push({start,note:note-12,gain:.036,decay:4.2,type:'pad'})
    }else{
      notes.push({start,note:chord[[0,2,3,1,2,1,3,2][b%8]],gain:.09,decay:sweet?.28:.5,type:sweet?'bell':'pluck'})
      if(b%2===0)notes.push({start,note:chord[0]-24,gain:.085,decay:.3,type:'bass'})
      if(b%4===2)notes.push({start:start+beat*(sweet?.5:.62),note:chord[3],gain:.055,decay:.24,type:'bell'})
    }
  }
  const output=new Float32Array(samples)
  for(const n of notes){
    const first=Math.floor(n.start*rate),length=Math.min(samples-first,Math.ceil(n.decay*5*rate)),frequency=440*2**((n.note-69)/12)
    for(let j=0;j<length;j++){
      const t=j/rate,phase=2*Math.PI*frequency*t
      const env=n.type==='pad'?(1-Math.exp(-t*1.7))*Math.exp(-t/n.decay):(1-Math.exp(-t*80))*Math.exp(-t/n.decay)
      const harmonic=n.type==='piano'?.18:n.type==='bell'?.38:n.type==='pluck'?.3:.05
      output[first+j]+=n.gain*env*(Math.sin(phase)+harmonic*Math.sin(phase*(n.type==='bell'?2.76:2))*Math.exp(-t*5))
    }
  }
  for(let i=0;i<samples;i++){
    const t=i/rate,b=t/beat,phase=b%1
    // Gentle brushed ticks and a soft kick only in the playful score.
    const percussion=sweet?.025*Math.sin(i*1.891)*Math.exp(-phase*110)+.035*Math.sin(2*Math.PI*54*phase*beat)*Math.exp(-phase*22):0
    const v=(output[i]+percussion)*Math.max(0,Math.min(1,t/.6,(seconds-t)/2.4))
    buffer.writeInt16LE(Math.round(Math.tanh(v)*30000),44+i*2)
  }
  return buffer
}

export async function renderFilm(directory, plan, { signal, onProgress = () => {} } = {}) {
  await prepareFont(directory)
  await writeFile(path.join(directory,'creative-plan.json'),JSON.stringify(plan))
  const script=fileURLToPath(new URL('./creativeFilm.py',import.meta.url))
  await runMedia(process.env.MEMORY_FILM_PYTHON||'python',[script,directory],{signal,progress:chunk=>{
    for(const line of chunk.split('\n')){try{const v=JSON.parse(line);if(v.progress)onProgress(v.progress)}catch{/* A partial progress line is harmless. */}}
  }})
  const {duration,segments}=JSON.parse(await readFile(path.join(directory,'creative-result.json'),'utf8'))
  await writeFile(path.join(directory,'music.wav'),makeCreativeMusic(duration,plan.treatment))
  await runMedia(binary(),['-v','error','-y','-i','creative-silent.mp4','-i','music.wav','-map','0:v','-map','1:a','-c:v','copy','-c:a','aac','-b:a','160k','-t',String(duration),'-movflags','+faststart','film.mp4'],{cwd:directory,signal})
  await runMedia(binary(),['-v','error','-y','-ss','1.4','-i','film.mp4','-frames:v','1','poster.jpg'],{cwd:directory,signal})
  const file=await readFile(path.join(directory,'film.mp4'))
  if(file.length<4096||file.toString('ascii',4,8)!=='ftyp')throw new Error('生成文件未通过 MP4 校验')
  onProgress(100)
  return {duration:Math.round(duration*10)/10,bytes:file.length,width:720,height:960,segments}
}

// Kept as an explicit compatibility renderer for archived v5 edit plans.
export async function renderLegacyFilm(directory, plan, { signal, onProgress = () => {} } = {}) {
  await prepareFont(directory)
  const art = filmTreatments[plan.treatment] || filmTreatments['warm-album']
  const fps = 24, transition = plan.treatment === 'sweet-moments' ? .35 : .6
  const durations = plan.shots.map((s) => Math.round(s.seconds * fps) / fps)
  const duration = durations.reduce((a, b) => a + b, 0) - transition * (plan.shots.length - 1)
  await writeFile(path.join(directory, 'title.txt'), plan.title)
  await writeFile(path.join(directory, 'closing.txt'), plan.closing)
  await writeFile(path.join(directory, 'series.txt'), art.label)
  for (let index = 0; index < plan.shots.length; index++) {
    signal?.throwIfAborted()
    const shot = plan.shots[index], frames = durations[index] * fps
    await writeFile(path.join(directory, `caption-${index}.txt`), lines(shot.caption))
    await writeFile(path.join(directory, `date-${index}.txt`), `${shot.date || '值得珍藏的片段'}    /    ${String(index + 1).padStart(2, '0')}`)
    const zoom = shot.motion === 'still' ? '1' : shot.motion === 'pull' ? `1.018-0.018*on/${frames}` : `1+0.018*on/${frames}`
    const x = shot.motion === 'drift' ? `(iw-iw/zoom)*on/${frames}` : 'iw/2-iw/zoom/2'
    const filter = [
      `scale=${art.width}:${art.height}:force_original_aspect_ratio=decrease`,
      `pad=720:960:(ow-iw)/2:${art.top}+(${art.height}-ih)/2:color=0x${art.paper}`, 'setsar=1',
      `zoompan=z='${zoom}':x='${x}':y='ih/2-ih/zoom/2':d=${frames}:s=720x960:fps=${fps}`,
      `drawbox=x=44:y=114:w=632:h=2:color=0x${art.accent}:t=fill`,
      `drawbox=x=44:y=916:w=${Math.round(632*(index+1)/plan.shots.length)}:h=3:color=0x${art.accent}:t=fill`,
      drawText('series.txt', 16, 27, `0x${art.ink}`),
      drawText('title.txt', index === 0 ? 31 : 27, 63, `0x${art.ink}`),
      drawText(`caption-${index}.txt`, 25, 815, `0x${art.ink}`),
      ...(index === plan.shots.length - 1 ? [drawText('closing.txt', 21, 879, `0x${art.ink}`)] : []),
      drawText(`date-${index}.txt`, 17, 935, `0x${art.ink}`), 'format=yuv420p',
    ].join(',')
    await runMedia(binary(), ['-hide_banner', '-loglevel', 'error', '-y', '-i', `image-${index}.jpg`, '-vf', filter, '-frames:v', String(frames), '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-threads', '2', `clip-${index}.mp4`], { cwd: directory, signal })
    onProgress(Math.round(15 + (index + 1) / plan.shots.length * 65))
  }
  await writeFile(path.join(directory, 'music.wav'), makeFilmMusic(duration, plan.treatment))
  const filters = []
  let previous = '0:v', offset = 0
  for (let i = 1; i < plan.shots.length; i++) {
    offset += durations[i - 1] - transition
    filters.push(`[${previous}][${i}:v]xfade=transition=fade:duration=${transition}:offset=${offset.toFixed(3)}[fade${i}]`)
    previous = `fade${i}`
  }
  filters.push(`[${previous}]fade=t=in:d=0.5,fade=t=out:st=${(duration - .7).toFixed(3)}:d=0.7,format=yuv420p[video]`)
  const inputs = plan.shots.flatMap((_, i) => ['-i', `clip-${i}.mp4`])
  await runMedia(binary(), ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-i', 'music.wav', '-filter_complex_threads', '1', '-filter_complex', filters.join(';'), '-map', '[video]', '-map', `${plan.shots.length}:a`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-threads', '2', '-c:a', 'aac', '-b:a', '128k', '-t', duration.toFixed(3), '-movflags', '+faststart', 'film.mp4'], { cwd: directory, signal })
  await runMedia(binary(), ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '1', '-i', 'film.mp4', '-frames:v', '1', 'poster.jpg'], { cwd: directory, signal })
  const file = await readFile(path.join(directory, 'film.mp4'))
  if (file.length < 4096 || file.toString('ascii', 4, 8) !== 'ftyp') throw new Error('生成文件未通过 MP4 校验')
  onProgress(100)
  return { duration: Math.round(duration * 10) / 10, bytes: file.length, width: 720, height: 960 }
}

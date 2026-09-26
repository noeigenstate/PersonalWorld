import { spawn } from 'node:child_process'
import { access, copyFile, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const binary = () => process.env.FFMPEG_PATH || 'ffmpeg'
export const FILM_RENDER_VERSION = 'warm-album-2'
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
  available ??= runMedia(binary(), ['-version']).then(() => true).catch(() => false)
  return { available: await available, format: 'mp4', width: 720, height: 960 }
}

async function prepareFont(directory) {
  const target = path.join(directory, 'font.ttf')
  const choices = [process.env.MEMORY_FILM_FONT, 'C:/Windows/Fonts/msyh.ttc', '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', '/System/Library/Fonts/PingFang.ttc'].filter(Boolean)
  for (const font of choices) {
    try { await access(font); await copyFile(font, target); return } catch { /* Try next supported CJK font. */ }
  }
  throw new Error('视频字幕缺少中文字体，请配置 MEMORY_FILM_FONT')
}

// An original, deterministic soft bell/piano arpeggio. No downloaded music,
// voice cloning or external music service. PCM is rendered locally.
export function makeFilmMusic(seconds) {
  const rate = 32000, samples = Math.ceil(seconds * rate)
  const buffer = Buffer.alloc(44 + samples * 2)
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40)
  const chords = [[62, 66, 69, 74], [59, 62, 66, 71], [55, 62, 67, 71], [57, 64, 69, 73]]
  const stride = .8
  for (let i = 0; i < samples; i++) {
    const time = i / rate, beat = Math.floor(time / stride)
    let value = 0
    for (let b = Math.max(0, beat - 4); b <= beat; b++) {
      const age = time - b * stride, note = chords[Math.floor(b / 8) % chords.length][[0, 1, 2, 3, 2, 1, 3, 1][b % 8]]
      const phase = 2 * Math.PI * 440 * 2 ** ((note - 69) / 12) * age
      const envelope = (1 - Math.exp(-age * 35)) * Math.exp(-age * 1.4)
      value += (Math.sin(phase) + .22 * Math.sin(phase * 2) + .06 * Math.sin(phase * 3)) * envelope * .095
    }
    value *= Math.min(1, time / 2, (seconds - time) / 3)
    buffer.writeInt16LE(Math.round(Math.max(-.8, Math.min(.8, value)) * 32767), 44 + i * 2)
  }
  return buffer
}

const drawText = (file, size, y, color = '0x655548') => `drawtext=fontfile=font.ttf:textfile=${file}:expansion=none:fontsize=${size}:fontcolor=${color}:x=(w-tw)/2:y=${y}`
const lines = (text) => { const chars = [...text]; return chars.length > 17 ? chars.slice(0, 16).join('') + '\n' + chars.slice(16).join('') : text }

export async function renderFilm(directory, plan, { signal, onProgress = () => {} } = {}) {
  await prepareFont(directory)
  const fps = 24, transition = .5
  const durations = plan.shots.map((s) => Math.round(s.seconds * fps) / fps)
  const duration = durations.reduce((a, b) => a + b, 0) - transition * (plan.shots.length - 1)
  await writeFile(path.join(directory, 'title.txt'), plan.title)
  for (let index = 0; index < plan.shots.length; index++) {
    signal?.throwIfAborted()
    const shot = plan.shots[index], frames = durations[index] * fps
    await writeFile(path.join(directory, `caption-${index}.txt`), lines(index === plan.shots.length - 1 ? plan.closing : shot.caption))
    await writeFile(path.join(directory, `date-${index}.txt`), `${shot.date || '值得珍藏的片段'}    /    ${String(index + 1).padStart(2, '0')}`)
    const filter = [
      'scale=624:664:force_original_aspect_ratio=decrease',
      'pad=720:960:(ow-iw)/2:134+(664-ih)/2:color=0xfbf4e8', 'setsar=1',
      `zoompan=z='1+0.012*on/${frames}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=${frames}:s=720x960:fps=${fps}`,
      drawText('title.txt', 27, 65), drawText(`caption-${index}.txt`, 26, 830), drawText(`date-${index}.txt`, 17, 919, '0x9a8675'), 'format=yuv420p',
    ].join(',')
    await runMedia(binary(), ['-hide_banner', '-loglevel', 'error', '-y', '-i', `image-${index}.jpg`, '-vf', filter, '-frames:v', String(frames), '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-threads', '2', `clip-${index}.mp4`], { cwd: directory, signal })
    onProgress(Math.round(15 + (index + 1) / plan.shots.length * 65))
  }
  await writeFile(path.join(directory, 'music.wav'), makeFilmMusic(duration))
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

import { encodeWav } from './wav'

// Hold-to-talk recording as 16 kHz mono PCM, so a WAV of what has been said so far can be made
// at any moment (live subtitles) and at the end (the question). StepFun ASR accepts WAV.
const TARGET_RATE = 16000
const MIN_SECONDS = 0.4

export interface Recording {
  /** Seconds recorded so far */
  seconds(): number
  /** Everything said so far, or null while it is still too short to mean anything */
  snapshot(): Blob | null
  stop(): Promise<Blob | null>
  cancel(): void
}

// Linear resampling; the context usually already runs at 16 kHz and this is a no-op
function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples
  const length = Math.round(samples.length * to / from)
  const out = new Float32Array(length)
  const step = from / to
  for (let i = 0; i < length; i++) {
    const at = i * step
    const index = Math.floor(at)
    const next = Math.min(samples.length - 1, index + 1)
    const t = at - index
    out[i] = samples[index] * (1 - t) + samples[next] * t
  }
  return out
}

export async function startRecording(): Promise<Recording> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器不支持录音')
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch {
    throw new Error('没有麦克风权限。请在浏览器地址栏允许使用麦克风')
  }
  let context: AudioContext
  try { context = new AudioContext({ sampleRate: TARGET_RATE }) } catch { context = new AudioContext() }
  await context.resume()
  const source = context.createMediaStreamSource(stream)
  // ScriptProcessor is old but runs everywhere the app runs; the output stays silent (never written)
  const processor = context.createScriptProcessor(4096, 1, 1)
  const chunks: Float32Array[] = []
  let samples = 0
  processor.onaudioprocess = (event) => {
    const data = event.inputBuffer.getChannelData(0)
    chunks.push(new Float32Array(data))
    samples += data.length
  }
  source.connect(processor)
  processor.connect(context.destination)
  const rate = context.sampleRate
  let stopped = false

  const wav = () => {
    const merged = new Float32Array(samples)
    let offset = 0
    for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length }
    return encodeWav(resample(merged, rate, TARGET_RATE), TARGET_RATE)
  }
  const teardown = () => {
    if (stopped) return
    stopped = true
    processor.onaudioprocess = null
    source.disconnect()
    processor.disconnect()
    stream.getTracks().forEach((track) => track.stop())
    void context.close()
  }
  return {
    seconds: () => samples / rate,
    snapshot: () => (stopped || samples / rate < MIN_SECONDS ? null : wav()),
    async stop() {
      teardown()
      return samples / rate < MIN_SECONDS ? null : wav()
    },
    cancel: teardown,
  }
}

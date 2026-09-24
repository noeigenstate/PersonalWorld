import { toWav } from './wav'

// Hold-to-talk recording. Returns WAV, which StepFun ASR accepts.
export async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器不支持录音，请改用键盘输入')
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch {
    throw new Error('没有麦克风权限。请在浏览器地址栏允许使用麦克风，或改用键盘输入')
  }
  const recorder = new MediaRecorder(stream)
  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
  const started = performance.now()
  recorder.start()
  return {
    async stop(): Promise<Blob | null> {
      const done = new Promise<void>((resolve) => { recorder.onstop = () => resolve() })
      recorder.stop()
      await done
      stream.getTracks().forEach((track) => track.stop())
      if (performance.now() - started < 400 || !chunks.length) return null
      return toWav(new Blob(chunks, { type: recorder.mimeType }))
    },
    cancel() {
      if (recorder.state !== 'inactive') recorder.stop()
      stream.getTracks().forEach((track) => track.stop())
    },
  }
}

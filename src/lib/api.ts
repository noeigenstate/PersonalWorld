import type { AiConfig, AnalysisResult, MemoryAsset, MemoryEvent } from '../types'

async function jsonResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`)
  return data as T
}

export async function fetchAiConfig(): Promise<AiConfig> {
  return jsonResponse<AiConfig>(await fetch('/api/config'))
}

export async function analyzeEvent(event: MemoryEvent, assets: MemoryAsset[]): Promise<AnalysisResult> {
  const images = event.assetIds
    .map((id) => assets.find((asset) => asset.id === id))
    .filter((asset): asset is MemoryAsset => Boolean(asset?.preview))
    .slice(0, 6)
    .map((asset) => ({
      name: asset.name,
      capturedAt: asset.capturedAt,
      latitude: asset.latitude,
      longitude: asset.longitude,
      dataUrl: asset.preview,
    }))
  if (!images.length) throw new Error('这个事件还没有可分析的图片预览')
  return jsonResponse<AnalysisResult>(await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Memory-Agent': 'web' },
    body: JSON.stringify({ images }),
  }))
}

export async function askMemory(question: string, events: MemoryEvent[]): Promise<string> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Memory-Agent': 'web' },
    body: JSON.stringify({ question, events }),
  })
  return (await jsonResponse<{ answer: string }>(response)).answer
}

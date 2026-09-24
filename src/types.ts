export type AssetKind = 'image' | 'video' | 'screenshot'

export interface MemoryAsset {
  id: string
  name: string
  kind: AssetKind
  mimeType: string
  size: number
  capturedAt: string
  dateSource: 'exif' | 'file'
  latitude?: number
  longitude?: number
  preview: string
  favorite: boolean
  hash: string
}

export type EventStatus = 'draft' | 'analyzed' | 'confirmed'

export interface MemoryEvent {
  id: string
  assetIds: string[]
  occurredAt: string
  title: string
  summary: string
  type: string
  place: string
  people: string[]
  visibleText: string
  tags: string[]
  questions: string[]
  confidence?: number
  status: EventStatus
}

export interface MemoryState {
  assets: MemoryAsset[]
  events: MemoryEvent[]
}

export interface AnalysisResult {
  title?: string
  summary?: string
  type?: string
  place?: string
  people?: string[]
  visibleText?: string
  tags?: string[]
  questions?: string[]
  confidence?: number
}

export interface AiConfig {
  available: boolean
  mode: 'model' | 'unconfigured' | 'agent-needs-adapter'
  message: string
}

export type AssetKind = 'image' | 'video' | 'screenshot'

export interface MemoryAsset {
  id: string
  name: string
  kind: AssetKind
  mimeType: string
  size: number
  capturedAt: string
  // exif = taken at; filename = saved at (chat apps); file = file modified at
  dateSource: 'exif' | 'filename' | 'file'
  width?: number
  height?: number
  // WGS-84, as stored in the photo's EXIF
  latitude?: number
  longitude?: number
  preview: string
  hash: string
  // 4×4 colour layout of the preview, used to rank similar photos
  signature?: number[]
  card?: PhotoCard
  context?: PhotoContext
}

export interface ContextFill {
  value: string
  fromRefIds: string[]
  reason: string
  confidence: number
}

// Written by the photo-context runtime skill
export interface PhotoContext {
  matches: { refId: string; relation: string; evidence: string; confidence: number }[]
  fills: { city: ContextFill | null; place: ContextFill | null; time: ContextFill | null; event: ContextFill | null }
  conflicts: string[]
  createdAt: string
}

export interface PhotoClue {
  kind: string
  evidence: string
  inference: string
  confidence: number
}

// Written by the photo-card runtime skill; facts are read by the app, not the model
export interface PhotoCard {
  title: string
  caption: string
  scene: string
  visibleText: string
  clues: PhotoClue[]
  landmark?: { name: string; city: string; confidence: number } | null
  eventGuess: { type: string; reason: string }
  tags: string[]
  questions: string[]
  createdAt: string
}

export type EventStatus = 'draft' | 'analyzed' | 'confirmed'
export type ValueSource = 'exif' | 'filename' | 'file' | 'gps' | 'ai' | 'user'

export interface MemoryEvent {
  id: string
  assetIds: string[]
  occurredAt: string
  endedAt?: string
  timeSource: ValueSource
  title: string
  summary: string
  type: string
  // Free-text place detail, e.g. "外滩" or "静安区南京西路"
  place: string
  // City the event belongs to; places, the space line and story lines are derived from it
  city?: string
  citySource?: ValueSource
  // WGS-84 centroid of the event's photos
  lat?: number
  lng?: number
  people: string[]
  visibleText: string
  tags: string[]
  questions: string[]
  confidence?: number
  status: EventStatus
}

export type PlaceRole = 'home' | 'study' | 'work' | 'residence' | 'travel'

export interface MemoryState {
  assets: MemoryAsset[]
  events: MemoryEvent[]
  // Roles the user has confirmed for a city; anything absent is inferred
  placeRoles: Record<string, PlaceRole>
}

export interface Place {
  city: string
  eventIds: string[]
  firstAt: string
  lastAt: string
  lat?: number
  lng?: number
  role: PlaceRole
  roleConfirmed: boolean
  isBase: boolean
}

export interface AnalysisResult {
  title?: string
  summary?: string
  type?: string
  place?: string
  city?: string
  people?: string[]
  visibleText?: string
  tags?: string[]
  questions?: string[]
  confidence?: number
}

export interface GeocodeResult {
  id: string
  city: string
  district: string
  address: string
}

export interface AiConfig {
  available: boolean
  mode: 'model' | 'unconfigured' | 'agent-needs-adapter'
  message: string
  geocode: boolean
  amapJsKey?: string
}

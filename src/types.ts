export type AssetKind = 'image' | 'video' | 'screenshot'

export interface MemoryAsset {
  id: string
  name: string
  kind: AssetKind
  mimeType: string
  size: number
  capturedAt: string
  dateSource: 'exif' | 'file'
  // WGS-84, as stored in the photo's EXIF
  latitude?: number
  longitude?: number
  preview: string
  hash: string
}

export type EventStatus = 'draft' | 'analyzed' | 'confirmed'
export type ValueSource = 'exif' | 'file' | 'gps' | 'ai' | 'user'

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

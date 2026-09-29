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
  // 'none' when the file carries no EXIF at all (chat apps strip it unless sent as original)
  metadata?: 'exif' | 'none'
  camera?: { make?: string; model?: string; lens?: string }
  // WGS-84, as stored in the photo's EXIF
  latitude?: number
  longitude?: number
  altitude?: number
  // Compass bearing the camera faced, 0 = north
  direction?: number
  // Place names written into IPTC/XMP by the camera or an editing app
  metaPlace?: string
  // Finest known place for this photo; see src/lib/location.ts for the resolution order
  location?: PhotoLocation
  // Set once the automatic locating queue has looked at this photo's content
  locateTried?: boolean
  preview: string
  hash: string
  // 4×4 colour layout of the preview, used to rank similar photos
  signature?: number[]
  // Pixel statistics of the preview for finding near-duplicates (src/lib/cull.ts)
  look?: PhotoLook
  card?: PhotoCard
  context?: PhotoContext
}

export interface PhotoLook {
  // 64-bit difference hash as 16 hex digits; empty when the preview could not be measured
  dhash: string
  // Variance of the Laplacian on a 320 px copy: higher is sharper
  sharpness: number
  // Mean luminance 0–255 and the share of clipped pixels
  brightness: number
  clipped: number
}

export interface PhotoLocation {
  source: 'gps' | 'meta' | 'landmark' | 'text' | 'peer' | 'user'
  precision: 'point' | 'poi' | 'street' | 'district' | 'city' | 'province'
  // GCJ-02 [lng, lat] as AMap returns it; for GPS photos the EXIF WGS-84 stays on the asset
  gcj?: [number, number]
  province?: string
  city?: string
  district?: string
  township?: string
  street?: string
  number?: string
  aoi?: string
  poi?: { name: string; distance?: number }
  label: string
  evidence?: string
  confidence: number
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
  // Best text to search on the map for where this was taken, from a landmark or readable place name
  // level: how far the text can place it (a POI, or only a district / city / province)
  placeQuery?: { text: string; city: string; from: 'landmark' | 'text'; level?: 'poi' | 'district' | 'city' | 'province'; confidence: number } | null
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
  // A live projection from the story graph, never persisted as a user fact.
  understanding?: EventUnderstanding
}

export interface EventUnderstanding {
  title: string
  summary: string
  insights: { text: string; assetIds: string[] }[]
  photos?: { assetId: string; title: string; caption: string }[]
  motifs: string[]
  openQuestions: string[]
  revision: string
  updatedAt?: number
}

export type PlaceRole = 'home' | 'study' | 'work' | 'residence' | 'travel'

export interface MemoryState {
  assets: MemoryAsset[]
  events: MemoryEvent[]
  // Roles the user has confirmed for a city; anything absent is inferred
  placeRoles: Record<string, PlaceRole>
  // Automatically generate cards for imported photos; the user can pause the queue
  autoPhotoCards?: boolean
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
  localReview?: boolean
  available: boolean
  mode: 'model' | 'unconfigured'
  message: string
  geocode: boolean
  amapJsKey?: string
  amapStyle?: string
}

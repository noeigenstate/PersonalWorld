import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, CircleHelp, LogOut, Plus, Upload, UserRound, X } from 'lucide-react'
import { CakeLogo } from './components/CakeLogo'
import { analyzeEvent, askButler, fetchAiConfig, fetchWorldDataStatus, retryWorldData, type WorldDataStatus, generatePhotoCard, geocode, inferFromPeers, speak, transcribe, type Account, type ButlerAction, type ButlerFocus, type ButlerMemoryPhoto, type ButlerState, type ButlerTurn } from './lib/api'
import { colorSignature, knownAbout, pickReferences } from './lib/peers'
import { better, inheritFromEvent } from './lib/location'
import { gcj02ToWgs84, wgs84ToGcj02 } from './lib/geo'
import { photoFacts as factsOf } from './lib/photoFacts'
import type { MapPhoto } from './map/scene'
import { detailedAddresses, locateAddress, searchPlace } from './map/amap'
import type { PhotoFacts } from './lib/photoFacts'
import { importFiles } from './lib/import'
import { baseAt, cityLabel, derivePlaces, firstsOf, formatYearMonth, lastsOf, movesForButler, regroupDrafts, roleLabels, spaceLine, storyLine } from './lib/memory'
import { startRecording, type Recording } from './lib/recorder'
import { geocodeInBrowser } from './map/amap'
import { visitRoutes } from './lib/storyRoutes'
import { loadMemory, removeFile, restoredFromVault, saveMemory } from './lib/storage'
import { scenePhotos } from './lib/spacetime'
import type { AiConfig, MemoryAsset, MemoryEvent, MemoryState, PhotoLook, PlaceRole } from './types'
import { VoiceButler, type Subtitle, type VoiceState } from './components/VoiceButler'
import { Showcase, type ShowcaseState } from './components/Showcase'
import { StoryStage } from './components/StoryStage'
import { recentStories, shouldMoveStoryMap, type NarratedStory, type StorySummary } from './lib/storytelling'
import { EventDetail, statusLabel } from './components/EventDetail'
import { ImportDialog } from './components/ImportDialog'
import { LifeMapView } from './components/LifeMapView'
import { BackgroundProgress, LoadingGate, type GateStep } from './components/LoadingGate'
import { TimelineBar } from './components/TimelineBar'
import { MemoryFilms, type FilmSummary } from './components/MemoryFilms'
import { SpacetimeScene } from './components/SpacetimeScene'
import { useSceneCoverage } from './lib/useSceneCoverage'
import { useMemoryGraph } from './lib/useMemoryGraph'
import { understoodEvents } from './lib/eventUnderstanding'
import { MemoryLibrary } from './components/MemoryLibrary'
import { PhotoCull } from './components/PhotoCull'
import { SceneCoverage } from './components/SceneCoverage'
import type { StoryChapter } from './lib/memoryGraph'

const initialMemory: MemoryState = { assets: [], events: [], placeRoles: {}, autoPhotoCards: true }
// The photo stage the butler opens on the right (520 px panel + margins)
const SHOWCASE_WIDTH = 560
const TIMEBAR_HEIGHT = 88
// The glass top bar covers the top 52 px of the map
const CHROME_TOP = 52
// Live subtitles: what has been said so far is recognised again this often while the button is held
const LIVE_ASR_INTERVAL = 1500
const SLIDE_MS = 4500
const uid = () => crypto.randomUUID()
const years = (from: string, to: string) => Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / (365.25 * 86400000)))
const localDay = (value: string) => new Date(value).toLocaleDateString('sv-SE')

// Sentences for speech, none much longer than 40 characters, so the first clip comes back fast;
// fragments of a few characters ride along with the sentence before them
export function speechChunks(text: string, max = 40): string[] {
  const sentences = text.match(/[^。！？!?；;\n]+[。！？!?；;\n]*/g) || [text]
  const out: string[] = []
  for (const sentence of sentences) {
    const pieces = sentence.length > max ? sentence.match(/[^，,、]+[，,、]*/g) || [sentence] : [sentence]
    let current = ''
    for (const piece of pieces) {
      if (current && current.length + piece.length > max) { out.push(current); current = '' }
      current += piece
    }
    if (current) out.push(current)
  }
  return out.reduce<string[]>((list, part) => {
    if (list.length && part.trim().length < 4) list[list.length - 1] += part
    else list.push(part)
    return list
  }, []).filter((part) => part.trim())
}

export default function App({ account, onSignOut }: { account: Account; onSignOut: () => void }) {
  const [memory, setMemory] = useState<MemoryState>(initialMemory)
  const [ready, setReady] = useState(false)
  const [filmChapter, setFilmChapter] = useState<{chapter:StoryChapter;at:number}|null>(null)
  const [aiConfig, setAiConfig] = useState<AiConfig>({ available: false, mode: 'unconfigured', message: '正在检查 AI 连接…', geocode: false })
  const [configChecked, setConfigChecked] = useState(false)
  const [selectedCity, setSelectedCity] = useState<string | null>(null)
  const [globeOverview, setGlobeOverview] = useState(true)
  const [highlightedEventId, setHighlightedEventId] = useState<string | null>(null)
  const [timelineAt, setTimelineAt] = useState<number | null>(null)
  const [activeEventId, setActiveEventId] = useState<string | null>(null)
  const [openPhotoId, setOpenPhotoId] = useState<string | null>(null)
  const [mapFocus, setMapFocus] = useState<{ photo: MapPhoto; at: number } | null>(null)
  const [landmarkPreviewAt, setLandmarkPreviewAt] = useState(0)
  const [sceneEnabled, setSceneEnabled] = useState(true)
  const [routeId, setRouteId] = useState('')
  const [locating, setLocating] = useState<{ done: number; total: number } | null>(null)
  const stopLocating = useRef(false)
  const autoRun = useRef(false)
  const [autoBusyIds, setAutoBusyIds] = useState<string[]>([])
  const [importOpen, setImportOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [trayOpen, setTrayOpen] = useState(false)
  const [busyEventId, setBusyEventId] = useState<string | null>(null)
  const [cardBusyId, setCardBusyId] = useState<string | null>(null)
  const [contextBusyId, setContextBusyId] = useState<string | null>(null)
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null)
  const [notice, setNotice] = useState('')
  // What the loading gate waits for besides the analysis (see LoadingGate)
  const [worldData, setWorldData] = useState<WorldDataStatus | null>(null)
  const [worldDataUnreachable, setWorldDataUnreachable] = useState(false)
  const [mapReady, setMapReady] = useState(false)
  const [analysisError, setAnalysisError] = useState('')
  // The life butler: subtitles over the map instead of a chat window
  const [subtitle, setSubtitle] = useState<Subtitle | null>(null)
  const [focus, setFocus] = useState<ButlerFocus | null>(null)
  const [asking, setAsking] = useState(false)
  const [askingStory, setAskingStory] = useState(false)
  const [voiceState, setVoiceState] = useState<VoiceState>('idle')
  const [speaking, setSpeaking] = useState(false)
  const [showcase, setShowcase] = useState<ShowcaseState | null>(null)
  const [narratedStory, setNarratedStory] = useState<NarratedStory | null>(null)
  const [storyChoices, setStoryChoices] = useState<StorySummary[]>([])
  const lastStoryPoint = useRef<[number, number] | undefined>(undefined)
  const [pendingRoleCity, setPendingRoleCity] = useState<string | null>(null)
  const [libraryOpen, setLibraryOpen] = useState<{ tab?: 'people' | 'stories'; at: number } | null>(null)
  const [spacetimeOpen, setSpacetimeOpen] = useState<{ at: number } | null>(null)
  const [filmPlay, setFilmPlay] = useState<{ id?: string; at: number } | null>(null)
  const [filmMake, setFilmMake] = useState<{ assetIds?: string[]; at: number } | null>(null)
  const [films, setFilms] = useState<FilmSummary[]>([])
  // This computer has FFmpeg + Python + Pillow, so new films can be cut
  const [filmCapable, setFilmCapable] = useState(false)
  const history = useRef<ButlerTurn[]>([])
  const recording = useRef<Recording | null>(null)
  const liveTimer = useRef(0)
  const hideTimer = useRef(0)
  // The person has addressed the butler by voice or text, so it may speak too
  const voiceUsed = useRef(false)
  const audio = useRef<HTMLAudioElement | null>(null)
  const speechDone = useRef<(() => void) | null>(null)
  // Bumped to interrupt the sentence-by-sentence speech loop
  const speechToken = useRef(0)
  // Bumped to end a guided story (a `story` action) when the person takes over
  const tourToken = useRef(0)
  const aiRef = useRef(aiConfig); aiRef.current = aiConfig
  const showcaseRef = useRef(showcase); showcaseRef.current = showcase
  const geocoded = useRef(new Set<string>())

  const refreshStories = useCallback(() => { void recentStories().then(result => setStoryChoices(result.stories)).catch(() => {}) }, [])
  useEffect(() => { if (ready) refreshStories() }, [ready, refreshStories])

  useEffect(() => {
    loadMemory().then((data) => {
      setMemory(data)
      setReady(true)
      if (restoredFromVault()) setNotice(`已从本机照片库恢复 ${restoredFromVault()} 张照片`)
    }).catch(() => setReady(true))
    fetchAiConfig().then(setAiConfig).catch(() => setAiConfig({ available: false, mode: 'unconfigured', message: 'AI 服务未启动；本地整理仍可使用', geocode: false }))
      .finally(() => setConfigChecked(true))
  }, [])

  useEffect(() => {
    if (!ready) return
    saveMemory(memory).catch((error) => {
      console.error('本地保存失败', error)
      const reason = error instanceof DOMException && error.name === 'QuotaExceededError' ? '浏览器可用空间不足' : error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      setNotice(`浏览器缓存没能保存（${reason}）；照片仍会备份到本机照片库`)
    })
  }, [memory, ready])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 5200)
    return () => window.clearTimeout(timer)
  }, [notice])

  // Name the city of every located event once: web-service key on the server,
  // otherwise the JS API geocoder in the browser
  useEffect(() => {
    if (!ready || (!aiConfig.geocode && !aiConfig.amapJsKey)) return
    const pending = memory.events.filter((e) => !e.city && e.lat !== undefined && e.lng !== undefined && !geocoded.current.has(e.id))
    if (!pending.length) return
    pending.forEach((e) => geocoded.current.add(e.id))
    const points = pending.map((e) => ({ id: e.id, lat: e.lat!, lng: e.lng! }))
    ;(aiConfig.geocode ? geocode(points) : geocodeInBrowser(aiConfig.amapJsKey!, points))
      .then((results) => setMemory((current) => ({
        ...current,
        events: current.events.map((event) => {
          const hit = results.find((r) => r.id === event.id)
          if (!hit?.city || event.city) return event
          return { ...event, city: hit.city, citySource: 'gps', place: event.place || hit.address }
        }),
      })))
      .catch((error) => setNotice(error instanceof Error ? error.message : '地名识别失败'))
  }, [memory.events, ready, aiConfig.geocode, aiConfig.amapJsKey])

  // Place of each photo, finest first: its own GPS, then place names in its metadata.
  // (The picture itself is used after a photo card is generated; see makePhotoCard.)
  const located = useRef(new Set<string>())
  useEffect(() => {
    const key = aiConfig.amapJsKey
    if (!ready || !key) return
    const withGps = memory.assets.filter((a) => a.latitude !== undefined && a.longitude !== undefined && a.location?.source !== 'gps' && !located.current.has(a.id))
    const withName = memory.assets.filter((a) => a.metaPlace && !a.location && a.latitude === undefined && !located.current.has(a.id))
    if (!withGps.length && !withName.length) return
    ;[...withGps, ...withName].forEach((a) => located.current.add(a.id))
    ;(async () => {
      const found = await detailedAddresses(key, withGps.map((a) => ({ id: a.id, lat: a.latitude!, lng: a.longitude! })))
      for (const a of withName) {
        const hit = await locateAddress(key, a.metaPlace!).catch(() => undefined)
        if (hit) found.set(a.id, hit)
      }
      if (found.size) setMemory((current) => ({ ...current, assets: current.assets.map((a) => (found.has(a.id) ? { ...a, location: better(a.location, found.get(a.id)) } : a)) }))
    })().catch((error) => setNotice(error instanceof Error ? error.message : '地址识别失败'))
  }, [memory.assets, ready, aiConfig.amapJsKey])

  // Photos imported before signatures existed get one once
  useEffect(() => {
    if (!ready) return
    const missing = memory.assets.filter((a) => !a.signature && a.preview && a.kind !== 'video')
    if (!missing.length) return
    let cancelled = false
    Promise.all(missing.map(async (a) => [a.id, await colorSignature(a.preview).catch(() => undefined)] as const)).then((pairs) => {
      if (cancelled) return
      const found = new Map(pairs.filter(([, sig]) => sig))
      setMemory((current) => ({ ...current, assets: current.assets.map((a) => (found.has(a.id) ? { ...a, signature: found.get(a.id) } : a)) }))
    })
    return () => { cancelled = true }
  }, [memory.assets, ready])

  const library = useMemoryGraph(memory.assets, memory.events, ready, importing || autoBusyIds.length > 0 || Boolean(cardBusyId))
  const events = useMemo(() => [...understoodEvents(memory.events, memory.assets, library.state)].sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()), [memory.events, memory.assets, library.state?.graph.revision])
  const places = useMemo(() => derivePlaces(events, memory.placeRoles), [events, memory.placeRoles])
  const bases = useMemo(() => spaceLine(places), [places])
  const story = useMemo(() => (selectedCity ? storyLine(selectedCity, events, places) : []), [selectedCity, events, places])
  const storyIds = useMemo(() => new Set(story.map((e) => e.id)), [story])
  const storyAssetIds = useMemo(() => new Set(story.flatMap((e) => e.assetIds)), [story])
  const routes = useMemo(() => visitRoutes(story), [story])
  const routeEventIds = useMemo(() => routes.find((route) => route.id === routeId)?.eventIds || [], [routes, routeId])
  const firsts = useMemo(() => firstsOf(events), [events])
  const lasts = useMemo(() => lastsOf(events, places), [events, places])
  const needsWork = events.filter((e) => !e.city || e.status === 'draft')
  const analyzablePhotos = memory.assets.filter((a) => a.preview && a.kind !== 'video')
  const pendingPhotoCards = analyzablePhotos.filter((a) => !a.card?.scene?.trim()).length
  const hasImages = (event: MemoryEvent) => event.assetIds.some((id) => { const a = memory.assets.find((x) => x.id === id); return Boolean(a?.preview && a.kind !== 'video') })
  const pendingAnalysis = memory.events.filter((e) => e.status === 'draft' && hasImages(e)).length
  // ---- The loading gate: the map opens once its data, the map itself and the analysis are done
  const megabytes = (bytes: number) => (bytes / 1048576).toFixed(0)
  const analysisPaused = memory.autoPhotoCards === false
  const photosWithEvents = memory.events.filter(hasImages).length
  const cardsDone = analyzablePhotos.length - pendingPhotoCards
  const gateSteps: GateStep[] = [
    (() => {
      const step = { id: 'data', label: '地图数据' }
      if (worldDataUnreachable) return { ...step, state: 'error', detail: '连接不到服务，请确认 npm run dev 在运行' }
      const s = worldData
      if (!s || s.state === 'checking') return { ...step, state: 'active', detail: '正在检查本机的地图数据…' }
      if (s.state === 'ready') return { ...step, state: 'done', detail: '街区地图数据已在本机' }
      if (s.state === 'unavailable') return { ...step, state: 'done', detail: s.message }
      if (s.state === 'verifying') return { ...step, state: 'active', detail: '正在校验文件完整性…', progress: 1 }
      if (s.state === 'error') return { ...step, state: 'error', detail: s.error, action: { label: '重试下载', onClick: () => { void retryWorldData().then(setWorldData).catch((error) => setNotice(error instanceof Error ? error.message : '重试失败')) } } }
      const left = s.speed > 0 ? Math.ceil((s.total - s.received) / s.speed) : 0
      return { ...step, state: 'active', progress: s.total ? s.received / s.total : 0, detail: `正在下载 ${s.file}：${megabytes(s.received)}/${megabytes(s.total)} MB${s.speed ? ` · ${(s.speed / 1048576).toFixed(1)} MB/s · 约 ${left > 90 ? `${Math.ceil(left / 60)} 分钟` : `${left} 秒`}` : ''}` }
    })(),
    mapReady ? { id: 'map', label: '地图', state: 'done', detail: '地球和街区地图已加载' } : { id: 'map', label: '地图', state: 'active', detail: aiConfig.amapJsKey ? '正在加载高德地图和卡通世界…' : '正在加载地图…' },
    !ready || importing
      ? { id: 'library', label: '照片库', state: 'active', detail: importing ? '正在导入影像…' : '正在读取照片库…' }
      : { id: 'library', label: '照片库', state: 'done', detail: memory.assets.length ? `${memory.assets.length} 个影像` : '还没有导入照片' },
    (() => {
      const step = { id: 'cards', label: '照片信息卡', progress: analyzablePhotos.length ? cardsDone / analyzablePhotos.length : undefined }
      if (!pendingPhotoCards) return { ...step, state: 'done', detail: analyzablePhotos.length ? `${analyzablePhotos.length} 张照片已分析` : '没有需要分析的照片' }
      if (configChecked && !aiConfig.available) return { ...step, state: 'error', detail: `${aiConfig.message}。在 .env 配置 StepFun 后重启服务` }
      if (analysisPaused) return { ...step, state: 'paused', detail: `已暂停，还有 ${pendingPhotoCards} 张${analysisError ? `：${analysisError}` : ''}`, action: { label: '继续分析', onClick: resumeAnalysis } }
      return { ...step, state: 'active', detail: locating ? `正在分析照片 ${cardsDone}/${analyzablePhotos.length}` : `等待分析 ${pendingPhotoCards} 张` }
    })(),
    (() => {
      const step = { id: 'events', label: '事件分析', progress: photosWithEvents ? (photosWithEvents - pendingAnalysis) / photosWithEvents : undefined }
      if (!pendingAnalysis) return { ...step, state: 'done', detail: photosWithEvents ? `${photosWithEvents} 件事已分析` : '没有需要分析的事件' }
      if (configChecked && !aiConfig.available) return { ...step, state: 'error', detail: '需要 StepFun，见上一步' }
      if (analysisPaused) return { ...step, state: 'paused', detail: `已暂停，还有 ${pendingAnalysis} 件`, action: pendingPhotoCards ? undefined : { label: '继续分析', onClick: resumeAnalysis } }
      if (pendingPhotoCards) return { ...step, state: 'waiting', detail: `照片信息卡完成后开始，共 ${pendingAnalysis} 件` }
      return { ...step, state: 'active', detail: busyEventId ? `正在分析事件，还有 ${pendingAnalysis} 件` : `等待分析 ${pendingAnalysis} 件` }
    })(),
  ] as GateStep[]
  // Map data, the map and the library hold the map back; the analysis runs in the background
  const gateOpen = gateSteps.some((step) => ['data', 'map', 'library'].includes(step.id) && step.state !== 'done')
  const analysisSteps = gateSteps.filter((step) => step.id === 'cards' || step.id === 'events')
  const analysisInBackground = !gateOpen && analysisSteps.some((step) => step.state !== 'done')
  const activeEvent = events.find((e) => e.id === activeEventId)
  const eventCovers = useMemo(() => {
    const assets = new Map(memory.assets.map((asset) => [asset.id, asset]))
    return Object.fromEntries(events.flatMap((event) => {
      const images = event.assetIds.map((id) => assets.get(id)).filter((asset) => asset?.preview && asset.kind !== 'video')
      const names = images.map(asset => asset?.location?.aoi || asset?.location?.poi?.name).filter(Boolean)
      const place = names.length && new Set(names).size === 1 ? names[0] : undefined
      return images.length ? [[event.id, { preview: images[0]!.preview, count: images.length, place }]] : []
    }))
  }, [events, memory.assets])
  // Every photo with a place, for the map's photo layer
  const mapPhotos = useMemo<MapPhoto[]>(() => memory.assets.flatMap((a) => {
    if (!a.preview || a.kind === 'video') return []
    const gcj = a.location?.gcj || (a.latitude !== undefined && a.longitude !== undefined ? (({ lat, lng }) => [lng, lat] as [number, number])(wgs84ToGcj02({ lat: a.latitude, lng: a.longitude! })) : undefined)
    if (!gcj) return []
    const cardLandmark = a.card?.landmark && a.card.landmark.confidence >= 0.7 ? a.card.landmark.name : undefined
    const nearbyLandmark = a.location?.poi?.name || (a.location?.precision === 'poi' ? a.location.label : undefined)
    const placeLandmark = /东方明珠|oriental\s*pearl/i.test(nearbyLandmark || '') ? nearbyLandmark : undefined
    // A photo with its own GPS is an exact point on the map even where AMap cannot name a street
    // or place for it; the location's own precision describes the address, not the position
    const precision = a.latitude !== undefined && a.longitude !== undefined ? 'point' : a.location?.precision || 'point'
    return [{ id: a.id, name: a.name, gcj, preview: a.preview, inferred: Boolean(a.location && !['gps', 'meta', 'user'].includes(a.location.source)), precision, venueName: a.location?.aoi || a.location?.poi?.name, landmark: cardLandmark || placeLandmark, landmarkSource: cardLandmark ? 'photo' : placeLandmark ? 'place' : undefined, sceneCard: a.card ? { title: a.card.title, caption: a.card.caption, scene: a.card.scene, tags: a.card.tags, eventGuess: a.card.eventGuess, createdAt: a.card.createdAt } : undefined }]
  }), [memory.assets])
  const visibleMapPhotos = useMemo(() => {
    if (timelineAt === null) return mapPhotos
    const captured = new Map(memory.assets.map((asset) => [asset.id, Date.parse(asset.capturedAt)]))
    return mapPhotos.filter((photo) => (captured.get(photo.id) ?? Infinity) <= timelineAt + 86400000)
  }, [mapPhotos, memory.assets, timelineAt])
  const sceneCoverage = useSceneCoverage(memory.assets, mapPhotos, ready && !locating)
  // The photos' information cards without pictures: what the butler searches by meaning
  const photoIndex = useMemo<ButlerMemoryPhoto[]>(() => {
    const people = library.state?.people || []
    const memberships = library.state?.graph.memberships || {}
    return memory.assets.flatMap((a) => {
      if (!a.preview || a.kind === 'video') return []
      const event = memory.events.find((e) => e.assetIds.includes(a.id))
      const names = (memberships[a.id] || []).map((pid) => { const p = people.find((x) => x.id === pid); return p?.name || p?.relationship || '' }).filter(Boolean)
      return [{
        id: a.id, eventId: event?.id || '', date: localDay(a.capturedAt), dateSource: a.dateSource,
        city: a.location?.city || event?.city || '', place: a.location?.aoi || a.location?.poi?.name || a.location?.label || event?.place || '',
        title: a.card?.title || '', caption: a.card?.caption || '', scene: a.card?.scene || '', tags: a.card?.tags || [], people: names,
      }]
    })
  }, [memory.assets, memory.events, library.state?.graph.revision, library.state?.revision])

  function openPhoto(assetId: string) {
    const event = memory.events.find((e) => e.assetIds.includes(assetId))
    if (!event) return
    setOpenPhotoId(assetId)
    setActiveEventId(event.id)
  }

  function reportAnalysisPause(error: unknown) {
    const message = error instanceof Error ? error.message : ''
    setAnalysisError(message)
    setNotice(message ? `自动分析已暂停：${message}` : '自动分析已暂停')
  }
  // Also forgets the events tried in this session, so the one that failed is analyzed again
  function resumeAnalysis() {
    stopLocating.current = false
    analysed.current.clear()
    setAnalysisError('')
    setMemory((current) => ({ ...current, autoPhotoCards: true }))
  }

  // The map data download on the service computer, polled until it is in place
  useEffect(() => {
    let stopped = false
    let timer = 0
    const poll = async () => {
      let delay = 1000
      try {
        const status = await fetchWorldDataStatus()
        if (stopped) return
        setWorldData(status)
        setWorldDataUnreachable(false)
        if (status.state === 'ready' || status.state === 'unavailable') return
        if (status.state === 'error') delay = 3000
      } catch {
        if (stopped) return
        setWorldDataUnreachable(true)
        delay = 3000
      }
      timer = window.setTimeout(poll, delay)
    }
    void poll()
    return () => { stopped = true; clearTimeout(timer) }
  }, [])

  // Analyze actual imported photos in the browser's account database, two at a time. Existing
  // Complete cards are kept; legacy cards with no observation need repair. Photos without
  // their own location can additionally use the card's place clue.
  useEffect(() => {
    const key = aiConfig.amapJsKey
    if (!ready || !aiConfig.available || memory.autoPhotoCards === false || autoRun.current) return
    const queue = memory.assets.filter((a) => a.preview && a.kind !== 'video' && (
      !a.card?.scene?.trim() || (key && !a.location && !a.locateTried && a.latitude === undefined && !a.metaPlace)
    )).sort((a, b) => Number(!b.location && b.latitude === undefined) - Number(!a.location && a.latitude === undefined))
    if (!queue.length) return
    autoRun.current = true
    stopLocating.current = false
    setLocating({ done: 0, total: queue.length })
    ;(async () => {
      let done = 0
      const worker = async () => {
        for (let asset = queue.shift(); asset && !stopLocating.current; asset = queue.shift()) {
          const event = memory.events.find((e) => e.assetIds.includes(asset!.id))
          setAutoBusyIds((ids) => [...ids, asset.id])
          try {
            const card = asset.card?.scene?.trim() ? asset.card : { ...(await generatePhotoCard(asset, factsOf(asset, event))), createdAt: new Date().toISOString() }
            const needsPlace = !asset.location && asset.latitude === undefined && !asset.metaPlace
            const found = needsPlace && key && card.placeQuery ? await searchPlace(key, card.placeQuery).catch(() => undefined) : undefined
            const id = asset.id
            setMemory((current) => ({
              ...current,
              assets: current.assets.map((a) => (a.id === id ? { ...a, card: a.card?.scene?.trim() ? a.card : card, locateTried: needsPlace && key ? true : a.locateTried, location: better(a.location, found) } : a)),
              // The event takes the place too (a dashed, unconfirmed city), with coordinates so the map can draw it
              events: found?.city || found?.province ? current.events.map((e) => {
                if (!e.assetIds.includes(id) || e.city) return e
                const wgs = found.gcj ? gcj02ToWgs84({ lng: found.gcj[0], lat: found.gcj[1] }) : undefined
                return { ...e, city: found.city || found.province, citySource: 'ai', place: e.place || found.label, lat: e.lat ?? wgs?.lat, lng: e.lng ?? wgs?.lng }
              }) : current.events,
            }))
          } catch (error) {
            stopLocating.current = true
            setMemory((current) => ({ ...current, autoPhotoCards: false }))
            reportAnalysisPause(error)
          } finally {
            setAutoBusyIds((ids) => ids.filter((id) => id !== asset.id))
          }
          done++
          setLocating((p) => (p ? { ...p, done } : p))
        }
      }
      try {
        await Promise.all([worker(), worker()])
        // Share places within events
        setMemory((current) => {
          const inherited = inheritFromEvent(current.assets, current.events)
          if (!inherited.size) return current
          return { ...current, assets: current.assets.map((a) => (inherited.has(a.id) ? { ...a, location: inherited.get(a.id) } : a)) }
        })
      } finally {
        autoRun.current = false
        setLocating(null)
      }
    })().catch((error) => {
      setMemory((current) => ({ ...current, autoPhotoCards: false }))
      reportAnalysisPause(error)
    })
  }, [memory.assets, memory.events, memory.autoPhotoCards, ready, aiConfig.available, aiConfig.amapJsKey])

  // Events analyze themselves, one at a time, after the photo cards; the person only corrects and
  // confirms. A failure pauses the queue together with the cards (the chip on the map resumes it).
  const analysed = useRef(new Set<string>())
  useEffect(() => {
    // autoRun: the card queue above claims the same render before `locating` is set
    if (!ready || !aiConfig.available || memory.autoPhotoCards === false || importing || busyEventId || locating || autoRun.current) return
    const next = memory.events.find((e) => e.status === 'draft' && !analysed.current.has(e.id) && hasImages(e))
    if (!next) return
    analysed.current.add(next.id)
    void runAnalysis(next)
  }, [memory.events, memory.assets, memory.autoPhotoCards, ready, aiConfig.available, importing, busyEventId, locating]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedPlace = places.find((p) => p.city === selectedCity)

  const updateEvent = useCallback((next: MemoryEvent) => {
    const { understanding: _interpretation, ...source } = next
    setMemory((current) => ({ ...current, events: current.events.map((e) => (e.id === next.id ? source : e)) }))
  }, [])

  // ---- The life butler's voice: subtitles and speech --------------------------------------
  const stopSpeaking = useCallback(() => {
    speechToken.current++
    audio.current?.pause()
    audio.current = null
    speechDone.current?.()
    speechDone.current = null
    setSpeaking(false)
  }, [])

  const playClip = (url: string) => new Promise<void>((resolve) => {
    const player = new Audio(url)
    audio.current = player
    speechDone.current = resolve
    player.onended = () => resolve()
    player.onerror = () => resolve()
    player.play().catch(() => resolve())
  })

  // Reads text aloud sentence by sentence: every sentence is requested at once, the short first
  // one is ready in about a second while the rest load, and `onSentence` gets the text heard so
  // far as each starts — so the subtitle keeps pace with the voice. Resolves when done or
  // interrupted; true if anything was heard.
  const say = useCallback(async (text: string, onSentence?: (heardSoFar: string) => void) => {
    stopSpeaking()
    if (!aiRef.current.available || !text.trim()) return false
    const token = speechToken.current
    const parts = speechChunks(text)
    const clips = parts.map((part) => speak(part).then((blob) => URL.createObjectURL(blob)).catch(() => null))
    setSpeaking(true)
    let heard = false
    try {
      for (let i = 0; i < parts.length; i++) {
        const url = await clips[i]
        if (speechToken.current !== token) break
        onSentence?.(parts.slice(0, i + 1).join(''))
        if (!url) continue
        heard = true
        await playClip(url)
      }
    } finally {
      void Promise.all(clips).then((urls) => urls.forEach((url) => { if (url) URL.revokeObjectURL(url) }))
      if (speechToken.current === token) { audio.current = null; speechDone.current = null; setSpeaking(false) }
    }
    return heard
  }, [stopSpeaking])

  const scheduleHide = useCallback((ms: number) => {
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setSubtitle(null), ms)
  }, [])
  const showSubtitle = useCallback((next: Omit<Subtitle, 'id'>, hideAfter = 0) => {
    window.clearTimeout(hideTimer.current)
    setSubtitle({ id: uid(), ...next })
    if (hideAfter) scheduleHide(hideAfter)
  }, [scheduleHide])
  const dismissSubtitle = () => { window.clearTimeout(hideTimer.current); setSubtitle(null) }

  // The butler's answer: subtitle and voice together, sentence by sentence. If the first clip
  // takes longer than 1.5 s (or speech is unavailable) the whole text shows and the voice catches up.
  const narrate = useCallback(async (text: string) => {
    if (!aiRef.current.available) { showSubtitle({ role: 'assistant', text }); return }
    let shownAll = false, revealed = false
    const fallback = window.setTimeout(() => { if (!revealed) { shownAll = true; showSubtitle({ role: 'assistant', text }) } }, 1500)
    const heard = await say(text, (heardSoFar) => { revealed = true; window.clearTimeout(fallback); if (!shownAll) showSubtitle({ role: 'assistant', text: heardSoFar }) })
    window.clearTimeout(fallback)
    if (!heard && !shownAll) showSubtitle({ role: 'assistant', text })
  }, [say, showSubtitle])

  // Choosing a place on the map makes the butler speak first (as a subtitle; aloud once the
  // person has used their voice). There is no separate entry.
  const selectCity = useCallback((city: string | null, announce = true) => {
    if (announce) setNarratedStory(null)
    setSelectedCity(city)
    setGlobeOverview(!city)
    setRouteId('')
    setHighlightedEventId(null)
    if (!city) { setFocus(null); setMapFocus(null); setLandmarkPreviewAt(0); return }
    const place = places.find((p) => p.city === city)
    if (!place) return
    setFocus({ city, from: place.firstAt.slice(0, 10), to: place.lastAt.slice(0, 10) })
    if (!announce) return
    const name = cityLabel(city)
    const count = storyLine(city, events, places).length
    let text = place.isBase
      ? `你在${name}生活了 ${years(place.firstAt, place.lastAt)} 年，我记得这里的 ${count} 件事。可以沿时间线看看这些回忆，想聊哪一段？`
      : `你在${formatYearMonth(place.firstAt)}来过${name}，我记得这里的 ${place.eventIds.length} 件事，想聊哪一次？`
    // Films cut from this place's photos are offered, so the capability has a way in
    const here = new Set(storyLine(city, events, places).flatMap((e) => e.assetIds))
    const filmsHere = films.filter((f) => f.assetIds.some((id) => here.has(id))).length
    if (filmsHere) text += ` 这里还有 ${filmsHere} 段回忆短片，想看就说"放短片"。`
    if (place.isBase && !place.roleConfirmed) { text += ` ${name}对你来说是老家、求学、工作还是居住的地方？`; setPendingRoleCity(city) }
    if (voiceUsed.current) void narrate(text).then(() => scheduleHide(8000))
    else showSubtitle({ role: 'assistant', text }, 14000)
  }, [events, places, films, showSubtitle, narrate, scheduleHide])

  async function handleFiles(files: File[]) {
    if (!files.length || importing) return
    setImporting(true)
    try {
      const result = await importFiles(files, memory.assets.map((a) => a.hash))
      if (result.assets.length) {
        setMemory((current) => ({ ...current, assets: [...current.assets, ...result.assets], events: regroupDrafts(current, result.assets) }))
        setImportOpen(false)
      }
      const parts = [`已导入 ${result.assets.length} 个影像`]
      if (result.duplicates) parts.push(`跳过 ${result.duplicates} 个重复文件`)
      if (result.rejected.length) parts.push(result.rejected.slice(0, 2).join('；'))
      setNotice(parts.join(' · '))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '导入失败，请重试')
    } finally {
      setImporting(false)
    }
  }

  // Automatic: the result is merged into the event as it is by then, never over a confirmation
  async function runAnalysis(event: MemoryEvent) {
    setBusyEventId(event.id)
    try {
      const result = await analyzeEvent(event, memory.assets)
      const aiCity = result.city?.trim()
      setMemory((current) => ({
        ...current,
        events: current.events.map((e) => {
          if (e.id !== event.id || e.status === 'confirmed') return e
          const keepCity = Boolean(e.city && e.citySource !== 'ai')
          return {
            ...e,
            title: result.title || e.title,
            summary: result.summary || e.summary,
            type: result.type || e.type,
            place: result.place || e.place,
            city: keepCity ? e.city : aiCity || e.city,
            citySource: keepCity ? e.citySource : aiCity ? 'ai' : e.citySource,
            people: result.people || [],
            visibleText: result.visibleText || '',
            tags: result.tags || [],
            questions: result.questions || [],
            confidence: result.confidence,
            status: 'analyzed',
          }
        }),
      }))
    } catch (error) {
      setMemory((current) => ({ ...current, autoPhotoCards: false }))
      reportAnalysisPause(error)
    } finally {
      setBusyEventId(null)
    }
  }

  async function makePhotoCard(asset: MemoryAsset, facts: PhotoFacts) {
    if (!aiConfig.available) { setNotice('请先在 .env 中配置 StepFun API Key，重启服务后再生成'); return }
    if (autoBusyIds.includes(asset.id)) return
    setCardBusyId(asset.id)
    try {
      const card = await generatePhotoCard(asset, facts)
      setMemory((current) => ({ ...current, assets: current.assets.map((a) => (a.id === asset.id ? { ...a, card: { ...card, createdAt: new Date().toISOString() } } : a)) }))
      // Level 2: no location from the photo's own data → search the landmark or place name it shows
      if (!asset.location && card.placeQuery && aiConfig.amapJsKey) {
        const found = await searchPlace(aiConfig.amapJsKey, card.placeQuery).catch(() => undefined)
        if (found) {
          setMemory((current) => ({
            ...current,
            assets: current.assets.map((a) => (a.id === asset.id ? { ...a, location: better(a.location, found) } : a)),
            // An inferred place also gives an unlocated event a (dashed, unconfirmed) city
            events: current.events.map((e) => (e.assetIds.includes(asset.id) && !e.city && found.city ? { ...e, city: found.city, citySource: 'ai', place: e.place || found.label } : e)),
          }))
        }
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '信息卡生成失败，请重试')
    } finally {
      setCardBusyId(null)
    }
  }

  const signatures = useMemo(() => new Map(memory.assets.filter((a) => a.signature).map((a) => [a.id, a.signature!])), [memory.assets])
  const eventOfAsset = (id: string) => memory.events.find((e) => e.assetIds.includes(id))

  async function inferContext(asset: MemoryAsset) {
    const refs = pickReferences(asset, memory.assets, memory.events, signatures)
    if (!refs.length) { setNotice('还没有带定位或已确认地点的照片可以对比'); return null }
    const context = { ...(await inferFromPeers(asset, knownAbout(asset, eventOfAsset(asset.id)), refs)), createdAt: new Date().toISOString() }
    setMemory((current) => ({ ...current, assets: current.assets.map((a) => (a.id === asset.id ? { ...a, context } : a)) }))
    return context
  }

  async function runContext(asset: MemoryAsset) {
    if (!aiConfig.available) { setNotice('请先在 .env 中配置 StepFun API Key，重启服务后再对比'); return }
    setContextBusyId(asset.id)
    try { await inferContext(asset) } catch (error) { setNotice(error instanceof Error ? error.message : '对比失败，请重试') } finally { setContextBusyId(null) }
  }

  // Adopting a filled value is the user confirming it
  function applyToEvent(asset: MemoryAsset, field: 'city' | 'place', value: string) {
    const event = eventOfAsset(asset.id)
    if (!event) return
    updateEvent(field === 'city' ? { ...event, city: value, citySource: 'user' } : { ...event, place: value })
    setNotice(field === 'city' ? `已把这件事放到${cityLabel(value)}` : `地点已更新为「${value}」`)
  }

  // Unlocated events: compare their cover photo with located photos; confident cities go on the map as unconfirmed
  async function completeFromPeers() {
    if (!aiConfig.available) { setNotice('请先在 .env 中配置 StepFun API Key，重启服务后再补全'); return }
    const targets = memory.events.filter((e) => !e.city).map((e) => memory.assets.find((a) => e.assetIds.includes(a.id) && a.preview && a.kind !== 'video')).filter((a): a is MemoryAsset => Boolean(a))
    let placed = 0
    setBatch({ done: 0, total: targets.length })
    for (const [index, asset] of targets.entries()) {
      try {
        const context = await inferContext(asset)
        const city = context?.fills.city
        if (city && city.confidence >= 0.75) {
          placed++
          setMemory((current) => ({ ...current, events: current.events.map((e) => (e.assetIds.includes(asset.id) && !e.city ? { ...e, city: city.value, citySource: 'ai' } : e)) }))
        }
      } catch (error) {
        setNotice(error instanceof Error ? error.message : '补全中断')
        break
      }
      setBatch({ done: index + 1, total: targets.length })
    }
    setBatch(null)
    setNotice(placed ? `${placed} 件事从其他照片补全了城市，地图上以虚线显示，请确认` : '没有找到足够可靠的依据，暂未补全')
  }

  async function deleteAsset(id: string) {
    if (!window.confirm('要移除这个影像吗？浏览器缓存和服务电脑上的副本都会删除，无法撤销。')) return
    await deleteAssets([id])
    setNotice('影像已移除')
  }

  // Removes photos everywhere: files, vault copies, and events left without photos
  async function deleteAssets(ids: string[]) {
    for (const id of ids) await removeFile(id)
    const gone = new Set(ids)
    setMemory((current) => ({
      ...current,
      assets: current.assets.filter((a) => !gone.has(a.id)),
      events: current.events.map((e) => ({ ...e, assetIds: e.assetIds.filter((assetId) => !gone.has(assetId)) })).filter((e) => e.assetIds.length),
    }))
  }

  const saveLooks = useCallback((looks: Record<string, PhotoLook>) => {
    setMemory((current) => ({ ...current, assets: current.assets.map((a) => (looks[a.id] ? { ...a, look: looks[a.id] } : a)) }))
  }, [])

  // ---- What the butler can do on the map --------------------------------------------------
  function focusPhoto(id: string) {
    const photo = mapPhotos.find((p) => p.id === id)
    if (!photo) return false
    setGlobeOverview(false)
    setMapFocus({ photo, at: Date.now() })
    return true
  }

  function focusStoryPhoto(id: string) {
    const photo = mapPhotos.find(p => p.id === id)
    if (!photo || !shouldMoveStoryMap(lastStoryPoint.current, photo.gcj)) return
    lastStoryPoint.current = photo.gcj
    focusPhoto(id)
  }

  // The story line an event belongs on: its city if that is a life base, else the base lived in then
  function contextCityFor(event: MemoryEvent) {
    if (!event.city) return null
    return places.find((p) => p.city === event.city)?.isBase ? event.city : baseAt(places, event.occurredAt)?.city || event.city
  }
  // Move to another story line only when the event is not already on the one being looked at
  function showContextOf(event: MemoryEvent | undefined) {
    if (!event || storyIds.has(event.id)) return
    const city = contextCityFor(event)
    if (city && city !== selectedCity && places.some((p) => p.city === city)) selectCity(city, false)
  }

  function openShowcase(ids: string[], mode: ShowcaseState['mode']) {
    setActiveEventId(null)
    setOpenPhotoId(null)
    setShowcase({ ids, mode, index: 0, playing: mode === 'slideshow' && ids.length > 1 })
    showContextOf(memory.events.find((e) => e.assetIds.includes(ids[0])))
    focusPhoto(ids[0])
  }

  function scrubTo(at: number) {
    setTimelineAt(at)
    const candidates = selectedCity ? story : events
    const nearest = candidates.reduce<MemoryEvent | null>((best, event) => !best || Math.abs(Date.parse(event.occurredAt) - at) < Math.abs(Date.parse(best.occurredAt) - at) ? event : best, null)
    setHighlightedEventId(nearest?.id || null)
  }

  // A guided story: for each step the map moves to the photo, the photo comes on stage and the
  // sentence is spoken; the person taking over (mic, stage controls) ends it
  async function runStory(steps: { assetId: string; text: string }[]) {
    const token = ++tourToken.current
    const ids = steps.map((s) => s.assetId)
    setActiveEventId(null)
    setOpenPhotoId(null)
    setShowcase({ ids, mode: 'slideshow', index: 0, playing: false })
    showContextOf(memory.events.find((e) => e.assetIds.includes(ids[0])))
    for (let i = 0; i < steps.length; i++) {
      if (tourToken.current !== token) return
      setShowcase((s) => (s ? { ...s, index: i, playing: false } : s))
      // Let the map start moving before the words
      await new Promise<void>((resolve) => window.setTimeout(resolve, i === 0 ? 400 : 700))
      if (tourToken.current !== token) return
      await narrate(steps[i].text)
    }
  }

  function runActions(actions: ButlerAction[]) {
    const done = new Set<ButlerAction['type']>()
    let story: { assetId: string; text: string }[] | undefined
    let narrative: NarratedStory | undefined
    for (const action of actions) {
      done.add(action.type)
      switch (action.type) {
        case 'focus_city': selectCity(action.city, false); break
        case 'overview': setShowcase(null); selectCity(null); break
        case 'focus_photo': focusPhoto(action.assetId); break
        case 'show_photos': openShowcase(action.assetIds, 'gallery'); break
        case 'slideshow': openShowcase(action.assetIds, 'slideshow'); break
        case 'story': story = action.steps; narrative = action.story; break
        case 'open_event': setOpenPhotoId(null); setActiveEventId(action.eventId); break
        case 'set_place_role': confirmRole(action.city, action.role, false); break
        case 'timeline': { const at = Date.parse(action.date); if (!Number.isNaN(at)) scrubTo(at); break }
        case 'open_stories': setLibraryOpen({ at: Date.now() }); break
        case 'open_spacetime': if (selectedCity) setSpacetimeOpen({ at: Date.now() }); break
        case 'play_film': setFilmPlay({ id: action.filmId, at: Date.now() }); break
        case 'make_film': setFilmMake({ assetIds: action.assetIds, at: Date.now() }); break
        case 'close': tourToken.current++; setShowcase(null); setActiveEventId(null); setOpenPhotoId(null); break
      }
    }
    return { done, story, narrative }
  }

  // A slideshow moves on by itself; the map follows the photo on stage
  useEffect(() => {
    if (!showcase?.playing || showcase.ids.length < 2) return
    const timer = window.setTimeout(() => setShowcase((s) => (s && s.playing ? (s.index + 1 >= s.ids.length ? { ...s, playing: false } : { ...s, index: s.index + 1 }) : s)), SLIDE_MS)
    return () => window.clearTimeout(timer)
  }, [showcase?.playing, showcase?.index, showcase?.ids])
  useEffect(() => {
    if (!showcase) return
    focusPhoto(showcase.ids[Math.min(showcase.index, showcase.ids.length - 1)])
  }, [showcase?.index, showcase?.ids]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (showcase?.mode === 'slideshow' && !showcase.playing && !speaking && subtitle?.role === 'assistant') scheduleHide(8000)
  }, [showcase?.playing, showcase?.mode, speaking]) // eslint-disable-line react-hooks/exhaustive-deps

  const uiState = (): ButlerState => ({
    view: globeOverview && !selectedCity ? 'globe' : mapFocus ? 'street' : 'city',
    city: selectedCity || '',
    openEventId: activeEventId || '',
    focusedPhotoId: mapFocus?.photo.id || '',
    showing: narratedStory?.assetIds || showcase?.ids || [],
    pendingRoleCity: pendingRoleCity || '',
    features: {
      people: (library.state?.people || []).filter((p) => p.confirmed).length,
      stories: library.state?.graph.chapters.length || 0,
      spacetime: Boolean(selectedCity && scenePhotos(memory.assets, memory.events, selectedCity).length >= 2),
      // Films about the story line being looked at come first
      films: [...films].sort((a, b) => Number(b.assetIds.some((id) => storyAssetIds.has(id))) - Number(a.assetIds.some((id) => storyAssetIds.has(id)))).map(({ id, title }) => ({ id, title })),
      filmCapable,
    },
  })

  async function ask(question: string, storytelling?: { intent?: 'story'; storyId?: string }) {
    if (!aiRef.current.available) { setNotice('人生管家需要 StepFun：请在 .env 中配置后重启服务'); return }
    const ticket = ++tourToken.current
    stopSpeaking()
    setNarratedStory(null)
    setShowcase(current => current ? { ...current, playing: false } : current)
    setAsking(true)
    setAskingStory(Boolean(storytelling?.intent || storytelling?.storyId || /故事|回忆|演绎|边看/.test(question)))
    try {
      const memoryForButler = {
        events: events.map((e) => ({
          id: e.id, title: e.title, summary: e.summary, type: e.type,
          start: e.occurredAt.slice(0, 10), end: (e.endedAt || e.occurredAt).slice(0, 10),
          city: e.city || '', place: e.place, people: e.people, tags: e.tags, status: e.status,
          visibleText: e.visibleText, firsts: firsts.get(e.id) || [], lasts: lasts.get(e.id) || [], photoCount: e.assetIds.length,
        })),
        places: places.map((p) => ({ city: p.city, role: p.role, roleConfirmed: p.roleConfirmed, firstAt: p.firstAt.slice(0, 10), lastAt: p.lastAt.slice(0, 10), eventCount: p.eventIds.length })),
        moves: movesForButler(places),
        photos: photoIndex,
      }
      const reply = await askButler(question, history.current.slice(-8), memoryForButler, focus || undefined, uiState(), storytelling)
      if (tourToken.current !== ticket) return
      const turns: ButlerTurn[] = [{ role: 'user', content: question }, { role: 'assistant', content: reply.answer }]
      history.current = [...history.current, ...turns].slice(-16)
      const { done: acted, story, narrative } = runActions(reply.actions)
      const staged = acted.has('show_photos') || acted.has('slideshow') || acted.has('story')
      // Photos it talked about but did not put on stage are shown anyway
      if (reply.assetIds.length && !staged && !acted.has('focus_photo')) openShowcase(reply.assetIds, 'gallery')
      // Without an explicit move, the first cited event guides the map
      const first = events.find((e) => e.id === reply.eventIds[0])
      if (first) {
        if (!acted.has('focus_city') && !acted.has('overview') && !staged) showContextOf(first)
        setHighlightedEventId(first.id)
      }
      setAsking(false); setAskingStory(false)
      if (reply.answer) await narrate(reply.answer)
      if (tourToken.current !== ticket) return
      if (narrative) {
        setShowcase(null); setActiveEventId(null); setOpenPhotoId(null); setSubtitle(null)
        lastStoryPoint.current = undefined
        setNarratedStory(narrative); refreshStories()
      } else if (story) await runStory(story)
      if (!showcaseRef.current?.playing) scheduleHide(8000)
    } catch (error) {
      if (tourToken.current === ticket) showSubtitle({ role: 'assistant', text: error instanceof Error ? error.message : '没能回答，请重试', error: true }, 8000)
    } finally {
      if (tourToken.current === ticket) { setAsking(false); setAskingStory(false) }
    }
  }

  // Hold to talk. While the button is held, what has been said so far is recognised every
  // 1.5 s and shown as a live subtitle; on release the whole recording becomes the question.
  async function voiceStart() {
    tourToken.current++
    setNarratedStory(null)
    stopSpeaking()
    window.clearTimeout(hideTimer.current)
    try {
      const session = await startRecording()
      recording.current = session
      voiceUsed.current = true
      setVoiceState('recording')
      setSubtitle({ id: 'live', role: 'user', text: '', live: true })
      let sequence = 0, applied = 0, inFlight = false
      window.clearInterval(liveTimer.current)
      liveTimer.current = window.setInterval(() => {
        if (inFlight || recording.current !== session) return
        const wav = session.snapshot()
        if (!wav) return
        const mine = ++sequence
        inFlight = true
        transcribe(wav)
          .then((text) => { if (recording.current === session && mine > applied && text) { applied = mine; setSubtitle({ id: 'live', role: 'user', text, live: true }) } })
          .catch(() => {})
          .finally(() => { inFlight = false })
      }, LIVE_ASR_INTERVAL)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '无法开始录音')
    }
  }

  async function voiceEnd() {
    const session = recording.current
    recording.current = null
    window.clearInterval(liveTimer.current)
    if (!session) return
    setVoiceState('transcribing')
    try {
      const wav = await session.stop()
      if (!wav) { setSubtitle(null); setNotice('说话时间太短，请按住按钮再说'); return }
      const text = await transcribe(wav)
      if (!text) { setSubtitle(null); setNotice('没有听清，请再说一次'); return }
      showSubtitle({ role: 'user', text })
      setVoiceState('idle')
      await ask(text)
    } catch (error) {
      setSubtitle(null)
      setNotice(error instanceof Error ? error.message : '语音识别失败')
    } finally {
      setVoiceState('idle')
    }
  }

  function submitButlerText(value: string) {
    const text = value.trim().slice(0, 500)
    if (!text || asking || voiceState !== 'idle' || !aiRef.current.available) return
    tourToken.current++
    stopSpeaking()
    setShowcase((current) => current ? { ...current, playing: false } : current)
    voiceUsed.current = true
    showSubtitle({ role: 'user', text })
    void ask(text)
  }

  function confirmRole(city: string, role: PlaceRole, announce = true) {
    setMemory((current) => ({ ...current, placeRoles: { ...current.placeRoles, [city]: role } }))
    setPendingRoleCity((pending) => (pending === city ? null : pending))
    const kind = role === 'home' ? '的老家' : role === 'study' ? '求学的地方' : role === 'work' ? '工作的地方' : '生活过的地方'
    if (announce) showSubtitle({ role: 'assistant', text: `记下了，${cityLabel(city)}是你${kind}（${roleLabels[role]}）。` }, 8000)
  }

  function tellMemory(storyId?: string) {
    if (asking || voiceState !== 'idle') return
    voiceUsed.current = true
    const question = storyId ? '再听这段回忆，使用现在的人物和照片资料。' : '自动挑一段有具体细节的回忆，边看照片边讲故事，和最近讲过的角度有所不同。'
    showSubtitle({ role: 'user', text: storyId ? '再听这段回忆' : '听一段回忆' })
    void ask(question, { intent: 'story', storyId })
  }

  return (
    <div className={`app-shell${globeOverview && !selectedCity ? ' globe-mode' : ''}`}>
      <header className="app-bar">
        <span className="app-brand"><CakeLogo size={26} /><span>Personal World</span></span>
        <div className="app-actions">
          <PhotoCull assets={memory.assets} ready={ready} aiAvailable={aiConfig.available} onLooks={saveLooks} onDelete={async (ids) => { await deleteAssets(ids); setNotice(`已删除 ${ids.length} 张照片`) }} />
          <span className={`connection-status ${aiConfig.available ? 'online' : ''}`} title={aiConfig.message}><span />{aiConfig.available ? 'AI 模型已接入' : 'AI 模型未接入'}</span>
          <button className="button button-primary top-import" onClick={() => setImportOpen(true)}><Plus size={16} />导入影像</button>
          <span className="account" title={`已登录：${account.username}`}><UserRound size={15} /><span>{account.username}</span></span>
          <button className="icon-button" onClick={() => { stopSpeaking(); onSignOut() }} aria-label="退出登录" title="退出登录"><LogOut size={17} /></button>
        </div>
      </header>

      <main className="stage">
        {configChecked && <LifeMapView
          amapKey={aiConfig.amapJsKey}
          amapStyle={aiConfig.amapStyle}
          sceneEnabled={sceneEnabled}
          globeOverview={globeOverview && !selectedCity}
          onMapError={setNotice}
          onMapReady={() => setMapReady(true)}
          places={places}
          bases={bases}
          story={story}
          routeEventIds={routeEventIds}
          selectedCity={selectedCity}
          highlightedEventId={highlightedEventId}
          insetRight={narratedStory ? 780 : showcase ? SHOWCASE_WIDTH : 0}
          insetBottom={events.length ? TIMEBAR_HEIGHT : 0}
          insetTop={CHROME_TOP}
          onSelectCity={(city) => selectCity(city)}
          onOpenEvent={setActiveEventId}
          onOpenPhoto={openPhoto}
          onFocusPhoto={(photo) => { setGlobeOverview(false); setMapFocus({ photo, at: Date.now() }) }}
          onGlobeChange={(on) => { if (on && selectedCity) selectCity(null, false); else setGlobeOverview(on) }}
          photos={visibleMapPhotos}
          eventCovers={eventCovers}
          focus={mapFocus}
          landmarkPreviewAt={landmarkPreviewAt}
        />}

        {gateOpen && <LoadingGate steps={gateSteps} />}
        {analysisInBackground && <BackgroundProgress steps={analysisSteps} />}

        {ready && events.length > 0 && (
          <div className="map-heading">
            {selectedCity && selectedPlace ? (
              <>
                <button className="crumb" onClick={() => selectCity(null)}><ChevronLeft size={14} />人生地图</button>
                <h1>{cityLabel(selectedCity)}的故事线<b>.</b></h1>
                <p>{formatYearMonth(selectedPlace.firstAt)}{selectedPlace.isBase ? ' 至今' : ''} · {story.length} 件事</p>
              </>
            ) : (
              <>
                {!globeOverview && <button className="crumb" onClick={() => selectCity(null)}><ChevronLeft size={14} />返回地球</button>}
                <h1>我的人生地图<b>.</b></h1>
              </>
            )}
            {selectedCity && routes.length > 0 && <div className="memory-route-control">
              <select aria-label="选择回忆连线" value={routeEventIds.length ? routeId : ''} onChange={(event) => setRouteId(event.target.value)}>
                <option value="">不显示回忆连线</option>
                {routes.map((route) => <option key={route.id} value={route.id}>{route.label}</option>)}
              </select>
              {routeEventIds.length > 0 && <small>按拍摄先后连接，仅表示这次回忆的地点顺序。</small>}
            </div>}
            {/* Scene controls, then what is going on in the background: one row of same-sized chips */}
            {aiConfig.amapJsKey && (mapPhotos.length > 0 || !globeOverview) && <div className="heading-chips">
              {!globeOverview && <button
                className={`building-toggle ${sceneEnabled ? 'active' : ''}`}
                type="button"
                aria-pressed={sceneEnabled}
                title="放大到有精确定位的照片地点后查看风格化记忆场景"
                onClick={() => setSceneEnabled((enabled) => !enabled)}
              >
                3D 记忆场景 {sceneEnabled ? '开' : '关'}
                <small>{sceneCoverage.total ? sceneCoverage.done < sceneCoverage.total ? `检查街区 ${sceneCoverage.done}/${sceneCoverage.total}` : `${sceneCoverage.total} 处街区${sceneCoverage.partial + sceneCoverage.failed ? ` · ${sceneCoverage.partial + sceneCoverage.failed} 处待补` : ''}` : '真实照片地点'}</small>
              </button>}
              {mapPhotos.length>0&&<SceneCoverage coverage={sceneCoverage} onFocus={id=>{const photo=mapPhotos.find(p=>p.id===id);if(photo){setGlobeOverview(false);setMapFocus({photo,at:Date.now()})}}}/>}
              {!mapPhotos.length && <button className="scene-preview" type="button" onClick={() => { selectCity(null, false); setGlobeOverview(false); setLandmarkPreviewAt((value) => value + 1) }}>查看上海地标样例</button>}
            </div>}
            {(aiConfig.available && analyzablePhotos.length > 0 || library.state?.understanding?.busy || needsWork.length > 0) && <div className="heading-chips status">
              {aiConfig.available && analyzablePhotos.length > 0 && (
                <div className={`locating-chip${locating || busyEventId ? ' working' : ''}`} role="status" aria-label="自动分析状态">
                  <span>{locating ? `正在分析照片 ${locating.done}/${locating.total}` : busyEventId ? `正在分析事件，还有 ${pendingAnalysis} 件` : pendingPhotoCards || pendingAnalysis ? `${memory.autoPhotoCards === false ? '已暂停' : '待分析'}${pendingPhotoCards ? ` ${pendingPhotoCards} 张照片` : ''}${pendingAnalysis ? ` ${pendingAnalysis} 件事` : ''}` : `${analyzablePhotos.length} 张照片信息卡 · 事件已自动分析`}</span>
                  {locating || busyEventId
                    ? <button onClick={() => { stopLocating.current = true; setMemory((current) => ({ ...current, autoPhotoCards: false })) }}>暂停</button>
                    : (pendingPhotoCards > 0 || pendingAnalysis > 0) && memory.autoPhotoCards === false ? <button onClick={resumeAnalysis}>继续分析</button> : null}
                </div>
              )}
              {library.state?.understanding?.busy && <div className="locating-chip working" role="status" aria-label="回忆更新状态">
                <span>{library.state.understanding.phase === 'stories' ? '正在串联这些回忆' : `正在更新回忆 ${library.state.understanding.completed}/${library.state.understanding.total}`}</span>
              </div>}
              {needsWork.length > 0 && <button className="tray-chip" onClick={() => setTrayOpen((open) => !open)}><CircleHelp size={14} />{needsWork.length} 件事待整理</button>}
            </div>}
          </div>
        )}

        {/* People & stories, spacetime scenes and memory films have no buttons: the butler opens
            them when asked, and films keep being made in the background */}
        <div className="story-apps-hidden">
          <MemoryLibrary library={library} assets={memory.assets} onPhoto={openPhoto} onFilm={chapter=>setFilmChapter({chapter,at:Date.now()})} openRequest={libraryOpen} />
          {selectedCity && <SpacetimeScene assets={memory.assets} events={memory.events} city={selectedCity} onPhoto={openPhoto} openRequest={spacetimeOpen} />}
          <MemoryFilms assets={memory.assets} events={memory.events} ready={ready} analyzing={importing || autoBusyIds.length > 0 || Boolean(cardBusyId) || library.busy || Boolean(library.state?.understanding?.busy)} graph={library.state} requestedChapter={filmChapter} requestedPlay={filmPlay} requestedFilm={filmMake} onFilms={(list, capable) => { setFilms(list); setFilmCapable(capable) }} />
        </div>

        {trayOpen && needsWork.length > 0 && (
          <div className="tray" role="dialog" aria-label="待整理的事件">
            <div className="tray-head"><b>待整理的事件</b><button className="icon-button" onClick={() => setTrayOpen(false)} aria-label="关闭"><X size={17} /></button></div>
            <p>没有城市的事件还不能放上地图。接入 StepFun 后事件会自动分析；也可以从其他带定位的照片补全，或打开事件手动填写。</p>
            {needsWork.some((e) => !e.city) && (
              <button className="button button-primary tray-batch" onClick={() => void completeFromPeers()} disabled={Boolean(batch)}>
                {batch ? `正在对比 ${batch.done}/${batch.total}…` : `用其他照片补全位置（${needsWork.filter((e) => !e.city).length} 件）`}
              </button>
            )}
            <ul>
              {needsWork.map((e) => (
                <li key={e.id}><button onClick={() => { setActiveEventId(e.id); setTrayOpen(false) }}>
                  <time>{formatYearMonth(e.occurredAt)}</time><span>{e.title}</span><small>{e.city ? statusLabel(e.status) : '未定位'}</small>
                </button></li>
              ))}
            </ul>
          </div>
        )}

        {ready && !events.length && !gateOpen && (
          <div className="map-empty">
            <h1>从照片开始，画出你的人生地图</h1>
            <p>导入手机里的照片、视频或截图。Personal World 会先把它们整理成事件，再按事件发生的地方放上地图。</p>
            <button className="button button-primary" onClick={() => setImportOpen(true)}><Upload size={17} />导入第一批影像</button>
          </div>
        )}
        {ready && events.length > 0 && !places.length && !gateOpen && (
          <div className="map-empty compact">
            <h2>还没有可以放上地图的事件</h2>
            <p>{aiConfig.geocode || aiConfig.amapJsKey ? '这些照片没有定位信息。' : '填写高德 Key 后，带定位的照片会自动识别城市。'}{aiConfig.available ? '事件正在自动分析，认出的城市会放上地图；' : '接入 StepFun 后事件会自动分析；'}也可以打开事件手动填写城市。</p>
            <button className="button button-subtle" onClick={() => setTrayOpen(true)}>查看待整理的事件</button>
          </div>
        )}

        {showcase && ready && (
          <Showcase
            showcase={showcase}
            assets={memory.assets}
            events={events}
            onChange={(next) => { tourToken.current++; setShowcase(next) }}
            onClose={() => { tourToken.current++; setShowcase(null) }}
            onOpen={(id) => { tourToken.current++; setShowcase((s) => (s ? { ...s, playing: false } : s)); openPhoto(id) }}
          />
        )}

        {narratedStory && ready && <StoryStage key={narratedStory.id} story={narratedStory} assets={memory.assets}
          onFocus={focusStoryPhoto}
          onClose={() => setNarratedStory(null)}
          onOpen={openPhoto}
          onAnother={() => tellMemory()}
          onRetell={tellMemory}
          onRemembered={() => { void library.mutate('/settle', {}).catch(() => {}); refreshStories() }}
        />}

        {events.length > 0 && (
          // Full width even with the photo stage open: the stage ends above the microphone, so nothing overlaps
          <div className="timebar-wrap" style={{ right: 24 }}>
            <TimelineBar events={events} bases={bases} storyIds={storyIds} selectedCity={selectedCity} highlightedEventId={highlightedEventId} scrubAt={timelineAt} onScrub={scrubTo} onOpenEvent={setActiveEventId} />
          </div>
        )}

        {ready && events.length > 0 && (
          <VoiceButler
            voiceState={voiceState}
            busy={asking}
            disabled={!aiConfig.available}
            subtitle={narratedStory ? null : subtitle}
            speaking={speaking}
            storyBusy={askingStory}
            onVoiceStart={() => void voiceStart()}
            onVoiceEnd={() => void voiceEnd()}
            onTextSubmit={submitButlerText}
            stories={storyChoices}
            onTellStory={tellMemory}
            onStopSpeaking={() => { tourToken.current++; stopSpeaking() }}
            onDismiss={dismissSubtitle}
          />
        )}
      </main>

      {importOpen && <ImportDialog importing={importing} onFiles={(files) => void handleFiles(files)} onClose={() => setImportOpen(false)} />}
      {activeEvent && (
        <EventDetail
          event={activeEvent}
          assets={memory.assets}
          firsts={firsts.get(activeEvent.id) || []}
          lasts={lasts.get(activeEvent.id) || []}
          aiAvailable={aiConfig.available}
          busy={busyEventId === activeEvent.id}
          onClose={() => { setActiveEventId(null); setOpenPhotoId(null) }}
          initialAssetId={openPhotoId}
          identities={Object.fromEntries(Object.entries(library.state?.graph.memberships||{}).map(([id,people])=>[id,people.map(pid=>{const p=library.state?.people.find(p=>p.id===pid);return p?.name||p?.relationship||'已确认人物'})]))}
          onSave={(next) => { updateEvent(next); setNotice('事件已确认并保存') }}
          onDeleteAsset={(id) => void deleteAsset(id)}
          cardBusyIds={[...(cardBusyId ? [cardBusyId] : []), ...autoBusyIds]}
          onGenerateCard={(asset, facts) => void makePhotoCard(asset, facts)}
          peers={{
            candidateCount: (asset) => pickReferences(asset, memory.assets, memory.events, signatures).length,
            busyId: contextBusyId,
            infer: (asset) => void runContext(asset),
            apply: applyToEvent,
            assetById: (id) => memory.assets.find((a) => a.id === id),
            showOnMap: (asset) => {
              setActiveEventId(null)
              setOpenPhotoId(null)
              focusPhoto(asset.id)
            },
          }}
        />
      )}
      {notice && <div className="toast" role="status"><span className="toast-dot" />{notice}<button onClick={() => setNotice('')} aria-label="关闭提示"><X size={16} /></button></div>}
    </div>
  )
}

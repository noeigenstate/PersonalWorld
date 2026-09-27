import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Aperture, ChevronLeft, CircleHelp, LogOut, Plus, Upload, UserRound, X } from 'lucide-react'
import { analyzeEvent, askButler, fetchAiConfig, generatePhotoCard, geocode, inferFromPeers, speak, transcribe, type Account, type ButlerFocus, type ButlerTurn } from './lib/api'
import { colorSignature, knownAbout, pickReferences } from './lib/peers'
import { better, inheritFromEvent } from './lib/location'
import { gcj02ToWgs84, wgs84ToGcj02 } from './lib/geo'
import { photoFacts as factsOf } from './lib/photoFacts'
import type { MapPhoto } from './map/scene'
import { detailedAddresses, locateAddress, searchPlace } from './map/amap'
import type { PhotoFacts } from './lib/photoFacts'
import { importFiles } from './lib/import'
import { baseAt, cityLabel, derivePlaces, firstsOf, formatYearMonth, regroupDrafts, roleLabels, spaceLine, storyLine } from './lib/memory'
import { startRecording } from './lib/recorder'
import { geocodeInBrowser } from './map/amap'
import { visitRoutes } from './lib/storyRoutes'
import { loadMemory, removeFile, saveMemory } from './lib/storage'
import type { AiConfig, MemoryAsset, MemoryEvent, MemoryState, PlaceRole } from './types'
import { Butler, type ButlerMessage, type VoiceState } from './components/Butler'
import { EventDetail, statusLabel } from './components/EventDetail'
import { ImportDialog } from './components/ImportDialog'
import { LifeMapView } from './components/LifeMapView'
import { TimelineBar } from './components/TimelineBar'
import { MemoryFilms } from './components/MemoryFilms'
import { useSceneCoverage } from './lib/useSceneCoverage'

type Tab = 'map' | 'butler'
const initialMemory: MemoryState = { assets: [], events: [], placeRoles: {}, autoPhotoCards: true }
const BUTLER_WIDTH = 432
const TIMEBAR_HEIGHT = 128
const uid = () => crypto.randomUUID()
const years = (from: string, to: string) => Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / (365.25 * 86400000)))

export default function App({ account, onSignOut }: { account: Account; onSignOut: () => void }) {
  const [memory, setMemory] = useState<MemoryState>(initialMemory)
  const [ready, setReady] = useState(false)
  const [aiConfig, setAiConfig] = useState<AiConfig>({ available: false, mode: 'unconfigured', message: '正在检查 AI 连接…', geocode: false })
  const [configChecked, setConfigChecked] = useState(false)
  const [tab, setTab] = useState<Tab>('map')
  const [selectedCity, setSelectedCity] = useState<string | null>(null)
  const [highlightedEventId, setHighlightedEventId] = useState<string | null>(null)
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
  const [messages, setMessages] = useState<ButlerMessage[]>([])
  const [focus, setFocus] = useState<ButlerFocus | null>(null)
  const [asking, setAsking] = useState(false)
  const [voiceState, setVoiceState] = useState<VoiceState>('idle')
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const recording = useRef<Awaited<ReturnType<typeof startRecording>> | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  const geocoded = useRef(new Set<string>())

  useEffect(() => {
    loadMemory().then((data) => { setMemory(data); setReady(true) }).catch(() => setReady(true))
    fetchAiConfig().then(setAiConfig).catch(() => setAiConfig({ available: false, mode: 'unconfigured', message: 'AI 服务未启动；本地整理仍可使用', geocode: false }))
      .finally(() => setConfigChecked(true))
  }, [])

  useEffect(() => { if (ready) saveMemory(memory).catch(() => setNotice('本地存储失败，请检查浏览器可用空间')) }, [memory, ready])

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

  const events = useMemo(() => [...memory.events].sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()), [memory.events])
  const places = useMemo(() => derivePlaces(events, memory.placeRoles), [events, memory.placeRoles])
  const bases = useMemo(() => spaceLine(places), [places])
  const story = useMemo(() => (selectedCity ? storyLine(selectedCity, events, places) : []), [selectedCity, events, places])
  const storyIds = useMemo(() => new Set(story.map((e) => e.id)), [story])
  const routes = useMemo(() => visitRoutes(story), [story])
  const routeEventIds = useMemo(() => routes.find((route) => route.id === routeId)?.eventIds || [], [routes, routeId])
  const firsts = useMemo(() => firstsOf(events), [events])
  const needsWork = events.filter((e) => !e.city || e.status === 'draft')
  const analyzablePhotos = memory.assets.filter((a) => a.preview && a.kind !== 'video')
  const pendingPhotoCards = analyzablePhotos.filter((a) => !a.card).length
  const activeEvent = events.find((e) => e.id === activeEventId)
  // Every photo with a place, for the map's photo layer
  const mapPhotos = useMemo<MapPhoto[]>(() => memory.assets.flatMap((a) => {
    if (!a.preview || a.kind === 'video') return []
    const gcj = a.location?.gcj || (a.latitude !== undefined && a.longitude !== undefined ? (({ lat, lng }) => [lng, lat] as [number, number])(wgs84ToGcj02({ lat: a.latitude, lng: a.longitude! })) : undefined)
    if (!gcj) return []
    const cardLandmark = a.card?.landmark && a.card.landmark.confidence >= 0.7 ? a.card.landmark.name : undefined
    const nearbyLandmark = a.location?.poi?.name || (a.location?.precision === 'poi' ? a.location.label : undefined)
    const placeLandmark = /东方明珠|oriental\s*pearl/i.test(nearbyLandmark || '') ? nearbyLandmark : undefined
    return [{ id: a.id, name: a.name, gcj, preview: a.preview, inferred: Boolean(a.location && !['gps', 'meta', 'user'].includes(a.location.source)), precision: a.location?.precision || 'point', venueName: a.location?.aoi || a.location?.poi?.name, landmark: cardLandmark || placeLandmark, landmarkSource: cardLandmark ? 'photo' : placeLandmark ? 'place' : undefined, sceneCard: a.card ? { title: a.card.title, caption: a.card.caption, scene: a.card.scene, tags: a.card.tags, eventGuess: a.card.eventGuess, createdAt: a.card.createdAt } : undefined }]
  }), [memory.assets])
  const sceneCoverage = useSceneCoverage(memory.assets, mapPhotos, ready && !locating)

  function openPhoto(assetId: string) {
    const event = memory.events.find((e) => e.assetIds.includes(assetId))
    if (!event) return
    setOpenPhotoId(assetId)
    setActiveEventId(event.id)
  }

  // Analyze actual imported photos in the browser's account database, two at a time. Existing
  // cards are kept. Photos without their own location can additionally use the card's place clue.
  useEffect(() => {
    const key = aiConfig.amapJsKey
    if (!ready || !aiConfig.available || memory.autoPhotoCards === false || autoRun.current) return
    const queue = memory.assets.filter((a) => a.preview && a.kind !== 'video' && (
      !a.card || (key && !a.location && !a.locateTried && a.latitude === undefined && !a.metaPlace)
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
            const card = asset.card || { ...(await generatePhotoCard(asset, factsOf(asset, event))), createdAt: new Date().toISOString() }
            const needsPlace = !asset.location && asset.latitude === undefined && !asset.metaPlace
            const found = needsPlace && key && card.placeQuery ? await searchPlace(key, card.placeQuery).catch(() => undefined) : undefined
            const id = asset.id
            setMemory((current) => ({
              ...current,
              assets: current.assets.map((a) => (a.id === id ? { ...a, card: a.card || card, locateTried: needsPlace && key ? true : a.locateTried, location: better(a.location, found) } : a)),
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
            setNotice(error instanceof Error ? `自动分析已暂停：${error.message}` : '自动分析已暂停')
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
      setNotice(error instanceof Error ? `自动分析已暂停：${error.message}` : '自动分析已暂停')
    })
  }, [memory.assets, memory.events, memory.autoPhotoCards, ready, aiConfig.available, aiConfig.amapJsKey])
  const selectedPlace = places.find((p) => p.city === selectedCity)
  const panelOpen = tab === 'butler' || Boolean(selectedCity)

  const updateEvent = useCallback((next: MemoryEvent) => {
    setMemory((current) => ({ ...current, events: current.events.map((e) => (e.id === next.id ? next : e)) }))
  }, [])

  const selectCity = useCallback((city: string | null, announce = true) => {
    setSelectedCity(city)
    setRouteId('')
    setHighlightedEventId(null)
    if (!city) { setFocus(null); return }
    const place = places.find((p) => p.city === city)
    if (!place) return
    setFocus({ city, from: place.firstAt.slice(0, 10), to: place.lastAt.slice(0, 10) })
    if (!announce) return
    const name = cityLabel(city)
    const count = storyLine(city, events, places).length
    const text = place.isBase
      ? `你在${name}生活了 ${years(place.firstAt, place.lastAt)} 年，我记得这里的 ${count} 件事。可以沿时间线看看这些回忆，想聊哪一段？`
      : `你在${formatYearMonth(place.firstAt)}来过${name}，我记得这里的 ${place.eventIds.length} 件事，想聊哪一次？`
    const intro: ButlerMessage[] = [{ id: uid(), role: 'assistant', text }]
    if (place.isBase && !place.roleConfirmed) intro.push({ id: uid(), role: 'assistant', text: `${name}对你来说是哪一种地方？`, roleFor: city })
    setMessages((current) => [...current, ...intro])
  }, [events, places])

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

  async function runAnalysis(event: MemoryEvent) {
    if (!aiConfig.available) { setNotice('请先在 .env 中配置 StepFun API Key，重启服务后再分析'); return }
    setBusyEventId(event.id)
    try {
      const result = await analyzeEvent(event, memory.assets)
      const aiCity = result.city?.trim()
      const keepCity = Boolean(event.city && event.citySource !== 'ai')
      updateEvent({
        ...event,
        title: result.title || event.title,
        summary: result.summary || event.summary,
        type: result.type || event.type,
        place: result.place || event.place,
        city: keepCity ? event.city : aiCity || event.city,
        citySource: keepCity ? event.citySource : aiCity ? 'ai' : event.citySource,
        people: result.people || [],
        visibleText: result.visibleText || '',
        tags: result.tags || [],
        questions: result.questions || [],
        confidence: result.confidence,
        status: 'analyzed',
      })
      setNotice('分析完成，请核对事件内容')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '分析失败，请重试')
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
    if (!window.confirm('要从本地记忆中移除这个影像吗？此操作无法撤销。')) return
    await removeFile(id)
    setMemory((current) => ({
      ...current,
      assets: current.assets.filter((a) => a.id !== id),
      events: current.events.map((e) => ({ ...e, assetIds: e.assetIds.filter((assetId) => assetId !== id) })).filter((e) => e.assetIds.length),
    }))
    setNotice('影像已移除')
  }

  function stopSpeaking() {
    audio.current?.pause()
    audio.current = null
    setSpeakingId(null)
  }

  async function speakMessage(message: ButlerMessage) {
    if (speakingId === message.id) { stopSpeaking(); return }
    stopSpeaking()
    setSpeakingId(message.id)
    try {
      const url = URL.createObjectURL(await speak(message.text))
      const player = new Audio(url)
      audio.current = player
      player.onended = () => { URL.revokeObjectURL(url); setSpeakingId((id) => (id === message.id ? null : id)) }
      await player.play()
    } catch (error) {
      setSpeakingId(null)
      setNotice(error instanceof Error ? error.message : '朗读失败')
    }
  }

  async function ask(question: string, voice = false) {
    if (!aiConfig.available) { setNotice('人生管家需要 StepFun：请在 .env 中配置后重启服务'); return }
    const history: ButlerTurn[] = messages.filter((m) => !m.error && !m.roleFor).slice(-8).map((m) => ({ role: m.role, content: m.text }))
    setMessages((current) => [...current, { id: uid(), role: 'user', text: question, voice }])
    setAsking(true)
    try {
      const memoryForButler = {
        events: events.map((e) => ({
          id: e.id, title: e.title, summary: e.summary, type: e.type,
          start: e.occurredAt.slice(0, 10), end: (e.endedAt || e.occurredAt).slice(0, 10),
          city: e.city || '', place: e.place, people: e.people, tags: e.tags, status: e.status,
          visibleText: e.visibleText, firsts: firsts.get(e.id) || [], photoCount: e.assetIds.length,
        })),
        places: places.map((p) => ({ city: p.city, role: p.role, roleConfirmed: p.roleConfirmed, firstAt: p.firstAt.slice(0, 10), lastAt: p.lastAt.slice(0, 10), eventCount: p.eventIds.length })),
      }
      const reply = await askButler(question, history, memoryForButler, focus || undefined)
      const message: ButlerMessage = { id: uid(), role: 'assistant', text: reply.answer, eventIds: reply.eventIds }
      setMessages((current) => [...current, message])
      const first = events.find((e) => e.id === reply.eventIds[0])
      if (first) {
        const home = first.city && places.find((p) => p.city === first.city)?.isBase ? first.city : baseAt(places, first.occurredAt)?.city || first.city
        if (home && home !== selectedCity && !storyIds.has(first.id)) selectCity(home, false)
        setHighlightedEventId(first.id)
      }
      if (voice) void speakMessage(message)
    } catch (error) {
      setMessages((current) => [...current, { id: uid(), role: 'assistant', text: error instanceof Error ? error.message : '没能回答，请重试', error: true }])
    } finally {
      setAsking(false)
    }
  }

  async function voiceStart() {
    stopSpeaking()
    try {
      recording.current = await startRecording()
      setVoiceState('recording')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '无法开始录音')
    }
  }

  async function voiceEnd() {
    const session = recording.current
    recording.current = null
    if (!session) return
    setVoiceState('transcribing')
    try {
      const wav = await session.stop()
      if (!wav) { setNotice('说话时间太短，请按住按钮再说'); return }
      const text = await transcribe(wav)
      if (!text) { setNotice('没有听清，请再说一次'); return }
      await ask(text, true)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '语音识别失败')
    } finally {
      setVoiceState('idle')
    }
  }

  function confirmRole(city: string, role: PlaceRole) {
    setMemory((current) => ({ ...current, placeRoles: { ...current.placeRoles, [city]: role } }))
    const kind = role === 'home' ? '的老家' : role === 'study' ? '求学的地方' : role === 'work' ? '工作的地方' : '生活过的地方'
    setMessages((current) => [
      ...current.filter((m) => m.roleFor !== city),
      { id: uid(), role: 'user', text: roleLabels[role] },
      { id: uid(), role: 'assistant', text: `记下了，${cityLabel(city)}是你${kind}。` },
    ])
  }

  function closeButler() {
    setTab('map')
    selectCity(null)
  }

  const focusLabel = selectedCity && selectedPlace
    ? `正在聊：${cityLabel(selectedCity)} · ${formatYearMonth(selectedPlace.firstAt)}${selectedPlace.isBase ? ' 至今' : ''}`
    : '可以问我人生中的任何一段'

  return (
    <div className="app-shell">
      <header className="app-bar">
        <span className="app-brand"><Aperture size={22} strokeWidth={2} /><span>Personal World</span></span>
        <nav className="app-tabs" aria-label="主导航">
          <button className={tab === 'map' ? 'on' : ''} onClick={() => setTab('map')} aria-current={tab === 'map' ? 'page' : undefined}>人生地图</button>
          <button className={tab === 'butler' ? 'on' : ''} onClick={() => setTab('butler')} aria-current={tab === 'butler' ? 'page' : undefined}>人生管家</button>
        </nav>
        <div className="app-actions">
          <MemoryFilms assets={memory.assets} events={memory.events} ready={ready} analyzing={importing || autoBusyIds.length > 0 || Boolean(cardBusyId)} />
          <span className={`connection-status ${aiConfig.available ? 'online' : ''}`} title={aiConfig.message}><span />{aiConfig.available ? 'StepFun 已连接' : '本地模式'}</span>
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
          onMapError={setNotice}
          places={places}
          bases={bases}
          story={story}
          routeEventIds={routeEventIds}
          selectedCity={selectedCity}
          highlightedEventId={highlightedEventId}
          insetRight={panelOpen ? BUTLER_WIDTH : 0}
          insetBottom={events.length ? TIMEBAR_HEIGHT : 0}
          onSelectCity={(city) => selectCity(city)}
          onOpenEvent={setActiveEventId}
          onOpenPhoto={openPhoto}
          photos={mapPhotos}
          focus={mapFocus}
          landmarkPreviewAt={landmarkPreviewAt}
        />}

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
                <h1>我的人生地图<b>.</b></h1>
                <p>{bases.length} 个人生据点 · {events.length} 件事 · {places.length - bases.length} 个途经地点</p>
              </>
            )}
            <div className="legend">
              <span><em className="lg-story" />回忆事件</span>
              <span><em className="lg-migrate" />迁徙</span>
              <span><em className="lg-unsure" />待确认</span>
            </div>
            {selectedCity && routes.length > 0 && <div className="memory-route-control">
              <select aria-label="选择回忆连线" value={routeEventIds.length ? routeId : ''} onChange={(event) => setRouteId(event.target.value)}>
                <option value="">不显示回忆连线</option>
                {routes.map((route) => <option key={route.id} value={route.id}>{route.label}</option>)}
              </select>
              {routeEventIds.length > 0 && <small>按拍摄先后连接，仅表示这次回忆的地点顺序。</small>}
            </div>}
            {aiConfig.amapJsKey && (<>
              <button
                className={`building-toggle ${sceneEnabled ? 'active' : ''}`}
                type="button"
                aria-pressed={sceneEnabled}
                title="放大到有精确定位的照片地点后查看风格化记忆场景"
                onClick={() => setSceneEnabled((enabled) => !enabled)}
              >
                3D 记忆场景 {sceneEnabled ? '开' : '关'}
                <small>{sceneCoverage.total ? sceneCoverage.done < sceneCoverage.total ? `检查街区 ${sceneCoverage.done}/${sceneCoverage.total}` : `${sceneCoverage.total} 处街区资料${sceneCoverage.partial + sceneCoverage.failed ? ` · ${sceneCoverage.partial + sceneCoverage.failed} 处待补` : ''}` : '真实照片地点'}</small>
              </button>
              {!mapPhotos.length && <button className="scene-preview" type="button" onClick={() => { setTab('map'); selectCity(null, false); setLandmarkPreviewAt((value) => value + 1) }}>查看上海地标样例</button>}
            </>)}
            {aiConfig.available && analyzablePhotos.length > 0 && (
              <div className="locating-chip" role="status" aria-label="照片自动分析状态">
                <span>{locating ? `StepFun 正在分析真实照片 ${locating.done}/${locating.total}` : pendingPhotoCards ? `${memory.autoPhotoCards === false ? '已暂停' : '待分析'} ${pendingPhotoCards} 张照片` : `已生成 ${analyzablePhotos.length} 张照片信息卡`}</span>
                {locating
                  ? <button onClick={() => { stopLocating.current = true; setMemory((current) => ({ ...current, autoPhotoCards: false })) }}>暂停</button>
                  : pendingPhotoCards > 0 && memory.autoPhotoCards === false ? <button onClick={() => { stopLocating.current = false; setMemory((current) => ({ ...current, autoPhotoCards: true })) }}>继续分析</button> : null}
              </div>
            )}
            {needsWork.length > 0 && <button className="tray-chip" onClick={() => setTrayOpen((open) => !open)}><CircleHelp size={14} />{needsWork.length} 件事待整理</button>}
          </div>
        )}

        {trayOpen && needsWork.length > 0 && (
          <div className="tray" role="dialog" aria-label="待整理的事件">
            <div className="tray-head"><b>待整理的事件</b><button className="icon-button" onClick={() => setTrayOpen(false)} aria-label="关闭"><X size={17} /></button></div>
            <p>没有城市的事件还不能放上地图。可以从其他带定位的照片补全，也可以打开事件用 StepFun 分析或手动填写。</p>
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

        {ready && !events.length && (
          <div className="map-empty">
            <h1>从照片开始，画出你的人生地图</h1>
            <p>导入手机里的照片、视频或截图。Personal World 会先把它们整理成事件，再按事件发生的地方放上地图。</p>
            <button className="button button-primary" onClick={() => setImportOpen(true)}><Upload size={17} />导入第一批影像</button>
          </div>
        )}
        {ready && events.length > 0 && !places.length && (
          <div className="map-empty compact">
            <h2>还没有可以放上地图的事件</h2>
            <p>{aiConfig.geocode || aiConfig.amapJsKey ? '这些照片没有定位信息。' : '填写高德 Key 后，带定位的照片会自动识别城市。'}也可以打开事件，用 StepFun 分析或手动填写城市。</p>
            <button className="button button-subtle" onClick={() => setTrayOpen(true)}>查看待整理的事件</button>
          </div>
        )}

        {events.length > 0 && (
          <div className="timebar-wrap" style={{ right: panelOpen ? BUTLER_WIDTH + 24 : 24 }}>
            <TimelineBar events={events} bases={bases} storyIds={storyIds} selectedCity={selectedCity} highlightedEventId={highlightedEventId} onOpenEvent={setActiveEventId} />
          </div>
        )}

        {panelOpen && (
          <Butler
            messages={messages.length ? messages : [{ id: 'hello', role: 'assistant', text: events.length ? '我是你的人生管家。点地图上的一个地方，或者直接问我，比如「我这几年搬过几次家？」' : '我是你的人生管家。先导入一些照片，我才会有可以回想的事。' }]}
            busy={asking}
            voiceState={voiceState}
            focusLabel={focusLabel}
            events={events}
            assets={memory.assets}
            speakingId={speakingId}
            onAsk={(text) => void ask(text)}
            onVoiceStart={() => void voiceStart()}
            onVoiceEnd={() => void voiceEnd()}
            onSpeak={(m) => void speakMessage(m)}
            onConfirmRole={confirmRole}
            onOpenEvent={setActiveEventId}
            onClose={closeButler}
          />
        )}
      </main>

      {importOpen && <ImportDialog importing={importing} onFiles={(files) => void handleFiles(files)} onClose={() => setImportOpen(false)} />}
      {activeEvent && (
        <EventDetail
          event={activeEvent}
          assets={memory.assets}
          firsts={firsts.get(activeEvent.id) || []}
          aiAvailable={aiConfig.available}
          busy={busyEventId === activeEvent.id}
          onClose={() => { setActiveEventId(null); setOpenPhotoId(null) }}
          initialAssetId={openPhotoId}
          onAnalyze={() => void runAnalysis(activeEvent)}
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
              const photo = mapPhotos.find((p) => p.id === asset.id)
              if (!photo) return
              setActiveEventId(null)
              setOpenPhotoId(null)
              setMapFocus({ photo, at: Date.now() })
            },
          }}
        />
      )}
      {notice && <div className="toast" role="status"><span className="toast-dot" />{notice}<button onClick={() => setNotice('')} aria-label="关闭提示"><X size={16} /></button></div>}
    </div>
  )
}

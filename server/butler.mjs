// The life butler's tools (skills/life-butler): the compact memory the browser sends so the model
// can search photos by meaning, and the actions it may give back to drive the life map.

const strings = (value, max) => (Array.isArray(value) ? value.filter((v) => typeof v === 'string').slice(0, max) : [])
const text = (value, max) => String(value ?? '').slice(0, max)

// Photos the model reads on one question; larger libraries are narrowed to the ones nearest the question
export const PHOTO_CAP = 400
export const ROLES = ['home', 'study', 'work', 'residence']

// One photo's information card, without the picture
export function compactPhoto(photo) {
  return {
    id: text(photo.id, 64),
    eventId: text(photo.eventId, 64),
    date: text(photo.date, 10),
    city: text(photo.city, 20),
    place: text(photo.place, 40),
    title: text(photo.title, 30),
    caption: text(photo.caption, 80),
    scene: text(photo.scene, 80),
    tags: strings(photo.tags, 6),
    people: strings(photo.people, 6),
  }
}

// What the page shows right now, so "this", "here" and "the next one" have a meaning
export function compactState(state) {
  if (!state || typeof state !== 'object') return null
  const features = state.features && typeof state.features === 'object' ? state.features : {}
  return {
    view: ['globe', 'city', 'street'].includes(state.view) ? state.view : 'globe',
    city: text(state.city, 20),
    openEventId: text(state.openEventId, 64),
    focusedPhotoId: text(state.focusedPhotoId, 64),
    showing: strings(state.showing, 12),
    pendingRoleCity: text(state.pendingRoleCity, 20),
    features: {
      people: Number(features.people) || 0,
      stories: Number(features.stories) || 0,
      spacetime: features.spacetime === true,
      // Finished films, and whether this computer can render new ones (FFmpeg + Python + Pillow)
      films: (Array.isArray(features.films) ? features.films : []).slice(0, 12)
        .filter((f) => f && typeof f.id === 'string').map((f) => ({ id: text(f.id, 64), title: text(f.title, 40) })),
      filmCapable: features.filmCapable === true,
    },
  }
}

// Over the cap: rank by shared character pairs with the question, newest first among equals
export function pickPhotos(question, photos, cap = PHOTO_CAP) {
  if (photos.length <= cap) return photos
  const q = String(question || '').replace(/\s+/g, '')
  const grams = new Set()
  for (let i = 0; i < q.length - 1; i++) grams.add(q.slice(i, i + 2))
  const score = (p) => {
    const haystack = [p.title, p.caption, p.scene, p.place, p.city, p.date, ...p.tags, ...p.people].join(' ')
    let hits = 0
    for (const gram of grams) if (haystack.includes(gram)) hits++
    return hits
  }
  return photos.map((p, i) => ({ p, s: score(p), i })).sort((a, b) => b.s - a.s || b.i - a.i).slice(0, cap).map(({ p }) => p)
}

// Only actions on things that exist get through; at most four per answer
export function readActions(value, known) {
  const out = []
  for (const action of Array.isArray(value) ? value.slice(0, 12) : []) {
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') continue
    const { type } = action
    if (type === 'overview' || type === 'close' || type === 'open_stories') out.push({ type })
    else if (type === 'open_spacetime') { if (known.spacetime) out.push({ type }) }
    else if (type === 'focus_city') { if (known.cities.has(action.city)) out.push({ type, city: action.city }) }
    else if (type === 'focus_photo') { if (known.photos.has(action.assetId)) out.push({ type, assetId: action.assetId }) }
    else if (type === 'show_photos' || type === 'slideshow') {
      const assetIds = [...new Set(strings(action.assetIds, 12).filter((id) => known.photos.has(id)))]
      if (assetIds.length) out.push({ type, assetIds })
    }
    else if (type === 'open_event') { if (known.events.has(action.eventId)) out.push({ type, eventId: action.eventId }) }
    else if (type === 'set_place_role') { if (known.cities.has(action.city) && ROLES.includes(action.role)) out.push({ type, city: action.city, role: action.role }) }
    else if (type === 'timeline') { if (/^\d{4}-\d{2}-\d{2}$/.test(String(action.date || ''))) out.push({ type, date: action.date }) }
    else if (type === 'play_film') { if (known.films.size) out.push(known.films.has(action.filmId) ? { type, filmId: action.filmId } : { type }) }
    else if (type === 'make_film') {
      if (!known.filmCapable) continue
      const assetIds = [...new Set(strings(action.assetIds, 80).filter((id) => known.photos.has(id)))]
      out.push(assetIds.length ? { type, assetIds } : { type })
    }
    else if (type === 'story') {
      // One photo and one sentence per step, each photo once
      const seen = new Set()
      const steps = (Array.isArray(action.steps) ? action.steps : []).slice(0, 12)
        .filter((s) => s && typeof s.assetId === 'string' && known.photos.has(s.assetId) && typeof s.text === 'string' && s.text.trim() && !seen.has(s.assetId) && seen.add(s.assetId))
        .map((s) => ({ assetId: s.assetId, text: s.text.trim().slice(0, 160) }))
      if (steps.length) out.push({ type, steps })
    }
    if (out.length >= 4) break
  }
  return out
}

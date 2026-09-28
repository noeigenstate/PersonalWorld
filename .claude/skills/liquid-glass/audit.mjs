// Checks a stylesheet against the Liquid Glass rules in SKILL.md.
// audit(cssText) → [{ rule, ok, detail }]; used by test.mjs and by evals/ on older stylesheets.

// Flat list of { selectors: string[], decls: Map, media: string } (comments stripped, one level of @media)
export function parseCss(text) {
  const css = text.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = []
  let i = 0
  const readBlock = (media) => {
    while (i < css.length) {
      const open = css.indexOf('{', i)
      const close = css.indexOf('}', i)
      if (close !== -1 && (open === -1 || close < open)) { i = close + 1; return }
      if (open === -1) { i = css.length; return }
      const head = css.slice(i, open).trim()
      i = open + 1
      if (head.startsWith('@media') || head.startsWith('@supports')) { readBlock(head); continue }
      if (head.startsWith('@keyframes')) { let depth = 1; while (depth && i < css.length) { if (css[i] === '{') depth++; if (css[i] === '}') depth--; i++ } continue }
      const end = css.indexOf('}', i)
      const body = css.slice(i, end)
      i = end + 1
      const decls = new Map()
      for (const part of body.split(';')) {
        const colon = part.indexOf(':')
        if (colon > 0) decls.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim())
      }
      rules.push({ selectors: head.split(',').map((s) => s.trim()).filter(Boolean), decls, media })
    }
  }
  readBlock('')
  return rules
}

export const NAVIGATION = ['.app-bar', '.map-heading', '.timebar', '.butler', '.tray', '.map-photo-menu', '.import-modal', '.detail-panel', '.auth-card', '.privacy-modal']
export const CONTENT = ['.map-label', '.map-photo']
const TOKENS = ['--glass-fill', '--glass-fill-thick', '--glass-blur', '--glass-sheen', '--glass-rim', '--glass-shadow', '--glass-edge', '--fill', '--label', '--accent']

// sRGB relative luminance / contrast
const luminance = (hex) => {
  const [r, g, b] = hex.replace('#', '').match(/../g).map((h) => parseInt(h, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }

export function audit(text) {
  const rules = parseCss(text)
  const base = rules.filter((r) => !r.media)
  const has = (sel, pred, list = base) => list.some((r) => r.selectors.includes(sel) && pred(r.decls))
  const results = []
  const check = (rule, ok, detail = '') => results.push({ rule, ok: Boolean(ok), detail })

  const root = new Map(base.filter((r) => r.selectors.includes(':root')).flatMap((r) => [...r.decls]))
  const missingTokens = TOKENS.filter((t) => !root.has(t))
  check('tokens', !missingTokens.length, missingTokens.join(' '))

  const glassy = (d) => /var\(--glass-blur\)/.test(d.get('backdrop-filter') || '') && /--glass-(fill|sheen)/.test(d.get('background') || '')
  const bare = NAVIGATION.filter((sel) => !has(sel, glassy))
  check('navigation-is-glass', !bare.length, bare.join(' '))

  const contentGlass = rules.filter((r) => r.selectors.some((s) => CONTENT.some((c) => s.startsWith(c) && !/[\w-]/.test(s[c.length] || ''))) && [...r.decls.values()].some((v) => /--glass-(rim|sheen)/.test(v)))
  check('content-not-glass', !contentGlass.length, contentGlass.map((r) => r.selectors.join(',')).join(' | '))

  // Judge what the cascade leaves per selector: later rules with the same selector and media override earlier ones
  const merged = new Map()
  for (const r of rules) for (const sel of r.selectors) {
    const key = `${r.media}|${sel}`
    merged.set(key, new Map([...(merged.get(key) || []), ...r.decls]))
  }
  const unprefixed = [...merged].filter(([, d]) => d.has('backdrop-filter') && d.get('backdrop-filter') !== 'none' && d.get('-webkit-backdrop-filter') !== d.get('backdrop-filter')).map(([key]) => key)
  check('webkit-prefix', !unprefixed.length, unprefixed.join(' | '))

  const reduced = rules.filter((r) => /prefers-reduced-transparency/.test(r.media))
  const reducedCovers = NAVIGATION.filter((sel) => !has(sel, (d) => d.get('backdrop-filter') === 'none', reduced))
  check('reduce-transparency', reduced.length && !reducedCovers.length, reducedCovers.join(' '))

  check('increase-contrast', rules.some((r) => /prefers-contrast:\s*more/.test(r.media) && r.decls.has('border-color')))

  // Glass on glass: a descendant of a glass panel with its own glass blur
  const nested = rules.filter((r) => r.selectors.some((s) => NAVIGATION.some((n) => s.startsWith(n + ' '))) && /--glass-blur/.test(r.decls.get('backdrop-filter') || ''))
  check('no-glass-on-glass', !nested.length, nested.map((r) => r.selectors.join(',')).join(' | '))

  const moving = [...merged].filter(([key, d]) => /:hover|:active/.test(key) && d.has('transform') && d.get('transform') !== 'none').map(([key]) => key)
  check('static-on-hover', !moving.length, moving.join(' | '))

  check('clear-variant-over-media', has('.lightbox-toolbar button', (d) => /--glass-clear/.test(d.get('background') || '')))

  const label2 = root.get('--label-2') || root.get('--muted') || ''
  check('secondary-label-contrast', /^#[0-9a-f]{6}$/i.test(label2) && contrast(label2, '#ffffff') >= 4.5, label2)
  return results
}

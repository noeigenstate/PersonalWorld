---
name: liquid-glass
description: Apply Apple's Liquid Glass look to the Personal World web UI (CSS). Use when styling panels, bars, buttons, sheets or map overlays, or when the user asks for the Apple / 液态玻璃 style.
---

# Liquid Glass for Personal World (web)

Source: Apple HIG, Materials (<https://developer.apple.com/design/human-interface-guidelines/materials>) and
the Liquid Glass overview (<https://developer.apple.com/documentation/technologyoverviews/liquid-glass>).
The HIG rules below are quoted or paraphrased; the CSS is our web translation.

## Rules from the HIG

1. **Glass is a layer for controls and navigation that floats above content.**
   "Don't use Liquid Glass in the content layer." Content uses *standard materials* (plain blur, no glass rim or sheen).
2. **Sparingly.** Apply it to the most important functional elements only. Never put glass on glass: controls
   inside a glass panel use *fills* (translucent grey capsules), not another glass surface.
3. **Regular variant** for components with a lot of text (sidebars, popovers, alerts). It blurs and adjusts the
   luminosity of what is behind it.
4. **Clear variant** only over visually rich media (photos, video). If the media is bright, add a dark dimming
   layer of about 35 % opacity.
5. **Vibrant labels on materials**: text on glass uses the label colours (`--label`, `--label-2`), never a
   low-contrast tint.
6. **Accessibility**: when people reduce transparency the material becomes nearly opaque; when they increase
   contrast, edges get a visible border.
7. Shapes: capsules for buttons and chips; nested corners are **concentric** (inner radius = outer radius − padding).

## Where each material goes here

| Layer | Elements | Material |
|---|---|---|
| Navigation / controls (glass, regular) | `.app-bar` (floating capsule), `.map-heading`, `.timebar`, `.butler`, `.tray`, `.map-photo-menu`, `.map-empty`, sheets (`.import-modal`, `.detail-panel`, `.privacy-modal`, `.memory-library`, `.film-modal`, `.cull-sheet`), `.auth-card` | `.glass` tokens |
| Controls over photos (glass, clear + dim) | `.lightbox-toolbar button` | `--glass-clear` + 35 % dim |
| Primary action (tinted glass) | `.button-primary`, `.hold`, `.send` | accent fill + rim |
| Content | `.map-label`, `.map-photo`, `.map-scene-caption`, photo grids | standard material or opaque; **no** glass rim |
| Controls inside glass | chips, legend, secondary buttons, inputs, bubbles | fills (`--fill`, `--fill-2`) |

## Tokens (in `src/app.css` `:root`)

```css
--glass-fill: rgba(255,255,255,.56);            /* regular */
--glass-fill-thick: rgba(252,252,253,.8);       /* sheets with long text */
--glass-blur: blur(26px) saturate(190%);
--glass-sheen: linear-gradient(180deg,rgba(255,255,255,.55),rgba(255,255,255,.14) 36%,rgba(255,255,255,0) 62%,rgba(255,255,255,.16));
--glass-rim: inset 0 1px 1px rgba(255,255,255,.9), inset 0 -1px 1px rgba(255,255,255,.3), inset 0 0 0 .5px rgba(255,255,255,.6);
--glass-shadow: 0 12px 36px rgba(16,24,40,.16), 0 2px 6px rgba(16,24,40,.06);
```

Apply as: `background: var(--glass-sheen), var(--glass-fill); backdrop-filter: var(--glass-blur);
-webkit-backdrop-filter: var(--glass-blur); border: 1px solid var(--glass-edge); box-shadow: var(--glass-rim), var(--glass-shadow)`.
The sheen lives in `background` (not a pseudo-element) because many elements already use `:before`/`:after`.

## Project constraints that still apply

- The interface stays still: no floating, wobbling, refraction animation or hover movement (`CLAUDE.md`).
  Glass responds with colour and light only.
- Every `backdrop-filter` has its `-webkit-` twin (Safari on iPhone is a target over LAN).
- Floating chrome sits over a full-bleed map; the map is told about it through `insets.top` so fitted
  views are not hidden under the bar.

## Check

`node --test .claude/skills/liquid-glass/test.mjs` checks the stylesheet against these rules. Screenshots for
review: `node tests/ui-shots.mjs <dir>` with `npm run dev` running.

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
| Navigation / controls (glass, regular) | `.app-bar` (full-width strip across the top of the page), `.map-heading`, `.butler`, `.tray`, `.map-photo-menu`, `.map-empty`, sheets (`.import-modal`, `.detail-panel`, `.privacy-modal`, `.memory-library`, `.film-modal`, `.cull-sheet`), `.auth-card` | `.glass` tokens |
| Controls over photos (glass, clear + dim) | `.lightbox-toolbar button` | `--glass-clear` + 35 % dim |
| Primary action (tinted glass) | `.button-primary`, `.hold`, `.send` | accent fill + rim |
| Content | `.map-label`, `.map-photo`, `.map-scene-caption`, photo grids | standard material or opaque; **no** glass rim |
| Controls inside glass | chips, legend, secondary buttons, inputs, bubbles | fills (`--fill`, `--fill-2`) |

The timeline is a user-requested bare, draggable line over the scene, without a glass panel.

## Tokens (in `src/app.css` `:root`)

```css
--glass-fill: rgba(255,255,255,.26);            /* regular */
--glass-fill-thick: rgba(250,250,252,.68);      /* sheets and panels with long text */
--glass-blur: blur(12px) saturate(160%) brightness(1.04);
--glass-blur-thick: blur(22px) saturate(180%);
--glass-sheen: linear-gradient(180deg,rgba(255,255,255,.34),rgba(255,255,255,.06) 40%,rgba(255,255,255,0) 60%,rgba(255,255,255,.1));
--glass-rim: inset 0 1px 0 rgba(255,255,255,.85), inset 0 -1px 0 rgba(255,255,255,.28), inset 0 0 18px rgba(255,255,255,.22), inset 0 -12px 22px -16px rgba(20,30,60,.2);
--glass-specular: linear-gradient(135deg,rgba(255,255,255,.95),rgba(255,255,255,.22) 26%,rgba(255,255,255,0) 50%,rgba(255,255,255,.16) 74%,rgba(255,255,255,.7));
```

Apply as: `background: var(--glass-sheen), var(--glass-fill); backdrop-filter: var(--glass-blur);
-webkit-backdrop-filter: var(--glass-blur); border: 1px solid var(--glass-edge); box-shadow: var(--glass-rim), var(--glass-shadow)`.
The sheen lives in `background`; the specular rim is the one `::before` of each glass panel.

## Project constraints that still apply

- The interface stays still: no floating, wobbling, refraction animation or hover movement (`CLAUDE.md`).
  Glass responds with colour and light only.
- Every `backdrop-filter` has its `-webkit-` twin (Safari on iPhone is a target over LAN).
- The top bar spans the page width (not a floating capsule — the user asked for it to fill the top);
  the map runs on underneath it and is told about it through `insets.top` so fitted views are not hidden.

## What makes it read as real glass

- **Clear, not milky**: low fill (0.26–0.34 on the bar) and light blur, so the map shows through; text-heavy
  panels (heading, butler, sheets) use a denser slab (0.58–0.68) to stay legible.
- **Refraction at the rim** (`src/lib/liquidGlass.ts`): an SVG displacement map per element size and corner
  radius bends what is behind the rim inwards, like a lens. Chromium only (`backdrop-filter: url(#…)`);
  other browsers keep the plain glass. Static — nothing wobbles.
- **Specular rim**: `--glass-specular`, a 1 px masked gradient ring, bright at top-left and bottom-right,
  plus an inner glow and a faint lower shade in `--glass-rim` for thickness.
- **Moderate saturation** (150–160 %): higher turns the map's sky and seas neon.

## Check

`node --test skills/liquid-glass/test.mjs` checks the stylesheet against these rules. Screenshots for
review: `node tests/ui-shots.mjs <dir>` with `npm run dev` running.

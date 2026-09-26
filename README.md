# Ad Creative

A mobile web app for building product ad creative (fade overlay + headline/subhead + logo, over an uploaded photo). Single-page, works in a phone browser, no login, no backend — everything happens client-side on a `<canvas>`.

## Run locally

No build step. Serve the folder statically, e.g.:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000` on your phone or in a mobile-width browser window.

For the "Add to Home Screen" / installable PWA behaviour and the Web Share API "save to Photos" export flow, the app needs to be served over HTTPS (or `localhost`) — deploy it to any static host (Netlify, Vercel, GitHub Pages, etc.) to try that on a real phone.

## What's implemented

- Upload a photo, pick a canvas preset — all four match Meta's supported ad image ratios: Feed/Square 1:1, Feed (portrait) 4:5, Story/Reels 9:16, Landscape/Link ad 1.91:1
- Position tab: pinch/drag (or a zoom slider, 50–400%) to pan and zoom the photo within the canvas. Only active while that tab is open — the photo locks in place as soon as you switch tabs, so drags elsewhere can't accidentally move it. Zooming out below 100% switches from cropping the photo to fill the frame to showing the whole, uncropped photo (whatever the 100% crop was cutting off reappears) and then shrinking it further the more you zoom out, revealing a plain white margin that grows evenly around it — useful when the source photo's aspect ratio doesn't match the canvas preset and you want the entire subject visible with white space around it, not just what the crop leaves in frame
- Ken Burns video export (same Position tab): pan/zoom to a starting view and tap "Set Point A", then to an ending view and tap "Set Point B"; "Export video" records a smooth animated pan/zoom between them (eased, over a chosen duration) with text/logo held fixed on top, via canvas.captureStream() + MediaRecorder — MP4 on Safari, WebM elsewhere
- Fade overlay: direction (top, bottom, left, or right), reach, speed-to-solid, an intensity cap (so the darkest point can be dialled down to a light tint instead of ever becoming a fully solid block), colour, and an optional textured toggle (with its own strength and grain-size sliders) that adds a procedural paper/leather-style grain masked to fade in and out with the gradient's own alpha — using the smoothstep + plateau easing so the fade always blends to 0% opacity at its outer edge
- Eyedropper on every colour picker (fade, each text layer, logo tint): tap the pipette, then tap anywhere on the canvas to sample that exact pixel's colour straight off the photo/preview — works everywhere, including iOS Safari, since it doesn't rely on the browser's own (inconsistently supported) colour-input eyedropper
- Effects tab: film grain (with a fine-to-coarse grain-size slider — the low end is now genuinely fine, not just less-strong), vignette, a warm "heritage" colour-grade, and a "Film stock" selector with two full grades (each with its own strength slider), applied across the whole composite (photo, fade, text and logo):
  - **Fuji** — lifted/faded shadows with a cool teal cast, soft highlight roll-off with a warm amber cast, and gently muted saturation
  - **Tech optics** — a stylised late-'90s "classified hardware" look: crushed blacks with a cold steel/silver split tone, chromatic aberration that strengthens toward the frame edges, a chrome highlight bloom, fine grain, a cool anamorphic flare, a vignette, and a corner-bracket/grid/spec-text HUD overlay (editable label text) — each of those six layers past the base colour grade has its own on/off toggle, so you can keep just the grade and aberration and drop the rest, for instance
  - **Frontier** — a warm, sun-baked vintage-western advertising look: golden-hour white balance, selective colour (reds punched up, greens pulled toward muted olive, blues pulled toward a desaturated grey-teal), a faded-matte tone curve with lifted blacks and soft-rolled highlights, a brown-shadow/cream-highlight split tone, red-orange halation off the highlights, warm 35mm-style grain, and a soft dust haze drifting down from the top — halation, grain, haze, an optional top-right sun flare (off by default), and the vignette each have their own on/off toggle too
- Three independent text layers (headline, subheader, optional "other" line) — subheader and "other" can each be toggled off entirely — each with font, size, colour; horizontal alignment and a continuous position slider apply to the stacked text block as a whole, always staying inside the edge padding. An orientation control rotates the whole block 90° either way (reading top-to-bottom or bottom-to-top) for vertical text, with the position slider and its labels adapting to slide the rotated block left/right instead of up/down. Vertical text gets a second, independent position slider for the other axis (up/down the frame) in place of the horizontal-only "text block alignment" control — defaults to dead-centre, and clicking the already-active "Vertical" button again snaps both position sliders back to centre
- Inline legibility warning banner when the text block sits over an insufficiently-faded area
- Logo upload with drag-to-position on canvas or a vertical-position slider (both clamped to the same left/right and top/bottom margins as the text, at any size), corner + center position presets, and a colour choice: keep the logo's original colours, tint it to a custom colour you pick, or tint it to always match the current fade colour. While dragging, the margin boundaries are always shown, plus "smart" alignment guides that appear only when the logo's edges or centre line up with the canvas centre or the text block's own edges/centre — the same alignment signal design tools give you
- A persistent "default logo" (separate from the working session) that's saved once and then loads automatically in future sessions, surviving "Clear saved session"
- Independent left/right and top/bottom margin sliders (each symmetric), shared by the text block's width/vertical range and the logo's drag/slider clamp
- Story/Reels safe-zone overlay toggle
- Export renders at up to the photo's own native resolution (not capped at the on-screen preset size), with high-quality resampling and no in-app-only guides (safe zone, logo drag guides) ever baked in — via the Web Share API where supported (native "Save to Photos" sheet) with a download-link fallback
- Installable PWA: manifest + service worker precaching the app shell and self-hosted fonts for offline use, with network-first HTML so updates show up automatically
- Full session auto-save in IndexedDB — the uploaded photo, the logo, and every setting persist in the browser and are restored on reopen; "Clear saved session" wipes the current working state back to a blank start (saved default logo, recipe templates, and the project library are kept)
- A named recipe/template library: save the current fade/text/logo setup (not the photo) under a name, and re-apply it later to a different photo
- A project library: nested folders (e.g. Advertising → Top of funnel) holding fully saved projects — photo, logo, and every setting — that can be reopened and tweaked later, browsable from a "Library" button in the header
- Desktop/laptop friendly: above ~820px wide the layout switches to a canvas + sidebar side-by-side view (tabs and settings panel always visible together, no bottom sheet), with hover affordances on buttons/tabs — upload, typing, mouse-drag positioning/logo placement, and the library all work the same as on mobile, just with a mouse and keyboard. A +/− "editing view" zoom (desktop only) in the corner of the canvas lets you display it larger than the window for finer editing — purely a bigger on-screen display of the same composite (the stage scrolls once it no longer fits), with zero effect on the actual image, its resolution, or the export

## Fonts

Self-hosted (woff/ttf) under `fonts/`, sourced from Google Fonts: Playfair Display, Fraunces, Inter, Work Sans, Archivo, plus Georgia/system-ui fallbacks.

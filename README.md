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

- Upload a photo, pick a canvas preset (Feed 4:5, Feed 1:1, Story/Reels 9:16, Facebook link ad)
- Position tab: pinch/drag (or a zoom slider) to pan and zoom the photo within the canvas. Only active while that tab is open — the photo locks in place as soon as you switch tabs, so drags elsewhere can't accidentally move it
- Fade overlay: direction (top/bottom), reach, speed-to-solid, and an intensity cap (so the darkest point can be dialled down to a light tint instead of ever becoming a fully solid block), colour — using the smoothstep + plateau easing so the fade always blends to 0% opacity at its outer edge
- Three independent text layers (headline, subheader, optional "other" line), each with font, size, colour; horizontal alignment and a continuous vertical-position slider apply to the stacked text block as a whole, always staying inside the top/bottom edge padding
- Inline legibility warning banner when the text block sits over an insufficiently-faded area
- Logo upload with drag-to-position on canvas (clamped to the same side margin as the text at any size, with guide lines while dragging), corner + center position presets, and a colour choice: keep the logo's original colours, tint it to a custom colour you pick, or tint it to always match the current fade colour
- A persistent "default logo" (separate from the working session) that's saved once and then loads automatically in future sessions, surviving "Clear saved session"
- Adjustable side margin, shared by the text block width and the logo drag clamp
- Story/Reels safe-zone overlay toggle
- Export renders at up to the photo's own native resolution (not capped at the on-screen preset size), with high-quality resampling and no in-app-only guides (safe zone, logo drag guides) ever baked in — via the Web Share API where supported (native "Save to Photos" sheet) with a download-link fallback
- Installable PWA: manifest + service worker precaching the app shell and self-hosted fonts for offline use, with network-first HTML so updates show up automatically
- Full session auto-save in IndexedDB — the uploaded photo, the logo, and every setting persist in the browser and are restored on reopen; "Clear saved session" wipes the current working state back to a blank start (saved default logo, recipe templates, and the project library are kept)
- A named recipe/template library: save the current fade/text/logo setup (not the photo) under a name, and re-apply it later to a different photo
- A project library: nested folders (e.g. Advertising → Top of funnel) holding fully saved projects — photo, logo, and every setting — that can be reopened and tweaked later, browsable from a "Library" button in the header

## Fonts

Self-hosted (woff/ttf) under `fonts/`, sourced from Google Fonts: Playfair Display, Fraunces, Inter, Work Sans, Archivo, plus Georgia/system-ui fallbacks.

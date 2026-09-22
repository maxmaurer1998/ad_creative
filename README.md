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
- Fade overlay: direction (top/bottom), reach, speed, colour — using the smoothstep + plateau easing so the fade always blends to 0% opacity at its outer edge
- Three independent text layers (headline, subheader, optional "other" line), each with font, size, colour; alignment (horizontal/vertical) applies to the stacked text block as a whole
- Inline legibility warning banner when the text block sits over an insufficiently-faded area
- Logo upload with drag-to-position on canvas (clamped to the same side margin as the text, with guide lines while dragging) and corner presets; size as % of canvas width; optional "match fade colour" tint
- Adjustable side margin, shared by the text block width and the logo drag clamp
- Story/Reels safe-zone overlay toggle
- Export at full canvas resolution as PNG, via the Web Share API where supported (native "Save to Photos" sheet) with a download-link fallback
- Installable PWA: manifest + service worker precaching the app shell and self-hosted fonts for offline use
- Full session auto-save in IndexedDB — the uploaded photo, the logo, and every setting persist in the browser and are restored on reopen; "Clear saved session" wipes it back to a blank start

## Fonts

Self-hosted (woff/ttf) under `fonts/`, sourced from Google Fonts: Playfair Display, Fraunces, Inter, Work Sans, Archivo, plus Georgia/system-ui fallbacks.

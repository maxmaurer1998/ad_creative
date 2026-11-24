// Cut out tab: takes the product off its background and puts it on any colour
// with a realistic shadow. Everything runs on this device; nothing is uploaded.
//
// Two ways of finding the product:
//  - Colour (plain backgrounds, e.g. product shots on white): the background
//    colour is measured from the photo's edges, and only pixels that match it
//    AND are connected to the edge are removed. Anything that differs from the
//    background (dark leather, cream canvas, a black cuff, a burgundy clip) is
//    kept, so no part of the product can be cut away. Soft grey floor shadows
//    are recognised (neutral, smooth, a bit darker than the background) and
//    removed too, and edge pixels have the old background colour taken out so
//    there's no white fringe on a dark colour. No download needed.
//  - AI (busy backgrounds like wood or fur): an AI segmentation model (ISNet,
//    from IMG.LY's background-removal-data package, AGPL-3.0) via
//    onnxruntime-web. 88 MB, downloaded once. It guesses, so it can miss parts
//    of the product on close-ups; the status line says so.
// "Auto" picks Colour whenever the photo has a plain background around it.
(() => {
  'use strict';

  const ORT_VERSION = '1.19.2';
  const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
  const MODEL_PARTS = 22;
  const MODEL_PART_URL = (i) => `models/isnet/isnet-medium.part${String(i).padStart(2, '0')}`;
  const MODEL_CACHE = 'ad-creative-models-v1';
  const MODEL_CACHE_KEY = 'models/isnet/isnet-medium.onnx';
  const SIZE = 1024;           // AI model input/output size
  const MAX_SIDE = 2400;       // longest side of the result (plenty for ads)
  const SETTINGS_KEY = 'adCreativeCutoutSettings3';

  const STYLES = {
    flatlay: { strength: 18, soft: 60, dist: 6, angle: 270, contact: 15,
      hint: 'Flat lay: the product lying on a surface, lit from above. A subtle, soft shadow just below it.' },
    studio:  { strength: 25, soft: 45, dist: 30, angle: 270, contact: 20,
      hint: 'Studio drop: lit from one side, so the shadow falls the other way. Use "Light from" to move it.' },
    floor:   { strength: 35, soft: 45, dist: 30, angle: 300, contact: 35,
      hint: 'Standing: for products photographed upright (not lying flat). The shadow falls on the floor behind.' },
    none:    { hint: 'No shadow: just the product on the colour.' },
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    run: $('cutoutRunBtn'), cancel: $('cutoutCancelBtn'), progress: $('cutoutProgress'), bar: $('cutoutProgressBar'),
    status: $('cutoutStatus'), controls: $('cutoutControls'), method: $('cutoutMethod'), swatches: $('cutoutSwatches'), bg: $('cutoutBg'),
    light: $('cutoutLight'), lightVal: $('cutoutLightVal'), space: $('cutoutSpace'), spaceVal: $('cutoutSpaceVal'),
    style: $('cutoutShadowStyle'), styleHint: $('cutoutStyleHint'), sliders: $('cutoutShadowSliders'),
    strength: $('cutoutStrength'), strengthVal: $('cutoutStrengthVal'), soft: $('cutoutSoft'), softVal: $('cutoutSoftVal'),
    dist: $('cutoutDist'), distVal: $('cutoutDistVal'), angle: $('cutoutAngle'), angleVal: $('cutoutAngleVal'),
    contact: $('cutoutContact'), contactVal: $('cutoutContactVal'),
    clean: $('cutoutClean'), cleanVal: $('cutoutCleanVal'), trim: $('cutoutTrim'), trimVal: $('cutoutTrimVal'),
    stray: $('cutoutStray'), ownShadow: $('cutoutOwnShadow'),
    revert: $('cutoutRevertBtn'), download: $('cutoutDownloadBtn'),
  };
  if (!els.run) return;

  let session = null;
  let backend = '';
  let forceWasm = false;
  let running = false;
  let cancelled = false;
  let swapping = false;
  let originalBlob = null;  // photo before cutting out
  let work = null;          // { w, h, data } original pixels at working size
  let plain = null;         // { ok, bg:[r,g,b], noise, coverage }
  let usedMethod = '';      // 'colour' | 'ai'
  let aiRaw = null;         // { m: Float32Array(SIZE*SIZE), ox, oy, cw, ch }
  let alphaCache = null;    // { key, alpha }
  let aiNote = '';
  let resultBlob = null;
  let method = 'auto';
  let bgColor = '#ded0ba';  // or 'none'
  let style = 'flatlay';
  let composeTimer = 0;
  let composeSeq = 0;

  // ---------- settings ----------
  const SLIDERS = ['light', 'space', 'strength', 'soft', 'dist', 'angle', 'contact', 'clean', 'trim'];
  function saveSettings() {
    try {
      const s = { bgColor, style, method, stray: els.stray.checked, ownShadow: els.ownShadow.checked };
      SLIDERS.forEach((k) => { s[k] = +els[k].value; });
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch (e) { /* no storage */ }
  }
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      if (!s) return;
      if (s.bgColor) bgColor = s.bgColor;
      if (STYLES[s.style]) style = s.style;
      if (['auto', 'colour', 'ai'].includes(s.method)) method = s.method;
      SLIDERS.forEach((k) => { if (s[k] != null) els[k].value = s[k]; });
      if (s.stray != null) els.stray.checked = !!s.stray;
      if (s.ownShadow != null) els.ownShadow.checked = !!s.ownShadow;
    } catch (e) { /* ignore */ }
  }

  const ANGLE_NAMES = ['right', 'bottom right', 'below', 'bottom left', 'left', 'top left', 'above', 'top right'];
  function syncLabels() {
    els.lightVal.textContent = `${els.light.value}%`;
    els.spaceVal.textContent = `${els.space.value}%`;
    els.strengthVal.textContent = `${els.strength.value}%`;
    els.softVal.textContent = `${els.soft.value}%`;
    els.distVal.textContent = `${els.dist.value}%`;
    els.angleVal.textContent = ANGLE_NAMES[Math.round(+els.angle.value / 45) % 8];
    els.contactVal.textContent = `${els.contact.value}%`;
    els.cleanVal.textContent = `${els.clean.value}%`;
    els.trimVal.textContent = `${els.trim.value}`;
    [...els.method.querySelectorAll('button')].forEach((b) => b.classList.toggle('active', b.dataset.val === method));
    [...els.style.querySelectorAll('button')].forEach((b) => b.classList.toggle('active', b.dataset.val === style));
    els.styleHint.textContent = STYLES[style].hint;
    els.sliders.hidden = style === 'none';
    [...els.swatches.querySelectorAll('button')].forEach((b) => b.classList.toggle('active', b.dataset.val === bgColor));
    if (bgColor !== 'none') els.bg.value = bgColor;
    els.run.disabled = running || !(window.adCreative && window.adCreative.getPhoto());
  }

  function changed() { syncLabels(); saveSettings(); scheduleCompose(); }

  els.swatches.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    bgColor = b.dataset.val; changed();
  });
  els.bg.addEventListener('input', () => { bgColor = els.bg.value.toLowerCase(); changed(); });
  els.bg.addEventListener('change', () => { bgColor = els.bg.value.toLowerCase(); changed(); });
  els.style.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || !STYLES[b.dataset.val]) return;
    style = b.dataset.val;
    const p = STYLES[style];
    if (p.strength != null) ['strength', 'soft', 'dist', 'angle', 'contact'].forEach((k) => { els[k].value = p[k]; });
    changed();
  });
  els.method.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    method = b.dataset.val; syncLabels(); saveSettings();
    if (work) run(); // redo the cut-out with the chosen method
  });
  SLIDERS.forEach((k) => els[k].addEventListener('input', changed));
  els.stray.addEventListener('change', changed);
  els.ownShadow.addEventListener('change', changed);

  function resetAll() {
    originalBlob = null; work = null; plain = null; aiRaw = null; alphaCache = null; resultBlob = null; usedMethod = ''; aiNote = '';
    els.controls.hidden = true;
  }
  document.addEventListener('adcreative:photo', () => {
    const cur = window.adCreative && window.adCreative.getPhotoBlob();
    if (!swapping && cur !== resultBlob && cur !== originalBlob) { resetAll(); setStatus(''); }
    syncLabels();
    setTimeout(syncLabels, 400);
  });
  const tabBtn = document.querySelector('.tab-btn[data-panel="panel-cutout"]');
  if (tabBtn) tabBtn.addEventListener('click', () => setTimeout(syncLabels, 0));

  // ---------- helpers ----------
  function setStatus(t) { els.status.textContent = t; }
  function setProgress(f) { els.bar.style.width = `${Math.round(f * 100)}%`; }
  const nextFrame = () => new Promise((r) => setTimeout(r, 0));
  function canvasOf(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function loadImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read the photo.')); };
      img.src = url;
    });
  }
  function hexToRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h = 0, s = 0; const l = (mx + mn) / 2;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = (g - b) / d + (g < b ? 6 : 0); else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h, s, l];
  }
  // Real shadows aren't grey: they're the surface colour, darker and a bit
  // richer. Used with "multiply" so the background shows through.
  function shadowColorFor(hex) {
    if (hex === 'none') return 'rgb(0,0,0)';
    const [r, g, b] = hexToRgb(hex);
    const [h, s, l] = rgbToHsl(r, g, b);
    const l2 = Math.max(0.05, l * 0.45);
    const s2 = Math.min(1, s * 1.1 + 0.04);
    return `hsl(${Math.round(h * 360)}, ${Math.round(s2 * 100)}%, ${Math.round(l2 * 100)}%)`;
  }

  let filterBlur = null;
  function canFilterBlur() {
    if (filterBlur == null) {
      try { const x = canvasOf(2, 2).getContext('2d'); x.filter = 'blur(2px)'; filterBlur = x.filter === 'blur(2px)'; }
      catch (e) { filterBlur = false; }
    }
    return filterBlur;
  }
  // draws `src` blurred by `r` px into ctx at (x, y, w, h)
  function drawBlurred(ctx, src, r, x, y, w, h) {
    if (r < 0.5) { ctx.drawImage(src, x, y, w, h); return; }
    const pad = Math.ceil(r * 2.5);
    if (canFilterBlur()) {
      const t = canvasOf(Math.ceil(w) + 2 * pad, Math.ceil(h) + 2 * pad);
      const tc = t.getContext('2d');
      tc.filter = `blur(${r}px)`;
      tc.drawImage(src, pad, pad, w, h);
      ctx.drawImage(t, x - pad, y - pad);
      return;
    }
    // fallback: shrink and enlarge twice (close to a gaussian, and fast)
    const k = Math.max(1, r / 2);
    const sw = Math.max(2, Math.round((w + 2 * pad) / k)), sh = Math.max(2, Math.round((h + 2 * pad) / k));
    const a = canvasOf(sw, sh), ac = a.getContext('2d');
    ac.imageSmoothingQuality = 'high';
    ac.drawImage(src, pad / k, pad / k, w / k, h / k);
    const b2 = canvasOf(Math.max(2, Math.round(sw / 2)), Math.max(2, Math.round(sh / 2))), bc = b2.getContext('2d');
    bc.imageSmoothingQuality = 'high';
    bc.drawImage(a, 0, 0, b2.width, b2.height);
    ac.clearRect(0, 0, sw, sh);
    ac.drawImage(b2, 0, 0, sw, sh);
    ctx.save(); ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(a, x - pad, y - pad, w + 2 * pad, h + 2 * pad);
    ctx.restore();
  }

  // ---------- plain background detection ----------
  // Looks at a band around the photo's edges. If a good share of it is one
  // even colour, that's the background.
  function detectPlain(data, w, h) {
    const k = Math.max(3, Math.round(Math.min(w, h) * 0.006));
    const px = [];
    const add = (x, y) => { const i = (y * w + x) * 4; px.push(data[i], data[i + 1], data[i + 2]); };
    for (let y = 0; y < h; y += 2) for (let x = 0; x < k; x += 2) { add(x, y); add(w - 1 - x, y); }
    for (let x = 0; x < w; x += 2) for (let y = 0; y < k; y += 2) { add(x, y); add(x, h - 1 - y); }
    const n = px.length / 3;
    const bins = new Map();
    for (let i = 0; i < n; i++) {
      const key = ((px[3 * i] >> 4) << 8) | ((px[3 * i + 1] >> 4) << 4) | (px[3 * i + 2] >> 4);
      bins.set(key, (bins.get(key) || 0) + 1);
    }
    let best = 0, bestN = 0;
    bins.forEach((c, key) => { if (c > bestN) { bestN = c; best = key; } });
    const cr = ((best >> 8) & 15) * 16 + 8, cg = ((best >> 4) & 15) * 16 + 8, cb = (best & 15) * 16 + 8;
    const rs = [], gs = [], bs = [];
    for (let i = 0; i < n; i++) {
      const dr = px[3 * i] - cr, dg = px[3 * i + 1] - cg, db = px[3 * i + 2] - cb;
      if (dr * dr + dg * dg + db * db < 24 * 24) { rs.push(px[3 * i]); gs.push(px[3 * i + 1]); bs.push(px[3 * i + 2]); }
    }
    const med = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1] || 0; };
    const bg = [med(rs), med(gs), med(bs)];
    const ds = [];
    let close = 0;
    for (let i = 0; i < n; i++) {
      const dr = px[3 * i] - bg[0], dg = px[3 * i + 1] - bg[1], db = px[3 * i + 2] - bg[2];
      const d = Math.sqrt(dr * dr + dg * dg + db * db);
      if (d < 14) { close++; ds.push(d); }
    }
    ds.sort((p, q) => p - q);
    const noise = ds.length ? ds[Math.floor(ds.length * 0.9)] : 99;
    const coverage = close / n;
    const ok = coverage >= 0.1 && noise < 9;
    return { ok, bg, noise, coverage };
  }

  // ---------- colour cut-out ----------
  function colourAlpha(o) {
    const { w, h, data } = work;
    const N = w * h;
    const [br, bgc, bb] = plain.bg;
    const Lb = (br + bgc + bb) / 3;
    const chb = Math.max(Math.abs(br - Lb), Math.abs(bgc - Lb), Math.abs(bb - Lb));
    // Clean-up scales how close to the background colour a pixel must be to
    // count as background (default 30% = about the measured photo noise).
    // Kept tight on purpose, so pale product (cream canvas) is never taken.
    const tol = Math.max(4, plain.noise * 1.5 + 2) * (0.55 + o.clean * 1.5);
    const dist = new Float32Array(N);
    const L = new Uint8Array(N);
    const neutral = new Uint8Array(N); // same hue as the background, not darker than half
    for (let i = 0, j = 0; i < N; i++, j += 4) {
      const r = data[j], g = data[j + 1], b = data[j + 2];
      const dr = r - br, dg = g - bgc, db = b - bb;
      dist[i] = Math.sqrt(dr * dr + dg * dg + db * db);
      const m = (r + g + b) / 3;
      L[i] = m;
      const ch = Math.max(Math.abs(r - m), Math.abs(g - m), Math.abs(b - m));
      neutral[i] = (Math.abs(ch - chb) <= 5 && m >= Lb * 0.5 && m <= Lb + 6) ? 1 : 0;
    }
    // With the AI's help (when it's available), the photo's shadow can be
    // told apart from pale product: pixels that are light and nearly
    // colourless (a shadow on white picks up a faint warm or cool tint from
    // the product beside it) count as shadow only where the AI says "not
    // product". Strongly coloured or dark pixels are never removed this way,
    // so leather, brass, cream canvas and black knit stay safe whatever the
    // AI thinks.
    const ai = (o.ownShadow && aiRaw) ? aiAtWork() : null;
    if (ai) {
      for (let i = 0, j = 0; i < N; i++, j += 4) {
        if (neutral[i] || ai[i] >= 128) continue;
        const r = data[j], g = data[j + 1], b = data[j + 2];
        const m = L[i];
        const ch = Math.max(Math.abs(r - m), Math.abs(g - m), Math.abs(b - m));
        if (Math.abs(ch - chb) <= 14 && m >= Lb * 0.45 && m <= Lb + 6) neutral[i] = 2; // 2 = AI-confirmed shadow
      }
    }
    // 1 = background colour, 2 = the photo's own (soft, smooth) shadow
    const cand = new Uint8Array(N);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (dist[i] < tol) { cand[i] = 1; continue; }
        if (!o.ownShadow || !neutral[i]) continue;
        if (neutral[i] === 2) { cand[i] = 2; continue; }
        let mn = 255, mx = 0;
        for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++) {
          for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) {
            const v = L[yy * w + xx]; if (v < mn) mn = v; if (v > mx) mx = v;
          }
        }
        if (mx - mn <= 9) cand[i] = 2;
      }
    }
    // group background-looking pixels into connected areas
    const lab = new Int32Array(N);
    const stack = new Int32Array(N);
    const touches = [false], size = [0], exact = [0], nearBg = [0];
    let next = 1;
    for (let st = 0; st < N; st++) {
      if (!cand[st] || lab[st]) continue;
      let sp = 0, cnt = 0, ex = 0, nb = 0, edge = false;
      stack[sp++] = st; lab[st] = next;
      while (sp) {
        const p = stack[--sp]; cnt++;
        if (cand[p] === 1) ex++;
        if (dist[p] < 16) nb++;
        const x = p % w, y = (p / w) | 0;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
        if (x > 0 && cand[p - 1] && !lab[p - 1]) { lab[p - 1] = next; stack[sp++] = p - 1; }
        if (x < w - 1 && cand[p + 1] && !lab[p + 1]) { lab[p + 1] = next; stack[sp++] = p + 1; }
        if (y > 0 && cand[p - w] && !lab[p - w]) { lab[p - w] = next; stack[sp++] = p - w; }
        if (y < h - 1 && cand[p + w] && !lab[p + w]) { lab[p + w] = next; stack[sp++] = p + w; }
      }
      touches.push(edge); size.push(cnt); exact.push(ex); nearBg.push(nb); next++;
    }
    // background = areas touching the edge, plus enclosed areas that are
    // almost all exactly the background colour (belt holes, inside a buckle)
    // Enclosed areas (inside a clip, a buckle, a belt hole, between straps):
    //  - small ones count only if almost all exactly the background colour
    //    (belt holes), so white print or stitching on the product is safe;
    //  - larger ones (at least 0.04% of the photo) count if some of it is at
    //    or very near the background colour and the rest is the soft, neutral
    //    shading a gap gets (inside a belt loop or a clip).
    const minGap = Math.max(200, N * 0.0004);
    const isBgLab = new Uint8Array(next);
    for (let l = 1; l < next; l++) {
      if (touches[l]) isBgLab[l] = 1;
      else if (size[l] >= 6 && exact[l] / size[l] >= 0.85) isBgLab[l] = 1;
      else if (size[l] >= minGap && nearBg[l] >= 30 && nearBg[l] / size[l] >= 0.03) isBgLab[l] = 1;
    }
    const bg = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (lab[i] && isBgLab[lab[i]]) bg[i] = 1;
    // the faint outer rim of the photo's shadow: neutral pixels right next to
    // the background (up to 3 px), which the smoothness test above can miss
    // and the rest of the photo's shadow, which can be darker or have a
    // steeper edge than the smoothness test allows (e.g. under a clip):
    // grow the background outwards through neutral, fairly smooth pixels,
    // up to 1.5% of the photo. Textured or shiny parts (leather grain, metal
    // highlights) and anything with colour stop it.
    if (o.ownShadow) {
      const maxSteps = Math.max(4, Math.round(Math.max(w, h) * 0.015));
      const range = (i) => {
        const x = i % w, y = (i / w) | 0;
        let mn = 255, mx = 0;
        for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++) {
          for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) {
            const v = L[yy * w + xx]; if (v < mn) mn = v; if (v > mx) mx = v;
          }
        }
        return mx - mn;
      };
      // each pixel is looked at once (seen), so this stays fast on big photos
      const seen = new Uint8Array(N);
      let front = [];
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!bg[i] && neutral[i] && (bg[i - 1] || bg[i + 1] || bg[i - w] || bg[i + w])) { front.push(i); seen[i] = 1; }
      }
      for (let step = 0; step < maxSteps && front.length; step++) {
        const grown = [];
        const lim = step < 3 ? 40 : 16;
        for (const i of front) if (neutral[i] === 2 || range(i) <= lim) grown.push(i);
        for (const i of grown) bg[i] = 1;
        const nf = [];
        const push = (q) => { if (!seen[q] && !bg[q] && neutral[q]) { seen[q] = 1; nf.push(q); } };
        for (const i of grown) {
          const x = i % w, y = (i / w) | 0;
          if (x > 0) push(i - 1);
          if (x < w - 1) push(i + 1);
          if (y > 0) push(i - w);
          if (y < h - 1) push(i + w);
        }
        front = nf;
      }
    }
    // alpha: background 0, product 1, and a proper soft edge: for product
    // pixels touching the background, work out how much of the pixel is
    // product by comparing it with the solid product colour just inside
    const alpha = new Float32Array(N);
    for (let i = 0; i < N; i++) alpha[i] = bg[i] ? 0 : 1;
    const band = new Uint8Array(N);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (bg[i]) continue;
      let near = false;
      for (let yy = Math.max(0, y - 2); yy <= Math.min(h - 1, y + 2) && !near; yy++) {
        for (let xx = Math.max(0, x - 2); xx <= Math.min(w - 1, x + 2); xx++) if (bg[yy * w + xx]) { near = true; break; }
      }
      if (near) band[i] = 1;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!band[i]) continue;
      // solid product colour nearby (not on the edge band)
      let fr = 0, fg = 0, fb = 0, n = 0;
      for (let yy = Math.max(0, y - 4); yy <= Math.min(h - 1, y + 4); yy++) {
        for (let xx = Math.max(0, x - 4); xx <= Math.min(w - 1, x + 4); xx++) {
          const q = yy * w + xx;
          if (bg[q] || band[q]) continue;
          const j = q * 4; fr += data[j]; fg += data[j + 1]; fb += data[j + 2]; n++;
        }
      }
      const j = i * 4;
      if (!n) { // thin bit of product: judge by distance from the background alone
        const t = (dist[i] - tol) / Math.max(20, 4 * tol);
        alpha[i] = t <= 0 ? 0 : t >= 1 ? 1 : t;
        continue;
      }
      fr /= n; fg /= n; fb /= n;
      const vr = fr - br, vg = fg - bgc, vb = fb - bb;
      const vv = vr * vr + vg * vg + vb * vb;
      if (vv < 400) { alpha[i] = 1; continue; } // product the same colour as the background: keep
      const cr = data[j] - br, cg = data[j + 1] - bgc, cb = data[j + 2] - bb;
      let t = (cr * vr + cg * vg + cb * vb) / vv;
      alpha[i] = t <= 0 ? 0 : t >= 1 ? 1 : t;
    }
    return alpha;
  }

  // ---------- AI cut-out ----------
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.crossOrigin = 'anonymous';
      s.onload = resolve; s.onerror = () => reject(new Error('Could not load the AI engine (check your connection).'));
      document.head.appendChild(s);
    });
  }
  async function fetchModel() {
    let cache = null;
    try { cache = await caches.open(MODEL_CACHE); } catch (e) { /* no Cache API */ }
    if (cache) {
      const hit = await cache.match(MODEL_CACHE_KEY);
      if (hit) return new Uint8Array(await hit.arrayBuffer());
    }
    const parts = [];
    let got = 0;
    for (let i = 0; i < MODEL_PARTS; i++) {
      if (cancelled) throw new Error('cancelled');
      const res = await fetch(MODEL_PART_URL(i));
      if (!res.ok) throw new Error(`Could not download the model (${res.status}).`);
      const buf = new Uint8Array(await res.arrayBuffer());
      parts.push(buf); got += buf.length;
      setProgress((i + 1) / MODEL_PARTS * 0.6);
      setStatus(`Downloading the AI model, first time only… ${Math.round(got / 1e6)} of 88 MB`);
    }
    const all = new Uint8Array(got);
    let o = 0;
    for (const p of parts) { all.set(p, o); o += p.length; }
    if (cache) {
      try { await cache.put(MODEL_CACHE_KEY, new Response(all, { headers: { 'Content-Type': 'application/octet-stream' } })); }
      catch (e) { /* quota: will download again next time */ }
    }
    return all;
  }
  async function getSession() {
    if (session) return session;
    setStatus('Loading the AI engine…');
    if (!window.ort) await loadScript(`${ORT_BASE}ort.webgpu.min.js`);
    const ort = window.ort;
    ort.env.wasm.wasmPaths = ORT_BASE;
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    const bytes = await fetchModel();
    const tries = [];
    if (navigator.gpu && !forceWasm) tries.push('webgpu');
    tries.push('wasm');
    let lastErr = null;
    for (const ep of tries) {
      try {
        setStatus(ep === 'webgpu' ? 'Starting the AI model on your graphics chip…' : 'Starting the AI model…');
        session = await ort.InferenceSession.create(bytes, { executionProviders: [ep], graphOptimizationLevel: 'all' });
        backend = ep;
        return session;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('Could not start the model.');
  }
  async function runAI(img) {
    const sess = await getSession();
    const ort = window.ort;
    if (cancelled) throw new Error('cancelled');
    setProgress(0.65);
    setStatus('Finding the product…' + (backend === 'wasm' ? ' (no GPU: can take up to a minute)' : ''));
    await nextFrame();
    // keep the photo's shape: fit it inside the square, padded with its edge colour
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const s = SIZE / Math.max(iw, ih);
    const cw = Math.round(iw * s), ch = Math.round(ih * s);
    const ox = (SIZE - cw) >> 1, oy = (SIZE - ch) >> 1;
    const c = canvasOf(SIZE, SIZE);
    const cx = c.getContext('2d', { willReadFrequently: true });
    const e = plain.bg;
    cx.fillStyle = `rgb(${e[0]},${e[1]},${e[2]})`;
    cx.fillRect(0, 0, SIZE, SIZE);
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(img, ox, oy, cw, ch);
    const px = cx.getImageData(0, 0, SIZE, SIZE).data;
    const plane = SIZE * SIZE;
    const input = new Float32Array(3 * plane);
    for (let i = 0, j = 0; i < plane; i++, j += 4) {
      input[i] = (px[j] - 128) / 256;
      input[plane + i] = (px[j + 1] - 128) / 256;
      input[2 * plane + i] = (px[j + 2] - 128) / 256;
    }
    const res = await sess.run({ input: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) }, ['output']);
    if (cancelled) throw new Error('cancelled');
    const out = res.output.data;
    const m = new Float32Array(plane);
    for (let i = 0; i < plane; i++) { const v = out[i]; m[i] = v < 0 ? 0 : v > 1 ? 1 : v; }
    if (res.output.dispose) res.output.dispose();
    return { m, ox, oy, cw, ch };
  }
  // the AI model's raw answer (0..1, 1 = product) at working size
  function aiAtWork() {
    const { w, h } = work;
    const small = canvasOf(SIZE, SIZE);
    const sc = small.getContext('2d');
    const id = sc.createImageData(SIZE, SIZE);
    for (let i = 0, j = 0; i < aiRaw.m.length; i++, j += 4) { id.data[j] = id.data[j + 1] = id.data[j + 2] = 255; id.data[j + 3] = Math.round(aiRaw.m[i] * 255); }
    sc.putImageData(id, 0, 0);
    const big = canvasOf(w, h);
    const bc = big.getContext('2d', { willReadFrequently: true });
    bc.imageSmoothingEnabled = true; bc.imageSmoothingQuality = 'high';
    bc.drawImage(small, aiRaw.ox, aiRaw.oy, aiRaw.cw, aiRaw.ch, 0, 0, w, h);
    const d = bc.getImageData(0, 0, w, h).data;
    const a = new Uint8Array(w * h);
    for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
    return a;
  }

  function aiAlpha(o) {
    const { w, h } = work;
    const small = canvasOf(SIZE, SIZE);
    const sc = small.getContext('2d');
    const id = sc.createImageData(SIZE, SIZE);
    for (let i = 0, j = 0; i < aiRaw.m.length; i++, j += 4) { id.data[j] = id.data[j + 1] = id.data[j + 2] = 255; id.data[j + 3] = Math.round(aiRaw.m[i] * 255); }
    sc.putImageData(id, 0, 0);
    const big = canvasOf(w, h);
    const bc = big.getContext('2d', { willReadFrequently: true });
    bc.imageSmoothingEnabled = true; bc.imageSmoothingQuality = 'high';
    bc.drawImage(small, aiRaw.ox, aiRaw.oy, aiRaw.cw, aiRaw.ch, 0, 0, w, h);
    const d = bc.getImageData(0, 0, w, h).data;
    const N = w * h;
    const a = new Float32Array(N);
    // The model is often unsure inside the product (a cuff against fur comes
    // out half see-through), so anything it is even fairly sure of becomes
    // solid product. Clean-up raises the bar a little.
    const lo = 0.05 + o.clean * 0.3, hi = 0.3 + o.clean * 0.4;
    for (let i = 0; i < N; i++) {
      let t = (d[i * 4 + 3] / 255 - lo) / (hi - lo);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      a[i] = t * t * (3 - 2 * t);
    }
    return a;
  }

  // ---------- shared edge steps ----------
  // drops loose specks: separate pieces under 2% of the biggest piece
  function removeStray(a, w, h) {
    const N = w * h;
    const lab = new Int32Array(N);
    const stack = new Int32Array(N);
    const sizes = [0];
    let next = 1;
    for (let s = 0; s < N; s++) {
      if (lab[s] || a[s] < 0.5) continue;
      let sp = 0, cnt = 0;
      stack[sp++] = s; lab[s] = next;
      while (sp) {
        const p = stack[--sp]; cnt++;
        const x = p % w, y = (p / w) | 0;
        if (x > 0 && !lab[p - 1] && a[p - 1] >= 0.5) { lab[p - 1] = next; stack[sp++] = p - 1; }
        if (x < w - 1 && !lab[p + 1] && a[p + 1] >= 0.5) { lab[p + 1] = next; stack[sp++] = p + 1; }
        if (y > 0 && !lab[p - w] && a[p - w] >= 0.5) { lab[p - w] = next; stack[sp++] = p - w; }
        if (y < h - 1 && !lab[p + w] && a[p + w] >= 0.5) { lab[p + w] = next; stack[sp++] = p + w; }
      }
      sizes.push(cnt); next++;
    }
    let biggest = 0; for (const s of sizes) if (s > biggest) biggest = s;
    if (!biggest) return;
    const drop = sizes.map((s) => s < biggest * 0.02);
    for (let i = 0; i < N; i++) if (lab[i] && drop[lab[i]]) a[i] = 0;
  }
  function trimEdge(a, w, h, n) {
    for (let pass = 0; pass < n; pass++) {
      const src = a.slice();
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const p = y * w + x;
        let v = src[p];
        if (x > 0 && src[p - 1] < v) v = src[p - 1];
        if (x < w - 1 && src[p + 1] < v) v = src[p + 1];
        if (y > 0 && src[p - w] < v) v = src[p - w];
        if (y < h - 1 && src[p + w] < v) v = src[p + w];
        a[p] = (a[p] + v) / 2;
      }
    }
  }

  function opts() {
    return {
      bg: bgColor, light: els.light.value / 100, space: els.space.value / 100, style,
      strength: els.strength.value / 100, soft: els.soft.value / 100, dist: els.dist.value / 100,
      angle: +els.angle.value, contact: els.contact.value / 100,
      clean: els.clean.value / 100, trim: +els.trim.value, stray: els.stray.checked, ownShadow: els.ownShadow.checked,
    };
  }

  function getAlpha(o) {
    const key = `${usedMethod}|${o.clean}|${o.trim}|${o.stray}|${o.ownShadow}|${!!aiRaw}`;
    if (alphaCache && alphaCache.key === key) return alphaCache.alpha;
    const a = usedMethod === 'colour' ? colourAlpha(o) : aiAlpha(o);
    if (o.stray) removeStray(a, work.w, work.h);
    if (o.trim) trimEdge(a, work.w, work.h, o.trim);
    alphaCache = { key, alpha: a };
    return a;
  }

  // ---------- compose ----------
  function compose(o) {
    const { w, h, data } = work;
    const alpha = getAlpha(o);
    const N = w * h;
    const pad = Math.round(o.space * 0.5 * Math.max(w, h));
    const W = w + 2 * pad, H = h + 2 * pad;
    const unit = Math.max(w, h) / 100; // 1% of the photo's longer side

    // the product, with the old background colour taken out of its soft edges
    const obj = canvasOf(w, h);
    const oc = obj.getContext('2d');
    const od = oc.createImageData(w, h);
    const d = od.data;
    const bgk = usedMethod === 'colour' ? plain.bg : null;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let i = 0, j = 0; i < N; i++, j += 4) {
      const a = alpha[i];
      let r = data[j], g = data[j + 1], b = data[j + 2];
      if (bgk && a > 0.02 && a < 0.999) {
        r = (r - (1 - a) * bgk[0]) / a; g = (g - (1 - a) * bgk[1]) / a; b = (b - (1 - a) * bgk[2]) / a;
      }
      d[j] = r; d[j + 1] = g; d[j + 2] = b; d[j + 3] = a * 255;
      if (a > 0.5) {
        const x = i % w, y = (i / w) | 0;
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    oc.putImageData(od, 0, 0);
    const box = maxX < 0 ? { x0: 0, y0: 0, x1: w, y1: h } : { x0: minX, y0: minY, x1: maxX + 1, y1: maxY + 1 };

    const out = canvasOf(W, H);
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';

    // 1. background
    if (o.bg !== 'none') {
      ctx.fillStyle = o.bg;
      ctx.fillRect(0, 0, W, H);
      if (o.light > 0) {
        const cx = W / 2, cy = H * 0.45, R = Math.hypot(W, H) * 0.6;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
        g.addColorStop(0, `rgba(255,255,255,${0.14 * o.light})`);
        g.addColorStop(0.45, 'rgba(255,255,255,0)');
        g.addColorStop(1, `rgba(0,0,0,${0.18 * o.light})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
    }

    // 2. shadows, tinted with the background colour
    if (o.style !== 'none' && o.strength + o.contact > 0) {
      const sil = canvasOf(w, h);
      const sc = sil.getContext('2d');
      sc.fillStyle = shadowColorFor(o.bg);
      sc.fillRect(0, 0, w, h);
      sc.globalCompositeOperation = 'destination-in';
      sc.drawImage(obj, 0, 0);

      ctx.save();
      if (o.bg !== 'none') ctx.globalCompositeOperation = 'multiply';
      const rad = (o.angle + 180) * Math.PI / 180; // light FROM angle, shadow falls the other way
      if (o.style === 'floor') {
        const baseY = box.y1;
        const squash = 0.18 + o.dist * 0.5;
        const lean = Math.cos(rad) * (0.4 + o.dist);
        const tmp = canvasOf(W, H);
        const tc = tmp.getContext('2d');
        // point (x, y) -> (x + lean*(baseY - y), baseY - squash*(baseY - y))
        tc.setTransform(1, 0, -lean, squash, pad + lean * baseY, pad + baseY * (1 - squash));
        tc.drawImage(sil, 0, 0);
        tc.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = o.strength;
        drawBlurred(ctx, tmp, (1 + o.soft * 5) * unit, 0, 0, W, H);
      } else {
        const studio = o.style === 'studio';
        const dd = o.dist * (studio ? 6 : 3) * unit;
        const dx = Math.cos(rad) * dd, dy = Math.sin(rad) * dd;
        const blurR = (0.8 + o.soft * (studio ? 6 : 8)) * unit;
        // a wide, very soft shadow...
        ctx.globalAlpha = o.strength * 0.8;
        drawBlurred(ctx, sil, blurR, pad + dx, pad + dy, w, h);
        // ...and a lighter core nearer the product
        ctx.globalAlpha = o.strength * 0.35;
        drawBlurred(ctx, sil, blurR * 0.45, pad + dx * 0.5, pad + dy * 0.5, w, h);
      }
      // contact shadow: soft darkening right where the product meets the surface
      if (o.contact > 0) {
        const cr = Math.max(1.5, 0.5 * unit);
        ctx.globalAlpha = o.contact * 0.55;
        drawBlurred(ctx, sil, cr, pad + Math.cos(rad) * cr * 0.4, pad + Math.sin(rad) * cr * 0.4 + cr * 0.3, w, h);
      }
      ctx.restore();
    }

    // 3. the product itself
    ctx.drawImage(obj, pad, pad);
    return out;
  }

  async function composeAndApply() {
    if (!work || !usedMethod) return;
    const seq = ++composeSeq;
    const o = opts();
    setStatus('Updating…');
    await nextFrame();
    let out;
    try { out = compose(o); }
    catch (e) { console.error(e); setStatus(`Something went wrong: ${(e && e.message) || e}`); return; }
    const type = o.bg === 'none' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise((r) => out.toBlob(r, type, 0.94));
    if (seq !== composeSeq) return;
    if (!blob) { setStatus('Could not create the image (it may be too large for this device).'); return; }
    resultBlob = blob;
    swapping = true;
    await window.adCreative.replacePhoto(blob);
    swapping = false;
    setStatus(modeText());
  }
  function scheduleCompose() {
    if (!usedMethod) return;
    clearTimeout(composeTimer);
    composeTimer = setTimeout(composeAndApply, 250);
  }
  function modeText() {
    if (usedMethod === 'colour') return 'Plain background found, so it was cut out by its exact colour: every part of the product that differs from the background is kept' + (aiRaw ? ', and the AI checked the photo\'s own shadow' : '') + '. Adjust anything below; the design updates as you go.' + aiNote;
    return 'Cut out with the AI model (busy background). Check the edges: on close-ups it can miss parts of the product. If the photo has a plain background, choose Colour instead.';
  }

  // ---------- main ----------
  async function run() {
    if (running) return;
    const curImg = window.adCreative && window.adCreative.getPhoto();
    if (!curImg) return;
    running = true; cancelled = false;
    els.run.disabled = true; els.cancel.hidden = false; els.progress.hidden = false;
    setProgress(0.05);
    try {
      if (!originalBlob) originalBlob = window.adCreative.getPhotoBlob();
      const img = originalBlob ? await loadImage(originalBlob) : curImg;
      if (!work) {
        const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
        const f = Math.min(1, MAX_SIDE / Math.max(iw, ih));
        const w = Math.round(iw * f), h = Math.round(ih * f);
        const c = canvasOf(w, h);
        const cx = c.getContext('2d', { willReadFrequently: true });
        cx.imageSmoothingQuality = 'high';
        cx.drawImage(img, 0, 0, w, h);
        work = { w, h, data: cx.getImageData(0, 0, w, h).data };
        plain = detectPlain(work.data, w, h);
      }
      alphaCache = null;
      let m = method;
      if (m === 'auto') m = plain.ok ? 'colour' : 'ai';
      if (m === 'colour' && !plain.ok) {
        setStatus('No plain background found around the edges, so Colour can\'t be used on this photo. Try AI.');
        return;
      }
      if (m === 'ai' && !aiRaw) aiRaw = await runAI(img);
      if (m === 'colour' && els.ownShadow.checked && !aiRaw) {
        // the AI helps tell the photo's own shadow from pale product; if it
        // can't load (offline, old phone) the colour cut-out still works
        try { aiRaw = await runAI(img); }
        catch (e) {
          if (e && e.message === 'cancelled') throw e;
          console.warn('AI shadow help unavailable', e);
          aiNote = ' (Shadow check without AI: some of the photo\'s own shadow may be left. Try again on Wi-Fi.)';
        }
      }
      usedMethod = m;
      setProgress(0.95);
      setStatus('Cutting out…');
      await nextFrame();
      els.controls.hidden = false;
      await composeAndApply();
      setProgress(1);
    } catch (e) {
      swapping = false;
      if (e && e.message === 'cancelled') setStatus('Cancelled. Your photo is unchanged.');
      else if (backend === 'webgpu' && !forceWasm) {
        console.warn('WebGPU run failed, retrying on CPU', e);
        forceWasm = true; session = null; backend = '';
        running = false;
        setTimeout(run, 0);
        return;
      } else { console.error(e); setStatus(`Something went wrong: ${(e && e.message) || e}`); }
    } finally {
      running = false;
      els.cancel.hidden = true;
      setTimeout(() => { if (!running) els.progress.hidden = true; }, 1200);
      syncLabels();
    }
  }

  els.run.addEventListener('click', run);
  els.cancel.addEventListener('click', () => { cancelled = true; setStatus('Stopping…'); });
  els.revert.addEventListener('click', async () => {
    if (!originalBlob) return;
    clearTimeout(composeTimer); composeSeq++;
    const keep = originalBlob;
    swapping = true;
    await window.adCreative.replacePhoto(keep);
    swapping = false;
    resetAll();
    setStatus('Back to the original photo.');
  });
  els.download.addEventListener('click', async () => {
    const blob = window.adCreative && window.adCreative.getPhotoBlob();
    if (!blob) return;
    const ext = (blob.type || '').includes('png') ? 'png' : 'jpg';
    const name = `cutout-${Date.now()}.${ext}`;
    const file = new File([blob], name, { type: blob.type || 'image/jpeg' });
    const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });

  loadSettings();
  syncLabels();
  // test hook
  window.__cutout = {
    run, compose: () => composeAndApply(),
    get method() { return usedMethod; }, get plain() { return plain; },
    alpha: () => (alphaCache ? alphaCache.alpha : null), size: () => (work ? [work.w, work.h] : null),
  };
})();

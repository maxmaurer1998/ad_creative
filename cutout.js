// Cut out tab: removes the photo's background with an AI segmentation model
// (ISNet, from IMG.LY's background-removal-data package, AGPL-3.0) that runs
// on this device with onnxruntime-web, then puts the product on any colour
// with a realistic shadow. Nothing is uploaded anywhere.
//
// The model (models/isnet/isnet-medium.partNN, joined in order) takes
//   input  float32 [1,3,1024,1024]  RGB, (pixel - 128) / 256
// and returns output float32 [1,1,1024,1024]  0..1 (1 = product).
//
// The mask is computed once per photo. Everything after that (colour,
// shadow, edges, space) is redrawn from the original photo + mask, so the
// sliders can be changed as often as you like without losing quality.
(() => {
  'use strict';

  const ORT_VERSION = '1.19.2';
  const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
  const MODEL_PARTS = 22;
  const MODEL_PART_URL = (i) => `models/isnet/isnet-medium.part${String(i).padStart(2, '0')}`;
  const MODEL_CACHE = 'ad-creative-models-v1';
  const MODEL_CACHE_KEY = 'models/isnet/isnet-medium.onnx';
  const SIZE = 1024;           // model input/output size
  const MAX_SIDE = 3000;       // longest side of the result (plenty for ads)
  const SETTINGS_KEY = 'adCreativeCutoutSettings1';

  const STYLES = {
    flatlay: { strength: 35, soft: 45, dist: 18, angle: 315, contact: 45,
      hint: 'Flat lay: the product lying on a surface, photographed from above. Soft, close shadow all round.' },
    studio:  { strength: 45, soft: 30, dist: 40, angle: 315, contact: 40,
      hint: 'Studio drop: lit from one side, so the shadow falls the other way. Use "Light from" to move it.' },
    floor:   { strength: 55, soft: 35, dist: 30, angle: 300, contact: 60,
      hint: 'Standing: the product upright on a floor, with its shadow on the ground behind it.' },
    none:    { hint: 'No shadow: just the product on the colour.' },
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    run: $('cutoutRunBtn'), cancel: $('cutoutCancelBtn'), progress: $('cutoutProgress'), bar: $('cutoutProgressBar'),
    status: $('cutoutStatus'), controls: $('cutoutControls'), swatches: $('cutoutSwatches'), bg: $('cutoutBg'),
    light: $('cutoutLight'), lightVal: $('cutoutLightVal'), space: $('cutoutSpace'), spaceVal: $('cutoutSpaceVal'),
    style: $('cutoutShadowStyle'), styleHint: $('cutoutStyleHint'), sliders: $('cutoutShadowSliders'),
    strength: $('cutoutStrength'), strengthVal: $('cutoutStrengthVal'), soft: $('cutoutSoft'), softVal: $('cutoutSoftVal'),
    dist: $('cutoutDist'), distVal: $('cutoutDistVal'), angle: $('cutoutAngle'), angleVal: $('cutoutAngleVal'),
    contact: $('cutoutContact'), contactVal: $('cutoutContactVal'),
    clean: $('cutoutClean'), cleanVal: $('cutoutCleanVal'), trim: $('cutoutTrim'), trimVal: $('cutoutTrimVal'), stray: $('cutoutStray'),
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
  let originalImg = null;   // decoded original
  let rawMask = null;       // Float32Array(SIZE*SIZE) straight from the model
  let resultBlob = null;    // last composite we put in the design
  let bgColor = '#ded0ba';  // or 'none'
  let style = 'flatlay';
  let composeTimer = 0;
  let composeSeq = 0;

  // ---------- settings ----------
  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        bgColor, style, light: +els.light.value, space: +els.space.value,
        strength: +els.strength.value, soft: +els.soft.value, dist: +els.dist.value, angle: +els.angle.value,
        contact: +els.contact.value, clean: +els.clean.value, trim: +els.trim.value, stray: els.stray.checked,
      }));
    } catch (e) { /* no storage: just not remembered */ }
  }
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      if (!s) return;
      if (s.bgColor) bgColor = s.bgColor;
      if (STYLES[s.style]) style = s.style;
      ['light', 'space', 'strength', 'soft', 'dist', 'angle', 'contact', 'clean', 'trim'].forEach((k) => { if (s[k] != null) els[k].value = s[k]; });
      if (s.stray != null) els.stray.checked = !!s.stray;
    } catch (e) { /* ignore */ }
  }

  const ANGLE_NAMES = ['right', 'bottom right', 'below', 'bottom left', 'left', 'top left', 'above', 'top right'];
  function syncLabels() {
    els.lightVal.textContent = `${els.light.value}%`;
    els.spaceVal.textContent = `${els.space.value}%`;
    els.strengthVal.textContent = `${els.strength.value}%`;
    els.softVal.textContent = `${els.soft.value}%`;
    els.distVal.textContent = `${els.dist.value}%`;
    const a = +els.angle.value;
    // angle is where the light comes from, measured clockwise from "right" on screen
    els.angleVal.textContent = ANGLE_NAMES[Math.round(a / 45) % 8];
    els.contactVal.textContent = `${els.contact.value}%`;
    els.cleanVal.textContent = `${els.clean.value}%`;
    els.trimVal.textContent = `${els.trim.value}`;
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
  ['light', 'space', 'strength', 'soft', 'dist', 'angle', 'contact', 'clean', 'trim'].forEach((k) => els[k].addEventListener('input', changed));
  els.stray.addEventListener('change', changed);

  // a new photo (not one we made) starts over
  document.addEventListener('adcreative:photo', () => {
    const cur = window.adCreative && window.adCreative.getPhotoBlob();
    if (!swapping && cur !== resultBlob && cur !== originalBlob) {
      originalBlob = null; originalImg = null; rawMask = null; resultBlob = null;
      els.controls.hidden = true;
      setStatus('');
    }
    syncLabels();
    setTimeout(syncLabels, 400);
  });
  const tabBtn = document.querySelector('.tab-btn[data-panel="panel-cutout"]');
  if (tabBtn) tabBtn.addEventListener('click', () => setTimeout(syncLabels, 0));

  // ---------- model ----------
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
      setStatus(`Downloading the model, first time only… ${Math.round(got / 1e6)} of 88 MB`);
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
        setStatus(ep === 'webgpu' ? 'Starting the model on your graphics chip…' : 'Starting the model…');
        session = await ort.InferenceSession.create(bytes, { executionProviders: [ep], graphOptimizationLevel: 'all' });
        backend = ep;
        return session;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('Could not start the model.');
  }

  function loadImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read the photo.')); };
      img.src = url;
    });
  }

  // ---------- helpers ----------
  function setStatus(t) { els.status.textContent = t; }
  function setProgress(f) { els.bar.style.width = `${Math.round(f * 100)}%`; }
  const nextFrame = () => new Promise((r) => setTimeout(r, 0));
  function canvasOf(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h = 0, s = 0; const l = (mx + mn) / 2;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
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
    const l2 = Math.max(0.04, l * 0.3);
    const s2 = Math.min(1, s * 1.1 + 0.05);
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
    if (canFilterBlur()) {
      // filter blur on a padded copy so the edges fade out instead of clipping
      const pad = Math.ceil(r * 2.5);
      const t = canvasOf(Math.ceil(w) + 2 * pad, Math.ceil(h) + 2 * pad);
      const tc = t.getContext('2d');
      tc.filter = `blur(${r}px)`;
      tc.drawImage(src, pad, pad, w, h);
      ctx.drawImage(t, x - pad, y - pad);
      return;
    }
    // fallback: shrink and enlarge twice (close to a gaussian, and fast)
    const k = Math.max(1, r / 2);
    const pad = Math.ceil(r * 2.5);
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

  // ---------- mask clean-up (at model resolution, 1024 x 1024) ----------
  function refineMask(raw, clean, trim, stray) {
    const N = SIZE * SIZE;
    const m = new Float32Array(N);
    // 1. contrast: pushes faint leftovers to 0 and the product to 1
    const lo = clean * 0.45, hi = 1 - clean * 0.3;
    for (let i = 0; i < N; i++) {
      let t = (raw[i] - lo) / Math.max(0.01, hi - lo);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      m[i] = t * t * (3 - 2 * t);
    }
    // 2. keep only the main piece(s): flood fill everything over 0.5 and
    // drop islands smaller than 8% of the biggest one
    if (stray) {
      const lab = new Int32Array(N);
      const sizes = [0];
      const stack = new Int32Array(N);
      let next = 1;
      for (let i = 0; i < N; i++) {
        if (lab[i] || m[i] < 0.5) continue;
        let sp = 0, count = 0;
        stack[sp++] = i; lab[i] = next;
        while (sp) {
          const p = stack[--sp]; count++;
          const x = p % SIZE, y = (p / SIZE) | 0;
          if (x > 0 && !lab[p - 1] && m[p - 1] >= 0.5) { lab[p - 1] = next; stack[sp++] = p - 1; }
          if (x < SIZE - 1 && !lab[p + 1] && m[p + 1] >= 0.5) { lab[p + 1] = next; stack[sp++] = p + 1; }
          if (y > 0 && !lab[p - SIZE] && m[p - SIZE] >= 0.5) { lab[p - SIZE] = next; stack[sp++] = p - SIZE; }
          if (y < SIZE - 1 && !lab[p + SIZE] && m[p + SIZE] >= 0.5) { lab[p + SIZE] = next; stack[sp++] = p + SIZE; }
        }
        sizes.push(count); next++;
      }
      const biggest = Math.max(0, ...sizes);
      if (biggest > 0) {
        const keep = sizes.map((s) => s >= biggest * 0.08);
        // the soft edge pixels (under 0.5) belong to the nearest kept piece:
        // grow the kept area by a few pixels and use that as a gate
        const gate = new Uint8Array(N);
        for (let i = 0; i < N; i++) if (lab[i] && keep[lab[i]]) gate[i] = 1;
        for (let pass = 0; pass < 4; pass++) {
          const g2 = gate.slice();
          for (let y = 1; y < SIZE - 1; y++) for (let x = 1; x < SIZE - 1; x++) {
            const p = y * SIZE + x;
            if (!gate[p] && (gate[p - 1] || gate[p + 1] || gate[p - SIZE] || gate[p + SIZE])) g2[p] = 1;
          }
          gate.set(g2);
        }
        for (let i = 0; i < N; i++) if (!gate[i]) m[i] = 0;
      }
    }
    // 3. trim: shrink the edge by n px (removes a halo of old background)
    for (let pass = 0; pass < trim; pass++) {
      const src = m.slice();
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
        const p = y * SIZE + x;
        let v = src[p];
        if (x > 0) v = Math.min(v, src[p - 1]);
        if (x < SIZE - 1) v = Math.min(v, src[p + 1]);
        if (y > 0) v = Math.min(v, src[p - SIZE]);
        if (y < SIZE - 1) v = Math.min(v, src[p + SIZE]);
        m[p] = (m[p] + 3 * v) / 4; // partial erode keeps the edge smooth
      }
    }
    return m;
  }

  function maskCanvas(m) {
    const c = canvasOf(SIZE, SIZE);
    const x = c.getContext('2d');
    const id = x.createImageData(SIZE, SIZE);
    const d = id.data;
    let minX = SIZE, minY = SIZE, maxX = -1, maxY = -1;
    for (let i = 0, j = 0; i < m.length; i++, j += 4) {
      d[j] = 255; d[j + 1] = 255; d[j + 2] = 255;
      const a = Math.round(m[i] * 255);
      d[j + 3] = a;
      if (a > 128) {
        const px = i % SIZE, py = (i / SIZE) | 0;
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
      }
    }
    x.putImageData(id, 0, 0);
    const box = maxX < 0 ? { x0: 0, y0: 0, x1: 1, y1: 1 } : { x0: minX / SIZE, y0: minY / SIZE, x1: (maxX + 1) / SIZE, y1: (maxY + 1) / SIZE };
    return { c, box };
  }

  // ---------- compose ----------
  function opts() {
    return {
      bg: bgColor, light: els.light.value / 100, space: els.space.value / 100, style,
      strength: els.strength.value / 100, soft: els.soft.value / 100, dist: els.dist.value / 100,
      angle: +els.angle.value, contact: els.contact.value / 100,
      clean: els.clean.value / 100, trim: +els.trim.value, stray: els.stray.checked,
    };
  }

  function compose(o) {
    const iw = originalImg.naturalWidth || originalImg.width, ih = originalImg.naturalHeight || originalImg.height;
    const f = Math.min(1, MAX_SIDE / Math.max(iw, ih));
    const w = Math.round(iw * f), h = Math.round(ih * f);
    const pad = Math.round(o.space * 0.5 * Math.max(w, h));
    const W = w + 2 * pad, H = h + 2 * pad;
    const unit = Math.max(w, h) / 100; // 1% of the photo's longer side

    const { c: mSmall, box } = maskCanvas(refineMask(rawMask, o.clean, o.trim, o.stray));
    // full-size mask
    const mask = canvasOf(w, h);
    const mc = mask.getContext('2d');
    mc.imageSmoothingEnabled = true; mc.imageSmoothingQuality = 'high';
    mc.drawImage(mSmall, 0, 0, w, h);

    const out = canvasOf(W, H);
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';

    // 1. background
    if (o.bg !== 'none') {
      ctx.fillStyle = o.bg;
      ctx.fillRect(0, 0, W, H);
      if (o.light > 0) {
        // soft light pool a little above centre, gently darker corners
        const cx = W / 2, cy = H * 0.45, R = Math.hypot(W, H) * 0.6;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
        g.addColorStop(0, `rgba(255,255,255,${0.16 * o.light})`);
        g.addColorStop(0.45, 'rgba(255,255,255,0)');
        g.addColorStop(1, `rgba(0,0,0,${0.2 * o.light})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
    }

    // 2. shadows, tinted with the background colour
    if (o.style !== 'none') {
      const sil = canvasOf(w, h);
      const sc = sil.getContext('2d');
      sc.fillStyle = shadowColorFor(o.bg);
      sc.fillRect(0, 0, w, h);
      sc.globalCompositeOperation = 'destination-in';
      sc.drawImage(mask, 0, 0);

      ctx.save();
      if (o.bg !== 'none') ctx.globalCompositeOperation = 'multiply';
      // light comes FROM o.angle, so the shadow falls the opposite way
      const rad = (o.angle + 180) * Math.PI / 180;
      if (o.style === 'floor') {
        // shadow on the ground: the silhouette flattened onto the floor line
        // at the bottom of the product and leaned away from the light
        const baseY = box.y1 * h;
        const squash = 0.18 + o.dist * 0.5;
        const lean = Math.cos(rad) * (0.4 + o.dist);
        const blurR = (0.6 + o.soft * 4) * unit;
        const tmp = canvasOf(W, H);
        const tc = tmp.getContext('2d');
        // point (x, y) -> (x + lean*(baseY - y), baseY - squash*(baseY - y))
        tc.setTransform(1, 0, -lean, squash, pad + lean * baseY, pad + baseY * (1 - squash));
        tc.drawImage(sil, 0, 0);
        tc.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = o.strength;
        drawBlurred(ctx, tmp, blurR, 0, 0, W, H);
      } else {
        const d = o.dist * (o.style === 'studio' ? 6 : 3) * unit;
        const dx = Math.cos(rad) * d, dy = Math.sin(rad) * d;
        const blurR = (0.3 + o.soft * (o.style === 'studio' ? 4 : 6)) * unit;
        // wide soft shadow
        ctx.globalAlpha = o.strength;
        drawBlurred(ctx, sil, blurR, pad + dx, pad + dy, w, h);
        // a tighter, darker core nearer the product
        ctx.globalAlpha = o.strength * 0.5;
        drawBlurred(ctx, sil, blurR * 0.35, pad + dx * 0.4, pad + dy * 0.4, w, h);
      }
      // contact shadow: thin and dark right at the edge, barely offset
      if (o.contact > 0) {
        ctx.globalAlpha = Math.min(1, o.contact * 0.9);
        const cr = Math.max(1, 0.25 * unit);
        drawBlurred(ctx, sil, cr, pad + Math.cos(rad) * cr * 0.6, pad + Math.sin(rad) * cr * 0.6 + cr * 0.3, w, h);
      }
      ctx.restore();
    }

    // 3. the product itself
    const obj = canvasOf(w, h);
    const oc = obj.getContext('2d');
    oc.imageSmoothingEnabled = true; oc.imageSmoothingQuality = 'high';
    oc.drawImage(originalImg, 0, 0, w, h);
    oc.globalCompositeOperation = 'destination-in';
    oc.drawImage(mask, 0, 0);
    ctx.drawImage(obj, pad, pad);
    return out;
  }

  async function composeAndApply() {
    if (!rawMask || !originalImg) return;
    const seq = ++composeSeq;
    const o = opts();
    setStatus('Updating…');
    await nextFrame();
    let out;
    try { out = compose(o); }
    catch (e) { console.error(e); setStatus(`Something went wrong: ${(e && e.message) || e}`); return; }
    const type = o.bg === 'none' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise((r) => out.toBlob(r, type, 0.94));
    if (seq !== composeSeq) return; // a newer change is on its way
    if (!blob) { setStatus('Could not create the image (it may be too large for this device).'); return; }
    resultBlob = blob;
    swapping = true;
    await window.adCreative.replacePhoto(blob);
    swapping = false;
    setStatus(`Done: ${out.width}×${out.height}. Adjust anything below; the design updates as you go.`);
  }
  function scheduleCompose() {
    if (!rawMask) return;
    clearTimeout(composeTimer);
    composeTimer = setTimeout(composeAndApply, 250);
  }

  // ---------- main ----------
  async function run() {
    if (running) return;
    const curImg = window.adCreative && window.adCreative.getPhoto();
    if (!curImg) return;
    running = true; cancelled = false;
    els.run.disabled = true; els.cancel.hidden = false; els.progress.hidden = false;
    setProgress(0);
    try {
      // always cut out from the original, even if a cut-out is showing
      if (!originalBlob) {
        originalBlob = window.adCreative.getPhotoBlob();
        originalImg = originalBlob ? await loadImage(originalBlob) : curImg;
      }
      const sess = await getSession();
      const ort = window.ort;
      if (cancelled) throw new Error('cancelled');
      setProgress(0.65);
      setStatus('Finding the product…' + (backend === 'wasm' ? ' (no GPU: can take up to a minute)' : ''));
      await nextFrame();
      const c = canvasOf(SIZE, SIZE);
      const cx = c.getContext('2d', { willReadFrequently: true });
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(originalImg, 0, 0, SIZE, SIZE);
      const px = cx.getImageData(0, 0, SIZE, SIZE).data;
      const plane = SIZE * SIZE;
      const input = new Float32Array(3 * plane);
      for (let i = 0, j = 0; i < plane; i++, j += 4) {
        input[i] = (px[j] - 128) / 256;
        input[plane + i] = (px[j + 1] - 128) / 256;
        input[2 * plane + i] = (px[j + 2] - 128) / 256;
      }
      const t0 = performance.now();
      const res = await sess.run({ input: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) }, ['output']);
      if (cancelled) throw new Error('cancelled');
      const outData = res.output.data;
      rawMask = new Float32Array(plane);
      for (let i = 0; i < plane; i++) { const v = outData[i]; rawMask[i] = v < 0 ? 0 : v > 1 ? 1 : v; }
      if (res.output.dispose) res.output.dispose();
      setProgress(0.95);
      els.controls.hidden = false;
      await composeAndApply();
      setProgress(1);
      setStatus(`Background removed in ${Math.round((performance.now() - t0) / 1000)}s. Pick a colour and shadow below; the design updates as you go. Save the project to keep it.`);
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
    swapping = true;
    await window.adCreative.replacePhoto(originalBlob);
    swapping = false;
    els.controls.hidden = true;
    rawMask = null; resultBlob = null;
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
  window.__cutout = { run, compose: () => composeAndApply(), get backend() { return backend; }, get hasMask() { return !!rawMask; } };
})();

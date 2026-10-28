// Enhance tab: AI upscaling (Real-ESRGAN general-x4v3) that runs on this
// device with onnxruntime-web. Nothing is uploaded anywhere.
//
// The model (models/realesr-general-dn-x4.onnx) takes
//   image   float32 [1,3,h,w]  RGB 0..1
//   denoise float32 [1]        0 = keep all texture/grain, 1 = clean hardest
// and returns output float32 [1,3,4h,4w] (needs clamping to 0..1).
//
// The photo is processed in overlapping tiles so memory stays small, each
// tile is scaled straight to the chosen output size (2x = 4x then halved,
// which keeps more detail than a plain 2x), then some of the original is
// blended back and a little film grain added so it doesn't look plastic.
(() => {
  'use strict';

  const ORT_VERSION = '1.19.2';
  const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
  const MODEL_URL = 'models/realesr-general-dn-x4.onnx';
  const MODEL_CACHE = 'ad-creative-models-v1';
  const TILE = 128;          // core tile size (input pixels)
  const PAD = 10;            // overlap on each side, hides tile seams
  const MAX_OUT_PIXELS = 16_000_000; // iPhone Safari's canvas limit is ~16.7 MP

  const PRESETS = {
    leather:       { denoise: 5,  blend: 22, sharpen: 30, grain: 10,
      hint: 'Leather: keeps the natural grain and makes it crisper. A good default for all leather products.' },
    leatherDetail: { denoise: 0,  blend: 15, sharpen: 50, grain: 8,
      hint: 'Leather detail: maximum texture for close-ups of grain, creases and stitching. Check edges for halos.' },
    leatherSoft:   { denoise: 15, blend: 30, sharpen: 15, grain: 12,
      hint: 'Leather soft: for noisy or low-light photos. Cleans grainy shadows, keeps the leather looking real.' },
    natural:       { denoise: 12, blend: 35, sharpen: 0,  grain: 15,
      hint: 'Natural: the gentlest option, closest to the original photo. Good for shearling and fabric.' },
    balanced:      { denoise: 45, blend: 22, sharpen: 10, grain: 18,
      hint: 'Balanced: cleaner and smoother. For lifestyle shots where the product is small in frame.' },
    crisp:         { denoise: 90, blend: 10, sharpen: 0,  grain: 10,
      hint: 'Crisp: cleans hardest. Can make leather look smooth or plastic, so best for backgrounds and scenes.' },
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    preset: $('enhancePreset'), denoise: $('enhanceDenoise'), denoiseVal: $('enhanceDenoiseVal'),
    blend: $('enhanceBlend'), blendVal: $('enhanceBlendVal'), sharpen: $('enhanceSharpen'), sharpenVal: $('enhanceSharpenVal'), presetHint: $('enhancePresetHint'), grain: $('enhanceGrain'), grainVal: $('enhanceGrainVal'),
    scale: $('enhanceScale'), sizeHint: $('enhanceSizeHint'), run: $('enhanceRunBtn'), cancel: $('enhanceCancelBtn'),
    progress: $('enhanceProgress'), bar: $('enhanceProgressBar'), status: $('enhanceStatus'),
    afterRow: $('enhanceAfterRow'), revert: $('enhanceRevertBtn'), download: $('enhanceDownloadBtn'),
  };
  if (!els.run) return;

  let scale = 2;
  let running = false;
  let cancelled = false;
  let session = null;        // ort.InferenceSession, created once
  let backend = '';
  let forceWasm = false;    // set if the GPU path fails mid-run
  let originalBlob = null;   // the photo before enhancing, for "Back to original"
  let enhancedBlob = null;   // the last enhanced result
  let swapping = false;      // true while we swap the photo ourselves

  // ---------- settings ----------
  const SETTINGS_KEY = 'adCreativeEnhanceSettings2';
  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        denoise: +els.denoise.value, blend: +els.blend.value, sharpen: +els.sharpen.value, grain: +els.grain.value, scale,
      }));
    } catch (e) { /* storage unavailable: settings just won't be remembered */ }
  }
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      if (!s) return;
      els.denoise.value = s.denoise; els.blend.value = s.blend; els.grain.value = s.grain;
      if (s.sharpen != null) els.sharpen.value = s.sharpen;
      if (s.scale === 2 || s.scale === 4) scale = s.scale;
    } catch (e) { /* ignore */ }
  }

  function syncLabels() {
    els.denoiseVal.textContent = `${els.denoise.value}%`;
    els.blendVal.textContent = `${els.blend.value}%`;
    els.grainVal.textContent = (els.grain.value / 10).toFixed(1);
    els.sharpenVal.textContent = `${els.sharpen.value}%`;
    [...els.scale.querySelectorAll('button')].forEach((b) => b.classList.toggle('active', +b.dataset.val === scale));
    let match = '';
    for (const [name, p] of Object.entries(PRESETS)) {
      if (p.denoise === +els.denoise.value && p.blend === +els.blend.value && p.grain === +els.grain.value && p.sharpen === +els.sharpen.value) match = name;
    }
    [...els.preset.querySelectorAll('button')].forEach((b) => b.classList.toggle('active', b.dataset.val === match));
    els.presetHint.textContent = match ? PRESETS[match].hint : 'Custom settings.';
    updateSizeHint();
  }

  els.preset.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const p = PRESETS[b.dataset.val]; if (!p) return;
    els.denoise.value = p.denoise; els.blend.value = p.blend; els.grain.value = p.grain; els.sharpen.value = p.sharpen;
    syncLabels(); saveSettings();
  });
  els.scale.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    scale = +b.dataset.val; syncLabels(); saveSettings();
  });
  [els.denoise, els.blend, els.sharpen, els.grain].forEach((el) => el.addEventListener('input', () => { syncLabels(); saveSettings(); }));

  // ---------- sizes ----------
  function plan() {
    const img = window.adCreative && window.adCreative.getPhoto();
    if (!img) return null;
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    // shrink the input first if the result would be too big for a canvas
    let inW = w, inH = h;
    const maxIn = Math.sqrt(MAX_OUT_PIXELS / (scale * scale));
    const f = Math.min(1, maxIn / Math.sqrt(w * h));
    if (f < 1) { inW = Math.floor(w * f); inH = Math.floor(h * f); }
    return { w, h, inW, inH, outW: inW * scale, outH: inH * scale, shrunk: f < 1 };
  }

  function updateSizeHint() {
    const p = plan();
    els.run.disabled = !p || running;
    els.download.disabled = !p || running || !(window.adCreative && window.adCreative.getPhotoBlob());
    if (!p) { els.sizeHint.textContent = 'Load a photo to see the output size.'; return; }
    const mp = (p.outW * p.outH / 1e6).toFixed(1);
    let t = `${p.w}×${p.h} → ${p.outW}×${p.outH} (${mp} MP).`;
    if (p.shrunk) t += ' The photo is large, so it is reduced a little first to stay within what phones can handle.';
    els.sizeHint.textContent = t;
  }

  document.addEventListener('adcreative:photo', () => {
    // ignore the swaps this tab makes itself (enhanced <-> original)
    const cur = window.adCreative && window.adCreative.getPhotoBlob();
    if (!swapping && cur !== enhancedBlob && cur !== originalBlob) {
      originalBlob = null; enhancedBlob = null; els.afterRow.hidden = true; els.status.textContent = '';
    }
    updateSizeHint();
    setTimeout(updateSizeHint, 400); // the image may still be decoding
  });

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
    // kept in its own cache so app updates don't make you download it again
    let cache = null;
    try { cache = await caches.open(MODEL_CACHE); } catch (e) { /* no Cache API */ }
    if (cache) {
      const hit = await cache.match(MODEL_URL);
      if (hit) return new Uint8Array(await hit.arrayBuffer());
    }
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`Could not download the model (${res.status}).`);
    if (cache) { try { await cache.put(MODEL_URL, res.clone()); } catch (e) { /* quota: fine */ } }
    return new Uint8Array(await res.arrayBuffer());
  }

  async function getSession() {
    if (session) return session;
    setStatus('Loading the AI engine…');
    if (!window.ort) await loadScript(`${ORT_BASE}ort.webgpu.min.js`);
    const ort = window.ort;
    ort.env.wasm.wasmPaths = ORT_BASE;
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    setStatus('Downloading the model (10 MB, first time only)…');
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

  // ---------- sharpen ----------
  // Unsharp mask: pixel + amount * (pixel - blurred pixel), with a small
  // 3x3 gaussian blur, so it lifts fine texture rather than outlining shapes.
  // Done in horizontal strips (with a 1-row overlap) to keep memory low.
  async function unsharp(c, W, H, amount) {
    const STRIP = 192;
    for (let y0 = 0; y0 < H; y0 += STRIP) {
      const top = Math.max(0, y0 - 1), bot = Math.min(H, y0 + STRIP + 1);
      const hh = bot - top;
      const id = c.getImageData(0, top, W, hh);
      const a = id.data;
      const src = new Uint8ClampedArray(a);
      const row = W * 4;
      const yStart = y0 - top, yEnd = Math.min(y0 + STRIP, H) - top;
      for (let y = yStart; y < yEnd; y++) {
        const yu = y > 0 ? y - 1 : y, yd = y < hh - 1 ? y + 1 : y;
        const ru = yu * row, rc = y * row, rd = yd * row;
        for (let x = 0; x < W; x++) {
          const l = (x > 0 ? x - 1 : x) * 4, m = x * 4, r = (x < W - 1 ? x + 1 : x) * 4;
          for (let ch = 0; ch < 3; ch++) {
            const v = src[rc + m + ch];
            const blur = (src[ru + l + ch] + src[ru + r + ch] + src[rd + l + ch] + src[rd + r + ch]
              + 2 * (src[ru + m + ch] + src[rd + m + ch] + src[rc + l + ch] + src[rc + r + ch]) + 4 * v) / 16;
            a[rc + m + ch] = v + amount * (v - blur);
          }
        }
      }
      // write back only this strip's own rows (not the overlap)
      c.putImageData(id, 0, top, 0, yStart, W, yEnd - yStart);
      await nextFrame();
    }
  }

  // ---------- main ----------
  function setStatus(t) { els.status.textContent = t; }
  function setProgress(f) { els.bar.style.width = `${Math.round(f * 100)}%`; }
  const nextFrame = () => new Promise((r) => setTimeout(r, 0));

  function fmtTime(s) {
    s = Math.max(0, Math.round(s));
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  }

  async function enhance() {
    const p = plan(); if (!p || running) return;
    running = true; cancelled = false;
    els.run.disabled = true; els.cancel.hidden = false; els.progress.hidden = false; els.afterRow.hidden = true;
    setProgress(0);
    const settings = { denoise: els.denoise.value / 100, blend: els.blend.value / 100, grain: els.grain.value / 10, sharpen: els.sharpen.value / 100, scale };
    try {
      const sess = await getSession();
      const ort = window.ort;
      const img = window.adCreative.getPhoto();
      if (!originalBlob) originalBlob = window.adCreative.getPhotoBlob();

      // input pixels
      const src = document.createElement('canvas');
      src.width = p.inW; src.height = p.inH;
      const sctx = src.getContext('2d', { willReadFrequently: true });
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(img, 0, 0, p.inW, p.inH);
      const px = sctx.getImageData(0, 0, p.inW, p.inH).data;

      const out = document.createElement('canvas');
      out.width = p.outW; out.height = p.outH;
      const octx = out.getContext('2d');
      octx.imageSmoothingEnabled = true; octx.imageSmoothingQuality = 'high';

      // fixed-size windows (shifted inwards at the edges) so the model sees
      // one shape throughout, which is much faster on the GPU
      const winW = Math.min(TILE + 2 * PAD, p.inW), winH = Math.min(TILE + 2 * PAD, p.inH);
      const xs = [], ys = [];
      for (let x = 0; x < p.inW; x += TILE) xs.push(x);
      for (let y = 0; y < p.inH; y += TILE) ys.push(y);
      const total = xs.length * ys.length;
      const plane = winW * winH;
      const input = new Float32Array(3 * plane);
      const dn = new ort.Tensor('float32', new Float32Array([settings.denoise]), [1]);
      const tileCanvas = document.createElement('canvas');
      tileCanvas.width = winW * 4; tileCanvas.height = winH * 4;
      const tctx = tileCanvas.getContext('2d');
      const tileData = tctx.createImageData(winW * 4, winH * 4);
      const t0 = performance.now();
      let done = 0;

      for (const cy of ys) {
        for (const cx of xs) {
          if (cancelled) throw new Error('cancelled');
          const coreW = Math.min(TILE, p.inW - cx), coreH = Math.min(TILE, p.inH - cy);
          const wx = Math.max(0, Math.min(cx - PAD, p.inW - winW));
          const wy = Math.max(0, Math.min(cy - PAD, p.inH - winH));
          for (let y = 0; y < winH; y++) {
            let si = ((wy + y) * p.inW + wx) * 4, di = y * winW;
            for (let x = 0; x < winW; x++, si += 4, di++) {
              input[di] = px[si] / 255;
              input[plane + di] = px[si + 1] / 255;
              input[2 * plane + di] = px[si + 2] / 255;
            }
          }
          const res = await sess.run({ image: new ort.Tensor('float32', input, [1, 3, winH, winW]), denoise: dn });
          const o = res.output.data; // [3, 4winH, 4winW]
          const op = 16 * plane, d = tileData.data;
          for (let i = 0, j = 0; i < op; i++, j += 4) {
            d[j] = Math.max(0, Math.min(255, o[i] * 255 + 0.5));
            d[j + 1] = Math.max(0, Math.min(255, o[op + i] * 255 + 0.5));
            d[j + 2] = Math.max(0, Math.min(255, o[2 * op + i] * 255 + 0.5));
            d[j + 3] = 255;
          }
          if (res.output.dispose) res.output.dispose();
          tctx.putImageData(tileData, 0, 0);
          // copy just this tile's core into the output, scaled to 2x or 4x
          const sx = (cx - wx) * 4, sy = (cy - wy) * 4;
          octx.drawImage(tileCanvas, sx, sy, coreW * 4, coreH * 4,
            cx * settings.scale, cy * settings.scale, coreW * settings.scale, coreH * settings.scale);
          done++;
          setProgress(done / total * 0.95);
          const el = (performance.now() - t0) / 1000;
          const left = el / done * (total - done);
          setStatus(`Enhancing… ${Math.round(done / total * 100)}%` + (done >= 2 ? ` · about ${fmtTime(left)} left` : '') + (backend === 'wasm' ? ' (no GPU: slower)' : ''));
          if (done % 2 === 0) await nextFrame();
        }
      }

      // blend some of the original back in
      if (settings.blend > 0) {
        octx.save();
        octx.globalAlpha = settings.blend;
        octx.drawImage(img, 0, 0, p.outW, p.outH);
        octx.restore();
      }
      // sharpen fine texture (unsharp mask, ~1px radius), in strips
      if (settings.sharpen > 0) {
        setStatus('Sharpening…');
        await unsharp(octx, p.outW, p.outH, settings.sharpen * 1.5);
      }
      // fine film grain, done in strips to keep memory low
      if (settings.grain > 0) {
        setStatus('Adding grain…');
        const strip = 256;
        for (let y = 0; y < p.outH; y += strip) {
          const hh = Math.min(strip, p.outH - y);
          const id = octx.getImageData(0, y, p.outW, hh);
          const a = id.data;
          for (let i = 0; i < a.length; i += 4) {
            // approx. gaussian noise (sum of uniforms), same on R, G and B
            const n = (Math.random() + Math.random() + Math.random() - 1.5) * 2 * settings.grain;
            a[i] += n; a[i + 1] += n; a[i + 2] += n;
          }
          octx.putImageData(id, 0, y);
          if ((y / strip) % 8 === 0) await nextFrame();
        }
      }
      setProgress(0.98);
      setStatus('Saving…');
      const blob = await new Promise((r) => out.toBlob(r, 'image/jpeg', 0.95));
      if (!blob) throw new Error('Could not create the image (it may be too large for this device).');
      enhancedBlob = blob;
      swapping = true;
      await window.adCreative.replacePhoto(blob);
      swapping = false;
      setProgress(1);
      const secs = (performance.now() - t0) / 1000;
      setStatus(`Done in ${fmtTime(secs)}: ${p.outW}×${p.outH}. The enhanced photo is now in your design. Save the project to keep it.`);
      els.afterRow.hidden = false;
    } catch (e) {
      swapping = false;
      if (e && e.message === 'cancelled') setStatus('Cancelled. Your photo is unchanged.');
      else if (backend === 'webgpu' && !forceWasm) {
        // some phones' GPUs can't run every step: retry once without the GPU
        console.warn('WebGPU run failed, retrying on CPU', e);
        forceWasm = true; session = null; backend = '';
        running = false;
        setTimeout(enhance, 0);
        return;
      }
      else { console.error(e); setStatus(`Something went wrong: ${(e && e.message) || e}`); }
    } finally {
      running = false;
      els.cancel.hidden = true;
      setTimeout(() => { if (!running) els.progress.hidden = true; }, 1200);
      updateSizeHint();
    }
  }

  els.run.addEventListener('click', enhance);
  els.cancel.addEventListener('click', () => { cancelled = true; setStatus('Stopping…'); });
  els.revert.addEventListener('click', async () => {
    if (!originalBlob) return;
    swapping = true;
    await window.adCreative.replacePhoto(originalBlob);
    swapping = false;
    els.afterRow.hidden = true;
    setStatus('Back to the original photo.');
  });
  // Export photo: the current photo on its own (enhanced or not), full size.
  // On phones this opens the share sheet so "Save Image" puts it in Photos.
  els.download.addEventListener('click', async () => {
    const blob = window.adCreative && window.adCreative.getPhotoBlob();
    if (!blob) return;
    const isEnhanced = blob === enhancedBlob;
    const ext = (blob.type || '').includes('png') ? 'png' : 'jpg';
    const name = `${isEnhanced ? 'enhanced' : 'photo'}-${Date.now()}.${ext}`;
    const file = new File([blob], name, { type: blob.type || 'image/jpeg' });
    const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; /* else fall back to a download */ }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });

  // the photo finishes decoding a moment after it's chosen, so also refresh
  // whenever the Enhance tab is opened
  const tabBtn = document.querySelector('.tab-btn[data-panel="panel-enhance"]');
  if (tabBtn) tabBtn.addEventListener('click', () => setTimeout(updateSizeHint, 0));

  // a new upload clears "original" (handled above); keep the label fresh on start
  loadSettings();
  syncLabels();
  // test hook
  window.__enhance = { enhance, plan, get backend() { return backend; } };
})();

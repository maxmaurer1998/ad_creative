(() => {
  'use strict';

  // ---------- constants ----------

  const PRESETS = {
    '1080x1350': { w: 1080, h: 1350, label: 'Feed (portrait)' },
    '1080x1080': { w: 1080, h: 1080, label: 'Feed (square)' },
    '1080x1920': { w: 1080, h: 1920, label: 'Story / Reels' },
    '1200x628':  { w: 1200, h: 628,  label: 'Facebook link ad' },
  };

  const FONTS = [
    { id: 'playfair', label: 'Playfair Display', css: "'Playfair Display', Georgia, serif", weight: 700 },
    { id: 'fraunces', label: 'Fraunces', css: "'Fraunces', Georgia, serif", weight: 700 },
    { id: 'georgia', label: 'Georgia', css: "Georgia, 'Times New Roman', serif", weight: 700 },
    { id: 'inter', label: 'Inter', css: "'Inter', system-ui, sans-serif", weight: 700 },
    { id: 'worksans', label: 'Work Sans', css: "'Work Sans', system-ui, sans-serif", weight: 700 },
    { id: 'archivo', label: 'Archivo', css: "'Archivo', system-ui, sans-serif", weight: 700 },
    { id: 'system', label: 'System', css: "system-ui, -apple-system, sans-serif", weight: 700 },
  ];

  const SPEED_PLATEAU = { slow: 0.6, medium: 0.35, fast: 0.18 };

  const LS_KEY = 'adcreative.prefs.v1';

  // ---------- state ----------

  const state = {
    preset: '1080x1350',
    canvasW: 1080,
    canvasH: 1350,
    safeZone: false,
    image: null,   // HTMLImageElement
    logo: {
      img: null,
      xPct: 0.82,   // center x, fraction of canvas width
      yPct: 0.88,   // center y, fraction of canvas height
      sizePct: 18,  // width as % of canvas width
      manuallyPositioned: false,
    },
    fade: {
      direction: 'bottom',
      reach: 55,
      speed: 'medium',
      color: '#000000',
    },
    text: {
      hAlign: 'center',
      vAlign: 'bottom',
      layers: {
        headline:  { text: 'New Season, New Look', font: 'playfair', size: 72, color: '#ffffff' },
        subheader: { text: 'Shop the collection today', font: 'worksans', size: 36, color: '#ffffff' },
        other:     { text: 'Limited time only', font: 'worksans', size: 24, color: '#ffffff', enabled: false },
      },
    },
  };

  // ---------- DOM ----------

  const canvas = document.getElementById('previewCanvas');
  const ctx = canvas.getContext('2d');
  const stage = document.getElementById('stage');
  const dropHint = document.getElementById('dropHint');
  const legibilityBanner = document.getElementById('legibilityBanner');
  const exportBtn = document.getElementById('exportBtn');
  const imageInput = document.getElementById('imageInput');
  const logoInput = document.getElementById('logoInput');
  const presetSelect = document.getElementById('presetSelect');
  const safeZoneRow = document.getElementById('safeZoneRow');
  const safeZoneToggle = document.getElementById('safeZoneToggle');

  // ---------- prefs (localStorage nice-to-have) ----------

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const prefs = JSON.parse(raw);
      if (prefs.fadeColor) state.fade.color = prefs.fadeColor;
      if (prefs.layers) {
        for (const k of ['headline', 'subheader', 'other']) {
          if (prefs.layers[k]) Object.assign(state.text.layers[k], prefs.layers[k]);
        }
      }
    } catch (e) { /* ignore corrupt prefs */ }
  }

  function savePrefs() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        fadeColor: state.fade.color,
        layers: {
          headline: { font: state.text.layers.headline.font, color: state.text.layers.headline.color },
          subheader: { font: state.text.layers.subheader.font, color: state.text.layers.subheader.color },
          other: { font: state.text.layers.other.font, color: state.text.layers.other.color },
        },
      }));
    } catch (e) { /* storage unavailable */ }
  }

  // ---------- tab / panel switching ----------

  document.getElementById('tabbar').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === btn.dataset.panel));
  });

  document.getElementById('layerTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.layer-tab');
    if (!btn) return;
    document.querySelectorAll('.layer-tab').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.layer-panel').forEach(p => p.classList.toggle('hidden', p.dataset.layer !== btn.dataset.layer));
  });

  function wireSegmented(id, onChange) {
    document.getElementById(id).addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      document.querySelectorAll(`#${id} button`).forEach(b => b.classList.toggle('active', b === btn));
      onChange(btn.dataset.val);
    });
  }

  wireSegmented('fadeDirection', (val) => { state.fade.direction = val; render(); });
  wireSegmented('fadeSpeed', (val) => { state.fade.speed = val; render(); });
  wireSegmented('textHAlign', (val) => { state.text.hAlign = val; render(); });
  wireSegmented('textVAlign', (val) => { state.text.vAlign = val; render(); });
  wireSegmented('logoPreset', (val) => {
    applyLogoCorner(val);
    state.logo.manuallyPositioned = false;
    render();
  });

  const fadeReach = document.getElementById('fadeReach');
  const fadeReachVal = document.getElementById('fadeReachVal');
  fadeReach.addEventListener('input', () => {
    state.fade.reach = Number(fadeReach.value);
    fadeReachVal.textContent = `${state.fade.reach}%`;
    render();
  });

  document.getElementById('fadeColor').addEventListener('input', (e) => {
    state.fade.color = e.target.value;
    render();
    savePrefs();
  });

  const logoSize = document.getElementById('logoSize');
  const logoSizeVal = document.getElementById('logoSizeVal');
  logoSize.addEventListener('input', () => {
    state.logo.sizePct = Number(logoSize.value);
    logoSizeVal.textContent = `${state.logo.sizePct}%`;
    render();
  });

  document.getElementById('otherEnabled').addEventListener('change', (e) => {
    state.text.layers.other.enabled = e.target.checked;
    render();
  });

  // ---------- per-layer control wiring ----------

  function populateFontSelect(select) {
    select.innerHTML = '';
    for (const f of FONTS) {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f.label;
      select.appendChild(opt);
    }
  }

  function wireLayerPanel(layerKey) {
    const panel = document.getElementById(`layer-${layerKey}`);
    const textEl = panel.querySelector('.layer-text');
    const fontEl = panel.querySelector('.layer-font');
    const sizeEl = panel.querySelector('.layer-size');
    const sizeValEl = panel.querySelector('.layer-size-val');
    const colorEl = panel.querySelector('.layer-color');

    populateFontSelect(fontEl);

    const l = state.text.layers[layerKey];
    textEl.value = l.text;
    fontEl.value = l.font;
    sizeEl.value = l.size;
    sizeValEl.textContent = `${l.size}px`;
    colorEl.value = l.color;

    textEl.addEventListener('input', () => { l.text = textEl.value; render(); });
    fontEl.addEventListener('change', () => { l.font = fontEl.value; render(); savePrefs(); });
    sizeEl.addEventListener('input', () => {
      l.size = Number(sizeEl.value);
      sizeValEl.textContent = `${l.size}px`;
      render();
    });
    colorEl.addEventListener('input', () => { l.color = colorEl.value; render(); savePrefs(); });
  }

  // ---------- preset / canvas sizing ----------

  function applyPreset(key) {
    const p = PRESETS[key];
    state.preset = key;
    state.canvasW = p.w;
    state.canvasH = p.h;
    canvas.width = p.w;
    canvas.height = p.h;
    safeZoneRow.style.display = key === '1080x1920' ? 'flex' : 'none';
    fitStageToViewport();
    render();
  }

  presetSelect.addEventListener('change', () => applyPreset(presetSelect.value));
  safeZoneToggle.addEventListener('change', () => { state.safeZone = safeZoneToggle.checked; render(); });

  // ---------- image / logo upload ----------

  function loadImageFile(file, onLoaded) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { onLoaded(img); URL.revokeObjectURL(url); };
    img.src = url;
  }

  imageInput.addEventListener('change', () => {
    const file = imageInput.files[0];
    if (!file) return;
    loadImageFile(file, (img) => {
      state.image = img;
      dropHint.classList.add('hidden');
      exportBtn.disabled = false;
      render();
    });
  });

  logoInput.addEventListener('change', () => {
    const file = logoInput.files[0];
    if (!file) return;
    loadImageFile(file, (img) => {
      state.logo.img = img;
      render();
    });
  });

  // ---------- fade drawing ----------

  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return { r: 0, g: 0, b: 0 };
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
  }

  function fadeAlphaAt(fracFromOuterEdge, plateauK) {
    const t = Math.min(fracFromOuterEdge / plateauK, 1.0);
    return t * t * (3 - 2 * t); // smoothstep
  }

  function drawFade(W, H, fade) {
    const scrimH = H * (fade.reach / 100);
    if (scrimH <= 0) return;
    const plateauK = SPEED_PLATEAU[fade.speed];
    const { r, g, b } = hexToRgb(fade.color);

    let yOuter, yInner; // outer = transparent edge, inner = solid edge
    if (fade.direction === 'bottom') {
      yOuter = H - scrimH;
      yInner = H;
    } else {
      yOuter = scrimH;
      yInner = 0;
    }

    const grad = ctx.createLinearGradient(0, yOuter, 0, yInner);
    const steps = 48;
    for (let s = 0; s <= steps; s++) {
      const frac = s / steps;
      const alpha = fadeAlphaAt(frac, plateauK);
      grad.addColorStop(frac, `rgba(${r},${g},${b},${alpha})`);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, Math.min(yOuter, yInner), W, scrimH);
  }

  // average fade alpha across a vertical span [y0,y1] (for legibility check)
  function avgFadeAlphaOverSpan(W, H, fade, y0, y1) {
    const scrimH = H * (fade.reach / 100);
    if (scrimH <= 0) return 0;
    const plateauK = SPEED_PLATEAU[fade.speed];
    let zoneStart, zoneEnd; // zone in canvas y-coords, zoneStart = outer(0 alpha), zoneEnd = inner(full alpha)
    if (fade.direction === 'bottom') { zoneStart = H - scrimH; zoneEnd = H; }
    else { zoneStart = scrimH; zoneEnd = 0; }

    const samples = 12;
    let total = 0;
    for (let i = 0; i < samples; i++) {
      const y = y0 + ((y1 - y0) * i) / (samples - 1 || 1);
      let alpha;
      if (fade.direction === 'bottom') {
        if (y <= zoneStart) alpha = 0;
        else alpha = fadeAlphaAt((y - zoneStart) / scrimH, plateauK);
      } else {
        if (y >= zoneStart) alpha = 0;
        else alpha = fadeAlphaAt((zoneStart - y) / scrimH, plateauK);
      }
      total += alpha;
    }
    return total / samples;
  }

  // ---------- text drawing ----------

  function fontCss(layer, sizePx) {
    const f = FONTS.find(f => f.id === layer.font) || FONTS[0];
    return `${f.weight} ${sizePx}px ${f.css}`;
  }

  function wrapText(text, maxWidth, sizePx, layer) {
    ctx.font = fontCss(layer, sizePx);
    const paragraphs = text.split('\n');
    const lines = [];
    for (const para of paragraphs) {
      const words = para.split(/\s+/).filter(Boolean);
      if (words.length === 0) { lines.push(''); continue; }
      let current = words[0];
      for (let i = 1; i < words.length; i++) {
        const test = current + ' ' + words[i];
        if (ctx.measureText(test).width <= maxWidth) {
          current = test;
        } else {
          lines.push(current);
          current = words[i];
        }
      }
      lines.push(current);
    }
    return lines;
  }

  function getActiveLayers() {
    const order = ['headline', 'subheader', 'other'];
    return order
      .map(k => ({ key: k, ...state.text.layers[k] }))
      .filter(l => l.key !== 'other' ? l.text.trim().length > 0 : (l.enabled && l.text.trim().length > 0));
  }

  function buildTextBlock(W, H) {
    const margin = W * 0.08;
    const maxWidth = W - margin * 2;
    const layerGap = H * 0.015;
    const lineGapFactor = 1.18;

    const layers = getActiveLayers();
    const built = [];
    let totalHeight = 0;

    layers.forEach((l, idx) => {
      const sizePx = (l.size / 1080) * W; // scale relative to a 1080-wide reference so it's consistent across presets
      const lines = wrapText(l.text, maxWidth, sizePx, l);
      const lineHeight = sizePx * lineGapFactor;
      const blockH = lines.length * lineHeight;
      built.push({ ...l, sizePx, lines, lineHeight, blockH });
      totalHeight += blockH;
      if (idx < layers.length - 1) totalHeight += layerGap;
    });

    return { built, totalHeight, margin, maxWidth, layerGap };
  }

  function drawTextBlock(W, H) {
    const { built, totalHeight, margin } = buildTextBlock(W, H);
    if (built.length === 0) return null;

    const vPad = H * 0.06;
    let startY;
    if (state.text.vAlign === 'top') startY = vPad;
    else if (state.text.vAlign === 'middle') startY = (H - totalHeight) / 2;
    else startY = H - vPad - totalHeight;

    let x;
    if (state.text.hAlign === 'left') { ctx.textAlign = 'left'; x = margin; }
    else if (state.text.hAlign === 'right') { ctx.textAlign = 'right'; x = W - margin; }
    else { ctx.textAlign = 'center'; x = W / 2; }

    let y = startY;
    const layerGap = H * 0.015;

    built.forEach((l, idx) => {
      ctx.font = fontCss(l, l.sizePx);
      ctx.fillStyle = l.color;
      ctx.textBaseline = 'top';
      l.lines.forEach(line => {
        ctx.fillText(line, x, y);
        y += l.lineHeight;
      });
      if (idx < built.length - 1) y += layerGap;
    });

    return { top: startY, bottom: startY + totalHeight };
  }

  // ---------- logo drawing ----------

  function applyLogoCorner(corner) {
    const margin = 0.06;
    const sizeFrac = state.logo.sizePct / 100;
    const halfW = sizeFrac / 2;
    const aspect = state.logo.img ? state.logo.img.naturalHeight / state.logo.img.naturalWidth : 1;
    const halfH = (sizeFrac * aspect) / 2 * (state.canvasW / state.canvasH);

    if (corner === 'top-left') { state.logo.xPct = margin + halfW; state.logo.yPct = margin + halfH; }
    else if (corner === 'top-right') { state.logo.xPct = 1 - margin - halfW; state.logo.yPct = margin + halfH; }
    else if (corner === 'bottom-left') { state.logo.xPct = margin + halfW; state.logo.yPct = 1 - margin - halfH; }
    else { state.logo.xPct = 1 - margin - halfW; state.logo.yPct = 1 - margin - halfH; }
  }

  function suggestLogoCornerFromTextAlign(hAlign) {
    if (state.logo.manuallyPositioned) return;
    if (hAlign === 'left') applyLogoCorner('top-right');
    else if (hAlign === 'right') applyLogoCorner('top-left');
    document.querySelectorAll('#logoPreset button').forEach(b => {
      b.classList.toggle('active',
        (hAlign === 'left' && b.dataset.val === 'top-right') ||
        (hAlign === 'right' && b.dataset.val === 'top-left'));
    });
  }

  function logoRect(W, H) {
    if (!state.logo.img) return null;
    const w = (state.logo.sizePct / 100) * W;
    const h = w * (state.logo.img.naturalHeight / state.logo.img.naturalWidth);
    const cx = state.logo.xPct * W;
    const cy = state.logo.yPct * H;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }

  function drawLogo(W, H) {
    if (!state.logo.img) return;
    const r = logoRect(W, H);
    ctx.drawImage(state.logo.img, r.x, r.y, r.w, r.h);
  }

  // ---------- safe zone overlay ----------

  function drawSafeZone(W, H) {
    if (!(state.preset === '1080x1920' && state.safeZone)) return;
    ctx.fillStyle = 'rgba(120,120,130,0.45)';
    ctx.fillRect(0, 0, W, H * 0.14);
    ctx.fillRect(0, H * 0.65, W, H * 0.35);
  }

  // ---------- master render ----------

  function render() {
    const W = state.canvasW, H = state.canvasH;
    ctx.clearRect(0, 0, W, H);

    if (state.image) {
      drawImageCover(state.image, W, H);
    } else {
      ctx.fillStyle = '#1a1a1e';
      ctx.fillRect(0, 0, W, H);
    }

    drawFade(W, H, state.fade);
    const textBounds = drawTextBlock(W, H);
    drawLogo(W, H);
    drawSafeZone(W, H);

    updateLegibilityBanner(W, H, textBounds);
  }

  function drawImageCover(img, W, H) {
    const ir = img.naturalWidth / img.naturalHeight;
    const cr = W / H;
    let sw, sh, sx, sy;
    if (ir > cr) {
      sh = img.naturalHeight;
      sw = sh * cr;
      sx = (img.naturalWidth - sw) / 2;
      sy = 0;
    } else {
      sw = img.naturalWidth;
      sh = sw / cr;
      sx = 0;
      sy = (img.naturalHeight - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
  }

  function updateLegibilityBanner(W, H, textBounds) {
    if (!textBounds) { legibilityBanner.classList.add('hidden'); return; }
    const avgAlpha = avgFadeAlphaOverSpan(W, H, state.fade, textBounds.top, textBounds.bottom);
    if (avgAlpha < 0.4) {
      const suggestion = state.text.vAlign === 'bottom' && state.fade.direction !== 'bottom'
        ? 'try switching the fade direction to Bottom, or increase fade reach'
        : 'try Bottom alignment or increase fade reach';
      legibilityBanner.textContent = `Text may be hard to read here — ${suggestion}.`;
      legibilityBanner.classList.remove('hidden');
    } else {
      legibilityBanner.classList.add('hidden');
    }
  }

  // ---------- canvas resize to fit stage ----------

  function fitStageToViewport() {
    // Canvas keeps its intrinsic (preset) resolution; CSS just scales it to fit the stage box.
    const availW = stage.clientWidth;
    const availH = stage.clientHeight;
    const scale = Math.min(availW / state.canvasW, availH / state.canvasH);
    canvas.style.width = `${state.canvasW * scale}px`;
    canvas.style.height = `${state.canvasH * scale}px`;
  }

  window.addEventListener('resize', fitStageToViewport);

  // ---------- logo drag ----------

  let dragging = false;

  function clientToCanvas(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = state.canvasW / rect.width;
    const scaleY = state.canvasH / rect.height;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!state.logo.img) return;
    const p = clientToCanvas(e.clientX, e.clientY);
    const r = logoRect(state.canvasW, state.canvasH);
    if (!r) return;
    if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
      dragging = true;
      canvas.setPointerCapture(e.pointerId);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const p = clientToCanvas(e.clientX, e.clientY);
    state.logo.xPct = Math.min(1, Math.max(0, p.x / state.canvasW));
    state.logo.yPct = Math.min(1, Math.max(0, p.y / state.canvasH));
    state.logo.manuallyPositioned = true;
    render();
  });

  function endDrag(e) { dragging = false; }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ---------- text alignment -> logo suggestion hook ----------

  document.getElementById('textHAlign').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    suggestLogoCornerFromTextAlign(btn.dataset.val);
    render();
  });

  // ---------- export ----------

  async function exportImage() {
    if (!state.image) return;
    exportBtn.disabled = true;
    exportBtn.textContent = 'Exporting…';
    try {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('toBlob failed');
      const file = new File([blob], `ad-creative-${Date.now()}.png`, { type: 'image/png' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Ad Creative' });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      }
    } catch (err) {
      if (err && err.name !== 'AbortError') {
        console.error(err);
        alert('Export failed. Please try again.');
      }
    } finally {
      exportBtn.disabled = !state.image;
      exportBtn.textContent = 'Export';
    }
  }

  exportBtn.addEventListener('click', exportImage);

  // ---------- init ----------

  function init() {
    loadPrefs();

    ['headline', 'subheader', 'other'].forEach(wireLayerPanel);
    document.getElementById('otherEnabled').checked = state.text.layers.other.enabled;
    document.getElementById('fadeColor').value = state.fade.color;

    presetSelect.value = state.preset;
    applyPreset(state.preset);
    applyLogoCorner('bottom-right');

    fitStageToViewport();
    render();

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
      });
    }

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => render());
    }
  }

  init();
})();

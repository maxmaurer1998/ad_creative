(() => {
  'use strict';

  // ---------- constants ----------

  // all four match Meta's supported ad image ratios (1:1, 4:5, 9:16, 1.91:1)
  const PRESETS = {
    '1080x1080': { w: 1080, h: 1080, label: 'Feed / Square — 1:1' },
    '1080x1350': { w: 1080, h: 1350, label: 'Feed (portrait) — 4:5' },
    '1080x1920': { w: 1080, h: 1920, label: 'Story / Reels — 9:16' },
    '1200x628':  { w: 1200, h: 628,  label: 'Landscape / Link ad — 1.91:1' },
  };

  // weightRegular is what the "non-bold" option in Text Box falls back to --
  // Playfair/Fraunces only ship 600/700 weight font files (see fonts/fonts.css),
  // so their "regular" is 600, not a true 400, otherwise the browser would
  // just fall back to the nearest loaded weight (600) and the toggle would
  // silently do nothing
  const FONTS = [
    { id: 'playfair', label: 'Playfair Display', css: "'Playfair Display', Georgia, serif", weight: 700, weightRegular: 600 },
    { id: 'fraunces', label: 'Fraunces', css: "'Fraunces', Georgia, serif", weight: 700, weightRegular: 600 },
    { id: 'georgia', label: 'Georgia', css: "Georgia, 'Times New Roman', serif", weight: 700, weightRegular: 400 },
    { id: 'inter', label: 'Inter', css: "'Inter', system-ui, sans-serif", weight: 700, weightRegular: 400 },
    { id: 'worksans', label: 'Work Sans', css: "'Work Sans', system-ui, sans-serif", weight: 700, weightRegular: 400 },
    { id: 'archivo', label: 'Archivo', css: "'Archivo', system-ui, sans-serif", weight: 700, weightRegular: 400 },
    { id: 'system', label: 'System', css: "system-ui, -apple-system, sans-serif", weight: 700, weightRegular: 400 },
  ];

  // continuous fade-speed slider (0=slow/gradual, 100=fast/early-solid), mapped
  // linearly across the plateau_k range. At PLATEAU_SLOW=1.0 the smoothstep
  // eases across the *entire* reach zone with no flat solid tail at all --
  // the softest the gradient can possibly be for a given reach.
  const PLATEAU_SLOW = 1.0;
  const PLATEAU_FAST = 0.18;
  function speedValueToPlateauK(value) {
    return PLATEAU_SLOW + (PLATEAU_FAST - PLATEAU_SLOW) * (value / 100);
  }
  function speedValueToLabel(value) {
    if (value < 34) return 'Slow';
    if (value < 67) return 'Medium';
    return 'Fast';
  }

  const DEFAULT_MARGIN_FRAC = 0.08;
  const DEFAULT_MARGIN_V_FRAC = 0.06;

  const LS_KEY = 'adcreative.prefs.v1'; // legacy, read-only fallback for pre-session-save versions

  // ---------- state ----------

  // one "loupe" (magnifier circle) -- see state.magnifier below. Positions/
  // sizes are fractions of canvas W/H so the whole layout carries between
  // the 4:5 and 9:16 presets without re-tuning.
  function makeDefaultLoupe(loupeX, loupeY, targetX, targetY, enabled) {
    return {
      enabled,
      detailImg: null,     // HTMLImageElement -- the close-up/macro photo shown inside the loupe
      detailZoom: 1.8,      // 1.0-4.0, i.e. 100%-400%
      detailPanX: 0.5,      // which fraction of the detail image sits at the loupe's centre
      detailPanY: 0.5,
      loupeX, loupeY,        // loupe centre
      diameter: 0.28,        // fraction of canvas width
      style: 'hairline',     // 'hairline' | 'brass' | 'glass'
      shadow: true,
      targetX, targetY,      // the point on the main photo the loupe is magnifying
      marker: 'ring',        // 'ring' | 'dot' | 'none'
      connectorType: 'cone', // 'line' | 'cone' | 'none'
      lineOpacity: 1.0,
      fillOpacity: 0.08,
      labelText: '',
      labelPosition: 'below', // 'below' | 'above' | 'beside'
    };
  }

  // a free-floating text box: unlike the headline/subheader/other block,
  // it isn't clamped to the shared left/right/top/bottom margins -- it can
  // be dragged and placed anywhere on the canvas
  function makeDefaultFreeTextBox() {
    return {
      id: `ftb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: 'Your text here',
      font: 'worksans',
      bold: true,
      size: 48,       // px, scaled relative to a 1080-wide reference, like the other text layers
      color: '#ffffff',
      hAlign: 'center', // 'left' | 'center' | 'right'
      xPct: 0.5,       // centre x, fraction of canvas width
      yPct: 0.5,       // centre y, fraction of canvas height
      widthPct: 0.6,   // wrap width, fraction of canvas width
    };
  }

  const state = {
    preset: '1080x1350',
    canvasW: 1080,
    canvasH: 1350,
    safeZone: false,
    marginFrac: DEFAULT_MARGIN_FRAC, // left/right margin, shared by text wrap and logo drag clamp
    marginVFrac: DEFAULT_MARGIN_V_FRAC, // top/bottom margin, shared by text vertical range and logo vertical clamp
    image: null,   // HTMLImageElement
    imageTransform: { zoom: 1, offsetXPct: 0.5, offsetYPct: 0.5, rotation: 0 }, // pan/zoom/rotation, tied to this specific photo
    positionEditMode: false, // true only while the Position tab is open
    logo: {
      img: null,
      xPct: 0.82,   // center x, fraction of canvas width
      yPct: 0.88,   // center y, fraction of canvas height
      sizePct: 18,  // width as % of canvas width
      manuallyPositioned: false,
      colorMode: 'original', // 'original' | 'custom' | 'fade'
      customColor: '#ffffff',
      rotation: 0,   // 0 | 90 | 180 | 270 -- clockwise, about the logo's own centre
      flipH: false,  // mirrored left/right, applied before rotation
      flipV: false,  // mirrored top/bottom, applied before rotation
    },
    stars: {
      enabled: false,
      xPct: 0.18,   // center x, fraction of canvas width
      yPct: 0.88,   // center y, fraction of canvas height
      sizePct: 22,  // width of the whole 5-star row, as % of canvas width
      color: '#ffc107',
    },
    magnifierEditMode: false, // true only while the Magnifier tab is open
    magnifier: {
      enabled: false,
      activeLoupe: 0, // which loupe (0 or 1) the panel is currently editing
      dragPansDetail: false, // false: dragging inside a loupe moves it; true: it pans the detail photo instead
      loupes: [
        makeDefaultLoupe(0.80, 0.78, 0.74, 0.46, true),
        makeDefaultLoupe(0.20, 0.78, 0.26, 0.46, false),
      ],
    },
    freeTextEditMode: false, // true only while the Text Box tab is open
    freeText: {
      activeBox: 0, // which box the panel is currently editing
      boxes: [], // makeDefaultFreeTextBox() objects, added via the "Add text box" button
    },
    fade: {
      direction: 'bottom',
      reach: 55,
      speed: 60, // 0-100, see speedValueToPlateauK
      intensity: 100, // 0-100, scales the max opacity the fade ever reaches
      color: '#000000',
      textured: false, // subtle grain/mottling, masked to the fade's own alpha
      textureIntensity: 70, // 0-100, strength of that fade-area grain
      textureGrainSize: 25, // 0-100, particle size: 0=finest, 100=coarsest
    },
    text: {
      enabled: true, // master on/off for the whole headline/subheader/other block, including the headline
      hAlign: 'center',
      vAlign: 100, // 0=top .. 100=bottom, continuous
      orientation: 'horizontal', // 'horizontal' | 'vertical' | 'vertical-flipped'
      crossAlign: 50, // 0=top .. 100=bottom, continuous -- the block's position on the cross (non-stacking) axis, only used when orientation is vertical
      layers: {
        headline:  { text: 'New Season, New Look', font: 'playfair', size: 72, color: '#ffffff' },
        subheader: { text: 'Shop the collection today', font: 'worksans', size: 36, color: '#ffffff', enabled: true },
        other:     { text: 'Limited time only', font: 'worksans', size: 24, color: '#ffffff', enabled: false },
      },
    },
    effects: {
      grain: 0,     // 0-100, film grain across the whole composite
      grainSize: 25, // 0-100, particle size: 0=finest, 100=coarsest
      vignette: 0,  // 0-100, darkened edges
      warmth: 0,    // 0-100, warm "heritage" colour-grade overlay
      filmStock: 'none', // 'none' | 'fuji' | 'techOptics' | 'frontier'
      filmStockIntensity: 70, // 0-100, strength of the film-stock colour grade
      // per-layer on/off toggles for the Tech Optics pipeline -- each is a
      // separately switchable layer of that effect (see applyTechOptics)
      techOpticsAberration: true,
      techOpticsBloom: true,
      techOpticsGrain: true,
      techOpticsFlare: true,
      techOpticsVignette: true,
      techOpticsHud: true, // whether the Tech Optics corner-bracket/grid/spec-text overlay is shown
      techOpticsHudText: 'REF 0X-114 / LENS: IRIDIUM / MAT: X-ALLOY',
      // per-layer on/off toggles for the Frontier pipeline (see applyFrontier)
      frontierHalation: true,
      frontierGrain: true,
      frontierHaze: true,
      frontierFlare: false, // sun flare defaults off per spec
      frontierVignette: true,
    },
  };

  // ---------- DOM ----------

  const canvas = document.getElementById('previewCanvas');
  let ctx = canvas.getContext('2d'); // temporarily redirected to an offscreen hi-res context during export
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const stage = document.getElementById('stage');
  const stageWrap = document.getElementById('stageWrap');
  const dropHint = document.getElementById('dropHint');
  const exportBtn = document.getElementById('exportBtn');
  const saveBtn = document.getElementById('saveBtn');
  const imageInput = document.getElementById('imageInput');
  const logoInput = document.getElementById('logoInput');
  const presetSelect = document.getElementById('presetSelect');
  const safeZoneRow = document.getElementById('safeZoneRow');
  const safeZoneToggle = document.getElementById('safeZoneToggle');

  // ---------- persistence (IndexedDB: session "recipe" + photo/logo blobs + a named recipe library) ----------

  const IDB_NAME = 'adcreative-db';
  const IDB_VERSION = 3;
  const IDB_STORE_KV = 'kv';             // session state: recipe / photoBlob / logoBlob / savedLogo / imageTransform / detailBlob0 / detailBlob1
  const IDB_STORE_RECIPES = 'recipes';   // named recipe templates, keyed by name
  const IDB_STORE_FOLDERS = 'folders';   // { id, parentId, name, createdAt }
  const IDB_STORE_PROJECTS = 'projects'; // { id, folderId, name, recipe, imageTransform, photoBlob, logoBlob, thumbnailBlob, updatedAt }

  function idbOpen() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('no indexedDB')); return; }
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE_KV)) db.createObjectStore(IDB_STORE_KV);
        if (!db.objectStoreNames.contains(IDB_STORE_RECIPES)) db.createObjectStore(IDB_STORE_RECIPES);
        if (!db.objectStoreNames.contains(IDB_STORE_FOLDERS)) db.createObjectStore(IDB_STORE_FOLDERS, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(IDB_STORE_PROJECTS)) db.createObjectStore(IDB_STORE_PROJECTS, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbSet(store, key, value) {
    try {
      const db = await idbOpen();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) { /* IndexedDB unavailable (private browsing, quota, etc.) - ignore */ }
  }

  async function idbGet(store, key) {
    try {
      const db = await idbOpen();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } catch (e) { return undefined; }
  }

  async function idbDelete(store, key) {
    try {
      const db = await idbOpen();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) { /* ignore */ }
  }

  async function idbGetAllKeys(store) {
    try {
      const db = await idbOpen();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).getAllKeys();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } catch (e) { return []; }
  }

  // for stores created with a keyPath (folders/projects) -- the key lives
  // inside the value itself, so it must NOT be passed separately.
  // Returns whether the write actually succeeded -- callers that need to
  // know (e.g. "Save", which shouldn't claim success on a failed write) can
  // check it; callers that don't care can just ignore the return value, same
  // as before.
  async function idbPut(store, value) {
    try {
      const db = await idbOpen();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      return true;
    } catch (e) {
      console.error(`idbPut(${store}) failed`, e);
      return false;
    }
  }

  async function idbGetAllValues(store) {
    try {
      const db = await idbOpen();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } catch (e) { return []; }
  }

  function makeId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // maps the old 3-way top/middle/bottom toggle to the new continuous 0-100 slider
  function legacyVAlignToNumber(val) {
    if (val === 'top') return 0;
    if (val === 'middle') return 50;
    if (val === 'bottom') return 100;
    return null;
  }

  // the "recipe": every setting except the actual images, which are stored separately as blobs
  function serializeRecipe() {
    return {
      v: 2,
      preset: state.preset,
      safeZone: state.safeZone,
      marginFrac: state.marginFrac,
      marginVFrac: state.marginVFrac,
      fade: { ...state.fade },
      text: {
        enabled: state.text.enabled,
        hAlign: state.text.hAlign,
        vAlign: state.text.vAlign,
        orientation: state.text.orientation,
        crossAlign: state.text.crossAlign,
        layers: {
          headline: { ...state.text.layers.headline },
          subheader: { ...state.text.layers.subheader },
          other: { ...state.text.layers.other },
        },
      },
      logo: {
        xPct: state.logo.xPct,
        yPct: state.logo.yPct,
        sizePct: state.logo.sizePct,
        manuallyPositioned: state.logo.manuallyPositioned,
        colorMode: state.logo.colorMode,
        customColor: state.logo.customColor,
        rotation: state.logo.rotation,
        flipH: state.logo.flipH,
        flipV: state.logo.flipV,
      },
      stars: { ...state.stars },
      magnifier: {
        enabled: state.magnifier.enabled,
        activeLoupe: state.magnifier.activeLoupe,
        dragPansDetail: state.magnifier.dragPansDetail,
        loupes: state.magnifier.loupes.map((l) => ({
          enabled: l.enabled,
          detailZoom: l.detailZoom,
          detailPanX: l.detailPanX,
          detailPanY: l.detailPanY,
          loupeX: l.loupeX,
          loupeY: l.loupeY,
          diameter: l.diameter,
          style: l.style,
          shadow: l.shadow,
          targetX: l.targetX,
          targetY: l.targetY,
          marker: l.marker,
          connectorType: l.connectorType,
          lineOpacity: l.lineOpacity,
          fillOpacity: l.fillOpacity,
          labelText: l.labelText,
          labelPosition: l.labelPosition,
        })),
      },
      freeText: {
        activeBox: state.freeText.activeBox,
        boxes: state.freeText.boxes.map((b) => ({ ...b })),
      },
      effects: { ...state.effects },
    };
  }

  function applyRecipeToState(recipe) {
    if (!recipe) return;
    if (recipe.preset && PRESETS[recipe.preset]) state.preset = recipe.preset;
    if (typeof recipe.safeZone === 'boolean') state.safeZone = recipe.safeZone;
    if (typeof recipe.marginFrac === 'number') state.marginFrac = recipe.marginFrac;
    if (typeof recipe.marginVFrac === 'number') state.marginVFrac = recipe.marginVFrac;
    if (recipe.fade) {
      Object.assign(state.fade, recipe.fade);
      if (typeof state.fade.intensity !== 'number') state.fade.intensity = 100; // pre-intensity-slider recipes
      if (typeof state.fade.textureIntensity !== 'number') state.fade.textureIntensity = 70; // pre-textureIntensity recipes
    }
    if (recipe.effects) Object.assign(state.effects, recipe.effects);
    if (recipe.text) {
      state.text.enabled = typeof recipe.text.enabled === 'boolean' ? recipe.text.enabled : true; // pre-textBlockEnabled recipes defaulted on
      if (recipe.text.hAlign) state.text.hAlign = recipe.text.hAlign;
      if (recipe.text.orientation) state.text.orientation = recipe.text.orientation;
      if (typeof recipe.text.crossAlign === 'number') state.text.crossAlign = recipe.text.crossAlign;
      if (typeof recipe.text.vAlign === 'number') state.text.vAlign = recipe.text.vAlign;
      else {
        const legacy = legacyVAlignToNumber(recipe.text.vAlign);
        if (legacy !== null) state.text.vAlign = legacy;
      }
      if (recipe.text.layers) {
        for (const k of ['headline', 'subheader', 'other']) {
          if (recipe.text.layers[k]) Object.assign(state.text.layers[k], recipe.text.layers[k]);
        }
      }
      if (typeof state.text.layers.subheader.enabled !== 'boolean') state.text.layers.subheader.enabled = true; // pre-subheaderEnabled recipes
    }
    if (recipe.logo) {
      const { xPct, yPct, sizePct, manuallyPositioned, colorMode, customColor, matchFadeColor, rotation, flipH, flipV } = recipe.logo;
      if (typeof xPct === 'number') state.logo.xPct = xPct;
      if (typeof yPct === 'number') state.logo.yPct = yPct;
      if (typeof sizePct === 'number') state.logo.sizePct = sizePct;
      if (typeof manuallyPositioned === 'boolean') state.logo.manuallyPositioned = manuallyPositioned;
      if (typeof customColor === 'string') state.logo.customColor = customColor;
      if (typeof colorMode === 'string') state.logo.colorMode = colorMode;
      else if (typeof matchFadeColor === 'boolean') state.logo.colorMode = matchFadeColor ? 'fade' : 'original'; // pre-colorMode recipes
      state.logo.rotation = [0, 90, 180, 270].includes(rotation) ? rotation : 0; // pre-rotation recipes
      state.logo.flipH = typeof flipH === 'boolean' ? flipH : false;
      state.logo.flipV = typeof flipV === 'boolean' ? flipV : false;
    }
    if (recipe.stars) {
      const { enabled, xPct, yPct, sizePct, color } = recipe.stars;
      if (typeof enabled === 'boolean') state.stars.enabled = enabled;
      if (typeof xPct === 'number') state.stars.xPct = xPct;
      if (typeof yPct === 'number') state.stars.yPct = yPct;
      if (typeof sizePct === 'number') state.stars.sizePct = sizePct;
      if (typeof color === 'string') state.stars.color = color;
    }
    if (recipe.magnifier) {
      const m = recipe.magnifier;
      if (typeof m.enabled === 'boolean') state.magnifier.enabled = m.enabled;
      if (typeof m.activeLoupe === 'number') state.magnifier.activeLoupe = m.activeLoupe;
      if (typeof m.dragPansDetail === 'boolean') state.magnifier.dragPansDetail = m.dragPansDetail;
      const loupeFields = ['enabled', 'detailZoom', 'detailPanX', 'detailPanY', 'loupeX', 'loupeY', 'diameter', 'style', 'shadow', 'targetX', 'targetY', 'marker', 'connectorType', 'lineOpacity', 'fillOpacity', 'labelText', 'labelPosition'];
      if (Array.isArray(m.loupes)) {
        m.loupes.forEach((l, i) => {
          if (!l || !state.magnifier.loupes[i]) return;
          const target = state.magnifier.loupes[i];
          loupeFields.forEach((k) => { if (l[k] !== undefined) target[k] = l[k]; });
        });
      }
    }
    if (recipe.freeText && Array.isArray(recipe.freeText.boxes)) {
      const defaults = makeDefaultFreeTextBox();
      state.freeText.boxes = recipe.freeText.boxes.map((b) => ({ ...defaults, ...b, id: b.id || makeId() }));
      state.freeText.activeBox = typeof recipe.freeText.activeBox === 'number' ? Math.min(recipe.freeText.activeBox, Math.max(0, state.freeText.boxes.length - 1)) : 0;
    }
  }

  let saveRecipeTimer = null;
  function scheduleSaveRecipe() {
    clearTimeout(saveRecipeTimer);
    saveRecipeTimer = setTimeout(() => {
      idbSet(IDB_STORE_KV, 'recipe', serializeRecipe());
      idbSet(IDB_STORE_KV, 'imageTransform', state.imageTransform);
    }, 400);
  }

  function loadImageFromBlob(blob) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { resolve(img); URL.revokeObjectURL(url); };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  // The actual Blob/File currently loaded as the working photo/logo -- kept in
  // sync by every path that sets state.image / state.logo.img (upload, opening
  // a saved project, and restoring a session), so anything that needs "the
  // blob behind what's on screen right now" (saving into the project library)
  // reads this instead of re-fetching the session's own autosave KV entry,
  // which only ever gets written by a fresh upload and would otherwise still
  // hold a stale/unrelated blob after opening a different saved project.
  let currentPhotoBlob = null;
  let currentLogoBlob = null;
  let currentDetailBlobs = [null, null]; // same role, one per magnifier loupe's detail image

  function setCurrentDetailBlob(i, blob) {
    currentDetailBlobs[i] = blob || null;
    if (blob) idbSet(IDB_STORE_KV, `detailBlob${i}`, blob);
    else idbDelete(IDB_STORE_KV, `detailBlob${i}`);
  }

  // the saved-project record this session is currently editing, if any --
  // lets "Save" overwrite that same project in place instead of always
  // prompting for a name like "Save As" does. Persisted in the KV store (not
  // just in memory) so it survives a reload via the ordinary session
  // auto-restore, not only a fresh "open project" from the library.
  let currentProject = null; // { id, name, folderId } | null

  function setCurrentProject(project) {
    currentProject = project;
    if (project) idbSet(IDB_STORE_KV, 'currentProject', project);
    else idbDelete(IDB_STORE_KV, 'currentProject');
    updateSaveButtonLabel();
  }

  function updateSaveButtonLabel() {
    // keeps the button's own width constant regardless of the project name's
    // length (which project it'll overwrite is in the title tooltip instead)
    saveBtn.textContent = 'Save';
    saveBtn.title = currentProject
      ? `Save over "${currentProject.name}" -- use "Save as new here…" in the Library to save a copy instead`
      : 'Save the current design as a new project in your library';
  }

  function setCurrentPhotoBlob(blob) {
    currentPhotoBlob = blob || null;
    if (blob) idbSet(IDB_STORE_KV, 'photoBlob', blob);
    else idbDelete(IDB_STORE_KV, 'photoBlob');
  }

  function setCurrentLogoBlob(blob) {
    currentLogoBlob = blob || null;
    if (blob) idbSet(IDB_STORE_KV, 'logoBlob', blob);
    else idbDelete(IDB_STORE_KV, 'logoBlob');
  }

  async function restoreSession() {
    const [recipe, photoBlob, logoBlob, savedLogoBlob, imageTransform, savedCurrentProject, detailBlob0, detailBlob1] = await Promise.all([
      idbGet(IDB_STORE_KV, 'recipe'),
      idbGet(IDB_STORE_KV, 'photoBlob'),
      idbGet(IDB_STORE_KV, 'logoBlob'),
      idbGet(IDB_STORE_KV, 'savedLogo'),
      idbGet(IDB_STORE_KV, 'imageTransform'),
      idbGet(IDB_STORE_KV, 'currentProject'),
      idbGet(IDB_STORE_KV, 'detailBlob0'),
      idbGet(IDB_STORE_KV, 'detailBlob1'),
    ]);
    if (savedCurrentProject) { currentProject = savedCurrentProject; updateSaveButtonLabel(); }

    if (recipe) applyRecipeToState(recipe);

    if (photoBlob) {
      const img = await loadImageFromBlob(photoBlob);
      if (img) {
        state.image = img;
        currentPhotoBlob = photoBlob;
        dropHint.classList.add('hidden');
        exportBtn.disabled = false;
        saveBtn.disabled = false;
        if (imageTransform && typeof imageTransform.zoom === 'number') {
          state.imageTransform = imageTransform;
        }
      }
    }
    // prefer this session's own logo; fall back to the persistently-saved
    // default logo (kept even after "Clear saved session") if there is one
    const effectiveLogoBlob = logoBlob || savedLogoBlob;
    if (effectiveLogoBlob) {
      const img = await loadImageFromBlob(effectiveLogoBlob);
      if (img) { state.logo.img = img; currentLogoBlob = effectiveLogoBlob; }
    }

    const detailBlobs = [detailBlob0, detailBlob1];
    for (let i = 0; i < detailBlobs.length; i++) {
      if (!detailBlobs[i]) continue;
      const img = await loadImageFromBlob(detailBlobs[i]);
      if (img) { state.magnifier.loupes[i].detailImg = img; currentDetailBlobs[i] = detailBlobs[i]; }
    }

    return { hasRecipe: !!recipe };
  }

  async function clearSavedSession() {
    // only clear this working session -- the saved default logo, any named
    // recipe templates, and the project library itself are deliberate,
    // named saves and are kept
    await idbDelete(IDB_STORE_KV, 'recipe');
    await idbDelete(IDB_STORE_KV, 'photoBlob');
    await idbDelete(IDB_STORE_KV, 'logoBlob');
    await idbDelete(IDB_STORE_KV, 'detailBlob0');
    await idbDelete(IDB_STORE_KV, 'detailBlob1');
    await idbDelete(IDB_STORE_KV, 'imageTransform');
    await idbDelete(IDB_STORE_KV, 'currentProject');
    try { localStorage.removeItem(LS_KEY); } catch (e) { /* ignore */ }
    location.reload();
  }

  document.getElementById('clearSessionBtn').addEventListener('click', () => {
    const ok = confirm("Clear your current photo and settings from this browser?\n\nYour saved default logo and any saved recipe templates are kept. This can't be undone.");
    if (ok) clearSavedSession();
  });

  // ---------- persistent "saved logo" (kept independently of the session) ----------

  function imageToPngBlob(img) {
    return new Promise((resolve) => {
      const off = document.createElement('canvas');
      off.width = img.naturalWidth;
      off.height = img.naturalHeight;
      off.getContext('2d').drawImage(img, 0, 0);
      off.toBlob((blob) => resolve(blob), 'image/png');
    });
  }

  document.getElementById('saveLogoBtn').addEventListener('click', async () => {
    if (!state.logo.img) { alert('Upload a logo first.'); return; }
    const blob = await imageToPngBlob(state.logo.img);
    if (blob) {
      await idbSet(IDB_STORE_KV, 'savedLogo', blob);
      alert('Saved. This logo will now be used by default for new sessions, even after "Clear saved session".');
    }
  });

  document.getElementById('removeSavedLogoBtn').addEventListener('click', async () => {
    const ok = confirm('Remove the saved default logo? (The logo on canvas right now is unaffected.)');
    if (!ok) return;
    await idbDelete(IDB_STORE_KV, 'savedLogo');
  });

  // ---------- named recipe library (settings-only templates, reusable across photos) ----------

  const recipeSelect = document.getElementById('recipeSelect');

  async function refreshRecipeList(selectName) {
    const names = (await idbGetAllKeys(IDB_STORE_RECIPES)).sort((a, b) => a.localeCompare(b));
    recipeSelect.innerHTML = '<option value="">— none —</option>';
    for (const name of names) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      recipeSelect.appendChild(opt);
    }
    if (selectName && names.includes(selectName)) recipeSelect.value = selectName;
  }

  document.getElementById('saveRecipeBtn').addEventListener('click', async () => {
    const name = prompt('Name this recipe (fade, text, margin, and logo size/position -- not the photo or logo image itself):');
    if (!name || !name.trim()) return;
    await idbSet(IDB_STORE_RECIPES, name.trim(), serializeRecipe());
    await refreshRecipeList(name.trim());
  });

  document.getElementById('applyRecipeBtn').addEventListener('click', async () => {
    const name = recipeSelect.value;
    if (!name) return;
    const recipe = await idbGet(IDB_STORE_RECIPES, name);
    if (!recipe) return;
    applyRecipeToState(recipe);
    syncAllControlsFromState();
    applyPreset(state.preset);
    render();
  });

  document.getElementById('deleteRecipeBtn').addEventListener('click', async () => {
    const name = recipeSelect.value;
    if (!name) return;
    const ok = confirm(`Delete the saved recipe "${name}"? This can't be undone.`);
    if (!ok) return;
    await idbDelete(IDB_STORE_RECIPES, name);
    await refreshRecipeList();
  });

  // ---------- project library: nested folders of saved projects (photo + logo + full recipe) ----------

  const libraryOverlay = document.getElementById('libraryOverlay');
  const libraryList = document.getElementById('libraryList');
  const libraryBreadcrumb = document.getElementById('libraryBreadcrumb');
  const libraryBackBtn = document.getElementById('libraryBackBtn');

  let libraryCurrentFolderId = null; // null = root
  let libraryPath = []; // [{ id, name }, ...]
  let libraryObjectUrls = [];

  function revokeLibraryObjectUrls() {
    libraryObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    libraryObjectUrls = [];
  }

  async function loadFolderChildren(parentId) {
    const [allFolders, allProjects] = await Promise.all([
      idbGetAllValues(IDB_STORE_FOLDERS),
      idbGetAllValues(IDB_STORE_PROJECTS),
    ]);
    const folders = allFolders.filter((f) => f.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name));
    const projects = allProjects.filter((p) => p.folderId === parentId).sort((a, b) => b.updatedAt - a.updatedAt);
    return { folders, projects };
  }

  async function deleteFolderRecursive(folderId) {
    const [allFolders, allProjects] = await Promise.all([
      idbGetAllValues(IDB_STORE_FOLDERS),
      idbGetAllValues(IDB_STORE_PROJECTS),
    ]);
    for (const child of allFolders.filter((f) => f.parentId === folderId)) {
      await deleteFolderRecursive(child.id);
    }
    for (const proj of allProjects.filter((p) => p.folderId === folderId)) {
      await idbDelete(IDB_STORE_PROJECTS, proj.id);
    }
    await idbDelete(IDB_STORE_FOLDERS, folderId);
  }

  async function renderLibrary() {
    revokeLibraryObjectUrls();
    const { folders, projects } = await loadFolderChildren(libraryCurrentFolderId);

    libraryBackBtn.disabled = libraryPath.length === 0;
    libraryBreadcrumb.textContent = libraryPath.length ? `Home / ${libraryPath.map((p) => p.name).join(' / ')}` : 'Home';

    libraryList.innerHTML = '';

    if (folders.length === 0 && projects.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'hint-text';
      empty.textContent = 'Nothing here yet. Create a folder, or save the project you\'re working on into this one.';
      libraryList.appendChild(empty);
    }

    for (const folder of folders) {
      const row = document.createElement('div');
      row.className = 'library-row';
      row.innerHTML = `
        <span class="library-row-icon">📁</span>
        <span class="library-row-name" role="button">${escapeHtml(folder.name)}</span>
        <button class="library-row-btn" data-action="rename-folder" data-id="${folder.id}">Rename</button>
        <button class="library-row-btn" data-action="delete-folder" data-id="${folder.id}">Delete</button>
      `;
      row.querySelector('.library-row-name').addEventListener('click', () => {
        libraryPath.push({ id: folder.id, name: folder.name });
        libraryCurrentFolderId = folder.id;
        renderLibrary();
      });
      libraryList.appendChild(row);
    }

    for (const project of projects) {
      const row = document.createElement('div');
      row.className = 'library-row';
      let thumbHtml = '<div class="library-thumb library-thumb-empty"></div>';
      if (project.thumbnailBlob) {
        const url = URL.createObjectURL(project.thumbnailBlob);
        libraryObjectUrls.push(url);
        thumbHtml = `<img class="library-thumb" src="${url}" alt="" />`;
      }
      row.innerHTML = `
        ${thumbHtml}
        <span class="library-row-name" role="button">${escapeHtml(project.name)}</span>
        <button class="library-row-btn" data-action="rename-project" data-id="${project.id}">Rename</button>
        <button class="library-row-btn" data-action="duplicate-project" data-id="${project.id}">Duplicate</button>
        <button class="library-row-btn" data-action="delete-project" data-id="${project.id}">Delete</button>
      `;
      row.querySelector('.library-row-name').addEventListener('click', () => openProject(project.id));
      libraryList.appendChild(row);
    }

    libraryList.querySelectorAll('.library-row-btn').forEach((btn) => {
      btn.addEventListener('click', () => handleLibraryRowAction(btn.dataset.action, btn.dataset.id));
    });
  }

  async function handleLibraryRowAction(action, id) {
    if (action === 'rename-folder') {
      const folder = await idbGet(IDB_STORE_FOLDERS, id);
      if (!folder) return;
      const name = prompt('Rename folder:', folder.name);
      if (!name || !name.trim()) return;
      folder.name = name.trim();
      await idbPut(IDB_STORE_FOLDERS, folder);
      renderLibrary();
    } else if (action === 'delete-folder') {
      const ok = confirm("Delete this folder and everything inside it (subfolders and saved projects)?\n\nThis can't be undone.");
      if (!ok) return;
      await deleteFolderRecursive(id);
      renderLibrary();
    } else if (action === 'rename-project') {
      const project = await idbGet(IDB_STORE_PROJECTS, id);
      if (!project) return;
      const name = prompt('Rename project:', project.name);
      if (!name || !name.trim()) return;
      project.name = name.trim();
      await idbPut(IDB_STORE_PROJECTS, project);
      if (currentProject && currentProject.id === id) setCurrentProject({ ...currentProject, name: project.name });
      renderLibrary();
    } else if (action === 'duplicate-project') {
      const project = await idbGet(IDB_STORE_PROJECTS, id);
      if (!project) return;
      const copy = { ...project, id: makeId(), name: `${project.name} copy`, updatedAt: Date.now() };
      const ok = await idbPut(IDB_STORE_PROJECTS, copy);
      if (!ok) { alert("Couldn't duplicate this project -- your browser's storage may be full."); return; }
      renderLibrary();
    } else if (action === 'delete-project') {
      const ok = confirm("Delete this saved project?\n\nThis can't be undone.");
      if (!ok) return;
      await idbDelete(IDB_STORE_PROJECTS, id);
      if (currentProject && currentProject.id === id) setCurrentProject(null);
      renderLibrary();
    }
  }

  function makeThumbnail() {
    return new Promise((resolve) => {
      const thumbW = 320;
      const thumbH = Math.round(thumbW * (state.canvasH / state.canvasW));
      const off = document.createElement('canvas');
      off.width = thumbW;
      off.height = thumbH;
      const octx = off.getContext('2d');
      octx.imageSmoothingEnabled = true;
      octx.imageSmoothingQuality = 'high';
      octx.drawImage(canvas, 0, 0, thumbW, thumbH); // from the already-rendered live preview canvas
      off.toBlob((blob) => resolve(blob), 'image/jpeg', 0.82);
    });
  }

  // re-derives a usable image Blob straight from an already-loaded
  // HTMLImageElement -- a fallback for when the original upload's Blob/File
  // isn't available to save (see captureProjectFields below), so a project
  // never silently saves without the photo/logo that's visibly on screen
  function imageElementToBlob(img) {
    return new Promise((resolve) => {
      const off = document.createElement('canvas');
      off.width = img.naturalWidth;
      off.height = img.naturalHeight;
      off.getContext('2d').drawImage(img, 0, 0);
      off.toBlob((blob) => resolve(blob), 'image/png');
    });
  }

  // gathers everything a saved project record needs from the current working
  // state -- shared by "Save" (overwrite in place) and "Save as" (new record).
  // Falls back to re-deriving the photo/logo Blob from the loaded image
  // itself if the tracked upload Blob is missing for any reason, so "Save"
  // always captures what's actually on screen rather than silently saving a
  // project with no image.
  async function captureProjectFields() {
    const thumbnailBlob = await makeThumbnail();
    let photoBlob = currentPhotoBlob;
    if (!photoBlob && state.image) photoBlob = await imageElementToBlob(state.image);
    let logoBlob = null;
    if (state.logo.img) {
      logoBlob = currentLogoBlob || (await idbGet(IDB_STORE_KV, 'savedLogo')) || null;
      if (!logoBlob) logoBlob = await imageElementToBlob(state.logo.img);
    }
    const detailBlobs = [null, null];
    for (let i = 0; i < 2; i++) {
      const img = state.magnifier.loupes[i].detailImg;
      if (!img) continue;
      detailBlobs[i] = currentDetailBlobs[i] || await imageElementToBlob(img);
    }
    return {
      recipe: serializeRecipe(),
      imageTransform: { ...state.imageTransform },
      photoBlob: photoBlob || null,
      logoBlob,
      detailBlob0: detailBlobs[0],
      detailBlob1: detailBlobs[1],
      thumbnailBlob,
      updatedAt: Date.now(),
    };
  }

  // "Save as" -- always creates a brand-new project record with a new name,
  // into whichever folder is currently open in the library. Leaves any
  // previously-saved project completely untouched, then becomes the project
  // "Save" will overwrite from here on.
  async function saveProjectToCurrentFolder() {
    if (!state.image) { alert('Upload a photo first.'); return; }
    const name = prompt('Save as new project named:', currentProject ? currentProject.name : '');
    if (!name || !name.trim()) return;

    const project = {
      id: makeId(),
      folderId: libraryCurrentFolderId,
      name: name.trim(),
      ...(await captureProjectFields()),
    };
    const ok = await idbPut(IDB_STORE_PROJECTS, project);
    if (!ok) { alert("Couldn't save this project -- your browser's storage may be full. Try freeing up space (e.g. deleting an old saved project) and save again."); return; }
    setCurrentProject({ id: project.id, name: project.name, folderId: project.folderId });
    renderLibrary();
  }

  // "Save" -- overwrites the currently-open project in place (same id, name,
  // and folder), so editing a design and hitting Save never creates a
  // duplicate. With no project open yet, this is a first save and needs a
  // name, same as "Save as" -- from then on it's the current project.
  async function saveCurrentProject() {
    if (!state.image) { alert('Upload a photo first.'); return false; }
    if (!currentProject) {
      const name = prompt('Name this project:');
      if (!name || !name.trim()) return false;
      const project = {
        id: makeId(),
        folderId: libraryCurrentFolderId,
        name: name.trim(),
        ...(await captureProjectFields()),
      };
      const ok = await idbPut(IDB_STORE_PROJECTS, project);
      if (!ok) { alert("Couldn't save this project -- your browser's storage may be full. Try freeing up space (e.g. deleting an old saved project) and save again."); return false; }
      setCurrentProject({ id: project.id, name: project.name, folderId: project.folderId });
      renderLibrary();
      return true;
    }
    const project = {
      id: currentProject.id,
      folderId: currentProject.folderId,
      name: currentProject.name,
      ...(await captureProjectFields()),
    };
    const ok = await idbPut(IDB_STORE_PROJECTS, project);
    if (!ok) { alert("Couldn't save -- your browser's storage may be full. Try freeing up space (e.g. deleting an old saved project) and save again."); return false; }
    renderLibrary();
    return true;
  }

  async function openProject(id) {
    try {
      const project = await idbGet(IDB_STORE_PROJECTS, id);
      if (!project) { alert("Couldn't find that project — it may have been deleted."); return; }

      if (project.photoBlob) {
        const img = await loadImageFromBlob(project.photoBlob);
        if (img) {
          state.image = img;
          setCurrentPhotoBlob(project.photoBlob);
          dropHint.classList.add('hidden');
          exportBtn.disabled = false;
          saveBtn.disabled = false;
        } else {
          state.image = null;
          setCurrentPhotoBlob(null);
          dropHint.classList.remove('hidden');
          exportBtn.disabled = true;
          saveBtn.disabled = true;
          alert('This project\'s saved photo is damaged and could not be loaded. Its other settings (text, fade, logo) were still restored -- upload the photo again and re-save.');
        }
      } else {
        state.image = null;
        setCurrentPhotoBlob(null);
        dropHint.classList.remove('hidden');
        exportBtn.disabled = true;
        saveBtn.disabled = true;
        alert('This project was saved without a photo, so the canvas is blank. Its other settings (text, fade, logo) were still restored -- upload a photo and re-save to fix it going forward.');
      }

      if (project.logoBlob) {
        state.logo.img = await loadImageFromBlob(project.logoBlob);
        setCurrentLogoBlob(state.logo.img ? project.logoBlob : null);
      } else {
        state.logo.img = null;
        setCurrentLogoBlob(null);
      }

      for (let i = 0; i < 2; i++) {
        const blob = project[`detailBlob${i}`];
        if (blob) {
          const img = await loadImageFromBlob(blob);
          state.magnifier.loupes[i].detailImg = img;
          setCurrentDetailBlob(i, img ? blob : null);
        } else {
          state.magnifier.loupes[i].detailImg = null;
          setCurrentDetailBlob(i, null);
        }
      }

      if (project.recipe) applyRecipeToState(project.recipe);
      if (project.imageTransform && typeof project.imageTransform.zoom === 'number') {
        state.imageTransform = project.imageTransform;
      } else {
        state.imageTransform = { zoom: 1, offsetXPct: 0.5, offsetYPct: 0.5, rotation: 0 };
      }

      setCurrentProject({ id: project.id, name: project.name, folderId: project.folderId });
      syncAllControlsFromState();
      applyPreset(state.preset);
      render();
      closeLibrary();
    } catch (err) {
      console.error('Failed to open project', id, err);
      alert("Sorry, this project couldn't be opened — its saved data may be corrupted or too large for this device to load. Try deleting and re-saving it.");
    }
  }

  function openLibrary() {
    libraryCurrentFolderId = null;
    libraryPath = [];
    libraryOverlay.classList.remove('hidden');
    renderLibrary();
  }

  function closeLibrary() {
    revokeLibraryObjectUrls();
    libraryOverlay.classList.add('hidden');
  }

  document.getElementById('libraryBtn').addEventListener('click', openLibrary);
  document.getElementById('libraryCloseBtn').addEventListener('click', closeLibrary);
  document.getElementById('libraryBackBtn').addEventListener('click', () => {
    if (libraryPath.length === 0) return;
    libraryPath.pop();
    libraryCurrentFolderId = libraryPath.length ? libraryPath[libraryPath.length - 1].id : null;
    renderLibrary();
  });
  document.getElementById('libraryNewFolderBtn').addEventListener('click', async () => {
    const name = prompt('New folder name:');
    if (!name || !name.trim()) return;
    await idbPut(IDB_STORE_FOLDERS, { id: makeId(), parentId: libraryCurrentFolderId, name: name.trim(), createdAt: Date.now() });
    renderLibrary();
  });
  document.getElementById('librarySaveHereBtn').addEventListener('click', saveProjectToCurrentFolder);

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    let ok = false;
    try {
      ok = await saveCurrentProject();
    } finally {
      saveBtn.disabled = !state.image;
      if (ok) {
        saveBtn.textContent = 'Saved ✓';
        setTimeout(updateSaveButtonLabel, 1000);
      } else {
        updateSaveButtonLabel();
      }
    }
  });

  // legacy fallback: versions before session-save only kept font/colour in localStorage
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

  // ---------- tab / panel switching ----------

  document.getElementById('tabbar').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === btn.dataset.panel));

    // the photo can only be panned/zoomed while its own tab is open -- it's
    // locked everywhere else, per the request that it "fixes/locks" when off
    state.positionEditMode = btn.dataset.panel === 'panel-position';
    stage.classList.toggle('position-edit-mode', state.positionEditMode);
    // same idea for the magnifier's own on-canvas dragging (loupe/target/
    // detail-pan) -- only live while its tab is open, so it can't be
    // dragged by accident while editing something else
    state.magnifierEditMode = btn.dataset.panel === 'panel-magnifier';
    // same idea for free text boxes -- only draggable while their own tab is open
    state.freeTextEditMode = btn.dataset.panel === 'panel-freetext';
    render();
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
  wireSegmented('textHAlign', (val) => {
    state.text.hAlign = val;
    // quick-jump the continuous cross-position slider to match, so the
    // button still acts as a "snap to that side" shortcut like it used to,
    // while direct dragging (or the slider) can still move it anywhere after
    state.text.crossAlign = val === 'left' ? 0 : val === 'right' ? 100 : 50;
    textCrossAlign.value = state.text.crossAlign;
    render();
  });

  const textVPosLabel = document.getElementById('textVPosLabel');
  const textVPosScaleLabels = document.querySelectorAll('#textVPosScaleLabels span');
  const textVPosHint = document.getElementById('textVPosHint');
  function updateTextVPosLabels() {
    const orientation = state.text.orientation || 'horizontal';
    if (orientation === 'horizontal') {
      textVPosLabel.textContent = 'Vertical position';
      textVPosScaleLabels[0].textContent = 'Top';
      textVPosScaleLabels[1].textContent = 'Bottom';
      textVPosHint.textContent = 'Slides the whole text block up or down, without ever crossing the top/bottom edge padding. If you\'re on the Story/Reels preset, turn on "Show safe zone" (Canvas tab) to check the text won\'t sit under Instagram\'s own UI.';
    } else {
      textVPosLabel.textContent = 'Horizontal position';
      const nearEdge = orientation === 'vertical' ? 'Right' : 'Left';
      const farEdge = orientation === 'vertical' ? 'Left' : 'Right';
      textVPosScaleLabels[0].textContent = nearEdge;
      textVPosScaleLabels[1].textContent = farEdge;
      textVPosHint.textContent = `Slides the whole (rotated) text block left or right, without ever crossing the left/right edge padding.`;
    }
  }
  const textHAlignRow = document.getElementById('textHAlignRow');
  const textCrossAlignLabel = document.getElementById('textCrossAlignLabel');
  const textCrossAlignScaleLabels = document.querySelectorAll('#textCrossAlignRow2 span');
  const textCrossAlign = document.getElementById('textCrossAlign');
  function updateTextOrientationRows() {
    const vertical = (state.text.orientation || 'horizontal') !== 'horizontal';
    textHAlignRow.style.display = vertical ? 'none' : 'flex'; // text-align style only makes sense (and only applies) in horizontal mode
    if (vertical) {
      textCrossAlignLabel.textContent = 'Vertical position';
      textCrossAlignScaleLabels[0].textContent = 'Top';
      textCrossAlignScaleLabels[1].textContent = 'Bottom';
    } else {
      textCrossAlignLabel.textContent = 'Horizontal position';
      textCrossAlignScaleLabels[0].textContent = 'Left';
      textCrossAlignScaleLabels[1].textContent = 'Right';
    }
  }
  wireSegmented('textOrientation', (val) => {
    // clicking the already-active option again is a shortcut to snap both
    // position sliders back to dead-centre, without dragging each by hand
    if (val === state.text.orientation) {
      state.text.vAlign = 50;
      state.text.crossAlign = 50;
      textVPos.value = 50;
      textCrossAlign.value = 50;
    }
    state.text.orientation = val;
    updateTextVPosLabels();
    updateTextOrientationRows();
    render();
  });
  textCrossAlign.addEventListener('input', () => {
    state.text.crossAlign = Number(textCrossAlign.value);
    render();
  });
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

  const fadeSpeed = document.getElementById('fadeSpeed');
  const fadeSpeedVal = document.getElementById('fadeSpeedVal');
  fadeSpeed.addEventListener('input', () => {
    state.fade.speed = Number(fadeSpeed.value);
    fadeSpeedVal.textContent = speedValueToLabel(state.fade.speed);
    render();
  });

  document.getElementById('fadeColor').addEventListener('input', (e) => {
    state.fade.color = e.target.value;
    render();
  });

  const fadeIntensity = document.getElementById('fadeIntensity');
  const fadeIntensityVal = document.getElementById('fadeIntensityVal');
  fadeIntensity.addEventListener('input', () => {
    state.fade.intensity = Number(fadeIntensity.value);
    fadeIntensityVal.textContent = `${state.fade.intensity}%`;
    render();
  });

  document.getElementById('fadeTextured').addEventListener('change', (e) => {
    state.fade.textured = e.target.checked;
    render();
  });

  const fadeTextureIntensity = document.getElementById('fadeTextureIntensity');
  const fadeTextureIntensityVal = document.getElementById('fadeTextureIntensityVal');
  fadeTextureIntensity.addEventListener('input', () => {
    state.fade.textureIntensity = Number(fadeTextureIntensity.value);
    fadeTextureIntensityVal.textContent = `${state.fade.textureIntensity}%`;
    render();
  });

  const fadeTextureGrainSize = document.getElementById('fadeTextureGrainSize');
  fadeTextureGrainSize.addEventListener('input', () => {
    state.fade.textureGrainSize = Number(fadeTextureGrainSize.value);
    render();
  });

  const effectGrain = document.getElementById('effectGrain');
  const effectGrainVal = document.getElementById('effectGrainVal');
  effectGrain.addEventListener('input', () => {
    state.effects.grain = Number(effectGrain.value);
    effectGrainVal.textContent = `${state.effects.grain}%`;
    render();
  });

  const effectGrainSize = document.getElementById('effectGrainSize');
  effectGrainSize.addEventListener('input', () => {
    state.effects.grainSize = Number(effectGrainSize.value);
    render();
  });

  const effectVignette = document.getElementById('effectVignette');
  const effectVignetteVal = document.getElementById('effectVignetteVal');
  effectVignette.addEventListener('input', () => {
    state.effects.vignette = Number(effectVignette.value);
    effectVignetteVal.textContent = `${state.effects.vignette}%`;
    render();
  });

  const effectWarmth = document.getElementById('effectWarmth');
  const effectWarmthVal = document.getElementById('effectWarmthVal');
  effectWarmth.addEventListener('input', () => {
    state.effects.warmth = Number(effectWarmth.value);
    effectWarmthVal.textContent = `${state.effects.warmth}%`;
    render();
  });

  const filmStockIntensityRow = document.getElementById('filmStockIntensityRow');
  const techOpticsHudRow = document.getElementById('techOpticsHudRow');
  const techOpticsHudTextRow = document.getElementById('techOpticsHudTextRow');
  const techOpticsLayerRows = document.querySelectorAll('.tech-optics-layer-row');
  const frontierLayerRows = document.querySelectorAll('.frontier-layer-row');
  function updateTechOpticsRowVisibility() {
    const showTechOptics = state.effects.filmStock === 'techOptics';
    techOpticsLayerRows.forEach((row) => { row.style.display = showTechOptics ? 'flex' : 'none'; });
    techOpticsHudTextRow.style.display = showTechOptics && state.effects.techOpticsHud ? 'flex' : 'none';
  }
  function updateFrontierRowVisibility() {
    const showFrontier = state.effects.filmStock === 'frontier';
    frontierLayerRows.forEach((row) => { row.style.display = showFrontier ? 'flex' : 'none'; });
  }
  wireSegmented('filmStock', (val) => {
    state.effects.filmStock = val;
    filmStockIntensityRow.style.display = val === 'none' ? 'none' : 'flex';
    updateTechOpticsRowVisibility();
    updateFrontierRowVisibility();
    render();
  });

  const filmStockIntensity = document.getElementById('filmStockIntensity');
  const filmStockIntensityVal = document.getElementById('filmStockIntensityVal');
  filmStockIntensity.addEventListener('input', () => {
    state.effects.filmStockIntensity = Number(filmStockIntensity.value);
    filmStockIntensityVal.textContent = `${state.effects.filmStockIntensity}%`;
    render();
  });

  // per-layer on/off toggles for the Tech Optics effect
  ['Aberration', 'Bloom', 'Grain', 'Flare', 'Vignette'].forEach((name) => {
    document.getElementById(`techOptics${name}`).addEventListener('change', (e) => {
      state.effects[`techOptics${name}`] = e.target.checked;
      render();
    });
  });

  const techOpticsHudTextInput = document.getElementById('techOpticsHudText');
  document.getElementById('techOpticsHud').addEventListener('change', (e) => {
    state.effects.techOpticsHud = e.target.checked;
    techOpticsHudTextRow.style.display = e.target.checked ? 'flex' : 'none';
    render();
  });
  techOpticsHudTextInput.addEventListener('input', () => {
    state.effects.techOpticsHudText = techOpticsHudTextInput.value;
    render();
  });

  // per-layer on/off toggles for the Frontier effect
  ['Halation', 'Grain', 'Haze', 'Flare', 'Vignette'].forEach((name) => {
    document.getElementById(`frontier${name}`).addEventListener('change', (e) => {
      state.effects[`frontier${name}`] = e.target.checked;
      render();
    });
  });

  const logoSize = document.getElementById('logoSize');
  const logoSizeVal = document.getElementById('logoSizeVal');
  logoSize.addEventListener('input', () => {
    state.logo.sizePct = Number(logoSize.value);
    logoSizeVal.textContent = `${state.logo.sizePct}%`;
    const clamped = clampLogoPosition(state.logo.xPct, state.logo.yPct);
    state.logo.xPct = clamped.xPct;
    state.logo.yPct = clamped.yPct;
    render();
  });

  // maps the logo's vertical position <-> a 0 (top) .. 100 (bottom) slider,
  // across the same bounds dragging is clamped to
  function logoVPosValueToYPct(value) {
    const { minY, maxY } = getLogoBounds();
    if (minY > maxY) return 0.5;
    return minY + (maxY - minY) * (value / 100);
  }
  function yPctToLogoVPosValue(yPct) {
    const { minY, maxY } = getLogoBounds();
    if (maxY <= minY) return 50;
    return Math.round(((yPct - minY) / (maxY - minY)) * 100);
  }

  const logoVPos = document.getElementById('logoVPos');
  logoVPos.addEventListener('input', () => {
    state.logo.yPct = logoVPosValueToYPct(Number(logoVPos.value));
    state.logo.manuallyPositioned = true;
    render();
  });

  // rotating swaps the logo's on-screen width/height, which can push it
  // outside the current margins at its current size -- reclamp afterward,
  // same as changing size does
  document.getElementById('logoRotate').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const delta = btn.dataset.val === 'left' ? -90 : 90;
    state.logo.rotation = ((state.logo.rotation || 0) + delta + 360) % 360;
    const clamped = clampLogoPosition(state.logo.xPct, state.logo.yPct);
    state.logo.xPct = clamped.xPct;
    state.logo.yPct = clamped.yPct;
    logoVPos.value = yPctToLogoVPosValue(state.logo.yPct);
    render();
  });

  // flip buttons are independent on/off toggles, not an exclusive choice --
  // wireSegmented doesn't fit, so they're wired directly
  document.getElementById('logoFlip').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.val === 'h') state.logo.flipH = !state.logo.flipH;
    else state.logo.flipV = !state.logo.flipV;
    btn.classList.toggle('active');
    render();
  });

  const logoCustomColorRow = document.getElementById('logoCustomColorRow');
  wireSegmented('logoColorMode', (val) => {
    state.logo.colorMode = val;
    logoCustomColorRow.style.display = val === 'custom' ? 'flex' : 'none';
    render();
  });

  document.getElementById('logoCustomColor').addEventListener('input', (e) => {
    state.logo.customColor = e.target.value;
    render();
  });

  // ---------- 5-star rating icon ----------

  document.getElementById('starsEnabled').addEventListener('change', (e) => {
    state.stars.enabled = e.target.checked;
    render();
  });

  wireSegmented('starsPreset', (val) => {
    applyStarsCorner(val);
    render();
  });

  const starsSize = document.getElementById('starsSize');
  const starsSizeVal = document.getElementById('starsSizeVal');
  starsSize.addEventListener('input', () => {
    state.stars.sizePct = Number(starsSize.value);
    starsSizeVal.textContent = `${state.stars.sizePct}%`;
    const clamped = clampStarsPosition(state.stars.xPct, state.stars.yPct);
    state.stars.xPct = clamped.xPct;
    state.stars.yPct = clamped.yPct;
    render();
  });

  // maps the stars' vertical position <-> a 0 (top) .. 100 (bottom) slider,
  // across the same bounds dragging is clamped to -- same pattern as the logo's
  function starsVPosValueToYPct(value) {
    const { minY, maxY } = getStarsBounds();
    if (minY > maxY) return 0.5;
    return minY + (maxY - minY) * (value / 100);
  }
  function yPctToStarsVPosValue(yPct) {
    const { minY, maxY } = getStarsBounds();
    if (maxY <= minY) return 50;
    return Math.round(((yPct - minY) / (maxY - minY)) * 100);
  }
  // same idea along the horizontal axis, 0 (left) .. 100 (right)
  function starsHPosValueToXPct(value) {
    const { minX, maxX } = getStarsBounds();
    if (minX > maxX) return 0.5;
    return minX + (maxX - minX) * (value / 100);
  }
  function xPctToStarsHPosValue(xPct) {
    const { minX, maxX } = getStarsBounds();
    if (maxX <= minX) return 50;
    return Math.round(((xPct - minX) / (maxX - minX)) * 100);
  }

  const starsHPos = document.getElementById('starsHPos');
  starsHPos.addEventListener('input', () => {
    state.stars.xPct = starsHPosValueToXPct(Number(starsHPos.value));
    render();
  });

  const starsVPos = document.getElementById('starsVPos');
  starsVPos.addEventListener('input', () => {
    state.stars.yPct = starsVPosValueToYPct(Number(starsVPos.value));
    render();
  });

  document.getElementById('starsColor').addEventListener('input', (e) => {
    state.stars.color = e.target.value;
    render();
  });

  const imageZoom = document.getElementById('imageZoom');
  const imageZoomVal = document.getElementById('imageZoomVal');
  imageZoom.addEventListener('input', () => {
    setImageZoom(Number(imageZoom.value) / 100);
    imageZoomVal.textContent = `${imageZoom.value}%`;
    render();
  });

  document.getElementById('imageRotate').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || !state.image) return;
    const delta = btn.dataset.val === 'left' ? -90 : 90;
    state.imageTransform.rotation = ((state.imageTransform.rotation || 0) + delta + 360) % 360;
    render();
  });

  document.getElementById('resetImagePositionBtn').addEventListener('click', () => {
    // pan/zoom only -- rotation is a deliberate orientation choice, not a
    // "position", so it's left as-is (matching the logo's own rotate control,
    // which position presets don't touch either)
    state.imageTransform = { zoom: 1, offsetXPct: 0.5, offsetYPct: 0.5, rotation: state.imageTransform.rotation || 0 };
    imageZoom.value = 100;
    imageZoomVal.textContent = '100%';
    render();
  });

  const marginSlider = document.getElementById('marginSlider');
  const marginVal = document.getElementById('marginVal');
  marginSlider.addEventListener('input', () => {
    state.marginFrac = Number(marginSlider.value) / 100;
    marginVal.textContent = `${marginSlider.value}%`;
    const clamped = clampLogoPosition(state.logo.xPct, state.logo.yPct);
    state.logo.xPct = clamped.xPct;
    state.logo.yPct = clamped.yPct;
    render();
  });

  const marginVSlider = document.getElementById('marginVSlider');
  const marginVVal = document.getElementById('marginVVal');
  marginVSlider.addEventListener('input', () => {
    state.marginVFrac = Number(marginVSlider.value) / 100;
    marginVVal.textContent = `${marginVSlider.value}%`;
    const clamped = clampLogoPosition(state.logo.xPct, state.logo.yPct);
    state.logo.xPct = clamped.xPct;
    state.logo.yPct = clamped.yPct;
    render();
  });

  document.getElementById('textBlockEnabled').addEventListener('change', (e) => {
    state.text.enabled = e.target.checked;
    render();
  });

  document.getElementById('otherEnabled').addEventListener('change', (e) => {
    state.text.layers.other.enabled = e.target.checked;
    render();
  });

  document.getElementById('subheaderEnabled').addEventListener('change', (e) => {
    state.text.layers.subheader.enabled = e.target.checked;
    render();
  });

  const textVPos = document.getElementById('textVPos');
  textVPos.addEventListener('input', () => {
    state.text.vAlign = Number(textVPos.value);
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
    textEl.addEventListener('input', () => { l.text = textEl.value; render(); });
    fontEl.addEventListener('change', () => { l.font = fontEl.value; render(); });
    sizeEl.addEventListener('input', () => {
      l.size = Number(sizeEl.value);
      sizeValEl.textContent = `${l.size}px`;
      render();
    });
    colorEl.addEventListener('input', () => { l.color = colorEl.value; render(); });
  }

  function syncLayerPanel(layerKey) {
    const panel = document.getElementById(`layer-${layerKey}`);
    const l = state.text.layers[layerKey];
    panel.querySelector('.layer-text').value = l.text;
    panel.querySelector('.layer-font').value = l.font;
    panel.querySelector('.layer-size').value = l.size;
    panel.querySelector('.layer-size-val').textContent = `${l.size}px`;
    panel.querySelector('.layer-color').value = l.color;
  }

  // ---------- preset / canvas sizing ----------

  function applyPreset(key) {
    const p = PRESETS[key] || PRESETS['1080x1350']; // fall back if a saved project has an unrecognised/corrupted preset key
    key = PRESETS[key] ? key : '1080x1350';
    state.preset = key;
    state.canvasW = p.w;
    state.canvasH = p.h;
    canvas.width = p.w;
    canvas.height = p.h;
    // resizing a canvas resets its 2D context state, including smoothing quality
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
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
      state.imageTransform = { zoom: 1, offsetXPct: 0.5, offsetYPct: 0.5, rotation: 0 }; // reset crop/rotation for the new photo
      imageZoom.value = 100;
      imageZoomVal.textContent = '100%';
      videoKeyframeA = null; // old points don't apply to a new photo's content
      videoKeyframeB = null;
      updateVideoKeyframeUI();
      dropHint.classList.add('hidden');
      exportBtn.disabled = false;
      saveBtn.disabled = false;
      render();
    });
    setCurrentPhotoBlob(file);
  });

  logoInput.addEventListener('change', () => {
    const file = logoInput.files[0];
    if (!file) return;
    loadImageFile(file, (img) => {
      state.logo.img = img;
      render();
    });
    setCurrentLogoBlob(file);
  });

  // ---------- magnifier (premium loupe detail callout) ----------

  function activeLoupeObj() { return state.magnifier.loupes[state.magnifier.activeLoupe]; }

  const magnifierDetailInput = document.getElementById('magnifierDetailInput');
  const magnifierDetailZoom = document.getElementById('magnifierDetailZoom');
  const magnifierDetailZoomVal = document.getElementById('magnifierDetailZoomVal');
  const magnifierDetailPanX = document.getElementById('magnifierDetailPanX');
  const magnifierDetailPanXVal = document.getElementById('magnifierDetailPanXVal');
  const magnifierDetailPanY = document.getElementById('magnifierDetailPanY');
  const magnifierDetailPanYVal = document.getElementById('magnifierDetailPanYVal');
  const magnifierLoupeX = document.getElementById('magnifierLoupeX');
  const magnifierLoupeXVal = document.getElementById('magnifierLoupeXVal');
  const magnifierLoupeY = document.getElementById('magnifierLoupeY');
  const magnifierLoupeYVal = document.getElementById('magnifierLoupeYVal');
  const magnifierDiameter = document.getElementById('magnifierDiameter');
  const magnifierDiameterVal = document.getElementById('magnifierDiameterVal');
  const magnifierLineOpacity = document.getElementById('magnifierLineOpacity');
  const magnifierLineOpacityVal = document.getElementById('magnifierLineOpacityVal');
  const magnifierFillOpacity = document.getElementById('magnifierFillOpacity');
  const magnifierFillOpacityVal = document.getElementById('magnifierFillOpacityVal');
  const magnifierLabelText = document.getElementById('magnifierLabelText');
  const magnifierLoupeEnabled = document.getElementById('magnifierLoupeEnabled');
  const magnifierTargetX = document.getElementById('magnifierTargetX');
  const magnifierTargetXVal = document.getElementById('magnifierTargetXVal');
  const magnifierTargetY = document.getElementById('magnifierTargetY');
  const magnifierTargetYVal = document.getElementById('magnifierTargetYVal');

  // refreshes every control in the Magnifier panel to reflect whichever
  // loupe is currently selected (the "Loupe 1"/"Loupe 2" chips) -- called on
  // chip switch and from syncAllControlsFromState (session/project restore)
  function syncMagnifierPanelFromState() {
    const loupe = activeLoupeObj();
    document.getElementById('magnifierEnabled').checked = state.magnifier.enabled;
    setSegmentedActive('magnifierLoupeChips', String(state.magnifier.activeLoupe));
    magnifierLoupeEnabled.checked = loupe.enabled;
    setSegmentedActive('magnifierDragMode', state.magnifier.dragPansDetail ? 'pan' : 'loupe');
    magnifierDetailZoom.value = Math.round(loupe.detailZoom * 100);
    magnifierDetailZoomVal.textContent = `${magnifierDetailZoom.value}%`;
    magnifierDetailPanX.value = Math.round(loupe.detailPanX * 100);
    magnifierDetailPanXVal.textContent = `${magnifierDetailPanX.value}%`;
    magnifierDetailPanY.value = Math.round(loupe.detailPanY * 100);
    magnifierDetailPanYVal.textContent = `${magnifierDetailPanY.value}%`;
    magnifierLoupeX.value = Math.round(loupe.loupeX * 100);
    magnifierLoupeXVal.textContent = `${magnifierLoupeX.value}%`;
    magnifierLoupeY.value = Math.round(loupe.loupeY * 100);
    magnifierLoupeYVal.textContent = `${magnifierLoupeY.value}%`;
    magnifierDiameter.value = Math.round(loupe.diameter * 100);
    magnifierDiameterVal.textContent = `${magnifierDiameter.value}%`;
    setSegmentedActive('magnifierStyle', loupe.style);
    document.getElementById('magnifierShadow').checked = loupe.shadow;
    setSegmentedActive('magnifierMarker', loupe.marker);
    magnifierTargetX.value = Math.round(loupe.targetX * 100);
    magnifierTargetXVal.textContent = `${magnifierTargetX.value}%`;
    magnifierTargetY.value = Math.round(loupe.targetY * 100);
    magnifierTargetYVal.textContent = `${magnifierTargetY.value}%`;
    setSegmentedActive('magnifierConnectorType', loupe.connectorType);
    magnifierLineOpacity.value = Math.round(loupe.lineOpacity * 100);
    magnifierLineOpacityVal.textContent = `${magnifierLineOpacity.value}%`;
    magnifierFillOpacity.value = Math.round(loupe.fillOpacity * 100);
    magnifierFillOpacityVal.textContent = `${magnifierFillOpacity.value}%`;
    magnifierLabelText.value = loupe.labelText;
    setSegmentedActive('magnifierLabelPosition', loupe.labelPosition);
  }

  document.getElementById('magnifierEnabled').addEventListener('change', (e) => {
    state.magnifier.enabled = e.target.checked;
    render();
  });

  wireSegmented('magnifierLoupeChips', (val) => {
    state.magnifier.activeLoupe = Number(val);
    syncMagnifierPanelFromState();
    render();
  });

  magnifierLoupeEnabled.addEventListener('change', (e) => {
    activeLoupeObj().enabled = e.target.checked;
    render();
  });

  wireSegmented('magnifierDragMode', (val) => {
    state.magnifier.dragPansDetail = val === 'pan';
  });

  magnifierDetailInput.addEventListener('change', () => {
    const file = magnifierDetailInput.files[0];
    if (!file) return;
    const idx = state.magnifier.activeLoupe;
    loadImageFile(file, (img) => {
      state.magnifier.loupes[idx].detailImg = img;
      state.magnifier.loupes[idx].detailZoom = 1.8;
      state.magnifier.loupes[idx].detailPanX = 0.5;
      state.magnifier.loupes[idx].detailPanY = 0.5;
      syncMagnifierPanelFromState();
      render();
    });
    setCurrentDetailBlob(idx, file);
  });

  magnifierDetailZoom.addEventListener('input', () => {
    const loupe = activeLoupeObj();
    loupe.detailZoom = Number(magnifierDetailZoom.value) / 100;
    magnifierDetailZoomVal.textContent = `${magnifierDetailZoom.value}%`;
    const clamped = clampDetailPan(loupe, loupe.detailPanX, loupe.detailPanY);
    loupe.detailPanX = clamped.x;
    loupe.detailPanY = clamped.y;
    magnifierDetailPanX.value = Math.round(loupe.detailPanX * 100);
    magnifierDetailPanXVal.textContent = `${magnifierDetailPanX.value}%`;
    magnifierDetailPanY.value = Math.round(loupe.detailPanY * 100);
    magnifierDetailPanYVal.textContent = `${magnifierDetailPanY.value}%`;
    render();
  });

  magnifierDetailPanX.addEventListener('input', () => {
    const loupe = activeLoupeObj();
    const clamped = clampDetailPan(loupe, Number(magnifierDetailPanX.value) / 100, loupe.detailPanY);
    loupe.detailPanX = clamped.x;
    magnifierDetailPanXVal.textContent = `${Math.round(loupe.detailPanX * 100)}%`;
    render();
  });
  magnifierDetailPanY.addEventListener('input', () => {
    const loupe = activeLoupeObj();
    const clamped = clampDetailPan(loupe, loupe.detailPanX, Number(magnifierDetailPanY.value) / 100);
    loupe.detailPanY = clamped.y;
    magnifierDetailPanYVal.textContent = `${Math.round(loupe.detailPanY * 100)}%`;
    render();
  });

  document.getElementById('magnifierResetCropBtn').addEventListener('click', () => {
    const loupe = activeLoupeObj();
    loupe.detailZoom = 1.8;
    loupe.detailPanX = 0.5;
    loupe.detailPanY = 0.5;
    syncMagnifierPanelFromState();
    render();
  });

  magnifierLoupeX.addEventListener('input', () => {
    const loupe = activeLoupeObj();
    const clamped = clampLoupePosition(loupe, Number(magnifierLoupeX.value) / 100, loupe.loupeY);
    loupe.loupeX = clamped.x;
    magnifierLoupeXVal.textContent = `${Math.round(loupe.loupeX * 100)}%`;
    render();
  });
  magnifierLoupeY.addEventListener('input', () => {
    const loupe = activeLoupeObj();
    const clamped = clampLoupePosition(loupe, loupe.loupeX, Number(magnifierLoupeY.value) / 100);
    loupe.loupeY = clamped.y;
    magnifierLoupeYVal.textContent = `${Math.round(loupe.loupeY * 100)}%`;
    render();
  });

  // resizing can push the loupe outside the 4%-edge margin at its current
  // position -- reclamp afterward, same pattern as the logo's size slider
  magnifierDiameter.addEventListener('input', () => {
    const loupe = activeLoupeObj();
    loupe.diameter = Number(magnifierDiameter.value) / 100;
    magnifierDiameterVal.textContent = `${magnifierDiameter.value}%`;
    const clamped = clampLoupePosition(loupe, loupe.loupeX, loupe.loupeY);
    loupe.loupeX = clamped.x;
    loupe.loupeY = clamped.y;
    magnifierLoupeX.value = Math.round(loupe.loupeX * 100);
    magnifierLoupeXVal.textContent = `${magnifierLoupeX.value}%`;
    magnifierLoupeY.value = Math.round(loupe.loupeY * 100);
    magnifierLoupeYVal.textContent = `${magnifierLoupeY.value}%`;
    render();
  });

  wireSegmented('magnifierStyle', (val) => { activeLoupeObj().style = val; render(); });
  document.getElementById('magnifierShadow').addEventListener('change', (e) => { activeLoupeObj().shadow = e.target.checked; render(); });
  wireSegmented('magnifierMarker', (val) => { activeLoupeObj().marker = val; render(); });
  wireSegmented('magnifierConnectorType', (val) => { activeLoupeObj().connectorType = val; render(); });

  magnifierTargetX.addEventListener('input', () => {
    const loupe = activeLoupeObj();
    loupe.targetX = Number(magnifierTargetX.value) / 100;
    magnifierTargetXVal.textContent = `${magnifierTargetX.value}%`;
    render();
  });
  magnifierTargetY.addEventListener('input', () => {
    const loupe = activeLoupeObj();
    loupe.targetY = Number(magnifierTargetY.value) / 100;
    magnifierTargetYVal.textContent = `${magnifierTargetY.value}%`;
    render();
  });

  magnifierLineOpacity.addEventListener('input', () => {
    activeLoupeObj().lineOpacity = Number(magnifierLineOpacity.value) / 100;
    magnifierLineOpacityVal.textContent = `${magnifierLineOpacity.value}%`;
    render();
  });
  magnifierFillOpacity.addEventListener('input', () => {
    activeLoupeObj().fillOpacity = Number(magnifierFillOpacity.value) / 100;
    magnifierFillOpacityVal.textContent = `${magnifierFillOpacity.value}%`;
    render();
  });

  magnifierLabelText.addEventListener('input', () => {
    activeLoupeObj().labelText = magnifierLabelText.value;
    render();
  });
  wireSegmented('magnifierLabelPosition', (val) => { activeLoupeObj().labelPosition = val; render(); });

  // ---------- free text boxes (independent of the headline/subheader/other block) ----------

  const freeTextChips = document.getElementById('freeTextChips');
  const freeTextControls = document.getElementById('freeTextControls');
  const freeTextEmptyHint = document.getElementById('freeTextEmptyHint');
  const freeTextContent = document.getElementById('freeTextContent');
  const freeTextFont = document.getElementById('freeTextFont');
  const freeTextSize = document.getElementById('freeTextSize');
  const freeTextSizeVal = document.getElementById('freeTextSizeVal');
  const freeTextColor = document.getElementById('freeTextColor');
  const freeTextWidth = document.getElementById('freeTextWidth');
  const freeTextWidthVal = document.getElementById('freeTextWidthVal');
  const freeTextX = document.getElementById('freeTextX');
  const freeTextXVal = document.getElementById('freeTextXVal');
  const freeTextY = document.getElementById('freeTextY');
  const freeTextYVal = document.getElementById('freeTextYVal');

  populateFontSelect(freeTextFont);

  function renderFreeTextChips() {
    freeTextChips.innerHTML = '';
    state.freeText.boxes.forEach((box, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.val = String(i);
      btn.textContent = `Box ${i + 1}`;
      if (i === state.freeText.activeBox) btn.classList.add('active');
      freeTextChips.appendChild(btn);
    });
  }

  function syncFreeTextPanelFromState() {
    renderFreeTextChips();
    const box = activeFreeTextBoxObj();
    const hasBox = !!box;
    freeTextControls.classList.toggle('hidden', !hasBox);
    freeTextEmptyHint.classList.toggle('hidden', hasBox);
    document.getElementById('freeTextDeleteBtn').disabled = !hasBox;
    if (!hasBox) return;
    freeTextContent.value = box.text;
    freeTextFont.value = box.font;
    setSegmentedActive('freeTextWeight', box.bold === false ? 'regular' : 'bold');
    freeTextSize.value = box.size;
    freeTextSizeVal.textContent = `${box.size}px`;
    freeTextColor.value = box.color;
    setSegmentedActive('freeTextHAlign', box.hAlign);
    freeTextWidth.value = Math.round(box.widthPct * 100);
    freeTextWidthVal.textContent = `${freeTextWidth.value}%`;
    freeTextX.value = Math.round(box.xPct * 100);
    freeTextXVal.textContent = `${freeTextX.value}%`;
    freeTextY.value = Math.round(box.yPct * 100);
    freeTextYVal.textContent = `${freeTextY.value}%`;
  }

  document.getElementById('freeTextAddBtn').addEventListener('click', () => {
    state.freeText.boxes.push(makeDefaultFreeTextBox());
    state.freeText.activeBox = state.freeText.boxes.length - 1;
    syncFreeTextPanelFromState();
    render();
  });

  document.getElementById('freeTextDeleteBtn').addEventListener('click', () => {
    if (!state.freeText.boxes.length) return;
    state.freeText.boxes.splice(state.freeText.activeBox, 1);
    state.freeText.activeBox = Math.max(0, Math.min(state.freeText.activeBox, state.freeText.boxes.length - 1));
    syncFreeTextPanelFromState();
    render();
  });

  wireSegmented('freeTextChips', (val) => {
    state.freeText.activeBox = Number(val);
    syncFreeTextPanelFromState();
    render();
  });

  freeTextContent.addEventListener('input', () => {
    const box = activeFreeTextBoxObj();
    if (box) { box.text = freeTextContent.value; render(); }
  });
  freeTextFont.addEventListener('change', () => {
    const box = activeFreeTextBoxObj();
    if (box) { box.font = freeTextFont.value; render(); }
  });
  wireSegmented('freeTextWeight', (val) => {
    const box = activeFreeTextBoxObj();
    if (box) { box.bold = val === 'bold'; render(); }
  });
  freeTextSize.addEventListener('input', () => {
    const box = activeFreeTextBoxObj();
    if (!box) return;
    box.size = Number(freeTextSize.value);
    freeTextSizeVal.textContent = `${box.size}px`;
    render();
  });
  freeTextColor.addEventListener('input', () => {
    const box = activeFreeTextBoxObj();
    if (box) { box.color = freeTextColor.value; render(); }
  });
  wireSegmented('freeTextHAlign', (val) => {
    const box = activeFreeTextBoxObj();
    if (box) { box.hAlign = val; render(); }
  });
  freeTextWidth.addEventListener('input', () => {
    const box = activeFreeTextBoxObj();
    if (!box) return;
    box.widthPct = Number(freeTextWidth.value) / 100;
    freeTextWidthVal.textContent = `${freeTextWidth.value}%`;
    render();
  });
  freeTextX.addEventListener('input', () => {
    const box = activeFreeTextBoxObj();
    if (!box) return;
    box.xPct = Number(freeTextX.value) / 100;
    freeTextXVal.textContent = `${freeTextX.value}%`;
    render();
  });
  freeTextY.addEventListener('input', () => {
    const box = activeFreeTextBoxObj();
    if (!box) return;
    box.yPct = Number(freeTextY.value) / 100;
    freeTextYVal.textContent = `${freeTextY.value}%`;
    render();
  });

  // snaps the box's left/right/top/bottom edge to the exact same
  // marginFrac/marginVFrac the logo (and the headline/subheader/other
  // block) are clamped to, so a text box lines up with them precisely --
  // the box's own wrap-width/height, not just its centre, so the edge
  // itself (not just the midpoint) lands on the margin
  document.getElementById('freeTextMarginSnap').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const box = activeFreeTextBoxObj();
    if (!box) return;
    const W = state.canvasW, H = state.canvasH;
    const edge = btn.dataset.val;
    if (edge === 'left') box.xPct = state.marginFrac + box.widthPct / 2;
    else if (edge === 'right') box.xPct = 1 - state.marginFrac - box.widthPct / 2;
    else if (edge === 'top' || edge === 'bottom') {
      const layout = freeTextBoxLayout(box, W, H);
      const halfHFrac = (layout.totalH / H) / 2;
      box.yPct = edge === 'top' ? state.marginVFrac + halfHFrac : 1 - state.marginVFrac - halfHFrac;
    }
    box.xPct = Math.min(1, Math.max(0, box.xPct));
    box.yPct = Math.min(1, Math.max(0, box.yPct));
    syncFreeTextPanelFromState();
    render();
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

  // maps a 0-100 "Grain size" slider to an actual particle size in px:
  // 1px (finest -- smooth per-pixel noise) up to 8px (coarse, chunky specks)
  function grainSizeValueToPx(value) {
    return 1 + Math.round((value / 100) * 7);
  }

  // builds noise at the exact target size (not a small tiled pattern) so the
  // mottling never visibly repeats, however large the export gets. Each of
  // the fade texture and the whole-image grain effect gets its own cache
  // (via makeNoiseLayerCache below), since they're typically drawn at
  // different sizes and grain sizes within the same render.
  function makeNoiseLayerCache() {
    let cached = null; // { key, canvas }
    return function getNoiseLayer(w, h, grainPx) {
      const key = `${w}x${h}x${grainPx}`;
      if (cached && cached.key === key) return cached.canvas;

      const layer = document.createElement('canvas');
      layer.width = w;
      layer.height = h;
      const nctx = layer.getContext('2d');

      // coarse mottling: low-res noise upscaled with smoothing across the
      // full target size, for soft organic blotches (like leather/paper).
      // Blotch size scales with grain size too -- bigger grain, bigger blotches.
      // The floor here (rather than a fixed ~15px minimum) is what lets the
      // slider's low end read as genuinely fine/subtle instead of still
      // showing soft blotches no matter how low it's turned down.
      const cellPx = 4 + grainPx * 4;
      const coarseW = Math.max(2, Math.round(w / cellPx));
      const coarseH = Math.max(2, Math.round(h / cellPx));
      const coarse = document.createElement('canvas');
      coarse.width = coarseW;
      coarse.height = coarseH;
      const cctx = coarse.getContext('2d');
      const cData = cctx.createImageData(coarseW, coarseH);
      for (let i = 0; i < cData.data.length; i += 4) {
        const v = Math.floor(Math.random() * 255);
        cData.data[i] = v; cData.data[i + 1] = v; cData.data[i + 2] = v; cData.data[i + 3] = 255;
      }
      cctx.putImageData(cData, 0, 0);
      nctx.imageSmoothingEnabled = true;
      nctx.globalAlpha = 0.22;
      nctx.drawImage(coarse, 0, 0, w, h);
      nctx.globalAlpha = 1;

      // fine grain speckle: generated at a reduced resolution (one noise
      // pixel per grainPx-sized block) and scaled up WITHOUT smoothing, so
      // each speck stays a crisp, chunky block at larger grain sizes instead
      // of blurring into the mottling -- that's what makes grain size read
      // as "coarse" rather than just "stronger". At grainPx=1 this is
      // ordinary smooth per-pixel noise.
      const speckleW = Math.max(1, Math.round(w / grainPx));
      const speckleH = Math.max(1, Math.round(h / grainPx));
      const fineSmall = document.createElement('canvas');
      fineSmall.width = speckleW;
      fineSmall.height = speckleH;
      const fsctx = fineSmall.getContext('2d');
      const fData = fsctx.createImageData(speckleW, speckleH);
      for (let i = 0; i < fData.data.length; i += 4) {
        const v = Math.random() < 0.5 ? 0 : 255;
        fData.data[i] = v; fData.data[i + 1] = v; fData.data[i + 2] = v;
        fData.data[i + 3] = Math.random() * 42;
      }
      fsctx.putImageData(fData, 0, 0);
      nctx.imageSmoothingEnabled = false;
      nctx.drawImage(fineSmall, 0, 0, w, h);
      nctx.imageSmoothingEnabled = true;

      cached = { key, canvas: layer };
      return layer;
    };
  }

  const getFadeNoiseLayer = makeNoiseLayerCache();
  const getEffectsNoiseLayer = makeNoiseLayerCache();
  const getTechOpticsNoiseLayer = makeNoiseLayerCache();
  const getFrontierNoiseLayer = makeNoiseLayerCache();

  function drawFade(W, H, fade) {
    const vertical = fade.direction === 'top' || fade.direction === 'bottom';
    const extent = vertical ? H : W;
    const scrim = extent * (fade.reach / 100);
    if (scrim <= 0) return;
    const plateauK = speedValueToPlateauK(fade.speed);
    const intensity = (typeof fade.intensity === 'number' ? fade.intensity : 100) / 100;
    const { r, g, b } = hexToRgb(fade.color);

    let outer, inner; // outer = transparent edge, inner = solid edge, along the fade's own axis
    if (fade.direction === 'bottom' || fade.direction === 'right') {
      outer = extent - scrim;
      inner = extent;
    } else {
      outer = scrim;
      inner = 0;
    }

    // the offscreen layer's pixel size has to be a whole number, but `scrim`
    // (a percentage of the canvas) almost never is -- rounding it down, as a
    // plain cast would, leaves the solid edge for 'bottom'/'right' up to ~1px
    // short of the canvas's own edge, showing a sliver of the white/photo
    // background underneath as a thin line. Using ceil() for the layer's
    // size and anchoring the draw position from the solid edge backward
    // (rather than from the transparent edge forward) guarantees that solid
    // edge always lands exactly on the canvas boundary; drawPos replaces the
    // old rectStart for both the draw position and the gradient's local
    // coordinates, which absorb the sub-pixel difference on the transparent
    // end instead, where it's imperceptible against near-zero alpha anyway.
    const scrimPx = Math.ceil(scrim);
    const drawPos = (fade.direction === 'bottom' || fade.direction === 'right') ? extent - scrimPx : 0;

    // build the gradient on its own transparent layer first (rather than
    // straight onto the already-opaque photo) so an optional texture pass
    // can key off the gradient's *own* alpha and taper with it exactly --
    // compositing over an opaque photo would flatten every pixel's alpha
    // to 1, breaking that falloff.
    const layer = document.createElement('canvas');
    layer.width = vertical ? W : scrimPx;
    layer.height = vertical ? scrimPx : H;
    const lctx = layer.getContext('2d');

    const grad = vertical
      ? lctx.createLinearGradient(0, outer - drawPos, 0, inner - drawPos)
      : lctx.createLinearGradient(outer - drawPos, 0, inner - drawPos, 0);
    const steps = 48;
    for (let s = 0; s <= steps; s++) {
      const frac = s / steps;
      const alpha = fadeAlphaAt(frac, plateauK) * intensity;
      grad.addColorStop(frac, `rgba(${r},${g},${b},${alpha})`);
    }
    lctx.fillStyle = grad;
    lctx.fillRect(0, 0, layer.width, layer.height);

    if (fade.textured) {
      const grainPx = grainSizeValueToPx(typeof fade.textureGrainSize === 'number' ? fade.textureGrainSize : 25);
      lctx.globalCompositeOperation = 'source-atop';
      lctx.globalAlpha = (typeof fade.textureIntensity === 'number' ? fade.textureIntensity : 100) / 100;
      lctx.drawImage(getFadeNoiseLayer(layer.width, layer.height, grainPx), 0, 0);
      lctx.globalAlpha = 1;
    }

    if (vertical) ctx.drawImage(layer, 0, drawPos);
    else ctx.drawImage(layer, drawPos, 0);
  }

  // ---------- Fuji-inspired film-stock colour grade ----------
  // Per-channel tone curves (lifted/faded blacks, soft highlight roll-off) plus a
  // teal-shadow / amber-highlight split tone -- the classic Fujifilm colour-science
  // recipe: raise the black point so shadows fade to grey rather than crush to
  // pure black, gently compress the highlights instead of clipping to white, bias
  // shadows cool/teal and highlights warm/amber, and mute the overall saturation
  // a touch (closer to Fujifilm's muted, deep-green "Classic Chrome" rendering
  // than to a punchy digital default).
  const FILM_STOCK_CURVES = {
    fuji: {
      r: [[0, 0.035], [0.25, 0.24], [0.5, 0.50], [0.75, 0.76], [1, 0.965]],
      g: [[0, 0.03], [0.25, 0.225], [0.5, 0.485], [0.75, 0.75], [1, 0.95]],
      b: [[0, 0.06], [0.25, 0.245], [0.5, 0.49], [0.75, 0.72], [1, 0.90]],
      desaturate: 0.14, // 0-1, blend fraction toward luminance
    },
  };

  function buildCurveLut(points) {
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      const x = i / 255;
      let p0 = points[0], p1 = points[points.length - 1];
      for (let j = 0; j < points.length - 1; j++) {
        if (x >= points[j][0] && x <= points[j + 1][0]) { p0 = points[j]; p1 = points[j + 1]; break; }
      }
      const span = p1[0] - p0[0];
      const t = span > 0 ? (x - p0[0]) / span : 0;
      lut[i] = Math.round((p0[1] + (p1[1] - p0[1]) * t) * 255);
    }
    return lut;
  }

  let filmStockLutCache = null; // { key, lutR, lutG, lutB, desaturate }
  function getFilmStockLuts(key) {
    if (filmStockLutCache && filmStockLutCache.key === key) return filmStockLutCache;
    const curves = FILM_STOCK_CURVES[key];
    filmStockLutCache = {
      key,
      lutR: buildCurveLut(curves.r),
      lutG: buildCurveLut(curves.g),
      lutB: buildCurveLut(curves.b),
      desaturate: curves.desaturate,
    };
    return filmStockLutCache;
  }

  function applyFilmStock(W, H, effects) {
    const key = effects.filmStock;
    if (!key || key === 'none' || !FILM_STOCK_CURVES[key]) return;
    const amount = (typeof effects.filmStockIntensity === 'number' ? effects.filmStockIntensity : 70) / 100;
    if (amount <= 0) return;

    const { lutR, lutG, lutB, desaturate } = getFilmStockLuts(key);
    const imageData = ctx.getImageData(0, 0, W, H);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const r0 = d[i], g0 = d[i + 1], b0 = d[i + 2];
      let r = lutR[r0], g = lutG[g0], b = lutB[b0];
      if (desaturate > 0) {
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        r += (lum - r) * desaturate;
        g += (lum - g) * desaturate;
        b += (lum - b) * desaturate;
      }
      d[i] = r0 + (r - r0) * amount;
      d[i + 1] = g0 + (g - g0) * amount;
      d[i + 2] = b0 + (b - b0) * amount;
    }
    ctx.putImageData(imageData, 0, 0);
  }

  // ---------- "Tech Optics" -- a stylised late-'90s classified-hardware grade ----------
  // Crushed blacks + cold steel/silver split toning, chromatic aberration that
  // strengthens toward the frame edges, a chrome specular bloom on the
  // brightest highlights, fine grain, a cool anamorphic flare, a vignette, and
  // an optional corner-bracket/grid/spec-text HUD overlay. All pixel-space
  // constants are defined against a 1080px-wide reference and scaled by the
  // actual render width, matching how text-layer sizing already works, so the
  // look stays consistent between the live preview and a hi-res export.
  const TECH_OPTICS_PRESET = {
    contrast: 1.35,
    brightness: 0.95,
    crushThreshold: 0.08, // luminance below this fades toward black
    desaturate: 0.25,
    shadowColor: [0x1c, 0x2a, 0x3a],   // steel blue
    highlightColor: [0xdd, 0xe6, 0xee], // cold silver
    splitStrength: 0.55,
    aberrationPx: 2.5, // channel offset at the frame's horizontal edge
    bloomThreshold: 0.8,
    bloomBlurPx: 8,
    bloomOpacity: 0.35,
    grainOpacity: 0.08,
    flareOpacity: 0.25,
    vignetteOpacity: 0.4,
  };

  function techOpticsGradePixel(r0, g0, b0, preset) {
    let r = (r0 / 255 - 0.5) * preset.contrast + 0.5;
    let g = (g0 / 255 - 0.5) * preset.contrast + 0.5;
    let b = (b0 / 255 - 0.5) * preset.contrast + 0.5;
    r *= preset.brightness; g *= preset.brightness; b *= preset.brightness;

    const lum1 = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum1 < preset.crushThreshold && preset.crushThreshold > 0) {
      const k = Math.max(0, lum1 / preset.crushThreshold);
      const scale = k * k; // push shadow detail toward true black
      r *= scale; g *= scale; b *= scale;
    }

    const lum2 = 0.299 * r + 0.587 * g + 0.114 * b;
    r += (lum2 - r) * preset.desaturate;
    g += (lum2 - g) * preset.desaturate;
    b += (lum2 - b) * preset.desaturate;

    const lum3 = 0.299 * r + 0.587 * g + 0.114 * b;
    const shadowW = Math.max(0, Math.min(1, (0.35 - lum3) / 0.35)) * preset.splitStrength;
    const highlightW = Math.max(0, Math.min(1, (lum3 - 0.65) / 0.35)) * preset.splitStrength;
    if (shadowW > 0) {
      r += (preset.shadowColor[0] / 255 - r) * shadowW;
      g += (preset.shadowColor[1] / 255 - g) * shadowW;
      b += (preset.shadowColor[2] / 255 - b) * shadowW;
    }
    if (highlightW > 0) {
      r += (preset.highlightColor[0] / 255 - r) * highlightW;
      g += (preset.highlightColor[1] / 255 - g) * highlightW;
      b += (preset.highlightColor[2] / 255 - b) * highlightW;
    }
    return [r * 255, g * 255, b * 255];
  }

  // base colour grade only (contrast/crush/desaturate/split-tone) -- no
  // neighbour-pixel sampling needed, so this is a single pass.
  function applyTechOpticsGrade(W, H, preset, amount) {
    const imageData = ctx.getImageData(0, 0, W, H);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const [r, g, b] = techOpticsGradePixel(d[i], d[i + 1], d[i + 2], preset);
      d[i] = d[i] + (r - d[i]) * amount;
      d[i + 1] = d[i + 1] + (g - d[i + 1]) * amount;
      d[i + 2] = d[i + 2] + (b - d[i + 2]) * amount;
    }
    ctx.putImageData(imageData, 0, 0);
  }

  // chromatic aberration: shifts the red/blue channels apart horizontally,
  // more strongly toward the frame's edges. Run as its own pass (after the
  // grade, if that's also on) so it can be toggled independently -- it reads
  // from a snapshot and shifts using that same snapshot's neighbouring
  // pixels, then blends the shifted result against the pre-shift image by
  // `amount`.
  function applyTechOpticsAberration(W, H, preset, amount) {
    const src = ctx.getImageData(0, 0, W, H);
    const sd = src.data;
    const out = ctx.createImageData(W, H);
    const od = out.data;
    const halfW = W / 2;
    for (let y = 0; y < H; y++) {
      const rowBase = y * W * 4;
      for (let x = 0; x < W; x++) {
        const i = rowBase + x * 4;
        const edgeFrac = halfW > 0 ? Math.abs(x - halfW) / halfW : 0;
        const off = Math.round(preset.aberrationPx * edgeFrac);
        const ri = rowBase + Math.max(0, Math.min(W - 1, x - off)) * 4;
        const bi = rowBase + Math.max(0, Math.min(W - 1, x + off)) * 4;
        od[i] = sd[i] + (sd[ri] - sd[i]) * amount;
        od[i + 1] = sd[i + 1];
        od[i + 2] = sd[i + 2] + (sd[bi + 2] - sd[i + 2]) * amount;
        od[i + 3] = sd[i + 3];
      }
    }
    ctx.putImageData(out, 0, 0);
  }

  function applyTechOpticsBloom(W, H, preset, amount, scale) {
    const bloom = document.createElement('canvas');
    bloom.width = W; bloom.height = H;
    const bctx = bloom.getContext('2d');
    bctx.drawImage(ctx.canvas, 0, 0); // ctx.canvas, not the module-level `canvas` -- this must track whatever ctx currently points at (the offscreen hi-res canvas during export)
    const bd = bctx.getImageData(0, 0, W, H);
    const d = bd.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      const w = Math.max(0, Math.min(1, (lum - preset.bloomThreshold) / (1 - preset.bloomThreshold)));
      d[i + 3] = d[i + 3] * w;
    }
    bctx.putImageData(bd, 0, 0);

    ctx.save();
    ctx.filter = `blur(${preset.bloomBlurPx * scale}px)`;
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = preset.bloomOpacity * amount;
    ctx.drawImage(bloom, 0, 0);
    ctx.restore();
  }

  function applyTechOpticsGrain(W, H, preset, amount, scale) {
    const grainPx = Math.max(1, Math.round(scale));
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = preset.grainOpacity * amount;
    ctx.drawImage(getTechOpticsNoiseLayer(W, H, grainPx), 0, 0);
    ctx.restore();
  }

  function applyTechOpticsFlare(W, H, preset, amount, scale) {
    const y = H * 0.22;
    const thickness = 3 * scale;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = preset.flareOpacity * amount;

    const streak = ctx.createLinearGradient(0, y, W, y);
    streak.addColorStop(0, 'rgba(175,216,255,0)');
    streak.addColorStop(0.5, 'rgba(175,216,255,0.9)');
    streak.addColorStop(1, 'rgba(175,216,255,0)');
    ctx.fillStyle = streak;
    ctx.fillRect(0, y - thickness / 2, W, thickness);

    const hotX = W * 0.68, hotR = 40 * scale;
    const hot = ctx.createRadialGradient(hotX, y, 0, hotX, y, hotR);
    hot.addColorStop(0, 'rgba(210,235,255,0.9)');
    hot.addColorStop(1, 'rgba(210,235,255,0)');
    ctx.fillStyle = hot;
    ctx.beginPath();
    ctx.arc(hotX, y, hotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function applyTechOpticsVignette(W, H, preset, amount) {
    const cx = W / 2, cy = H / 2;
    const outerR = Math.sqrt(cx * cx + cy * cy);
    const grad = ctx.createRadialGradient(cx, cy, outerR * 0.5, cx, cy, outerR);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, `rgba(0,0,0,${preset.vignetteOpacity * amount})`);
    ctx.save();
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  function applyTechOpticsHud(W, H, effects, scale) {
    const pad = 24 * scale;
    const bracketLen = 22 * scale;
    const color = 'rgba(210,230,245,0.55)';

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, 1.5 * scale);
    const corners = [
      { x: pad, y: pad, dx: 1, dy: 1 },
      { x: W - pad, y: pad, dx: -1, dy: 1 },
      { x: pad, y: H - pad, dx: 1, dy: -1 },
      { x: W - pad, y: H - pad, dx: -1, dy: -1 },
    ];
    ctx.beginPath();
    for (const c of corners) {
      ctx.moveTo(c.x + bracketLen * c.dx, c.y);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(c.x, c.y + bracketLen * c.dy);
    }
    ctx.stroke();

    ctx.globalAlpha = 0.08;
    ctx.lineWidth = Math.max(1, scale);
    ctx.beginPath();
    for (let i = 1; i < 4; i++) {
      const x = (W / 4) * i;
      ctx.moveTo(x, 0); ctx.lineTo(x, H);
    }
    for (let i = 1; i < 4; i++) {
      const y = (H / 4) * i;
      ctx.moveTo(0, y); ctx.lineTo(W, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    const text = (effects.techOpticsHudText || '').trim();
    if (text) {
      const fontPx = Math.max(9, 11 * scale);
      ctx.font = `${fontPx}px ui-monospace, "SF Mono", "Courier New", monospace`;
      ctx.fillStyle = 'rgba(210,230,245,0.8)';
      ctx.textBaseline = 'bottom';
      ctx.textAlign = 'left';
      ctx.fillText(text.toUpperCase(), pad, H - pad - bracketLen - 6 * scale);
    }
    ctx.restore();
  }

  function applyTechOptics(W, H, effects) {
    if (effects.filmStock !== 'techOptics') return;
    const amount = (typeof effects.filmStockIntensity === 'number' ? effects.filmStockIntensity : 70) / 100;
    if (amount <= 0) return;
    const scale = W / 1080; // reference width, matches text-layer sizing convention
    const preset = TECH_OPTICS_PRESET;

    applyTechOpticsGrade(W, H, preset, amount);
    if (effects.techOpticsAberration) applyTechOpticsAberration(W, H, preset, amount);
    if (effects.techOpticsBloom) applyTechOpticsBloom(W, H, preset, amount, scale);
    if (effects.techOpticsGrain) applyTechOpticsGrain(W, H, preset, amount, scale);
    if (effects.techOpticsFlare) applyTechOpticsFlare(W, H, preset, amount, scale);
    if (effects.techOpticsVignette) applyTechOpticsVignette(W, H, preset, amount);
    if (effects.techOpticsHud) applyTechOpticsHud(W, H, effects, scale);
  }

  // ---------- "Frontier" -- a warm, sun-baked vintage-western advertising grade ----------
  // Golden-hour white balance, selective colour (warm reds punched up, greens
  // pushed toward olive and desaturated, blues pushed toward a desaturated
  // teal-grey), a faded-matte tone curve, a brown-shadow/cream-highlight split
  // tone, red-orange halation off the highlights, warm grain, a soft haze +
  // dust drifting down from the top, an optional corner sun flare, and a
  // wide warm-tinted vignette. Same 1080px-reference pixel scaling
  // convention as Tech Optics, for the same reason (consistent look between
  // the live preview and a hi-res export).
  const FRONTIER_PRESET = {
    warmShift: 18,      // 0-255-ish additive warm (R up / B down) shift
    magentaShift: 5,    // additive magenta tint (R+B up a touch, G down)
    redSatBoost: 0.25, redLumCut: 0.05,
    greenHueShiftDeg: -15, greenSatCut: 0.30,
    blueSatCut: 0.35, blueTealPull: 0.25,
    blackLift: 0.06, highlightRolloff: 0.90,
    shadowColor: [0x2b, 0x1a, 0x10], shadowStrength: 0.30,
    highlightColor: [0xf3, 0xd9, 0xa4], highlightStrength: 0.25,
    halationColor: [0xd2, 0x45, 0x2b], halationThreshold: 0.85, halationBlurPx: 16, halationOpacity: 0.20,
    grainOpacity: 0.10,
    hazeOpacity: 0.13, hazeColor: 'rgba(243,217,164,OPACITY)', dustColor: [243, 227, 195],
    flareColor: 'rgba(255,194,122,OPACITY)', flareOpacity: 0.20,
    vignetteColor: [0x1e, 0x12, 0x0a], vignetteOpacity: 0.30,
  };

  function rgbToHsl(r, g, b) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    const d = max - min;
    if (d > 0) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    return [h, s, l];
  }

  function hslToRgb(h, s, l) {
    if (s === 0) return [l, l, l];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue2rgb = (t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [hue2rgb(h + 1 / 3), hue2rgb(h), hue2rgb(h - 1 / 3)];
  }

  function frontierGradePixel(r0, g0, b0, preset) {
    // white balance
    let r = r0 + preset.warmShift + preset.magentaShift;
    let g = g0 - preset.magentaShift * 0.6;
    let b = b0 - preset.warmShift + preset.magentaShift * 0.5;

    // selective colour, in HSL
    let [h, s, l] = rgbToHsl(Math.max(0, Math.min(255, r)) / 255, Math.max(0, Math.min(255, g)) / 255, Math.max(0, Math.min(255, b)) / 255);
    const hueDeg = h * 360;
    if (hueDeg < 45 || hueDeg >= 330) { // reds/oranges
      s = Math.min(1, s * (1 + preset.redSatBoost));
      l = Math.max(0, l - preset.redLumCut);
    } else if (hueDeg >= 70 && hueDeg < 170) { // greens
      h = (h + preset.greenHueShiftDeg / 360 + 1) % 1;
      s = s * (1 - preset.greenSatCut);
    } else if (hueDeg >= 170 && hueDeg < 260) { // blues/cyans
      s = s * (1 - preset.blueSatCut);
      const teal = 190 / 360;
      h = h + (teal - h) * preset.blueTealPull;
    }
    [r, g, b] = hslToRgb(h, s, l).map((v) => v * 255);

    // tone curve: lift blacks, soft-roll the highlights
    const toCurve = (v) => {
      let x = v / 255;
      x = preset.blackLift + x * (1 - preset.blackLift); // lifted black point
      if (x > preset.highlightRolloff) {
        const over = (x - preset.highlightRolloff) / (1 - preset.highlightRolloff);
        x = preset.highlightRolloff + (1 - preset.highlightRolloff) * (1 - Math.pow(1 - over, 2));
      }
      return x * 255;
    };
    r = toCurve(r); g = toCurve(g); b = toCurve(b);

    // split tone, weighted slightly toward the highlights
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const shadowW = Math.max(0, Math.min(1, (0.4 - lum) / 0.4)) * preset.shadowStrength;
    const highlightW = Math.max(0, Math.min(1, (lum - 0.55) / 0.45)) * preset.highlightStrength;
    if (shadowW > 0) {
      r += (preset.shadowColor[0] - r) * shadowW;
      g += (preset.shadowColor[1] - g) * shadowW;
      b += (preset.shadowColor[2] - b) * shadowW;
    }
    if (highlightW > 0) {
      r += (preset.highlightColor[0] - r) * highlightW;
      g += (preset.highlightColor[1] - g) * highlightW;
      b += (preset.highlightColor[2] - b) * highlightW;
    }
    return [r, g, b];
  }

  function applyFrontierGrade(W, H, preset, amount) {
    const imageData = ctx.getImageData(0, 0, W, H);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const [r, g, b] = frontierGradePixel(d[i], d[i + 1], d[i + 2], preset);
      d[i] = d[i] + (r - d[i]) * amount;
      d[i + 1] = d[i + 1] + (g - d[i + 1]) * amount;
      d[i + 2] = d[i + 2] + (b - d[i + 2]) * amount;
    }
    ctx.putImageData(imageData, 0, 0);
  }

  function applyFrontierHalation(W, H, preset, amount, scale) {
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const octx = off.getContext('2d');
    octx.drawImage(ctx.canvas, 0, 0);
    const id = octx.getImageData(0, 0, W, H);
    const d = id.data;
    const [tr, tg, tb] = preset.halationColor;
    for (let i = 0; i < d.length; i += 4) {
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      const w = Math.max(0, Math.min(1, (lum - preset.halationThreshold) / (1 - preset.halationThreshold)));
      d[i] = tr; d[i + 1] = tg; d[i + 2] = tb; d[i + 3] = 255 * w;
    }
    octx.putImageData(id, 0, 0);

    ctx.save();
    ctx.filter = `blur(${preset.halationBlurPx * scale}px)`;
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = preset.halationOpacity * amount;
    ctx.drawImage(off, 0, 0);
    ctx.restore();
  }

  function applyFrontierGrain(W, H, preset, amount, scale) {
    const grainPx = Math.max(1, Math.round(2 * scale)); // 35mm-ish, slightly coarser than Tech Optics' fine grain
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = preset.grainOpacity * amount;
    ctx.drawImage(getFrontierNoiseLayer(W, H, grainPx), 0, 0);
    ctx.restore();
  }

  let frontierDustLayerCache = null; // { key, canvas } -- cached so specks don't re-randomise (flicker) on every render() call
  function getFrontierDustLayer(W, H, preset) {
    const key = `${W}x${H}`;
    if (frontierDustLayerCache && frontierDustLayerCache.key === key) return frontierDustLayerCache.canvas;
    const layer = document.createElement('canvas');
    layer.width = W; layer.height = H;
    const lctx = layer.getContext('2d');
    const [dr, dg, db] = preset.dustColor;
    const count = Math.max(20, Math.round((W * H) / 9000));
    for (let i = 0; i < count; i++) {
      const x = Math.random() * W, y = Math.random() * H;
      const r = (0.4 + Math.random() * 1.4) * (W / 1080);
      lctx.beginPath();
      lctx.fillStyle = `rgba(${dr},${dg},${db},${(0.15 + Math.random() * 0.25).toFixed(3)})`;
      lctx.arc(x, y, r, 0, Math.PI * 2);
      lctx.fill();
    }
    frontierDustLayerCache = { key, canvas: layer };
    return layer;
  }

  function applyFrontierHaze(W, H, preset, amount) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = preset.hazeOpacity * amount;
    const grad = ctx.createLinearGradient(0, 0, 0, H * 0.55);
    grad.addColorStop(0, preset.hazeColor.replace('OPACITY', '0.9'));
    grad.addColorStop(1, preset.hazeColor.replace('OPACITY', '0'));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H * 0.55);
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.6 * amount;
    ctx.drawImage(getFrontierDustLayer(W, H, preset), 0, 0);
    ctx.restore();
  }

  function applyFrontierFlare(W, H, preset, amount) {
    const cx = W * 0.85, cy = H * 0.12, r = W * 0.35;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, preset.flareColor.replace('OPACITY', '0.9'));
    grad.addColorStop(1, preset.flareColor.replace('OPACITY', '0'));
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = preset.flareOpacity * amount;
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  function applyFrontierVignette(W, H, preset, amount) {
    const cx = W / 2, cy = H / 2;
    const outerR = Math.sqrt(cx * cx + cy * cy);
    const [vr, vg, vb] = preset.vignetteColor;
    const grad = ctx.createRadialGradient(cx, cy, outerR * 0.6, cx, cy, outerR); // wide feather: starts further out than Tech Optics' vignette
    grad.addColorStop(0, `rgba(${vr},${vg},${vb},0)`);
    grad.addColorStop(1, `rgba(${vr},${vg},${vb},${preset.vignetteOpacity * amount})`);
    ctx.save();
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  function applyFrontier(W, H, effects) {
    if (effects.filmStock !== 'frontier') return;
    const amount = (typeof effects.filmStockIntensity === 'number' ? effects.filmStockIntensity : 70) / 100;
    if (amount <= 0) return;
    const scale = W / 1080;
    const preset = FRONTIER_PRESET;

    applyFrontierGrade(W, H, preset, amount);
    if (effects.frontierHalation) applyFrontierHalation(W, H, preset, amount, scale);
    if (effects.frontierGrain) applyFrontierGrain(W, H, preset, amount, scale);
    if (effects.frontierHaze) applyFrontierHaze(W, H, preset, amount);
    if (effects.frontierFlare) applyFrontierFlare(W, H, preset, amount);
    if (effects.frontierVignette) applyFrontierVignette(W, H, preset, amount);
  }

  // ---------- whole-composite effects (Effects tab): film stock, warmth, vignette, grain ----------

  function drawEffects(W, H, effects) {
    applyFilmStock(W, H, effects);
    applyTechOptics(W, H, effects);
    applyFrontier(W, H, effects);
    if (effects.warmth > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'soft-light';
      ctx.globalAlpha = effects.warmth / 100;
      ctx.fillStyle = 'rgb(255,175,90)';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    if (effects.vignette > 0) {
      const cx = W / 2, cy = H / 2;
      const outerR = Math.sqrt(cx * cx + cy * cy);
      const grad = ctx.createRadialGradient(cx, cy, outerR * 0.5, cx, cy, outerR);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, `rgba(0,0,0,${(effects.vignette / 100) * 0.7})`);
      ctx.save();
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    if (effects.grain > 0) {
      const grainPx = grainSizeValueToPx(typeof effects.grainSize === 'number' ? effects.grainSize : 25);
      ctx.save();
      ctx.globalAlpha = (effects.grain / 100) * 0.9;
      ctx.drawImage(getEffectsNoiseLayer(W, H, grainPx), 0, 0);
      ctx.restore();
    }
  }

  // ---------- text drawing ----------

  function fontCss(layer, sizePx) {
    const f = FONTS.find(f => f.id === layer.font) || FONTS[0];
    // only free text boxes carry a `bold` field -- the headline/subheader/
    // other layers never do, so `layer.bold === false` is never true for
    // them and they keep rendering at the font's normal (bold) weight
    const weight = layer.bold === false ? (f.weightRegular || 400) : f.weight;
    return `${weight} ${sizePx}px ${f.css}`;
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
      .filter(l => l.key === 'headline' ? l.text.trim().length > 0 : (l.enabled && l.text.trim().length > 0));
  }

  function buildTextBlock(W, H) {
    const margin = W * state.marginFrac;
    const maxWidth = W - margin * 2;
    const layerGap = H * 0.015;
    const lineGapFactor = 1.18;

    const layers = getActiveLayers();
    const built = [];
    let totalHeight = 0;
    let maxLineWidth = 0; // widest single line across all layers -- the block's actual (tighter than maxWidth) footprint, used for alignment guides

    layers.forEach((l, idx) => {
      const sizePx = (l.size / 1080) * W; // scale relative to a 1080-wide reference so it's consistent across presets
      const lines = wrapText(l.text, maxWidth, sizePx, l);
      // ctx.font is already set to this layer's font/size by wrapText, above
      lines.forEach((line) => { maxLineWidth = Math.max(maxLineWidth, ctx.measureText(line).width); });
      const lineHeight = sizePx * lineGapFactor;
      const blockH = lines.length * lineHeight;
      built.push({ ...l, sizePx, lines, lineHeight, blockH });
      totalHeight += blockH;
      if (idx < layers.length - 1) totalHeight += layerGap;
    });

    return { built, totalHeight, margin, maxWidth, layerGap, maxLineWidth };
  }

  // computes everything about the text block's current position -- shared by
  // drawTextBlock (rendering), the pointerdown hit-test, and the pointermove
  // drag handler, so all three always agree on where the block actually is.
  //
  // "vertical" rotates the whole block 90° so it reads top-to-bottom;
  // "vertical-flipped" rotates it -90° the other way, for bottom-to-top.
  // Rather than reimplementing wrapping/layout for a vertical writing mode,
  // this builds the exact same block as normal in a "logical" space with
  // width and height swapped (so wrapping is constrained by the canvas's
  // *height*, which becomes the block's on-screen width once rotated), then
  // (in drawTextBlock) draws it through a rotation transform about the
  // canvas centre.
  //
  // vAlign (0-100) is the block's position along its own stacking direction
  // -- screen-vertical when horizontal, screen-horizontal once rotated.
  // crossAlign (0-100) is its position along the other, cross axis -- the
  // one hAlign's left/center/right buttons used to only offer 3 fixed stops
  // for; now continuous (and draggable) for both orientations, with hAlign
  // left purely as which way each line's text visually aligns.
  function computeTextLayout(W, H) {
    if (!state.text.enabled) return null; // master toggle off -- whole block (headline included) hidden and undraggable
    const orientation = state.text.orientation || 'horizontal';
    const vertical = orientation !== 'horizontal';
    const effW = vertical ? H : W, effH = vertical ? W : H;

    const { built, totalHeight, margin, maxLineWidth } = buildTextBlock(effW, effH);
    if (built.length === 0) return null;

    const vPad = effH * state.marginVFrac;
    const topmostY = vPad;
    const bottommostY = effH - vPad - totalHeight;
    const startY = topmostY + (bottommostY - topmostY) * (state.text.vAlign / 100);

    const leftmostX = margin, rightmostX = effW - margin;
    const crossFrac = (typeof state.text.crossAlign === 'number' ? state.text.crossAlign : 50) / 100;
    // 0=screen-top/left .. 100=screen-bottom/right; which way that maps onto
    // local x depends on the rotation direction for vertical orientations
    const x = orientation === 'vertical-flipped'
      ? rightmostX + (leftmostX - rightmostX) * crossFrac
      : leftmostX + (rightmostX - leftmostX) * crossFrac;

    return { orientation, vertical, effW, effH, built, totalHeight, margin, maxLineWidth, topmostY, bottommostY, startY, leftmostX, rightmostX, x };
  }

  // the block's real-canvas-space bounding rect {left,right,top,bottom} --
  // used for alignment guides and the drag hit-test. Uses the widest actual
  // rendered line (maxLineWidth), not the full wrap
  // width, so it's a tight fit rather than a conservative full-axis band.
  function computeTextBoundsFromLayout(W, H, layout) {
    const { orientation, vertical, totalHeight, maxLineWidth, startY, x } = layout;
    if (!vertical) {
      let left, right;
      if (state.text.hAlign === 'left') { left = x; right = x + maxLineWidth; }
      else if (state.text.hAlign === 'right') { left = x - maxLineWidth; right = x; }
      else { left = x - maxLineWidth / 2; right = x + maxLineWidth / 2; }
      return { top: startY, bottom: startY + totalHeight, left, right };
    }
    // rotated ±90° about the canvas centre: the block's local stacking span
    // [startY, startY+totalHeight] maps onto a vertical band of x in real
    // canvas space, and the (centred) cross-axis span around `x` maps onto
    // a band of y -- see the rotation matrices in the comment above `x` in
    // computeTextLayout.
    const bandNear = orientation === 'vertical-flipped' ? startY : W - startY - totalHeight;
    const halfLine = maxLineWidth / 2;
    return {
      top: orientation === 'vertical-flipped' ? H - x - halfLine : x - halfLine,
      bottom: orientation === 'vertical-flipped' ? H - x + halfLine : x + halfLine,
      left: bandNear,
      right: bandNear + totalHeight,
    };
  }

  function drawTextBlock(W, H) {
    const layout = computeTextLayout(W, H);
    if (!layout) return null;
    const { orientation, vertical, effW, effH, built, startY, x } = layout;

    ctx.textAlign = vertical ? 'center' : (state.text.hAlign || 'center');

    ctx.save();
    if (vertical) {
      const angle = orientation === 'vertical-flipped' ? -Math.PI / 2 : Math.PI / 2;
      ctx.translate(W / 2, H / 2);
      ctx.rotate(angle);
      ctx.translate(-effW / 2, -effH / 2);
    }

    let y = startY;
    const layerGap = effH * 0.015;

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
    ctx.restore();

    return computeTextBoundsFromLayout(W, H, layout);
  }

  // ---------- logo drawing ----------

  // half-width/height of the logo's on-screen (post-rotation) bounding box,
  // as fractions of the canvas -- a 90/270 rotation swaps which of the
  // image's natural dimensions drives width vs height on screen
  function logoHalfFracs() {
    const sizeFrac = state.logo.sizePct / 100;
    const rawAspect = state.logo.img ? state.logo.img.naturalHeight / state.logo.img.naturalWidth : 1;
    const swapped = state.logo.rotation === 90 || state.logo.rotation === 270;
    const halfW = (swapped ? sizeFrac * rawAspect : sizeFrac) / 2;
    const halfH = ((swapped ? sizeFrac : sizeFrac * rawAspect) / 2) * (state.canvasW / state.canvasH);
    return { halfW, halfH };
  }

  function applyLogoCorner(corner) {
    const margin = state.marginFrac;
    const marginV = state.marginVFrac;
    const { halfW, halfH } = logoHalfFracs();

    if (corner === 'top-left') { state.logo.xPct = margin + halfW; state.logo.yPct = marginV + halfH; }
    else if (corner === 'top-right') { state.logo.xPct = 1 - margin - halfW; state.logo.yPct = marginV + halfH; }
    else if (corner === 'bottom-left') { state.logo.xPct = margin + halfW; state.logo.yPct = 1 - marginV - halfH; }
    else if (corner === 'bottom-right') { state.logo.xPct = 1 - margin - halfW; state.logo.yPct = 1 - marginV - halfH; }
    else { state.logo.xPct = 0.5; state.logo.yPct = 0.5; } // 'center'

    // safety net: guarantees every preset (including a logo too big for its
    // corner) still respects the same margin the text block uses
    const clamped = clampLogoPosition(state.logo.xPct, state.logo.yPct);
    state.logo.xPct = clamped.xPct;
    state.logo.yPct = clamped.yPct;
  }

  // clamp the logo's center x so its left/right edges never cross the same
  // margin used by the text block, at any logo size
  function getLogoBounds() {
    const { halfW, halfH } = logoHalfFracs();
    return {
      minX: state.marginFrac + halfW,
      maxX: 1 - state.marginFrac - halfW,
      minY: state.marginVFrac + halfH,
      maxY: 1 - state.marginVFrac - halfH,
    };
  }

  function clampLogoPosition(xPct, yPct) {
    const { minX, maxX, minY, maxY } = getLogoBounds();
    const clampedX = minX <= maxX ? Math.min(maxX, Math.max(minX, xPct)) : 0.5;
    const clampedY = minY <= maxY ? Math.min(maxY, Math.max(minY, yPct)) : 0.5;
    return { xPct: clampedX, yPct: clampedY };
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
    // baseW/baseH are the logo's own dimensions before rotation (what it's
    // actually drawn at); w/h are the on-screen bounding box after rotation,
    // swapped from base for a 90/270 turn -- used for hit-testing, margin
    // clamping and alignment guides, which only care about the box it occupies
    const baseW = (state.logo.sizePct / 100) * W;
    const baseH = baseW * (state.logo.img.naturalHeight / state.logo.img.naturalWidth);
    const swapped = state.logo.rotation === 90 || state.logo.rotation === 270;
    const w = swapped ? baseH : baseW;
    const h = swapped ? baseW : baseH;
    const cx = state.logo.xPct * W;
    const cy = state.logo.yPct * H;
    return { x: cx - w / 2, y: cy - h / 2, w, h, baseW, baseH };
  }

  // caches the last tinted version of the logo so we don't re-tint every frame
  let tintCache = { img: null, color: null, canvas: null };

  function getTintedLogo(img, color) {
    if (tintCache.img === img && tintCache.color === color) return tintCache.canvas;
    const off = document.createElement('canvas');
    off.width = img.naturalWidth;
    off.height = img.naturalHeight;
    const octx = off.getContext('2d');
    octx.drawImage(img, 0, 0);
    // source-in keeps the logo's existing alpha as a mask and replaces the
    // colour underneath it -- this only works well for a flat/silhouette
    // logo, since any original colour variation is discarded
    octx.globalCompositeOperation = 'source-in';
    octx.fillStyle = color;
    octx.fillRect(0, 0, off.width, off.height);
    tintCache = { img, color, canvas: off };
    return off;
  }

  function drawLogo(W, H) {
    if (!state.logo.img) return;
    const r = logoRect(W, H);
    let source = state.logo.img;
    if (state.logo.colorMode === 'fade') source = getTintedLogo(state.logo.img, state.fade.color);
    else if (state.logo.colorMode === 'custom') source = getTintedLogo(state.logo.img, state.logo.customColor);
    ctx.save();
    ctx.translate(state.logo.xPct * W, state.logo.yPct * H);
    if (state.logo.rotation) ctx.rotate((state.logo.rotation * Math.PI) / 180);
    ctx.scale(state.logo.flipH ? -1 : 1, state.logo.flipV ? -1 : 1);
    ctx.drawImage(source, -r.baseW / 2, -r.baseH / 2, r.baseW, r.baseH);
    ctx.restore();
  }

  // ---------- 5-star rating icon ----------

  // half-width/height of the star row's bounding box, as fractions of the
  // canvas -- same role as logoHalfFracs, for margin clamping and corner
  // presets. The row is always 5 squarish star slots side by side, so its
  // height (in canvas px) is a fifth of its width, adjusted for the
  // canvas's own aspect ratio the same way logoHalfFracs does.
  function starsHalfFracs() {
    const sizeFrac = state.stars.sizePct / 100;
    const halfW = sizeFrac / 2;
    const halfH = (sizeFrac / 5 / 2) * (state.canvasW / state.canvasH);
    return { halfW, halfH };
  }

  function applyStarsCorner(corner) {
    const margin = state.marginFrac;
    const marginV = state.marginVFrac;
    const { halfW, halfH } = starsHalfFracs();
    if (corner === 'top-left') { state.stars.xPct = margin + halfW; state.stars.yPct = marginV + halfH; }
    else if (corner === 'top-right') { state.stars.xPct = 1 - margin - halfW; state.stars.yPct = marginV + halfH; }
    else if (corner === 'bottom-left') { state.stars.xPct = margin + halfW; state.stars.yPct = 1 - marginV - halfH; }
    else if (corner === 'bottom-right') { state.stars.xPct = 1 - margin - halfW; state.stars.yPct = 1 - marginV - halfH; }
    else { state.stars.xPct = 0.5; state.stars.yPct = 0.5; } // 'center'
    const clamped = clampStarsPosition(state.stars.xPct, state.stars.yPct);
    state.stars.xPct = clamped.xPct;
    state.stars.yPct = clamped.yPct;
  }

  function getStarsBounds() {
    const { halfW, halfH } = starsHalfFracs();
    return {
      minX: state.marginFrac + halfW,
      maxX: 1 - state.marginFrac - halfW,
      minY: state.marginVFrac + halfH,
      maxY: 1 - state.marginVFrac - halfH,
    };
  }

  function clampStarsPosition(xPct, yPct) {
    const { minX, maxX, minY, maxY } = getStarsBounds();
    const clampedX = minX <= maxX ? Math.min(maxX, Math.max(minX, xPct)) : 0.5;
    const clampedY = minY <= maxY ? Math.min(maxY, Math.max(minY, yPct)) : 0.5;
    return { xPct: clampedX, yPct: clampedY };
  }

  // the star row's bounding rect in real canvas pixels -- used for drawing,
  // the drag hit-test, and alignment guides, same role as logoRect
  function starsRect(W, H) {
    if (!state.stars.enabled) return null;
    const w = (state.stars.sizePct / 100) * W;
    const h = w / 5;
    const cx = state.stars.xPct * W;
    const cy = state.stars.yPct * H;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }

  // traces a single 5-point star path centred at (cx, cy); innerRadius is
  // the classic ~0.382 ratio of outerRadius for a conventional star shape
  function traceStarPath(cx, cy, outerR) {
    const innerR = outerR * 0.382;
    const spikes = 5;
    let rot = -Math.PI / 2; // first point straight up
    const step = Math.PI / spikes;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR);
    for (let i = 0; i < spikes; i++) {
      rot += step;
      ctx.lineTo(cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR);
      rot += step;
      ctx.lineTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR);
    }
    ctx.closePath();
  }

  function drawStars(W, H) {
    const r = starsRect(W, H);
    if (!r) return;
    const slot = r.w / 5;
    const outerR = (slot / 2) * 0.86; // a touch of breathing room between stars
    ctx.save();
    ctx.fillStyle = state.stars.color;
    for (let i = 0; i < 5; i++) {
      const cx = r.x + slot * i + slot / 2;
      const cy = r.y + r.h / 2;
      traceStarPath(cx, cy, outerR);
      ctx.fill();
    }
    ctx.restore();
  }

  // ---------- free text boxes (independent of the headline/subheader/other block + its shared margins) ----------

  function activeFreeTextBoxObj() { return state.freeText.boxes[state.freeText.activeBox] || null; }

  // returns the box's real-canvas-space bounding rect, used for both drawing
  // and the drag hit-test, so they always agree on where the box actually is
  function freeTextBoxLayout(box, W, H) {
    const sizePx = (box.size / 1080) * W;
    const maxWidth = box.widthPct * W;
    const lines = wrapText(box.text, maxWidth, sizePx, box);
    const lineHeight = sizePx * 1.18;
    const totalH = lines.length * lineHeight;
    // ctx.font/measureText below reuse whatever wrapText just left set
    let widestLine = 0;
    lines.forEach((line) => { widestLine = Math.max(widestLine, ctx.measureText(line).width); });
    const cx = box.xPct * W, cy = box.yPct * H;
    const boxLeft = cx - maxWidth / 2, boxRight = cx + maxWidth / 2;
    const top = cy - totalH / 2, bottom = cy + totalH / 2;
    let left, right;
    if (box.hAlign === 'left') { left = boxLeft; right = boxLeft + widestLine; }
    else if (box.hAlign === 'right') { left = boxRight - widestLine; right = boxRight; }
    else { left = cx - widestLine / 2; right = cx + widestLine / 2; }
    return { sizePx, lines, lineHeight, totalH, cx, cy, boxLeft, boxRight, top, bottom, left, right };
  }

  function drawFreeTextBoxes(W, H) {
    return state.freeText.boxes.map((box, index) => {
      if (!box.text.trim()) return { box, index, layout: null };
      const layout = freeTextBoxLayout(box, W, H);
      ctx.save();
      ctx.font = fontCss(box, layout.sizePx);
      ctx.fillStyle = box.color;
      ctx.textBaseline = 'top';
      ctx.textAlign = box.hAlign;
      const x = box.hAlign === 'left' ? layout.boxLeft : box.hAlign === 'right' ? layout.boxRight : layout.cx;
      let y = layout.top;
      layout.lines.forEach((line) => {
        ctx.fillText(line, x, y);
        y += layout.lineHeight;
      });
      ctx.restore();
      return { box, index, layout };
    });
  }

  // faint dashed outline around whichever box the panel is currently
  // editing, shown only while the Text Box tab is open -- the hit-test for
  // dragging it uses the exact same rect, so what you see is what you drag
  function drawFreeTextEditingAids(W, H, freeTextResults) {
    if (!state.freeTextEditMode) return;
    const result = freeTextResults.find((r) => r.index === state.freeText.activeBox);
    if (!result || !result.layout) return;
    const scale = W / 1080;
    const pad = 10 * scale;
    ctx.save();
    ctx.strokeStyle = 'rgba(124,109,255,0.8)';
    ctx.lineWidth = Math.max(1.5, 1.5 * scale);
    ctx.setLineDash([W * 0.01, W * 0.008]);
    ctx.strokeRect(result.layout.boxLeft - pad, result.layout.top - pad, (result.layout.boxRight - result.layout.boxLeft) + pad * 2, result.layout.totalH + pad * 2);
    ctx.restore();
  }

  // ---------- magnifier (premium "loupe" detail callout) ----------

  const MAGNIFIER_INK = '#2B1E16';
  const MAGNIFIER_BRASS = '#966C26';

  // circle centre/radius and target point, in real canvas px for the given
  // resolution -- the one place this geometry is computed, shared by
  // drawing, hit-testing and dragging so they can never disagree
  function loupeCircle(loupe, W, H) {
    return { cx: loupe.loupeX * W, cy: loupe.loupeY * H, r: (loupe.diameter * W) / 2 };
  }

  // keeps at least 4% of canvas width between the loupe and any canvas edge
  // (a fixed rule, independent of the text/logo margin sliders -- the
  // magnifier is a separate, premium-detail element with its own spacing)
  function clampLoupePosition(loupe, x, y) {
    const edgeFrac = 0.04;
    const halfW = loupe.diameter / 2;
    const halfH = (loupe.diameter * state.canvasW) / 2 / state.canvasH;
    const minX = edgeFrac + halfW, maxX = 1 - edgeFrac - halfW;
    const minY = edgeFrac + halfH, maxY = 1 - edgeFrac - halfH;
    return {
      x: minX <= maxX ? Math.min(maxX, Math.max(minX, x)) : 0.5,
      y: minY <= maxY ? Math.min(maxY, Math.max(minY, y)) : 0.5,
    };
  }

  // clamps detailPanX/Y so the detail image, at its current zoom, always
  // fully covers the loupe circle -- expressed as a ratio independent of any
  // particular canvas resolution (both the circle's diameter and the image's
  // on-screen size scale together, so the bounds this implies are the same
  // at preview or export resolution)
  function clampDetailPan(loupe, panX, panY) {
    const img = loupe.detailImg;
    if (!img) return { x: 0.5, y: 0.5 };
    const coverScale = Math.max(1 / img.naturalWidth, 1 / img.naturalHeight); // for a unit (1px) diameter
    const scale = coverScale * loupe.detailZoom;
    const destW = img.naturalWidth * scale, destH = img.naturalHeight * scale;
    const r = 0.5;
    const minX = r / destW, maxX = 1 - r / destW;
    const minY = r / destH, maxY = 1 - r / destH;
    return {
      x: minX <= maxX ? Math.min(maxX, Math.max(minX, panX)) : 0.5,
      y: minY <= maxY ? Math.min(maxY, Math.max(minY, panY)) : 0.5,
    };
  }

  // the detail image's actual draw rect for a loupe circle (cx, cy, r) --
  // always clamped, so it's never possible to compute (or accidentally
  // persist) a rect that leaves empty space inside the circle
  function detailImageDrawRect(loupe, cx, cy, r) {
    const img = loupe.detailImg;
    if (!img) return null;
    const d = r * 2;
    const coverScale = Math.max(d / img.naturalWidth, d / img.naturalHeight);
    const scale = coverScale * loupe.detailZoom;
    const destW = img.naturalWidth * scale, destH = img.naturalHeight * scale;
    const pan = clampDetailPan(loupe, loupe.detailPanX, loupe.detailPanY);
    return { img, destX: cx - pan.x * destW, destY: cy - pan.y * destH, destW, destH };
  }

  // P -> loupe connector geometry (see the spec's section 3): the nearest
  // point on the circle E, and -- when the target is far enough away not to
  // overlap it -- the two tangent points T1/T2 the cone connector runs to.
  // Hidden (no connector at all) when the target sits inside or too close to
  // the loupe, since a line/cone from here would be meaningless.
  function computeConnectorGeometry(loupe, W, H) {
    const scale = W / 1080;
    const { cx, cy, r } = loupeCircle(loupe, W, H);
    const px = loupe.targetX * W, py = loupe.targetY * H;
    const dx = px - cx, dy = py - cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= r * 1.15) return { hidden: true, cx, cy, r, px, py, d, scale };
    const phi = Math.atan2(dy, dx);
    const E = { x: cx + r * Math.cos(phi), y: cy + r * Math.sin(phi) };
    const beta = Math.acos(Math.min(1, r / d));
    const T1 = { x: cx + r * Math.cos(phi + beta), y: cy + r * Math.sin(phi + beta) };
    const T2 = { x: cx + r * Math.cos(phi - beta), y: cy + r * Math.sin(phi - beta) };
    return { hidden: false, cx, cy, r, px, py, phi, beta, E, T1, T2, d, scale };
  }

  function drawConnector(loupe, geom) {
    if (loupe.connectorType === 'none' || geom.hidden) return;
    const { cx, cy, r, px, py, phi, beta, E, T1, T2, scale } = geom;
    // the connector line stops at the *edge* of the target marker rather
    // than its centre, so it doesn't visually run through the marker
    const markerR = loupe.marker === 'none' ? 0 : loupe.marker === 'dot' ? 4 * scale : 8 * scale;
    const stoppedFrom = (tx, ty) => {
      const ddx = tx - px, ddy = ty - py;
      const dd = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
      return { x: px + (markerR * ddx) / dd, y: py + (markerR * ddy) / dd };
    };

    if (loupe.connectorType === 'cone') {
      // faint wedge, fading from fully transparent at the target to the set
      // opacity right at the loupe's edge -- "a beam of focus, not a shape"
      const grad = ctx.createLinearGradient(px, py, E.x, E.y);
      grad.addColorStop(0, 'rgba(43,30,22,0)');
      grad.addColorStop(1, `rgba(43,30,22,${loupe.fillOpacity})`);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(T1.x, T1.y);
      ctx.arc(cx, cy, r, phi + beta, phi - beta, true); // the near-side (minor) arc between the two tangent points
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = `rgba(43,30,22,${loupe.lineOpacity})`;
      ctx.lineWidth = 1.75 * scale;
      [T1, T2].forEach((T) => {
        const s = stoppedFrom(T.x, T.y);
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(T.x, T.y);
        ctx.stroke();
      });
      ctx.restore();
    } else if (loupe.connectorType === 'line') {
      const s = stoppedFrom(E.x, E.y);
      ctx.save();
      ctx.strokeStyle = `rgba(43,30,22,${loupe.lineOpacity})`;
      ctx.lineWidth = 1.75 * scale;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(E.x, E.y);
      ctx.stroke();
      ctx.restore();
    }
  }

  // a filled circle whose only visible effect (once the opaque lens is drawn
  // on top of it) is the soft shadow spilling out beyond its own edge --
  // "lifted, not stuck on"
  function drawLoupeShadow(cx, cy, r, scale) {
    ctx.save();
    ctx.shadowColor = 'rgba(43,30,22,0.18)';
    ctx.shadowBlur = r * 2 * 0.06;
    ctx.shadowOffsetY = r * 2 * 0.015;
    ctx.fillStyle = 'rgba(0,0,0,1)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawLoupeVignette(cx, cy, r) {
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = grad;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
  }

  function drawLoupeRings(cx, cy, r, style, scale) {
    ctx.save();
    if (style === 'brass') {
      ctx.strokeStyle = MAGNIFIER_BRASS;
      ctx.lineWidth = 4 * scale;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(43,30,22,0.55)';
      ctx.lineWidth = 1 * scale;
      ctx.beginPath(); ctx.arc(cx, cy, r + 4 * scale, 0, Math.PI * 2); ctx.stroke();
    } else {
      // 'hairline' and 'glass' share the same ring construction
      ctx.strokeStyle = MAGNIFIER_INK;
      ctx.lineWidth = 3 * scale;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1 * scale;
      ctx.beginPath(); ctx.arc(cx, cy, r - 6 * scale, 0, Math.PI * 2); ctx.stroke();
    }
    if (style === 'glass') {
      // a very subtle specular highlight, top-left, ~90° long -- understated
      // on purpose; if it's easy to spot at a glance, it's too strong
      ctx.save();
      ctx.filter = `blur(${3 * scale}px)`;
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 10 * scale;
      ctx.beginPath();
      ctx.arc(cx, cy, r - 8 * scale, Math.PI, Math.PI * 1.5);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawTargetMarker(px, py, marker, scale) {
    if (marker === 'none') return;
    ctx.save();
    if (marker === 'dot') {
      ctx.fillStyle = MAGNIFIER_INK;
      ctx.beginPath(); ctx.arc(px, py, 4 * scale, 0, Math.PI * 2); ctx.fill();
    } else {
      const radius = 8 * scale;
      // soft white halo first, so the ring stays visible against dark photo content
      ctx.save();
      ctx.filter = `blur(${1 * scale}px)`;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 3 * scale;
      ctx.beginPath(); ctx.arc(px, py, radius, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = MAGNIFIER_INK;
      ctx.lineWidth = 2.5 * scale;
      ctx.beginPath(); ctx.arc(px, py, radius, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  // manual letter-spacing (tracking) for the label -- not every browser
  // supports canvas's own letterSpacing property reliably, so each character
  // is placed by hand, the same technique works everywhere
  function measureSpacedWidth(text, letterSpacing) {
    let w = 0;
    for (const ch of text) w += ctx.measureText(ch).width + letterSpacing;
    if (text.length) w -= letterSpacing;
    return w;
  }
  function fillSpacedText(text, x, y, letterSpacing, align) {
    const totalW = measureSpacedWidth(text, letterSpacing);
    let cursor = align === 'center' ? x - totalW / 2 : align === 'right' ? x - totalW : x;
    const prevAlign = ctx.textAlign;
    ctx.textAlign = 'left';
    for (const ch of text) {
      ctx.fillText(ch, cursor, y);
      cursor += ctx.measureText(ch).width + letterSpacing;
    }
    ctx.textAlign = prevAlign;
  }

  // draws the label (if any) and returns its bounding box, used for the 9:16
  // safe-zone check -- a label tucked right under the loupe can itself drift
  // into the forbidden Stories/Reels UI band even when the circle doesn't
  function drawLoupeLabel(loupe, cx, cy, r, W) {
    const text = (loupe.labelText || '').trim();
    if (!text) return null;
    const fontSize = 0.024 * W; // 26px at 1080
    const scale = W / 1080;
    const gap = 18 * scale;
    const letterSpacing = fontSize * 0.12;
    const upper = text.toUpperCase();
    ctx.save();
    ctx.font = `700 ${fontSize}px system-ui, -apple-system, sans-serif`;
    ctx.fillStyle = MAGNIFIER_INK;
    ctx.textBaseline = 'alphabetic';
    let bounds;
    if (loupe.labelPosition === 'above') {
      const y = cy - r - gap;
      fillSpacedText(upper, cx, y, letterSpacing, 'center');
      const w = measureSpacedWidth(upper, letterSpacing);
      bounds = { left: cx - w / 2, right: cx + w / 2, top: y - fontSize, bottom: y + fontSize * 0.2 };
    } else if (loupe.labelPosition === 'beside') {
      // auto side: whichever side has more room, so the label doesn't run off-canvas
      const onRight = cx <= W / 2;
      const x = onRight ? cx + r + gap : cx - r - gap;
      const y = cy + fontSize * 0.35;
      fillSpacedText(upper, x, y, letterSpacing, onRight ? 'left' : 'right');
      const w = measureSpacedWidth(upper, letterSpacing);
      bounds = onRight
        ? { left: x, right: x + w, top: y - fontSize, bottom: y + fontSize * 0.2 }
        : { left: x - w, right: x, top: y - fontSize, bottom: y + fontSize * 0.2 };
    } else { // 'below' (default)
      const y = cy + r + gap + fontSize * 0.8;
      fillSpacedText(upper, cx, y, letterSpacing, 'center');
      const w = measureSpacedWidth(upper, letterSpacing);
      bounds = { left: cx - w / 2, right: cx + w / 2, top: y - fontSize, bottom: y + fontSize * 0.2 };
    }
    ctx.restore();
    return bounds;
  }

  // draw order per the spec: cone fill -> cone/line strokes -> loupe shadow
  // -> loupe image -> vignette -> rings -> target marker -> label. The loupe
  // itself sits on top of the connector, so the lines read as disappearing
  // behind the lens rather than floating over it.
  function drawOneLoupe(loupe, W, H) {
    if (!loupe.enabled) return null;
    const scale = W / 1080;
    const geom = computeConnectorGeometry(loupe, W, H);
    drawConnector(loupe, geom);

    const { cx, cy, r } = geom;
    if (loupe.shadow) drawLoupeShadow(cx, cy, r, scale);

    const rect = detailImageDrawRect(loupe, cx, cy, r);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    if (rect) {
      const level = pickDownscaleSource(rect.img, rect.destW, rect.destH);
      ctx.drawImage(level.canvas, level.innerX, level.innerY, level.innerW, level.innerH, rect.destX, rect.destY, rect.destW, rect.destH);
    } else {
      // no detail photo uploaded yet -- a neutral placeholder so the loupe
      // still reads as a lens rather than an empty hole while editing
      ctx.fillStyle = '#ddd4c8';
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    ctx.restore();

    drawLoupeVignette(cx, cy, r);
    drawLoupeRings(cx, cy, r, loupe.style, scale);
    drawTargetMarker(geom.px, geom.py, loupe.marker, scale);
    const labelBounds = drawLoupeLabel(loupe, cx, cy, r, W);
    return { geom, labelBounds };
  }

  // draws every enabled loupe and returns per-loupe geometry/label bounds,
  // used afterwards for the 9:16 safe-zone warning and the "move the loupe"
  // hint -- both editing-only, so they're computed here rather than inside
  // the draw itself, which also runs (without them) for export
  function drawMagnifier(W, H) {
    if (!state.magnifier.enabled) return [];
    return state.magnifier.loupes.map((loupe, index) => {
      const result = drawOneLoupe(loupe, W, H);
      return result && { loupe, index, ...result };
    }).filter(Boolean);
  }

  // 9:16 only: Stories/Reels UI covers the top 14% and bottom 35% of the
  // frame, so a loupe (or its label) drifting in there is a real layout bug,
  // not just a style nitpick -- flagged with a red outline while editing
  function loupeInSafeZoneConflict(result, H) {
    if (state.preset !== '1080x1920') return false;
    const topBand = H * 0.14, bottomBand = H * 0.65;
    let top = result.geom.cy - result.geom.r, bottom = result.geom.cy + result.geom.r;
    if (result.labelBounds) {
      top = Math.min(top, result.labelBounds.top);
      bottom = Math.max(bottom, result.labelBounds.bottom);
    }
    return top < topBand || bottom > bottomBand;
  }

  // 2.6: the loupe must never sit on top of the headline text block --
  // approximated as circle-vs-rect overlap (closest-point test), checked
  // against the loupe circle and, separately, its label's own bounds
  function loupeOverlapsText(result, textBounds) {
    if (!textBounds) return false;
    const circleHitsRect = (cx, cy, r) => {
      const closestX = Math.min(Math.max(cx, textBounds.left), textBounds.right);
      const closestY = Math.min(Math.max(cy, textBounds.top), textBounds.bottom);
      const dx = cx - closestX, dy = cy - closestY;
      return dx * dx + dy * dy < r * r;
    };
    if (circleHitsRect(result.geom.cx, result.geom.cy, result.geom.r)) return true;
    if (result.labelBounds) {
      const lb = result.labelBounds;
      return lb.left < textBounds.right && lb.right > textBounds.left && lb.top < textBounds.bottom && lb.bottom > textBounds.top;
    }
    return false;
  }

  function drawMagnifierEditingAids(W, H, magnifierResults, textBounds) {
    const scale = W / 1080;
    magnifierResults.forEach((result) => {
      if (!loupeInSafeZoneConflict(result, H) && !loupeOverlapsText(result, textBounds)) return;
      ctx.save();
      ctx.strokeStyle = 'rgba(220,38,38,0.9)';
      ctx.lineWidth = Math.max(2, 2 * scale);
      ctx.setLineDash([W * 0.01, W * 0.008]);
      ctx.beginPath();
      ctx.arc(result.geom.cx, result.geom.cy, result.geom.r + 4 * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    });
  }

  // ---------- drag margin guide lines (shown while dragging the logo, text or stars) ----------

  let dragGuideTarget = null; // null | 'logo' | 'text' | 'stars' -- which object is being dragged, if any

  function drawDragGuides(W, H) {
    if (!dragGuideTarget) return;
    const marginPx = W * state.marginFrac;
    const marginVPx = H * state.marginVFrac;
    ctx.save();
    ctx.strokeStyle = 'rgba(108,99,255,0.9)';
    ctx.lineWidth = Math.max(2, W * 0.002);
    ctx.setLineDash([W * 0.012, W * 0.008]);
    [marginPx, W - marginPx].forEach((x) => {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    });
    [marginVPx, H - marginVPx].forEach((y) => {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    });
    ctx.restore();
  }

  // ---------- smart alignment guides (shown while dragging the logo, text or stars) ----------
  // beyond the always-on margin lines above, these appear only when the
  // dragged object's edges or centre line up with the canvas centre or
  // either *other* object's own edges/centre -- the same "does this line up
  // with that other element" signal design tools give you, rather than a
  // fixed reference. Whichever of logo/text/stars is being dragged is
  // compared against the other two, symmetrically.
  function drawSmartGuides(W, H, textBounds) {
    if (!dragGuideTarget) return;
    const rects = {
      logo: logoRect(W, H),
      stars: starsRect(W, H),
      text: textBounds ? { x: textBounds.left, y: textBounds.top, w: textBounds.right - textBounds.left, h: textBounds.bottom - textBounds.top } : null,
    };
    const dragged = rects[dragGuideTarget];
    const others = Object.keys(rects).filter((k) => k !== dragGuideTarget).map((k) => rects[k]).filter(Boolean);
    if (!dragged) return;

    const scale = W / 1080;
    const tol = 6 * scale;

    const marginPx = W * state.marginFrac;
    const marginVPx = H * state.marginVFrac;
    const xTargets = [W / 2, marginPx, W - marginPx];
    const yTargets = [H / 2, marginVPx, H - marginVPx];
    others.forEach((other) => {
      xTargets.push(other.x, other.x + other.w, other.x + other.w / 2);
      yTargets.push(other.y, other.y + other.h, other.y + other.h / 2);
    });

    const draggedXs = [dragged.x, dragged.x + dragged.w, dragged.x + dragged.w / 2];
    const draggedYs = [dragged.y, dragged.y + dragged.h, dragged.y + dragged.h / 2];

    const matchedX = new Set();
    const matchedY = new Set();
    xTargets.forEach((t) => { if (draggedXs.some((dx) => Math.abs(dx - t) <= tol)) matchedX.add(Math.round(t)); });
    yTargets.forEach((t) => { if (draggedYs.some((dy) => Math.abs(dy - t) <= tol)) matchedY.add(Math.round(t)); });
    if (matchedX.size === 0 && matchedY.size === 0) return;

    ctx.save();
    ctx.strokeStyle = 'rgba(255,71,133,0.95)'; // distinct from the margin guides' purple, so the two read as separate signals
    ctx.lineWidth = Math.max(1.5, scale * 1.5);
    matchedX.forEach((x) => { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); });
    matchedY.forEach((y) => { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); });
    ctx.restore();
  }

  // ---------- safe zone overlay ----------

  function drawSafeZone(W, H) {
    if (!(state.preset === '1080x1920' && state.safeZone)) return;
    ctx.fillStyle = 'rgba(120,120,130,0.45)';
    ctx.fillRect(0, 0, W, H * 0.14);
    ctx.fillRect(0, H * 0.65, W, H * 0.35);
  }

  // ---------- master render ----------

  // draws the actual composite (photo + fade + text + logo) against whatever
  // canvas `ctx` currently points to, at the given resolution. Editing aids
  // (logo drag guides, the safe-zone guide) are in-app-only and are never
  // baked into an export, regardless of whether they're toggled on.
  let lastMagnifierResults = []; // set by paintComposite, read by render() for the safe-zone/hint UI below
  let lastTextBounds = null; // set by paintComposite, read for the loupe/headline overlap warning
  let lastFreeTextResults = []; // set by paintComposite, read by the pointerdown hit-test for dragging a free text box

  function paintComposite(W, H, includeEditingAids) {
    ctx.clearRect(0, 0, W, H);

    if (state.image) {
      // white first so that zooming out past 100% (which letterboxes the
      // photo instead of cropping it further -- see drawImageCover) reveals
      // a plain white margin, matching the white background most product
      // photos already have rather than showing canvas chrome through it
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      drawImageCover(state.image, W, H);
    } else {
      ctx.fillStyle = '#1a1a1e';
      ctx.fillRect(0, 0, W, H);
    }

    drawFade(W, H, state.fade);
    const textBounds = drawTextBlock(W, H);
    drawLogo(W, H);
    drawStars(W, H);
    const freeTextResults = drawFreeTextBoxes(W, H);
    const magnifierResults = drawMagnifier(W, H);
    drawEffects(W, H, state.effects);
    if (includeEditingAids) {
      drawDragGuides(W, H);
      drawSmartGuides(W, H, textBounds);
      drawSafeZone(W, H);
      drawMagnifierEditingAids(W, H, magnifierResults, textBounds);
      drawFreeTextEditingAids(W, H, freeTextResults);
    }
    lastMagnifierResults = magnifierResults;
    lastTextBounds = textBounds;
    lastFreeTextResults = freeTextResults;
    return textBounds;
  }

  function render() {
    const W = state.canvasW, H = state.canvasH;
    paintComposite(W, H, true);
    updateMagnifierHints(W, H);
    logoVPos.value = yPctToLogoVPosValue(state.logo.yPct);
    starsHPos.value = xPctToStarsHPosValue(state.stars.xPct);
    starsVPos.value = yPctToStarsVPosValue(state.stars.yPct);
    // keeps the X/Y sliders live while dragging the loupe/target/detail-pan
    // directly on canvas, same reasoning as the logo/stars vertical sliders above
    if (magnifierDragMode) {
      const loupe = activeLoupeObj();
      magnifierLoupeX.value = Math.round(loupe.loupeX * 100);
      magnifierLoupeXVal.textContent = `${magnifierLoupeX.value}%`;
      magnifierLoupeY.value = Math.round(loupe.loupeY * 100);
      magnifierLoupeYVal.textContent = `${magnifierLoupeY.value}%`;
      magnifierDetailPanX.value = Math.round(loupe.detailPanX * 100);
      magnifierDetailPanXVal.textContent = `${magnifierDetailPanX.value}%`;
      magnifierDetailPanY.value = Math.round(loupe.detailPanY * 100);
      magnifierDetailPanYVal.textContent = `${magnifierDetailPanY.value}%`;
      magnifierTargetX.value = Math.round(loupe.targetX * 100);
      magnifierTargetXVal.textContent = `${magnifierTargetX.value}%`;
      magnifierTargetY.value = Math.round(loupe.targetY * 100);
      magnifierTargetYVal.textContent = `${magnifierTargetY.value}%`;
    }
    // same idea while dragging a free text box directly on canvas
    if (freeTextDragging) {
      const box = activeFreeTextBoxObj();
      if (box) {
        freeTextX.value = Math.round(box.xPct * 100);
        freeTextXVal.textContent = `${freeTextX.value}%`;
        freeTextY.value = Math.round(box.yPct * 100);
        freeTextYVal.textContent = `${freeTextY.value}%`;
      }
    }
    scheduleSaveRecipe();
  }

  // A cached pyramid of progressively-halved copies of a photo, each padded
  // with a few pixels of its own edge colour, extended outward. Some
  // browsers (this matches a known Safari quirk) sample slightly *past* the
  // edge of an image's source rectangle while smoothing a downscale -- past
  // the true edge there's nothing, which reads as transparent black and
  // shows up as a thin dark fringe right where the photo meets the plain
  // white margin while zoomed out. Padding gives that over-read real,
  // matching-coloured pixels to land on instead of black; downscaling in
  // several small steps (the same idea as real mipmapping) rather than one
  // big jump keeps every step's ratio -- and so the padding it needs -- small
  // and constant regardless of overall zoom. Cached per image so building
  // the pyramid only costs anything once per photo, not on every drag/zoom
  // frame.
  const EDGE_PAD = 4;
  // keyed by image identity (a Map, not a single slot) -- the magnifier can
  // have the main photo plus up to two detail images in play at once, and a
  // single-slot cache would thrash (rebuild on every draw) switching between
  // them every frame instead of paying the cost once per image
  const downscalePyramidCache = new Map();
  function padEdges(srcCanvasOrImg, w, h) {
    // draws srcCanvasOrImg's own edge pixels into a new canvas EDGE_PAD px
    // larger on all sides, extended/clamped outward -- top/bottom/left/right
    // strips stretched from a 1px source sliver, corners from a 1x1 pixel
    const padded = document.createElement('canvas');
    padded.width = w + EDGE_PAD * 2;
    padded.height = h + EDGE_PAD * 2;
    const pctx = padded.getContext('2d');
    pctx.drawImage(srcCanvasOrImg, 0, 0, w, h, EDGE_PAD, EDGE_PAD, w, h);
    pctx.drawImage(srcCanvasOrImg, 0, 0, w, 1, EDGE_PAD, 0, w, EDGE_PAD); // top
    pctx.drawImage(srcCanvasOrImg, 0, h - 1, w, 1, EDGE_PAD, EDGE_PAD + h, w, EDGE_PAD); // bottom
    pctx.drawImage(srcCanvasOrImg, 0, 0, 1, h, 0, EDGE_PAD, EDGE_PAD, h); // left
    pctx.drawImage(srcCanvasOrImg, w - 1, 0, 1, h, EDGE_PAD + w, EDGE_PAD, EDGE_PAD, h); // right
    pctx.drawImage(srcCanvasOrImg, 0, 0, 1, 1, 0, 0, EDGE_PAD, EDGE_PAD); // corners
    pctx.drawImage(srcCanvasOrImg, w - 1, 0, 1, 1, EDGE_PAD + w, 0, EDGE_PAD, EDGE_PAD);
    pctx.drawImage(srcCanvasOrImg, 0, h - 1, 1, 1, 0, EDGE_PAD + h, EDGE_PAD, EDGE_PAD);
    pctx.drawImage(srcCanvasOrImg, w - 1, h - 1, 1, 1, EDGE_PAD + w, EDGE_PAD + h, EDGE_PAD, EDGE_PAD);
    return padded;
  }
  function getDownscalePyramid(img) {
    if (downscalePyramidCache.has(img)) return downscalePyramidCache.get(img);
    // level 0: the full-resolution image, padded -- innerX/Y/W/H is always
    // the sub-rectangle of `canvas` that's the actual (unpadded) photo
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    const levels = [{ canvas: padEdges(img, w0, h0), innerX: EDGE_PAD, innerY: EDGE_PAD, innerW: w0, innerH: h0 }];
    let prev = levels[0];
    while (prev.innerW > 64 && prev.innerH > 64) {
      const nextInnerW = Math.max(1, Math.round(prev.innerW / 2));
      const nextInnerH = Math.max(1, Math.round(prev.innerH / 2));
      // downscale just the unpadded inner region (not the previous level's
      // own padding, which would otherwise compound into a visible border)
      // into a fresh canvas of exactly that size, then re-pad it
      const half = document.createElement('canvas');
      half.width = nextInnerW;
      half.height = nextInnerH;
      const hctx = half.getContext('2d');
      hctx.imageSmoothingEnabled = true;
      hctx.imageSmoothingQuality = 'high';
      hctx.drawImage(prev.canvas, prev.innerX, prev.innerY, prev.innerW, prev.innerH, 0, 0, nextInnerW, nextInnerH);
      const next = { canvas: padEdges(half, nextInnerW, nextInnerH), innerX: EDGE_PAD, innerY: EDGE_PAD, innerW: nextInnerW, innerH: nextInnerH };
      levels.push(next);
      prev = next;
    }
    downscalePyramidCache.set(img, levels);
    return levels;
  }

  // picks the smallest pyramid level still at least ~2x the size actually
  // being drawn at, so the final draw is always a safe, small-ratio scale
  function pickDownscaleSource(img, targetW, targetH) {
    const levels = getDownscalePyramid(img);
    for (const level of levels) {
      if (level.innerW <= targetW * 2 || level.innerH <= targetH * 2) return level;
    }
    return levels[levels.length - 1];
  }

  // the scale that fills the frame exactly on one axis (and overflows the
  // other, which the canvas clips naturally) at zoom=1 -- the single
  // reference point the whole zoom range scales from. A 90/270 rotation
  // swaps which of the image's natural dimensions ends up as its on-screen
  // width vs height, so the "which axis is constrained" choice has to swap
  // with it too, or the cover-fit would be computed for the wrong shape.
  function coverScaleFor(img, W, H) {
    const rotation = state.imageTransform.rotation || 0;
    const swapped = rotation === 90 || rotation === 270;
    const iw = swapped ? img.naturalHeight : img.naturalWidth;
    const ih = swapped ? img.naturalWidth : img.naturalHeight;
    return Math.max(W / iw, H / ih);
  }

  // The whole pan/zoom model is one formula: draw the *entire* source image
  // at scale = coverScaleFor(...) * zoom, positioned so that the source
  // point (offsetXPct, offsetYPct) sits at the frame's centre. There's no
  // separate "crop" concept and no branch on zoom at all, so there is
  // nothing that *can* jump: at zoom=1 this exactly fills the frame on the
  // constrained axis (matching the old cover-crop default) and overflows
  // the other axis, which the canvas clips for free; below zoom=1 the image
  // is simply smaller than the frame on both axes, so the plain white
  // background (see paintComposite) shows around it as a margin that grows
  // continuously the further out you go -- one continuous linear scale, not
  // two different fits stitched together at a boundary.
  //
  // Rotation is applied as a canvas transform around the frame's centre,
  // drawing the *unrotated* image so (offsetXPct, offsetYPct) -- a fraction
  // of the image's own, unrotated width/height -- always means the same
  // source point regardless of rotation; only where that point ends up on
  // screen changes.
  //
  // The image is drawn from a cached, edge-padded downscale pyramid (above),
  // not the original bitmap directly, to avoid a thin dark edge fringe some
  // browsers introduce when scaling down a lot in one step. Belt-and-braces
  // against whatever's left of that fringe (confirmed still visible on at
  // least one real device despite the above): whichever of the photo's own
  // edges actually has visible white margin beyond it (i.e. really is
  // "zoomed out" on that axis, not just cover-fit to it) gets its outermost
  // few pixels feathered into that same white, painted right on top of it in
  // the same rotated coordinate space -- so instead of trying to prevent
  // whatever a given browser's downscale filter does at the true edge, any
  // artifact it leaves is deliberately painted over with a soft fade a
  // viewer reads as intentional, not a bug. Only the edges with a real gap
  // are touched: at exactly 100% zoom the cover-fit axis sits flush against
  // the canvas edge with no margin, and feathering that would crop content
  // off a normal full-bleed photo for no reason.
  //
  // `left/top/right/bottom` and `canvasLeft/Top/Right/Bottom` are both
  // already in this same local (translated+rotated) coordinate space, so
  // whichever ones don't line up (beyond a tiny epsilon) are where the
  // margin -- and so the feather -- belongs.
  function drawImageEdgeFeather(left, top, right, bottom, canvasLeft, canvasTop, canvasRight, canvasBottom) {
    const feather = Math.max(3, Math.min(10, (right - left) * 0.01));
    const EPS = 0.5;
    const edges = [];
    if (top > canvasTop + EPS) edges.push({ x0: left, y0: top, x1: left, y1: top + feather, rect: [left, top, right - left, feather] });
    if (bottom < canvasBottom - EPS) edges.push({ x0: left, y0: bottom, x1: left, y1: bottom - feather, rect: [left, bottom - feather, right - left, feather] });
    if (left > canvasLeft + EPS) edges.push({ x0: left, y0: top, x1: left + feather, y1: top, rect: [left, top, feather, bottom - top] });
    if (right < canvasRight - EPS) edges.push({ x0: right, y0: top, x1: right - feather, y1: top, rect: [right - feather, top, feather, bottom - top] });
    for (const e of edges) {
      const grad = ctx.createLinearGradient(e.x0, e.y0, e.x1, e.y1);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(...e.rect);
    }
  }

  function drawImageCover(img, W, H) {
    const t = state.imageTransform;
    const rotation = t.rotation || 0;
    const rotationRad = (rotation * Math.PI) / 180;
    const scale = coverScaleFor(img, W, H) * t.zoom;
    const destW = img.naturalWidth * scale, destH = img.naturalHeight * scale;
    const level = pickDownscaleSource(img, destW, destH);
    const left = -t.offsetXPct * destW, top = -t.offsetYPct * destH;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    if (rotation) ctx.rotate(rotationRad);
    ctx.drawImage(level.canvas, level.innerX, level.innerY, level.innerW, level.innerH, left, top, destW, destH);
    // the canvas's own 4 corners, expressed in this same rotated local space
    // (i.e. un-rotated relative to the transform just applied), so their
    // bounding box is what "the canvas edge" means from in here
    const cos = Math.cos(-rotationRad), sin = Math.sin(-rotationRad);
    const corners = [[-W / 2, -H / 2], [W / 2, -H / 2], [-W / 2, H / 2], [W / 2, H / 2]]
      .map(([x, y]) => [x * cos - y * sin, x * sin + y * cos]);
    const canvasLeft = Math.min(...corners.map((c) => c[0]));
    const canvasRight = Math.max(...corners.map((c) => c[0]));
    const canvasTop = Math.min(...corners.map((c) => c[1]));
    const canvasBottom = Math.max(...corners.map((c) => c[1]));
    drawImageEdgeFeather(left, top, left + destW, top + destH, canvasLeft, canvasTop, canvasRight, canvasBottom);
    ctx.restore();
  }

  // No clamping at all -- total freedom to position the image/focus point
  // anywhere, at any zoom, including partially or fully off-canvas. Two
  // earlier, narrower attempts (full-bleed-only, then "free but bounded to
  // the frame") both still left some position unreachable; "Reset position"
  // is the escape hatch if a drag goes further than intended.
  function clampImageOffset(offsetXPct, offsetYPct, zoom, img, W, H) {
    return {
      offsetXPct,
      offsetYPct,
    };
  }

  // warns, for whichever loupe the panel is currently editing, when the
  // connector is hidden (target too close to/inside the loupe) or the loupe
  // drifts into the 9:16 safe zone -- the on-canvas red outline (see
  // drawMagnifierEditingAids) shows *where*, this explains *why*
  function updateMagnifierHints(W, H) {
    const hintEl = document.getElementById('magnifierHint');
    if (!hintEl) return;
    const idx = state.magnifier.activeLoupe;
    const loupe = state.magnifier.loupes[idx];
    if (!state.magnifier.enabled || !loupe || !loupe.enabled) { hintEl.classList.add('hidden'); return; }
    const result = lastMagnifierResults.find((r) => r.index === idx);
    const messages = [];
    if (result && result.geom.hidden) messages.push('The target is too close to the loupe — move it away to show the connector.');
    if (result && loupeInSafeZoneConflict(result, H)) messages.push('This loupe sits in the Stories/Reels safe zone (top 14% or bottom 35% of the frame) — it may be covered by platform UI.');
    if (result && loupeOverlapsText(result, lastTextBounds)) messages.push('This loupe overlaps the headline text — move it clear of the text block.');
    if (messages.length) {
      hintEl.textContent = messages.join(' ');
      hintEl.classList.remove('hidden');
    } else {
      hintEl.classList.add('hidden');
    }
  }

  // ---------- canvas resize to fit stage ----------

  // "editing view" zoom (desktop only) -- purely how large the canvas is
  // shown on screen, for finer editing on a small/cramped window. Never
  // touches state.canvasW/H, state.imageTransform, or anything that affects
  // the actual image or export -- it's the same composite, just displayed
  // bigger, with the stage becoming scrollable once it no longer fits.
  let viewZoom = 1;
  const VIEW_ZOOM_MIN = 1, VIEW_ZOOM_MAX = 3, VIEW_ZOOM_STEP = 0.25;

  // the available fitting box, independent of the stage's own current size
  // (which view-zoom deliberately grows past 100% -- measuring from `stage`
  // itself once it's already enlarged would feed back into itself)
  function getStageAvailableBox() {
    const cs = getComputedStyle(stageWrap);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    return { w: stageWrap.clientWidth - padX, h: stageWrap.clientHeight - padY };
  }

  function fitStageToViewport() {
    // Canvas keeps its intrinsic (preset) resolution; CSS just scales it to fit the stage box.
    const { w: availW, h: availH } = getStageAvailableBox();
    const baseScale = Math.min(availW / state.canvasW, availH / state.canvasH);
    const scale = baseScale * viewZoom;
    canvas.style.width = `${state.canvasW * scale}px`;
    canvas.style.height = `${state.canvasH * scale}px`;
  }

  window.addEventListener('resize', fitStageToViewport);

  const viewZoomVal = document.getElementById('viewZoomVal');
  const viewZoomInBtn = document.getElementById('viewZoomInBtn');
  const viewZoomOutBtn = document.getElementById('viewZoomOutBtn');

  function setViewZoom(zoom) {
    viewZoom = Math.min(VIEW_ZOOM_MAX, Math.max(VIEW_ZOOM_MIN, zoom));
    const zoomedIn = viewZoom > 1;
    stageWrap.classList.toggle('view-zoomed', zoomedIn);
    stage.classList.toggle('view-zoomed', zoomedIn);
    viewZoomVal.textContent = `${Math.round(viewZoom * 100)}%`;
    viewZoomOutBtn.disabled = viewZoom <= VIEW_ZOOM_MIN;
    viewZoomInBtn.disabled = viewZoom >= VIEW_ZOOM_MAX;
    fitStageToViewport();
    // re-centre the scroll position on every zoom step, so + / - always
    // zooms toward the middle of the frame rather than leaving the view
    // pinned wherever it happened to be scrolled to
    stageWrap.scrollLeft = (stageWrap.scrollWidth - stageWrap.clientWidth) / 2;
    stageWrap.scrollTop = (stageWrap.scrollHeight - stageWrap.clientHeight) / 2;
  }

  viewZoomInBtn.addEventListener('click', () => setViewZoom(viewZoom + VIEW_ZOOM_STEP));
  viewZoomOutBtn.addEventListener('click', () => setViewZoom(viewZoom - VIEW_ZOOM_STEP));

  // ---------- logo drag + text drag + photo pan/zoom (mode-exclusive on the canvas) ----------

  let dragging = false; // logo drag
  let starsDragging = false;
  let textDragging = false;
  let textDragStart = null; // { clientX, clientY, vAlign, crossAlign }
  let magnifierDragMode = null; // null | 'target' | 'loupe' | 'pan' -- only while state.magnifierEditMode
  let magnifierDragStart = null; // { clientX, clientY, ...whatever magnifierDragMode needs to resume from }
  let freeTextDragging = false; // only while state.freeTextEditMode, dragging the currently active box
  let freeTextDragStart = null; // { clientX, clientY, xPct, yPct }
  let photoDragging = false; // photo pan
  let panStart = null; // { clientX, clientY, offsetXPct, offsetYPct }
  const activePointers = new Map(); // pointerId -> {x, y}, for pinch-zoom
  let pinchStartDist = 0;
  let pinchStartZoom = 1;

  function clientToCanvas(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = state.canvasW / rect.width;
    const scaleY = state.canvasH / rect.height;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  }

  // ---------- eyedropper: sample a colour straight off the rendered canvas ----------

  const eyedropperHint = document.getElementById('eyedropperHint');
  let eyedropperInput = null;
  let eyedropperBtn = null;

  function resolveEyedropperInput(btn) {
    const targetId = btn.dataset.colorTarget;
    if (targetId) return document.getElementById(targetId);
    const panel = btn.closest('.layer-panel');
    return panel ? panel.querySelector('.layer-color') : null;
  }

  function setEyedropperActive(active) {
    stage.classList.toggle('eyedropper-mode', active);
    eyedropperHint.classList.toggle('hidden', !active);
    document.querySelectorAll('.eyedropper-btn').forEach(b => b.classList.toggle('active', active && b === eyedropperBtn));
  }

  function cancelEyedropper() {
    eyedropperInput = null;
    eyedropperBtn = null;
    setEyedropperActive(false);
  }

  document.querySelectorAll('.eyedropper-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (eyedropperBtn === btn) { cancelEyedropper(); return; } // clicking the same pipette again cancels
      const input = resolveEyedropperInput(btn);
      if (!input) return;
      eyedropperInput = input;
      eyedropperBtn = btn;
      setEyedropperActive(true);
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && eyedropperInput) cancelEyedropper();
  });

  // capture phase so this runs before (and can pre-empt) the logo-drag / photo-pan
  // pointerdown handling below -- a pick shouldn't also start dragging the logo
  canvas.addEventListener('pointerdown', (e) => {
    if (!eyedropperInput) return;
    e.preventDefault();
    e.stopPropagation();
    const p = clientToCanvas(e.clientX, e.clientY);
    const x = Math.min(canvas.width - 1, Math.max(0, Math.floor(p.x)));
    const y = Math.min(canvas.height - 1, Math.max(0, Math.floor(p.y)));
    const data = canvas.getContext('2d').getImageData(x, y, 1, 1).data;
    const hex = '#' + [data[0], data[1], data[2]].map(v => v.toString(16).padStart(2, '0')).join('');
    eyedropperInput.value = hex;
    eyedropperInput.dispatchEvent(new Event('input', { bubbles: true }));
    cancelEyedropper();
  }, true);

  function setImageZoom(zoom) {
    if (!state.image) return;
    const clampedZoom = Math.min(4, Math.max(0.5, zoom));
    state.imageTransform.zoom = clampedZoom;
    const clamped = clampImageOffset(
      state.imageTransform.offsetXPct, state.imageTransform.offsetYPct,
      clampedZoom, state.image, state.canvasW, state.canvasH
    );
    state.imageTransform.offsetXPct = clamped.offsetXPct;
    state.imageTransform.offsetYPct = clamped.offsetYPct;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (state.positionEditMode) {
      if (!state.image) return;
      canvas.setPointerCapture(e.pointerId);
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.size === 1) {
        photoDragging = true;
        panStart = {
          clientX: e.clientX, clientY: e.clientY,
          offsetXPct: state.imageTransform.offsetXPct, offsetYPct: state.imageTransform.offsetYPct,
        };
      } else if (activePointers.size === 2) {
        photoDragging = false;
        const pts = [...activePointers.values()];
        pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        pinchStartZoom = state.imageTransform.zoom;
      }
      return;
    }

    // mode-exclusive, same idea as positionEditMode above -- while this tab
    // is open, canvas drags only ever touch the loupe being edited, never
    // stars/logo/text underneath it
    if (state.magnifierEditMode) {
      if (!state.magnifier.enabled) return;
      const idx = state.magnifier.activeLoupe;
      const loupe = state.magnifier.loupes[idx];
      if (!loupe || !loupe.enabled) return;
      const mp = clientToCanvas(e.clientX, e.clientY);
      const scale = state.canvasW / 1080;
      const { cx, cy, r } = loupeCircle(loupe, state.canvasW, state.canvasH);
      const px = loupe.targetX * state.canvasW, py = loupe.targetY * state.canvasH;
      const targetHitR = 40 * scale; // generous touch-friendly hit area around the (small) marker -- bare glyph size would be unreliable to tap on a phone
      const dtx = mp.x - px, dty = mp.y - py;
      if (Math.sqrt(dtx * dtx + dty * dty) <= targetHitR) {
        magnifierDragMode = 'target';
        magnifierDragStart = { clientX: e.clientX, clientY: e.clientY, targetX: loupe.targetX, targetY: loupe.targetY };
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      const dlx = mp.x - cx, dly = mp.y - cy;
      if (Math.sqrt(dlx * dlx + dly * dly) <= r) {
        if (state.magnifier.dragPansDetail) {
          magnifierDragMode = 'pan';
          magnifierDragStart = { clientX: e.clientX, clientY: e.clientY, panX: loupe.detailPanX, panY: loupe.detailPanY };
        } else {
          magnifierDragMode = 'loupe';
          magnifierDragStart = { clientX: e.clientX, clientY: e.clientY, loupeX: loupe.loupeX, loupeY: loupe.loupeY };
        }
        canvas.setPointerCapture(e.pointerId);
      }
      return;
    }

    // mode-exclusive, same idea -- while the Text Box tab is open, canvas
    // drags only ever touch the box currently being edited in the panel
    if (state.freeTextEditMode) {
      const box = activeFreeTextBoxObj();
      if (!box) return;
      const mp = clientToCanvas(e.clientX, e.clientY);
      const layout = freeTextBoxLayout(box, state.canvasW, state.canvasH);
      const pad = 14 * (state.canvasW / 1080);
      if (mp.x >= layout.boxLeft - pad && mp.x <= layout.boxRight + pad && mp.y >= layout.top - pad && mp.y <= layout.bottom + pad) {
        freeTextDragging = true;
        freeTextDragStart = { clientX: e.clientX, clientY: e.clientY, xPct: box.xPct, yPct: box.yPct };
        canvas.setPointerCapture(e.pointerId);
        render();
      }
      return;
    }

    const p = clientToCanvas(e.clientX, e.clientY);

    if (state.stars.enabled) {
      const r = starsRect(state.canvasW, state.canvasH);
      // stars are drawn on top of everything else, so they get first pick
      // of an overlapping click, same reasoning as logo-over-text below
      if (r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
        starsDragging = true;
        dragGuideTarget = 'stars';
        canvas.setPointerCapture(e.pointerId);
        render();
        return;
      }
    }

    if (state.logo.img) {
      const r = logoRect(state.canvasW, state.canvasH);
      // logo takes priority over text when they overlap, matching that it's
      // drawn on top of the text in the composite
      if (r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
        dragging = true;
        dragGuideTarget = 'logo';
        canvas.setPointerCapture(e.pointerId);
        render();
        return;
      }
    }

    const layout = computeTextLayout(state.canvasW, state.canvasH);
    if (layout) {
      const b = computeTextBoundsFromLayout(state.canvasW, state.canvasH, layout);
      // a little slop around the tight text bounds -- makes it easier to grab
      // (rather than needing to hit the exact glyph edges), and absorbs the
      // odd sub-pixel rounding difference between the click point and a bound
      // that landed exactly on it (e.g. a drag that starts right at the last
      // line's baseline).
      const pad = 14 * (state.canvasW / 1080);
      if (p.x >= b.left - pad && p.x <= b.right + pad && p.y >= b.top - pad && p.y <= b.bottom + pad) {
        textDragging = true;
        dragGuideTarget = 'text';
        textDragStart = { clientX: e.clientX, clientY: e.clientY, vAlign: state.text.vAlign, crossAlign: state.text.crossAlign };
        canvas.setPointerCapture(e.pointerId);
        render();
      }
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (state.positionEditMode) {
      if (!activePointers.has(e.pointerId)) return;
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointers.size === 2) {
        const pts = [...activePointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (pinchStartDist > 0) {
          setImageZoom(pinchStartZoom * (dist / pinchStartDist));
          imageZoom.value = Math.round(state.imageTransform.zoom * 100);
          imageZoomVal.textContent = `${imageZoom.value}%`;
          render();
        }
        return;
      }

      if (photoDragging && panStart) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = state.canvasW / rect.width;
        const scaleY = state.canvasH / rect.height;
        const dxCanvas = (e.clientX - panStart.clientX) * scaleX;
        const dyCanvas = (e.clientY - panStart.clientY) * scaleY;
        // offsetXPct/offsetYPct are fractions of the *unrotated* image, but
        // the drag happens in on-screen (rotated) space -- map the screen
        // delta back into the image's own local axes first. This is the
        // inverse of the draw rotation in drawImageCover, i.e. rotating the
        // screen delta by -rotation (derived the same way as the vertical
        // text drag mapping above).
        const rotation = state.imageTransform.rotation || 0;
        let du, dv;
        if (rotation === 90) { du = dyCanvas; dv = -dxCanvas; }
        else if (rotation === 180) { du = -dxCanvas; dv = -dyCanvas; }
        else if (rotation === 270) { du = -dyCanvas; dv = dxCanvas; }
        else { du = dxCanvas; dv = dyCanvas; }
        const scale = coverScaleFor(state.image, state.canvasW, state.canvasH) * state.imageTransform.zoom;
        const dxFrac = -du / (state.image.naturalWidth * scale);
        const dyFrac = -dv / (state.image.naturalHeight * scale);
        const clamped = clampImageOffset(
          panStart.offsetXPct + dxFrac, panStart.offsetYPct + dyFrac,
          state.imageTransform.zoom, state.image, state.canvasW, state.canvasH
        );
        state.imageTransform.offsetXPct = clamped.offsetXPct;
        state.imageTransform.offsetYPct = clamped.offsetYPct;
        render();
      }
      return;
    }

    if (magnifierDragMode) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = state.canvasW / rect.width;
      const scaleY = state.canvasH / rect.height;
      const dxCanvas = (e.clientX - magnifierDragStart.clientX) * scaleX;
      const dyCanvas = (e.clientY - magnifierDragStart.clientY) * scaleY;
      const loupe = state.magnifier.loupes[state.magnifier.activeLoupe];
      if (!loupe) return;
      if (magnifierDragMode === 'target') {
        loupe.targetX = Math.min(1, Math.max(0, magnifierDragStart.targetX + dxCanvas / state.canvasW));
        loupe.targetY = Math.min(1, Math.max(0, magnifierDragStart.targetY + dyCanvas / state.canvasH));
      } else if (magnifierDragMode === 'loupe') {
        const clamped = clampLoupePosition(loupe, magnifierDragStart.loupeX + dxCanvas / state.canvasW, magnifierDragStart.loupeY + dyCanvas / state.canvasH);
        loupe.loupeX = clamped.x;
        loupe.loupeY = clamped.y;
      } else if (magnifierDragMode === 'pan' && loupe.detailImg) {
        // same idea as the main photo's pan drag: convert the screen-px
        // delta into a fraction of the detail image's own (cover-scaled)
        // on-screen size, independent of which canvas resolution this is
        const { r } = loupeCircle(loupe, state.canvasW, state.canvasH);
        const img = loupe.detailImg;
        const d = r * 2;
        const coverScale = Math.max(d / img.naturalWidth, d / img.naturalHeight);
        const scale = coverScale * loupe.detailZoom;
        const destW = img.naturalWidth * scale, destH = img.naturalHeight * scale;
        const clampedPan = clampDetailPan(loupe, magnifierDragStart.panX - dxCanvas / destW, magnifierDragStart.panY - dyCanvas / destH);
        loupe.detailPanX = clampedPan.x;
        loupe.detailPanY = clampedPan.y;
      }
      render();
      return;
    }

    if (freeTextDragging && freeTextDragStart) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = state.canvasW / rect.width;
      const scaleY = state.canvasH / rect.height;
      const dxCanvas = (e.clientX - freeTextDragStart.clientX) * scaleX;
      const dyCanvas = (e.clientY - freeTextDragStart.clientY) * scaleY;
      const box = activeFreeTextBoxObj();
      if (box) {
        // no left/right/top/bottom margin clamp, unlike the headline block --
        // free to place anywhere on the canvas, per spec
        box.xPct = Math.min(1, Math.max(0, freeTextDragStart.xPct + dxCanvas / state.canvasW));
        box.yPct = Math.min(1, Math.max(0, freeTextDragStart.yPct + dyCanvas / state.canvasH));
      }
      render();
      return;
    }

    if (dragging) {
      const p = clientToCanvas(e.clientX, e.clientY);
      const clamped = clampLogoPosition(p.x / state.canvasW, p.y / state.canvasH);
      state.logo.xPct = clamped.xPct;
      state.logo.yPct = clamped.yPct;
      state.logo.manuallyPositioned = true;
      render();
      return;
    }

    if (starsDragging) {
      const p = clientToCanvas(e.clientX, e.clientY);
      const clamped = clampStarsPosition(p.x / state.canvasW, p.y / state.canvasH);
      state.stars.xPct = clamped.xPct;
      state.stars.yPct = clamped.yPct;
      render();
      return;
    }

    if (textDragging && textDragStart) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = state.canvasW / rect.width;
      const scaleY = state.canvasH / rect.height;
      const dxCanvas = (e.clientX - textDragStart.clientX) * scaleX;
      const dyCanvas = (e.clientY - textDragStart.clientY) * scaleY;
      const layout = computeTextLayout(state.canvasW, state.canvasH);
      if (!layout) return;
      const vSpan = (layout.bottommostY - layout.topmostY) || 1;
      const cSpan = (layout.rightmostX - layout.leftmostX) || 1;
      // converts real canvas-pixel drag deltas into vAlign/crossAlign
      // fraction deltas -- the mapping depends on orientation, since
      // vertical text's two axes are rotated relative to the screen (see
      // computeTextLayout's rotation-matrix comment)
      let dVAlignFrac, dCrossFrac;
      if (!layout.vertical) {
        dVAlignFrac = dyCanvas / vSpan;
        dCrossFrac = dxCanvas / cSpan;
      } else if (layout.orientation === 'vertical-flipped') {
        dVAlignFrac = dxCanvas / vSpan;
        dCrossFrac = -dyCanvas / cSpan;
      } else {
        dVAlignFrac = -dxCanvas / vSpan;
        dCrossFrac = dyCanvas / cSpan;
      }
      state.text.vAlign = Math.min(100, Math.max(0, textDragStart.vAlign + dVAlignFrac * 100));
      state.text.crossAlign = Math.min(100, Math.max(0, textDragStart.crossAlign + dCrossFrac * 100));
      textVPos.value = Math.round(state.text.vAlign);
      textCrossAlign.value = Math.round(state.text.crossAlign);
      render();
    }
  });

  function endDrag(e) {
    if (state.positionEditMode) {
      if (e && activePointers.has(e.pointerId)) {
        activePointers.delete(e.pointerId);
        if (activePointers.size === 0) {
          photoDragging = false;
          panStart = null;
          pinchStartDist = 0;
        } else if (activePointers.size === 1) {
          // one finger lifted mid-pinch -- resume single-finger panning from here
          const [pt] = [...activePointers.values()];
          photoDragging = true;
          panStart = {
            clientX: pt.x, clientY: pt.y,
            offsetXPct: state.imageTransform.offsetXPct, offsetYPct: state.imageTransform.offsetYPct,
          };
          pinchStartDist = 0;
        }
      } else {
        activePointers.clear();
        photoDragging = false;
        panStart = null;
        pinchStartDist = 0;
      }
      render();
      return;
    }
    dragging = false;
    starsDragging = false;
    textDragging = false;
    textDragStart = null;
    dragGuideTarget = null;
    magnifierDragMode = null;
    magnifierDragStart = null;
    freeTextDragging = false;
    freeTextDragStart = null;
    render();
  }
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

  // scales the export up past the preset's baseline resolution when the
  // photo's own cropped-in pixels have more detail than that baseline would
  // capture, so the photo (and everything drawn on top of it) never gets
  // downsampled below the source's native sharpness. Capped to stay well
  // within mobile browsers' canvas memory limits.
  const MAX_EXPORT_DIMENSION = 4096;
  function computeExportScale() {
    if (!state.image) return 1;
    const scale = coverScaleFor(state.image, state.canvasW, state.canvasH) * state.imageTransform.zoom;
    const neededScale = Math.max(1 / scale, 1);
    const maxAllowedScale = MAX_EXPORT_DIMENSION / Math.max(state.canvasW, state.canvasH);
    return Math.min(neededScale, maxAllowedScale);
  }

  async function exportImage() {
    if (!state.image) return;
    exportBtn.disabled = true;
    exportBtn.textContent = 'Exporting…';
    const previewCtx = ctx;
    try {
      const scale = computeExportScale();
      const exportW = Math.round(state.canvasW * scale);
      const exportH = Math.round(state.canvasH * scale);

      const offscreen = document.createElement('canvas');
      offscreen.width = exportW;
      offscreen.height = exportH;
      try {
        ctx = offscreen.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        paintComposite(exportW, exportH, false);
      } finally {
        ctx = previewCtx;
      }

      const blob = await new Promise(resolve => offscreen.toBlob(resolve, 'image/png'));
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

  // ---------- Ken Burns video export (Position tab: pan/zoom between two keyframes) ----------

  let videoKeyframeA = null; // { zoom, offsetXPct, offsetYPct } snapshots of imageTransform
  let videoKeyframeB = null;
  let videoDurationSec = 4;

  function snapshotImageTransform() {
    return { zoom: state.imageTransform.zoom, offsetXPct: state.imageTransform.offsetXPct, offsetYPct: state.imageTransform.offsetYPct };
  }

  function lerpTransform(a, b, t) {
    return {
      zoom: a.zoom + (b.zoom - a.zoom) * t,
      offsetXPct: a.offsetXPct + (b.offsetXPct - a.offsetXPct) * t,
      offsetYPct: a.offsetYPct + (b.offsetYPct - a.offsetYPct) * t,
    };
  }

  function easeInOutT(t) { return t * t * (3 - 2 * t); } // smoothstep

  function pickVideoMimeType() {
    if (!window.MediaRecorder) return '';
    const candidates = [
      'video/mp4;codecs=avc1', 'video/mp4',                                   // Safari
      'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm',         // Chrome/Firefox/Android
    ];
    for (const c of candidates) {
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c)) return c;
    }
    return '';
  }

  // video gets its own (lower) resolution cap than image export -- rendering
  // a full composite 30x/sec for several seconds needs to stay smooth on a
  // phone, so this favours frame-rate over the max sharpness a still export
  // would use.
  const MAX_VIDEO_DIMENSION = 1920;
  function computeScaleForTransform(transform, maxDimension) {
    if (!state.image) return 1;
    const scale = coverScaleFor(state.image, state.canvasW, state.canvasH) * transform.zoom;
    const neededScale = Math.max(1 / scale, 1);
    const maxAllowedScale = maxDimension / Math.max(state.canvasW, state.canvasH);
    return Math.min(neededScale, maxAllowedScale);
  }
  function computeExportScaleForVideo() {
    return Math.max(
      computeScaleForTransform(videoKeyframeA, MAX_VIDEO_DIMENSION),
      computeScaleForTransform(videoKeyframeB, MAX_VIDEO_DIMENSION)
    );
  }

  const exportVideoBtn = document.getElementById('exportVideoBtn');

  function updateVideoKeyframeUI() {
    document.getElementById('setPointABtn').textContent = videoKeyframeA ? 'Point A ✓ (tap to update)' : 'Set Point A';
    document.getElementById('setPointBBtn').textContent = videoKeyframeB ? 'Point B ✓ (tap to update)' : 'Set Point B';
    exportVideoBtn.disabled = !(videoKeyframeA && videoKeyframeB && state.image);
  }

  document.getElementById('setPointABtn').addEventListener('click', () => {
    if (!state.image) { alert('Upload a photo first.'); return; }
    videoKeyframeA = snapshotImageTransform();
    updateVideoKeyframeUI();
  });
  document.getElementById('setPointBBtn').addEventListener('click', () => {
    if (!state.image) { alert('Upload a photo first.'); return; }
    videoKeyframeB = snapshotImageTransform();
    updateVideoKeyframeUI();
  });

  const videoDuration = document.getElementById('videoDuration');
  const videoDurationVal = document.getElementById('videoDurationVal');
  videoDuration.addEventListener('input', () => {
    videoDurationSec = Number(videoDuration.value);
    videoDurationVal.textContent = `${videoDurationSec}s`;
  });

  async function recordKenBurnsVideo() {
    if (!state.image) { alert('Upload a photo first.'); return; }
    if (!videoKeyframeA || !videoKeyframeB) { alert('Set both Point A and Point B first.'); return; }
    const mimeType = pickVideoMimeType();
    if (!mimeType) { alert("This browser doesn't support recording video. Try a recent Chrome or Safari."); return; }

    exportVideoBtn.disabled = true;
    exportVideoBtn.textContent = 'Recording…';
    const previewCtx = ctx;
    const originalTransform = state.imageTransform;
    let offscreenEl = null;

    try {
      const scale = computeExportScaleForVideo();
      const exportW = Math.round(state.canvasW * scale);
      const exportH = Math.round(state.canvasH * scale);

      const offscreen = document.createElement('canvas');
      offscreen.width = exportW;
      offscreen.height = exportH;
      // captureStream() needs the canvas actually in the rendered document
      // to produce real frames in some browsers -- kept off-screen and
      // invisible, but present in the DOM for the duration of the recording
      offscreen.style.cssText = 'position:fixed; left:-99999px; top:0; width:1px; height:1px;';
      document.body.appendChild(offscreen);
      offscreenEl = offscreen;
      const offCtx = offscreen.getContext('2d');
      offCtx.imageSmoothingEnabled = true;
      offCtx.imageSmoothingQuality = 'high';

      const stream = offscreen.captureStream(30);
      // no explicit videoBitsPerSecond: some browsers silently produce a
      // zero-byte recording at this resolution when one is specified --
      // letting the browser pick its own default bitrate is reliable
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
      recorder.start();

      ctx = offCtx;
      const durationMs = videoDurationSec * 1000;
      const startTime = performance.now();
      await new Promise((resolve) => {
        function frame(now) {
          const rawT = Math.min((now - startTime) / durationMs, 1);
          // rotation isn't part of the animated pan/zoom keyframes -- it's a
          // fixed orientation choice, so it's carried through from the live
          // transform rather than interpolated (there's nothing to interpolate:
          // both keyframes were taken at whatever the current rotation is)
          state.imageTransform = { ...lerpTransform(videoKeyframeA, videoKeyframeB, easeInOutT(rawT)), rotation: originalTransform.rotation || 0 };
          paintComposite(exportW, exportH, false);
          if (rawT < 1) requestAnimationFrame(frame);
          else resolve();
        }
        requestAnimationFrame(frame);
      });

      recorder.stop();
      await stopped;
      ctx = previewCtx;
      state.imageTransform = originalTransform;
      render();
      offscreenEl.remove();
      offscreenEl = null;

      const blob = new Blob(chunks, { type: mimeType.split(';')[0] });
      const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
      const file = new File([blob], `ad-creative-${Date.now()}.${ext}`, { type: blob.type });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Ad Creative video' });
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
      ctx = previewCtx;
      state.imageTransform = originalTransform;
      render();
      if (err && err.name !== 'AbortError') {
        console.error(err);
        alert('Video export failed. Please try again.');
      }
    } finally {
      if (offscreenEl) offscreenEl.remove();
      updateVideoKeyframeUI();
      exportVideoBtn.textContent = 'Export video';
    }
  }

  exportVideoBtn.addEventListener('click', recordKenBurnsVideo);

  // ---------- init ----------

  function setSegmentedActive(containerId, val) {
    document.querySelectorAll(`#${containerId} button`).forEach(b => b.classList.toggle('active', b.dataset.val === val));
  }

  function syncAllControlsFromState() {
    ['headline', 'subheader', 'other'].forEach(syncLayerPanel);
    document.getElementById('textBlockEnabled').checked = state.text.enabled;
    document.getElementById('otherEnabled').checked = state.text.layers.other.enabled;
    document.getElementById('subheaderEnabled').checked = state.text.layers.subheader.enabled;

    setSegmentedActive('fadeDirection', state.fade.direction);
    setSegmentedActive('textHAlign', state.text.hAlign);
    setSegmentedActive('textOrientation', state.text.orientation || 'horizontal');
    updateTextVPosLabels();
    updateTextOrientationRows();
    textVPos.value = state.text.vAlign;
    textCrossAlign.value = typeof state.text.crossAlign === 'number' ? state.text.crossAlign : 50;

    fadeReach.value = state.fade.reach;
    fadeReachVal.textContent = `${state.fade.reach}%`;
    fadeSpeed.value = state.fade.speed;
    fadeSpeedVal.textContent = speedValueToLabel(state.fade.speed);
    fadeIntensity.value = state.fade.intensity;
    fadeIntensityVal.textContent = `${state.fade.intensity}%`;
    document.getElementById('fadeColor').value = state.fade.color;
    document.getElementById('fadeTextured').checked = state.fade.textured;
    fadeTextureIntensity.value = state.fade.textureIntensity;
    fadeTextureIntensityVal.textContent = `${state.fade.textureIntensity}%`;
    fadeTextureGrainSize.value = state.fade.textureGrainSize;

    effectGrain.value = state.effects.grain;
    effectGrainVal.textContent = `${state.effects.grain}%`;
    effectGrainSize.value = state.effects.grainSize;
    effectVignette.value = state.effects.vignette;
    effectVignetteVal.textContent = `${state.effects.vignette}%`;
    effectWarmth.value = state.effects.warmth;
    effectWarmthVal.textContent = `${state.effects.warmth}%`;
    setSegmentedActive('filmStock', state.effects.filmStock);
    filmStockIntensityRow.style.display = state.effects.filmStock === 'none' ? 'none' : 'flex';
    filmStockIntensity.value = state.effects.filmStockIntensity;
    filmStockIntensityVal.textContent = `${state.effects.filmStockIntensity}%`;
    updateTechOpticsRowVisibility();
    ['Aberration', 'Bloom', 'Grain', 'Flare', 'Vignette', 'Hud'].forEach((name) => {
      document.getElementById(`techOptics${name}`).checked = state.effects[`techOptics${name}`];
    });
    techOpticsHudTextInput.value = state.effects.techOpticsHudText;
    updateFrontierRowVisibility();
    ['Halation', 'Grain', 'Haze', 'Flare', 'Vignette'].forEach((name) => {
      document.getElementById(`frontier${name}`).checked = state.effects[`frontier${name}`];
    });

    logoSize.value = state.logo.sizePct;
    logoSizeVal.textContent = `${state.logo.sizePct}%`;
    setSegmentedActive('logoColorMode', state.logo.colorMode);
    logoCustomColorRow.style.display = state.logo.colorMode === 'custom' ? 'flex' : 'none';
    document.getElementById('logoCustomColor').value = state.logo.customColor;
    document.querySelector('#logoFlip button[data-val="h"]').classList.toggle('active', !!state.logo.flipH);
    document.querySelector('#logoFlip button[data-val="v"]').classList.toggle('active', !!state.logo.flipV);

    document.getElementById('starsEnabled').checked = state.stars.enabled;
    starsSize.value = state.stars.sizePct;
    starsSizeVal.textContent = `${state.stars.sizePct}%`;
    document.getElementById('starsColor').value = state.stars.color;

    marginSlider.value = Math.round(state.marginFrac * 100);
    marginVal.textContent = `${marginSlider.value}%`;
    marginVSlider.value = Math.round(state.marginVFrac * 100);
    marginVVal.textContent = `${marginVSlider.value}%`;
    logoVPos.value = yPctToLogoVPosValue(state.logo.yPct);
    starsHPos.value = xPctToStarsHPosValue(state.stars.xPct);
    starsVPos.value = yPctToStarsVPosValue(state.stars.yPct);

    imageZoom.value = Math.round(state.imageTransform.zoom * 100);
    imageZoomVal.textContent = `${imageZoom.value}%`;

    safeZoneToggle.checked = state.safeZone;
    presetSelect.value = state.preset;

    syncMagnifierPanelFromState();
    syncFreeTextPanelFromState();
  }

  async function init() {
    ['headline', 'subheader', 'other'].forEach(wireLayerPanel);

    const { hasRecipe } = await restoreSession();
    if (!hasRecipe) loadPrefs();
    updateSaveButtonLabel();

    syncAllControlsFromState();
    refreshRecipeList();
    updateVideoKeyframeUI();

    applyPreset(state.preset);
    if (!hasRecipe) applyLogoCorner('bottom-right');

    fitStageToViewport();
    render();

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
          .then((reg) => reg.update().catch(() => {}))
          .catch(() => {});
      });

      // once a new service worker takes over, reload so the page picks up
      // the fresh HTML/JS it just installed, instead of staying stuck on
      // whatever was already loaded
      let reloadedForUpdate = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloadedForUpdate) return;
        reloadedForUpdate = true;
        window.location.reload();
      });
    }

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => render());
    }
  }

  init();
})();

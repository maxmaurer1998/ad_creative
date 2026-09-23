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

  const state = {
    preset: '1080x1350',
    canvasW: 1080,
    canvasH: 1350,
    safeZone: false,
    marginFrac: DEFAULT_MARGIN_FRAC, // left/right margin, shared by text wrap and logo drag clamp
    marginVFrac: DEFAULT_MARGIN_V_FRAC, // top/bottom margin, shared by text vertical range and logo vertical clamp
    image: null,   // HTMLImageElement
    imageTransform: { zoom: 1, offsetXPct: 0.5, offsetYPct: 0.5 }, // pan/zoom, tied to this specific photo
    positionEditMode: false, // true only while the Position tab is open
    logo: {
      img: null,
      xPct: 0.82,   // center x, fraction of canvas width
      yPct: 0.88,   // center y, fraction of canvas height
      sizePct: 18,  // width as % of canvas width
      manuallyPositioned: false,
      colorMode: 'original', // 'original' | 'custom' | 'fade'
      customColor: '#ffffff',
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
      hAlign: 'center',
      vAlign: 100, // 0=top .. 100=bottom, continuous
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
  const legibilityBanner = document.getElementById('legibilityBanner');
  const exportBtn = document.getElementById('exportBtn');
  const imageInput = document.getElementById('imageInput');
  const logoInput = document.getElementById('logoInput');
  const presetSelect = document.getElementById('presetSelect');
  const safeZoneRow = document.getElementById('safeZoneRow');
  const safeZoneToggle = document.getElementById('safeZoneToggle');

  // ---------- persistence (IndexedDB: session "recipe" + photo/logo blobs + a named recipe library) ----------

  const IDB_NAME = 'adcreative-db';
  const IDB_VERSION = 3;
  const IDB_STORE_KV = 'kv';             // session state: recipe / photoBlob / logoBlob / savedLogo / imageTransform
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
  // inside the value itself, so it must NOT be passed separately
  async function idbPut(store, value) {
    try {
      const db = await idbOpen();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) { /* ignore */ }
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
        hAlign: state.text.hAlign,
        vAlign: state.text.vAlign,
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
      if (recipe.text.hAlign) state.text.hAlign = recipe.text.hAlign;
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
      const { xPct, yPct, sizePct, manuallyPositioned, colorMode, customColor, matchFadeColor } = recipe.logo;
      if (typeof xPct === 'number') state.logo.xPct = xPct;
      if (typeof yPct === 'number') state.logo.yPct = yPct;
      if (typeof sizePct === 'number') state.logo.sizePct = sizePct;
      if (typeof manuallyPositioned === 'boolean') state.logo.manuallyPositioned = manuallyPositioned;
      if (typeof customColor === 'string') state.logo.customColor = customColor;
      if (typeof colorMode === 'string') state.logo.colorMode = colorMode;
      else if (typeof matchFadeColor === 'boolean') state.logo.colorMode = matchFadeColor ? 'fade' : 'original'; // pre-colorMode recipes
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
    const [recipe, photoBlob, logoBlob, savedLogoBlob, imageTransform] = await Promise.all([
      idbGet(IDB_STORE_KV, 'recipe'),
      idbGet(IDB_STORE_KV, 'photoBlob'),
      idbGet(IDB_STORE_KV, 'logoBlob'),
      idbGet(IDB_STORE_KV, 'savedLogo'),
      idbGet(IDB_STORE_KV, 'imageTransform'),
    ]);

    if (recipe) applyRecipeToState(recipe);

    if (photoBlob) {
      const img = await loadImageFromBlob(photoBlob);
      if (img) {
        state.image = img;
        currentPhotoBlob = photoBlob;
        dropHint.classList.add('hidden');
        exportBtn.disabled = false;
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

    return { hasRecipe: !!recipe };
  }

  async function clearSavedSession() {
    // only clear this working session -- the saved default logo and any
    // named recipe templates are deliberate, named saves and are kept
    await idbDelete(IDB_STORE_KV, 'recipe');
    await idbDelete(IDB_STORE_KV, 'photoBlob');
    await idbDelete(IDB_STORE_KV, 'logoBlob');
    await idbDelete(IDB_STORE_KV, 'imageTransform');
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
      renderLibrary();
    } else if (action === 'delete-project') {
      const ok = confirm("Delete this saved project?\n\nThis can't be undone.");
      if (!ok) return;
      await idbDelete(IDB_STORE_PROJECTS, id);
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

  async function saveProjectToCurrentFolder() {
    if (!state.image) { alert('Upload a photo first.'); return; }
    const name = prompt('Name this project:');
    if (!name || !name.trim()) return;

    const thumbnailBlob = await makeThumbnail();
    const photoBlob = currentPhotoBlob;
    let logoBlob = null;
    if (state.logo.img) {
      logoBlob = currentLogoBlob || (await idbGet(IDB_STORE_KV, 'savedLogo')) || null;
    }

    const project = {
      id: makeId(),
      folderId: libraryCurrentFolderId,
      name: name.trim(),
      recipe: serializeRecipe(),
      imageTransform: { ...state.imageTransform },
      photoBlob: photoBlob || null,
      logoBlob,
      thumbnailBlob,
      updatedAt: Date.now(),
    };
    await idbPut(IDB_STORE_PROJECTS, project);
    renderLibrary();
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
        } else {
          state.image = null;
          setCurrentPhotoBlob(null);
          dropHint.classList.remove('hidden');
          exportBtn.disabled = true;
          alert('This project\'s saved photo is damaged and could not be loaded. Its other settings (text, fade, logo) were still restored -- upload the photo again and re-save.');
        }
      } else {
        state.image = null;
        setCurrentPhotoBlob(null);
        dropHint.classList.remove('hidden');
        exportBtn.disabled = true;
        alert('This project was saved without a photo, so the canvas is blank. Its other settings (text, fade, logo) were still restored -- upload a photo and re-save to fix it going forward.');
      }

      if (project.logoBlob) {
        state.logo.img = await loadImageFromBlob(project.logoBlob);
        setCurrentLogoBlob(state.logo.img ? project.logoBlob : null);
      } else {
        state.logo.img = null;
        setCurrentLogoBlob(null);
      }

      if (project.recipe) applyRecipeToState(project.recipe);
      if (project.imageTransform && typeof project.imageTransform.zoom === 'number') {
        state.imageTransform = project.imageTransform;
      } else {
        state.imageTransform = { zoom: 1, offsetXPct: 0.5, offsetYPct: 0.5 };
      }

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
  wireSegmented('textHAlign', (val) => { state.text.hAlign = val; render(); });
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

  const imageZoom = document.getElementById('imageZoom');
  const imageZoomVal = document.getElementById('imageZoomVal');
  imageZoom.addEventListener('input', () => {
    setImageZoom(Number(imageZoom.value) / 100);
    imageZoomVal.textContent = `${imageZoom.value}%`;
    render();
  });

  document.getElementById('resetImagePositionBtn').addEventListener('click', () => {
    state.imageTransform = { zoom: 1, offsetXPct: 0.5, offsetYPct: 0.5 };
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
      state.imageTransform = { zoom: 1, offsetXPct: 0.5, offsetYPct: 0.5 }; // reset crop for the new photo
      imageZoom.value = 100;
      imageZoomVal.textContent = '100%';
      videoKeyframeA = null; // old points don't apply to a new photo's content
      videoKeyframeB = null;
      updateVideoKeyframeUI();
      dropHint.classList.add('hidden');
      exportBtn.disabled = false;
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
    const scrimH = H * (fade.reach / 100);
    if (scrimH <= 0) return;
    const plateauK = speedValueToPlateauK(fade.speed);
    const intensity = (typeof fade.intensity === 'number' ? fade.intensity : 100) / 100;
    const { r, g, b } = hexToRgb(fade.color);

    let yOuter, yInner; // outer = transparent edge, inner = solid edge
    if (fade.direction === 'bottom') {
      yOuter = H - scrimH;
      yInner = H;
    } else {
      yOuter = scrimH;
      yInner = 0;
    }
    const rectY = Math.min(yOuter, yInner);

    // build the gradient on its own transparent layer first (rather than
    // straight onto the already-opaque photo) so an optional texture pass
    // can key off the gradient's *own* alpha and taper with it exactly --
    // compositing over an opaque photo would flatten every pixel's alpha
    // to 1, breaking that falloff.
    const layer = document.createElement('canvas');
    layer.width = W;
    layer.height = scrimH;
    const lctx = layer.getContext('2d');

    const grad = lctx.createLinearGradient(0, yOuter - rectY, 0, yInner - rectY);
    const steps = 48;
    for (let s = 0; s <= steps; s++) {
      const frac = s / steps;
      const alpha = fadeAlphaAt(frac, plateauK) * intensity;
      grad.addColorStop(frac, `rgba(${r},${g},${b},${alpha})`);
    }
    lctx.fillStyle = grad;
    lctx.fillRect(0, 0, W, scrimH);

    if (fade.textured) {
      const grainPx = grainSizeValueToPx(typeof fade.textureGrainSize === 'number' ? fade.textureGrainSize : 25);
      lctx.globalCompositeOperation = 'source-atop';
      lctx.globalAlpha = (typeof fade.textureIntensity === 'number' ? fade.textureIntensity : 100) / 100;
      lctx.drawImage(getFadeNoiseLayer(W, scrimH, grainPx), 0, 0);
      lctx.globalAlpha = 1;
    }

    ctx.drawImage(layer, 0, rectY);
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

  // average fade alpha across a vertical span [y0,y1] (for legibility check)
  function avgFadeAlphaOverSpan(W, H, fade, y0, y1) {
    const scrimH = H * (fade.reach / 100);
    if (scrimH <= 0) return 0;
    const plateauK = speedValueToPlateauK(fade.speed);
    const intensity = (typeof fade.intensity === 'number' ? fade.intensity : 100) / 100;
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
        else alpha = fadeAlphaAt((y - zoneStart) / scrimH, plateauK) * intensity;
      } else {
        if (y >= zoneStart) alpha = 0;
        else alpha = fadeAlphaAt((zoneStart - y) / scrimH, plateauK) * intensity;
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

    // vAlign is 0 (top) .. 100 (bottom); vPad keeps the block from ever
    // touching the very top/bottom edge, however far it's slid
    const vPad = H * state.marginVFrac;
    const topmostY = vPad;
    const bottommostY = H - vPad - totalHeight;
    const startY = topmostY + (bottommostY - topmostY) * (state.text.vAlign / 100);

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
    const margin = state.marginFrac;
    const marginV = state.marginVFrac;
    const sizeFrac = state.logo.sizePct / 100;
    const halfW = sizeFrac / 2;
    const aspect = state.logo.img ? state.logo.img.naturalHeight / state.logo.img.naturalWidth : 1;
    const halfH = (sizeFrac * aspect) / 2 * (state.canvasW / state.canvasH);

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
    const sizeFrac = state.logo.sizePct / 100;
    const halfW = sizeFrac / 2;
    const aspect = state.logo.img ? state.logo.img.naturalHeight / state.logo.img.naturalWidth : 1;
    const halfH = (sizeFrac * aspect) / 2 * (state.canvasW / state.canvasH);
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
    const w = (state.logo.sizePct / 100) * W;
    const h = w * (state.logo.img.naturalHeight / state.logo.img.naturalWidth);
    const cx = state.logo.xPct * W;
    const cy = state.logo.yPct * H;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
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
    ctx.drawImage(source, r.x, r.y, r.w, r.h);
  }

  // ---------- logo margin guide lines (shown while dragging) ----------

  let showLogoGuides = false;

  function drawLogoGuides(W, H) {
    if (!showLogoGuides) return;
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
    drawEffects(W, H, state.effects);
    if (includeEditingAids) {
      drawLogoGuides(W, H);
      drawSafeZone(W, H);
    }
    return textBounds;
  }

  function render() {
    const W = state.canvasW, H = state.canvasH;
    const textBounds = paintComposite(W, H, true);
    updateLegibilityBanner(W, H, textBounds);
    logoVPos.value = yPctToLogoVPosValue(state.logo.yPct);
    scheduleSaveRecipe();
  }

  // the scale that fills the frame exactly on one axis (and overflows the
  // other, which the canvas clips naturally) at zoom=1 -- the single
  // reference point the whole zoom range scales from.
  function coverScaleFor(img, W, H) {
    return Math.max(W / img.naturalWidth, H / img.naturalHeight);
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
  function drawImageCover(img, W, H) {
    const t = state.imageTransform;
    const scale = coverScaleFor(img, W, H) * t.zoom;
    const destW = img.naturalWidth * scale, destH = img.naturalHeight * scale;
    const destX = W / 2 - t.offsetXPct * destW;
    const destY = H / 2 - t.offsetYPct * destH;
    ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, destX, destY, destW, destH);
  }

  // clamps a pan offset to keep the image from being dragged completely out
  // of view. On an axis where the image overflows the frame (destW >= W or
  // destH >= H -- always true at zoom >= 1), this keeps it full-bleed: no
  // gap ever opens up on either edge. Below that, the image is already
  // smaller than the frame on that axis and free to move -- the same
  // min/max span just runs the other way (from "flush against the start
  // edge" to "flush against the end edge"), so it can be dragged to sit
  // anywhere in the white margin, e.g. flush top instead of only centred.
  function clampImageOffset(offsetXPct, offsetYPct, zoom, img, W, H) {
    const scale = coverScaleFor(img, W, H) * zoom;
    const destW = img.naturalWidth * scale, destH = img.naturalHeight * scale;
    const halfWFrac = destW > 0 ? W / (2 * destW) : 0.5;
    const halfHFrac = destH > 0 ? H / (2 * destH) : 0.5;
    const loX = Math.min(halfWFrac, 1 - halfWFrac), hiX = Math.max(halfWFrac, 1 - halfWFrac);
    const loY = Math.min(halfHFrac, 1 - halfHFrac), hiY = Math.max(halfHFrac, 1 - halfHFrac);
    return {
      offsetXPct: Math.min(Math.max(offsetXPct, loX), hiX),
      offsetYPct: Math.min(Math.max(offsetYPct, loY), hiY),
    };
  }

  function updateLegibilityBanner(W, H, textBounds) {
    if (!textBounds) { legibilityBanner.classList.add('hidden'); return; }
    const avgAlpha = avgFadeAlphaOverSpan(W, H, state.fade, textBounds.top, textBounds.bottom);
    if (avgAlpha < 0.4) {
      const towardFadeEdge = state.fade.direction === 'bottom' ? 'down, toward the bottom' : 'up, toward the top';
      const suggestion = `try sliding the text ${towardFadeEdge}, or increase the fade's reach/intensity`;
      legibilityBanner.textContent = `Text may be hard to read here — ${suggestion}.`;
      legibilityBanner.classList.remove('hidden');
    } else {
      legibilityBanner.classList.add('hidden');
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

  // ---------- logo drag + photo pan/zoom (mode-exclusive on the canvas) ----------

  let dragging = false; // logo drag
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

    if (!state.logo.img) return;
    const p = clientToCanvas(e.clientX, e.clientY);
    const r = logoRect(state.canvasW, state.canvasH);
    if (!r) return;
    if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
      dragging = true;
      showLogoGuides = true;
      canvas.setPointerCapture(e.pointerId);
      render();
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
        const scale = coverScaleFor(state.image, state.canvasW, state.canvasH) * state.imageTransform.zoom;
        const dxFrac = -dxCanvas / (state.image.naturalWidth * scale);
        const dyFrac = -dyCanvas / (state.image.naturalHeight * scale);
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

    if (!dragging) return;
    const p = clientToCanvas(e.clientX, e.clientY);
    const clamped = clampLogoPosition(p.x / state.canvasW, p.y / state.canvasH);
    state.logo.xPct = clamped.xPct;
    state.logo.yPct = clamped.yPct;
    state.logo.manuallyPositioned = true;
    render();
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
    showLogoGuides = false;
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
          state.imageTransform = lerpTransform(videoKeyframeA, videoKeyframeB, easeInOutT(rawT));
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
    document.getElementById('otherEnabled').checked = state.text.layers.other.enabled;
    document.getElementById('subheaderEnabled').checked = state.text.layers.subheader.enabled;

    setSegmentedActive('fadeDirection', state.fade.direction);
    setSegmentedActive('textHAlign', state.text.hAlign);
    textVPos.value = state.text.vAlign;

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

    marginSlider.value = Math.round(state.marginFrac * 100);
    marginVal.textContent = `${marginSlider.value}%`;
    marginVSlider.value = Math.round(state.marginVFrac * 100);
    marginVVal.textContent = `${marginVSlider.value}%`;
    logoVPos.value = yPctToLogoVPosValue(state.logo.yPct);

    imageZoom.value = Math.round(state.imageTransform.zoom * 100);
    imageZoomVal.textContent = `${imageZoom.value}%`;

    safeZoneToggle.checked = state.safeZone;
    presetSelect.value = state.preset;
  }

  async function init() {
    ['headline', 'subheader', 'other'].forEach(wireLayerPanel);

    const { hasRecipe } = await restoreSession();
    if (!hasRecipe) loadPrefs();

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

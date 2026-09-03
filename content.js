let config = { ocrKey: '', deeplKey: '', targetLang: 'ES', mode: 'auto', autoDetect: true };
let busy = false;
let manualEdits = {};

const OVERLAY_CLASS = 'mt-overlay-text';
const BUBBLE_CLASS = 'mt-bubble';

chrome.storage.sync.get({
  ocrKey: '', deeplKey: '', targetLang: 'ES', mode: 'auto', autoDetect: true
}, (cfg) => { config = cfg; });

chrome.storage.local.get({ manualEdits: {} }, (r) => { manualEdits = r.manualEdits || {}; });

function normKey(t) {
  return (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function manualFor(originalText) {
  return manualEdits[normKey(originalText)] || null;
}

function saveManualEdit(originalText, correctedText) {
  manualEdits[normKey(originalText)] = correctedText;
  chrome.storage.local.set({ manualEdits });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'RUN_TRANSLATE') {
    if (msg.config) Object.assign(config, msg.config);
    startTranslation()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg.type === 'PING') sendResponse({ ok: true });
  if (msg.type === 'SET_MODE') {
    config.mode = msg.mode;
    if (msg.mode === 'click') clearOverlays();
    sendResponse({ ok: true });
  }
  if (msg.type === 'CLEAR_ALL') {
    clearOverlays();
    closePanel();
    sendResponse({ ok: true });
  }
});

function getAllMangaImages() {
  const candidates = [];
  document.querySelectorAll('img').forEach((img) => {
    if (!img.complete || !img.src) return;
    if (img.naturalWidth < 400 || img.naturalHeight < 300) return;
    const src = (img.currentSrc || img.src).toLowerCase();
    if (/logo|icon|avatar|spinner|loading|banner|credit|\.svg|data:image|thumbnail|thumb|button|emoji/.test(src)) return;
    if (/^data:/i.test(src)) return;
    const inReader = img.closest('#chapter-reader, .chapter-reader, [id*="reader"], [class*="reader"]');
    const inChapter = img.closest('#chapter-article, article[class*="chapter"], [class*="page-in"]');
    const isMain = img.naturalWidth >= 600;
    const priority = inReader ? 3 : (inChapter ? 2.5 : 2.2);
    if (inReader || inChapter || (isMain && priority >= 2.2)) {
      candidates.push({ img, url: src, priority });
    }
  });
  candidates.sort((a, b) => b.priority - a.priority);
  return candidates;
}

async function startTranslation() {
  if (busy) return;
  busy = true;
  try {
    if (config.mode === 'click') { setupClickMode(); return; }
    let targets;
    if (config.scope === 'visible') {
      targets = visibleImages();
    } else {
      targets = getAllMangaImages();
    }
    if (!targets.length) { console.warn('[MangaTranslator] Sin imágenes'); return; }
    console.log('[MangaTranslator] Imágenes a procesar:', targets.length);
    for (const target of targets) {
      await translateImageByUrl(target);
    }
  } finally {
    busy = false;
  }
}

function visibleImages() {
  const vh = window.innerHeight;
  return getAllMangaImages().filter((c) => {
    const r = c.img.getBoundingClientRect();
    return r.top < vh && r.bottom > 0;
  });
}

async function translateImageByUrl(target) {
  console.log('[MangaTranslator] OCR de:', target.url);
  const ocrRes = await chrome.runtime.sendMessage({
    type: 'OCR_URL', url: target.url, apikey: config.ocrKey,
    imgW: target.img.naturalWidth, imgH: target.img.naturalHeight
  });
  console.log('[MangaTranslator] Respuesta OCR:', ocrRes && ocrRes.ok ? 'ok, texto=' + (ocrRes.text || '').length + ' chars' : 'ERROR');
  if (!ocrRes.ok) { console.warn('[MangaTranslator] OCR error:', ocrRes.error); return null; }
  if (!ocrRes.text || !ocrRes.text.trim()) { console.log('[MangaTranslator] Imagen sin texto'); return null; }

  const rawRegions = (ocrRes.regions || []).filter((r) => r.text && r.text.trim());
  const regions = groupRegions(rawRegions, target.img.naturalHeight);
  console.log('[MangaTranslator] Regiones:', rawRegions.length, '→ grupos:', regions.length);

  let shown = 0;
  for (const g of regions) {
    const edited = manualFor(g.text);
    const sourceText = edited || g.text;
    const translated = await translateText(sourceText);
    if (!translated || translated.trim() === sourceText.trim()) continue;
    showOverlayAt(target.img, g.left, g.top, g.width, g.height, sourceText, translated, g.text);
    shown++;
  }
  if (shown === 0) {
    const translated = await translateText(ocrRes.text);
    if (translated && translated.trim() !== ocrRes.text.trim()) showPanel(translated);
  }
  return shown > 0 ? ocrRes.text : null;
}

function groupRegions(regions, imgHeight) {
  if (!regions.length) return [];
  const sorted = regions.slice().sort((a, b) => a.top - b.top);
  const groups = [];

  for (const r of sorted) {
    let placed = false;
    for (const g of groups) {
      const gBottom = g.top + g.height;
      const gap = r.top - gBottom;
      if (gap < -1) continue;
      const lineHeight = Math.max(g.height, r.height);
      const maxGap = lineHeight * 0.5;
      if (gap > maxGap) continue;
      const horizOverlap = Math.min(g.left + g.width, r.left + r.width) - Math.max(g.left, r.left);
      const overlapRatio = horizOverlap / Math.min(g.width, r.width);
      if (overlapRatio > 0.5) {
        g.left = Math.min(g.left, r.left);
        g.top = Math.min(g.top, r.top);
        g.width = Math.max(g.left + g.width, r.left + r.width) - g.left;
        g.height = Math.max(g.top + g.height, r.top + r.height) - g.top;
        g.text = g.text + ' ' + r.text;
        placed = true;
        break;
      }
    }
    if (!placed) {
      groups.push({ ...r });
    }
  }

  return groups;
}

function regionClickable() { return true; }

async function translateText(text) {
  if (!config.deeplKey) return text;
  try {
    const res = await chrome.runtime.sendMessage({ type: 'TRANSLATE', text, targetLang: config.targetLang, apikey: config.deeplKey });
    if (res && !res.ok) console.warn('[MangaTranslator] DeepL error:', res.error);
    return res && res.ok ? res.text : text;
  } catch (e) { console.warn('[MangaTranslator] DeepL excepción', e); return text; }
}

function showPanel(text, linkedOverlay) {
  closePanel();
  const panel = document.createElement('div');
  panel.id = 'mt-panel';

  const label = document.createElement('div');
  label.className = 'mt-panel-label';
  label.textContent = 'Fuente (inglés) - editable:';

  const inp = document.createElement('textarea');
  inp.className = 'mt-panel-input';
  inp.value = text;
  inp.spellcheck = false;
  inp.addEventListener('keydown', (ev) => {
    const k = ev.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown' ||
        k === 'PageUp' || k === 'PageDown' || k === 'Home' || k === 'End' || k === ' ') {
      ev.stopPropagation();
    }
  });

  const outLabel = document.createElement('div');
  outLabel.className = 'mt-panel-label';
  outLabel.textContent = 'Traducción (español):';

  const out = document.createElement('div');
  out.className = 'mt-panel-out';

  const refreshOutput = () => {
    out.textContent = (linkedOverlay && linkedOverlay.dataset.translated) || '';
  };
  refreshOutput();

  const btnRow = document.createElement('div');
  btnRow.className = 'mt-panel-btns';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'mt-panel-btn';
  saveBtn.textContent = 'Guardar y retraducir';
  saveBtn.addEventListener('click', async () => {
    const edited = inp.value.trim();
    if (!edited) return;
    saveBtn.textContent = '...';
    saveBtn.disabled = true;
    const translated = await translateText(edited);
    if (linkedOverlay) {
      const ocrKey = linkedOverlay.dataset.ocr;
      saveManualEdit(ocrKey, edited);
      linkedOverlay.textContent = translated;
      linkedOverlay.dataset.original = edited;
      linkedOverlay.dataset.translated = translated;
    }
    refreshOutput();
    saveBtn.textContent = 'Guardar y retraducir';
    saveBtn.disabled = false;
  });
  btnRow.appendChild(saveBtn);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'mt-panel-btn';
  closeBtn.textContent = 'Cerrar';
  closeBtn.addEventListener('click', closePanel);
  btnRow.appendChild(closeBtn);

  panel.appendChild(label);
  panel.appendChild(inp);
  panel.appendChild(outLabel);
  panel.appendChild(out);
  panel.appendChild(btnRow);

  document.body.appendChild(panel);
}

function closePanel() {
  const p = document.getElementById('mt-panel');
  if (p) p.remove();
}

function showOverlayAt(img, leftPct, topPct, widthPct, heightPct, originalText, translatedText, ocrText) {
  const rect = img.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const left = rect.left + window.scrollX;
  const top = rect.top + window.scrollY;
  let wBase = (widthPct / 100) * rect.width;
  let hBase = (heightPct / 100) * rect.height;
  let w = Math.max(30, wBase * 1.6);
  let h = Math.max(24, hBase * 1.5);
  const maxW = rect.width * 0.95;
  const maxH = rect.height * 0.6;
  w = Math.min(w, maxW);
  h = Math.min(h, maxH);

  const el = document.createElement('div');
  el.className = OVERLAY_CLASS;
  el.style.position = 'absolute';
  el.style.left = (left + (leftPct / 100) * rect.width) + 'px';
  el.style.top = (top + (topPct / 100) * rect.height) + 'px';
  el.style.width = w + 'px';
  el.style.minHeight = h + 'px';
  el.style.fontSize = Math.max(9, Math.min(15, h * 0.35)) + 'px';
  el.textContent = translatedText;
  el.dataset.original = originalText;
  el.dataset.translated = translatedText;
  el.dataset.ocr = ocrText || originalText;
  el.dataset.dragging = '0';
  el.dataset.mtImg = img.src;
  el.dataset.leftPct = leftPct;
  el.dataset.topPct = topPct;
  el.dataset.widthPct = widthPct;
  el.dataset.heightPct = heightPct;

  const expandBtn = document.createElement('span');
  expandBtn.className = 'mt-expand';
  expandBtn.textContent = '⤢';
  expandBtn.title = 'Ver completo al lado';
  expandBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    showPanel(el.dataset.original, el);
  });
  el.appendChild(expandBtn);

  const fuseBtn = document.createElement('span');
  fuseBtn.className = 'mt-fuse';
  fuseBtn.textContent = '⧉';
  fuseBtn.title = 'Seleccionar para fusionar con otro cuadro';
  fuseBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    handleFuseSelect(el);
  });
  el.appendChild(fuseBtn);

  const delBtn = document.createElement('span');
  delBtn.className = 'mt-del';
  delBtn.textContent = '✕';
  delBtn.title = 'Eliminar este cuadro';
  delBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    el.remove();
  });
  el.appendChild(delBtn);

  const handle = el;
  handle.addEventListener('mousedown', (ev) => {
    if (ev.target === expandBtn || ev.target === fuseBtn) return;
    ev.preventDefault();
    const startX = ev.clientX, startY = ev.clientY;
    const origLeft = parseFloat(el.style.left), origTop = parseFloat(el.style.top);
    el.dataset.dragging = '1';
    const onMove = (e) => {
      if (el.dataset.dragging !== '1') return;
      el.style.left = (origLeft + (e.clientX - startX)) + 'px';
      el.style.top = (origTop + (e.clientY - startY)) + 'px';
    };
    const onUp = () => {
      el.dataset.dragging = '0';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
  handle.addEventListener('click', () => {
    if (el.dataset.dragging === '1') return;
    showPanel(el.dataset.original, el);
  });

  document.body.appendChild(el);
}

function setupClickMode() {
  if (document.getElementById('mt-crop-hint')) return;
  const hint = document.createElement('div');
  hint.id = 'mt-crop-hint';
  hint.textContent = 'Mantén presionado y arrastra sobre el texto a traducir. Suelta para traducir esa zona.';
  document.body.appendChild(hint);

  let selBox = null;
  let startX = 0, startY = 0, startImg = null;

  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    setupClearSelection();
    const img = e.target.closest('img');
    if (!img || !img.src || /^data:/i.test(img.src) || !img.naturalWidth) return;
    startImg = img;
    startX = e.clientX;
    startY = e.clientY;
    selBox = document.createElement('div');
    selBox.className = 'mt-crop-box';
    document.body.appendChild(selBox);
  });

  document.addEventListener('mousemove', (e) => {
    if (!selBox) return;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    selBox.style.left = x + 'px';
    selBox.style.top = y + 'px';
    selBox.style.width = w + 'px';
    selBox.style.height = h + 'px';
  });

  document.addEventListener('mouseup', async (e) => {
    if (!selBox) return;
    const box = selBox;
    selBox = null;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    if (w < 10 || h < 10) { box.remove(); return; }
    box.remove();
    await translateArea(startImg, x, y, w, h);
  });
}

function setupClearSelection() {
  document.querySelectorAll('.mt-crop-box').forEach((b) => b.remove());
}

async function translateArea(img, xPx, yPx, wPx, hPx) {
  if (!img) return;
  const rect = img.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const ocrRes = await chrome.runtime.sendMessage({
    type: 'OCR_URL', url: img.src, apikey: config.ocrKey,
    imgW: img.naturalWidth, imgH: img.naturalHeight
  });
  if (!ocrRes.ok) { console.warn('[MangaTranslator] OCR error:', ocrRes.error); return; }

  const regions = groupRegions((ocrRes.regions || []).filter((r) => r.text && r.text.trim()), img.naturalHeight);

  let shown = 0;
  for (const g of regions) {
    const edited = manualFor(g.text);
    const sourceText = edited || g.text;
    const translated = await translateText(sourceText);
    if (!translated || translated.trim() === sourceText.trim()) continue;
    showOverlayAt(img, g.left, g.top, g.width, g.height, sourceText, translated, g.text);
    shown++;
  }
  console.log('[MangaTranslator] Modo clic: regiones=', regions.length, 'mostrados=', shown);

  if (shown === 0 && ocrRes.text) {
    const translated = await translateText(ocrRes.text);
    if (translated && translated.trim() !== ocrRes.text.trim()) showPanel(translated);
    else console.warn('[MangaTranslator] Modo clic: sin traducción');
  }
}

function clearOverlays() {
  document.querySelectorAll(`.${OVERLAY_CLASS}`).forEach((el) => el.remove());
  mtFuseSelected = null;
}

let mtFuseSelected = null;

function handleFuseSelect(el) {
  if (!mtFuseSelected) {
    mtFuseSelected = el;
    el.classList.add('mt-selected');
    showHint('Cuadro 1 seleccionado. Haz clic en ⧉ de otro cuadro para fusionarlo.');
    return;
  }
  if (mtFuseSelected === el) {
    mtFuseSelected.classList.remove('mt-selected');
    mtFuseSelected = null;
    return;
  }
  mergeOverlays(mtFuseSelected, el);
  mtFuseSelected.classList.remove('mt-selected');
  mtFuseSelected = null;
}

function showHint(text) {
  const h = document.createElement('div');
  h.className = 'mt-crop-hint-fixed';
  h.textContent = text;
  document.body.appendChild(h);
  setTimeout(() => h.remove(), 4000);
}

async function mergeOverlays(a, b) {
  const aL = parseFloat(a.dataset.leftPct), aT = parseFloat(a.dataset.topPct);
  const aW = parseFloat(a.dataset.widthPct), aH = parseFloat(a.dataset.heightPct);
  const bL = parseFloat(b.dataset.leftPct), bT = parseFloat(b.dataset.topPct);
  const bW = parseFloat(b.dataset.widthPct), bH = parseFloat(b.dataset.heightPct);

  const nL = Math.min(aL, bL);
  const nT = Math.min(aT, bT);
  const nR = Math.max(aL + aW, bL + bW);
  const nB = Math.max(aT + aH, bT + bH);
  const nW = nR - nL;
  const nH = nB - nT;

  const order = sortByReadingOrder(a, b);
  const combinedText = (order[0].dataset.original + ' ' + order[1].dataset.original).trim();
  const img = findImgBySrc(a.dataset.mtImg);

  a.remove();
  b.remove();

  if (!img) return;

  const translated = await translateText(combinedText);
  if (translated && translated.trim() !== combinedText.trim()) {
    saveManualEdit(a.dataset.ocr, combinedText);
    saveManualEdit(b.dataset.ocr, combinedText);
    showOverlayAt(img, nL, nT, nW, nH, combinedText, translated, a.dataset.ocr + ' ' + b.dataset.ocr);
  }
}

function sortByReadingOrder(a, b) {
  const aCx = parseFloat(a.dataset.leftPct) + parseFloat(a.dataset.widthPct) / 2;
  const aCy = parseFloat(a.dataset.topPct) + parseFloat(a.dataset.heightPct) / 2;
  const bCx = parseFloat(b.dataset.leftPct) + parseFloat(b.dataset.widthPct) / 2;
  const bCy = parseFloat(b.dataset.topPct) + parseFloat(b.dataset.heightPct) / 2;
  if (Math.abs(aCy - bCy) < 12) {
    return aCx <= bCx ? [a, b] : [b, a];
  }
  return aCy <= bCy ? [a, b] : [b, a];
}

function findImgBySrc(src) {
  const imgs = document.querySelectorAll('img');
  for (const i of imgs) {
    if (i.src === src) return i;
  }
  return null;
}
'use strict';

/* =====================================================================
   Durum
===================================================================== */
let files = [];          // { id, path, dir, base, nameNoExt, ext, kind, size, birthtimeMs, mtimeMs, newBase, bad, dup }
let lastOperation = null; // basarili rename sonrasi: [{ from, to, dir, ext }]
let idSeq = 1;
let mode = 'number';
let busy = false;
let scope = 'all';                 // 'all' (tum dosyalar) veya 'selected' (yalnizca isaretliler)
const marked = new Set();          // yeniden adlandirilacak dosya id'leri (scope='selected')
let lastClickIndex = -1;           // Shift+tik aralik capasi
let lang = 'tr';                   // arayuz dili (tr/en/ar)

function t(key, vars) { return window.I18N ? window.I18N.t(lang, key, vars) : key; }
let selectedId = null;             // onizlemede gosterilen dosya
let editingId = null;              // satir ici duzenlenen dosya
let previewToken = 0;              // onizleme yukleme yaris kosulu korumasi
let previewLoadedPath = null;      // onizlemede yuklu olan medyanin yolu (gereksiz yeniden yuklemeyi onler)
let playMode = '3s';               // '3s' (ilk 3 sn) veya 'full' (tum video)
const thumbCache = new Map();      // path -> dataURL | null
const thumbPending = new Set();    // istek halindeki yollar

/* =====================================================================
   DOM
===================================================================== */
const $ = (id) => document.getElementById(id);
const listEl = $('fileList');
const statusEl = $('status');
const btnApply = $('btnApply');
const btnUndo = $('btnUndo');
const btnClear = $('btnClear');
const dropOverlay = $('dropOverlay');
const previewImg = $('previewImg');
const previewVideo = $('previewVideo');
const previewPlay = $('previewPlay');
const previewMute = $('previewMute');
const previewStage = $('previewStage');
const previewEmpty = $('previewEmpty');
const previewName = $('previewName');

const els = {
  numBase: $('numBase'), numStart: $('numStart'), numStep: $('numStep'),
  numPad: $('numPad'), numSep: $('numSep'),
  addPrefix: $('addPrefix'), addSuffix: $('addSuffix'),
  repFind: $('repFind'), repWith: $('repWith'), repCase: $('repCase'), repExt: $('repExt'),
  sortKey: $('sortKey'), sortDir: $('sortDir')
};

/* =====================================================================
   Yardimcilar
===================================================================== */
const fsKey = (s) => s.toLowerCase(); // mac & windows cogunlukla buyuk/kucuk harf duyarsiz

function baseName(p) { return p.split(/[\\/]/).pop(); }
function nameAndExt(b) {
  const i = b.lastIndexOf('.');
  if (i <= 0) return { nameNoExt: b, ext: '' };
  return { nameNoExt: b.slice(0, i), ext: b.slice(i) };
}
function kindIcon(kind) {
  if (kind === 'image') return '🖼️';
  if (kind === 'video') return '🎬';
  return '📄';
}

/* =====================================================================
   Dosya ekleme / cikarma
===================================================================== */
function addFiles(metas) {
  if (!metas || !metas.length) return;
  const have = new Set(files.map((f) => fsKey(f.path)));
  let added = 0;
  for (const m of metas) {
    if (have.has(fsKey(m.path))) continue;
    have.add(fsKey(m.path));
    files.push({ ...m, id: idSeq++, newBase: m.base, bad: null, dup: false, manual: false, manualName: '' });
    added++;
  }
  if (added) {
    sortFiles();
    recompute();
    flashStatus(t('filesAdded', { n: added }), 'ok');
  }
}

function removeFile(id) {
  files = files.filter((f) => f.id !== id);
  if (selectedId === id) selectedId = null;
  marked.delete(id);
  recompute();
}

function clearAll() {
  files = [];
  lastOperation = null;
  selectedId = null;
  marked.clear();
  recompute();
}

/* =====================================================================
   Siralama
===================================================================== */
function sortFiles() {
  const key = els.sortKey.value;
  if (key === 'manual') return; // mevcut diziyi koru
  const dir = els.sortDir.dataset.value === 'desc' ? -1 : 1;
  files.sort((a, b) => {
    let r = 0;
    if (key === 'name') r = Core.naturalCompare(a.base, b.base);
    else if (key === 'created') r = a.birthtimeMs - b.birthtimeMs;
    else if (key === 'modified') r = a.mtimeMs - b.mtimeMs;
    else if (key === 'size') r = a.size - b.size;
    if (r === 0) r = Core.naturalCompare(a.base, b.base);
    return r * dir;
  });
}

/* =====================================================================
   Yeni adlari hesapla
===================================================================== */
function readOpts() {
  return {
    base: els.numBase.value,
    start: parseInt(els.numStart.value, 10) || 0,
    step: Math.max(1, parseInt(els.numStep.value, 10) || 1),
    pad: els.numPad.value,
    sep: els.numSep.value,
    position: $('numPosition').dataset.value,
    dir: $('numDir').dataset.value,
    prefix: els.addPrefix.value,
    suffix: els.addSuffix.value,
    find: els.repFind.value,
    repWith: els.repWith.value,
    repCase: els.repCase.checked,
    repExt: els.repExt.checked
  };
}

function recompute() {
  const o = readOpts();
  const pick = scope === 'selected';
  const act = pick ? files.filter((f) => marked.has(f.id)) : files;  // aktif kume
  const total = act.length;
  const idxOf = new Map();
  act.forEach((f, i) => idxOf.set(f.id, i));

  files.forEach((f) => {
    if (pick && !marked.has(f.id)) {     // kapsam disindaki dosya degismez
      f.newBase = f.base;
      f.bad = null;
      return;
    }
    const i = idxOf.get(f.id);           // numara aktif kume icindeki siraya gore
    let nb;
    if (f.manual) nb = f.manualName;                              // elle duzenlenmis ad mode'u gecersiz kilar
    else if (mode === 'number') nb = Core.computeNumber(f, i, total, o);
    else if (mode === 'add') nb = Core.computeAdd(f, o);
    else nb = Core.computeReplace(f, o);
    f.newBase = nb;
    f.bad = Core.validateName(nb);
  });

  // Cakisma: ayni klasor + ayni hedef ad. Ayrac olarak '/' kullaniyoruz
  // cunku '/' bir dosya adinda yer alamaz -> anahtar benzersizdir.
  const counts = {};
  files.forEach((f) => {
    const k = fsKey(f.dir) + '/' + fsKey(f.newBase);
    counts[k] = (counts[k] || 0) + 1;
  });
  files.forEach((f) => {
    f.dup = counts[fsKey(f.dir) + '/' + fsKey(f.newBase)] > 1;
  });

  render();
  updateSelUI();
}

/* ===== Kapsam / secim ===== */
function setScope(val) {
  scope = val;
  document.querySelector('.app').classList.toggle('pick-mode', val === 'selected');
  setSegment($('scopeToggle'), val);
  recompute();
}
function ensurePickMode() { if (scope !== 'selected') setScope('selected'); }
function updateSelUI() {
  const c = $('selCount');
  if (c) c.textContent = t('selCount', { n: marked.size });
  const all = $('selAll');
  if (all) {
    all.checked = marked.size > 0 && marked.size === files.length;
    all.indeterminate = marked.size > 0 && marked.size < files.length;
  }
}

function selectAllFiles() {
  if (files.length === 0) return;
  files.forEach((f) => marked.add(f.id));
  if (scope !== 'selected') setScope('selected'); else recompute();
}
function deselectAllFiles() { marked.clear(); recompute(); }
function toggleMute() {
  if (!previewVideo.getAttribute('src')) return;
  previewVideo.muted = !previewVideo.muted;
  updateMuteIcon();
}

/* ===== Dil (i18n) ===== */
function applyLanguage(l) {
  lang = (window.I18N && window.I18N.STR[l]) ? l : 'tr';
  const dir = window.I18N ? window.I18N.STR[lang].dir : 'ltr';
  document.documentElement.lang = lang;
  document.documentElement.dir = dir;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  try { localStorage.setItem('lang', lang); } catch (_) {}
  updateMuteIcon();
  recompute(); // satir ipuclari, durum, secim metni vb. dile gore yeniden cizilir
}

/* ===== Menu eylemleri ===== */
function isTextFocused() {
  const el = document.activeElement;
  const tag = (el && el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || (el && el.isContentEditable);
}
function handleMenu(action) {
  switch (action) {
    case 'add': $('btnAdd').click(); break;
    case 'clear': clearAll(); break;
    case 'apply': if (!btnApply.disabled) apply(); break;
    case 'undo':
      if (isTextFocused()) { try { document.execCommand('undo'); } catch (_) {} }
      else if (!btnUndo.disabled) undo();
      break;
    case 'select-all':
      if (isTextFocused()) { try { document.activeElement.select(); } catch (_) {} }
      else selectAllFiles();
      break;
    case 'deselect-all': deselectAllFiles(); break;
    case 'play3': startPlayback('3s', true); break;
    case 'playfull': startPlayback('full', true); break;
    case 'mute': toggleMute(); break;
    default: break;
  }
}

/* =====================================================================
   Cizim
===================================================================== */
function render() {
  if (files.length === 0) {
    listEl.innerHTML =
      '<div id="emptyState" class="empty">' +
      '<div class="empty-icon">⬇︎</div>' +
      '<p class="empty-title">' + escapeHtml(t('dropTitle')) + '</p>' +
      '<p class="empty-sub">' + escapeHtml(t('dropSub')) + '</p>' +
      '<p class="empty-hint">' + escapeHtml(t('dropHint')) + '</p>' +
      '</div>';
    btnClear.disabled = true;
    updateStatusAndApply();
    updatePreview();
    return;
  }

  // Yapi ayni mi? (ayni id'ler, ayni sira) -> oyleyse YERINDE guncelle (kirpisma olmaz).
  const domRows = listEl.querySelectorAll('.row');
  let same = domRows.length === files.length;
  if (same) {
    for (let i = 0; i < files.length; i++) {
      if (parseInt(domRows[i].dataset.id, 10) !== files[i].id) { same = false; break; }
    }
  }

  if (same) {
    for (let i = 0; i < files.length; i++) applyRowState(domRows[i], files[i], i);
  } else {
    const frag = document.createDocumentFragment();
    files.forEach((f, i) => frag.appendChild(buildRow(f, i)));
    listEl.innerHTML = '';
    listEl.appendChild(frag);
  }

  btnClear.disabled = false;
  updateStatusAndApply();
  requestThumbs();
  updatePreview();
}

function rowTip(f, badText) {
  return badText ? badText : (f.manual ? t('tipManual') : t('tipEdit'));
}

function buildRow(f, i) {
  const changed = f.newBase !== f.base;
  const row = document.createElement('div');
  let cls = 'row ' + (changed ? 'changed' : 'same');
  if (marked.has(f.id)) cls += ' marked';
  if (f.id === selectedId) cls += ' selected';
  row.className = cls;
  row.draggable = true;
  row.dataset.id = String(f.id);

  const badText = f.bad ? t(f.bad) : (f.dup ? t('dupName') : '');
  let newClass = 'newname';
  if (f.bad || f.dup) newClass += ' bad';
  if (f.manual) newClass += ' manual';
  const tip = rowTip(f, badText);

  const th = thumbCache.get(f.path);
  const thumbCell = (th && th.url)
    ? '<img class="thumb" src="' + th.url + '" alt="">'
    : '<span class="kicon">' + kindIcon(f.kind) + '</span>';

  row.innerHTML =
    '<span class="row-check"><input type="checkbox" class="rowcb"' + (marked.has(f.id) ? ' checked' : '') + '></span>' +
    '<span class="grip" title="' + escapeHtml(t('tipGrip')) + '">⋮⋮</span>' +
    '<span class="idx">' + (i + 1) + '</span>' +
    '<span class="oldname"><span class="kind">' + thumbCell + '</span>' +
      '<span class="otext">' + escapeHtml(f.base) + '</span></span>' +
    '<span class="arrow">→</span>' +
    '<span class="' + newClass + '" data-id="' + f.id + '" title="' + escapeHtml(tip) + '">' +
      escapeHtml(f.newBase) + '</span>' +
    '<button class="remove" title="' + escapeHtml(t('tipRemove')) + '" data-id="' + f.id + '">×</button>';
  return row;
}

// Satiri YERINDE guncelle: kucuk resme/yapiya dokunmadan sadece degisen metni/sinifi yaz.
function applyRowState(row, f, i) {
  const changed = f.newBase !== f.base;
  let cls = 'row ' + (changed ? 'changed' : 'same');
  if (marked.has(f.id)) cls += ' marked';
  if (f.id === selectedId) cls += ' selected';
  if (row.className !== cls) row.className = cls;

  const cb = row.querySelector('.rowcb');
  if (cb && cb.checked !== marked.has(f.id)) cb.checked = marked.has(f.id);

  const idx = row.querySelector('.idx');
  if (idx && idx.textContent !== String(i + 1)) idx.textContent = String(i + 1);

  const otext = row.querySelector('.otext');
  if (otext && otext.textContent !== f.base) otext.textContent = f.base;

  if (editingId === f.id) return; // satir ici duzenleme suruyor -> dokunma

  let nn = row.querySelector('.newname');
  const editInput = row.querySelector('.newname-edit');
  if (editInput) { // duzenleme bitti -> input'u tekrar span'e cevir
    nn = document.createElement('span');
    nn.className = 'newname';
    nn.dataset.id = String(f.id);
    editInput.replaceWith(nn);
  }
  if (!nn) return;

  const badText = f.bad ? t(f.bad) : (f.dup ? t('dupName') : '');
  let ncls = 'newname';
  if (f.bad || f.dup) ncls += ' bad';
  if (f.manual) ncls += ' manual';
  if (nn.className !== ncls) nn.className = ncls;
  const tip = rowTip(f, badText);
  if (nn.getAttribute('title') !== tip) nn.setAttribute('title', tip);
  if (nn.textContent !== f.newBase) nn.textContent = f.newBase;
  if (nn.dataset.id !== String(f.id)) nn.dataset.id = String(f.id);
}

/* =====================================================================
   Kucuk resim (thumbnail) + onizleme
===================================================================== */
function requestThumbs() {
  if (!window.api || !window.api.getThumb) return;
  for (const f of files) {
    if (thumbCache.has(f.path) || thumbPending.has(f.path)) continue;
    thumbPending.add(f.path);
    const p = f.path;
    window.api.getThumb(p, 320).then((t) => {
      thumbPending.delete(p);
      thumbCache.set(p, t || null);
      if (t) applyThumb(p, t.url);
      if (selectedId && filesById(selectedId) && filesById(selectedId).path === p) updatePreview();
    }).catch(() => { thumbPending.delete(p); thumbCache.set(p, null); });
  }
}

function applyThumb(path, url) {
  // Ilgili satirin simge hucresini kucuk resimle degistir (tam yeniden cizim olmadan)
  for (const f of files) {
    if (f.path !== path) continue;
    const cell = listEl.querySelector('.row[data-id="' + f.id + '"] .kind');
    if (cell) cell.innerHTML = '<img class="thumb" src="' + url + '" alt="">';
  }
}

function filesById(id) { return files.find((f) => f.id === id) || null; }

function selectFile(id) {
  selectedId = id;
  listEl.querySelectorAll('.row').forEach((r) => {
    r.classList.toggle('selected', parseInt(r.dataset.id, 10) === id);
  });
  updatePreview();
}

// En-boy orani CSS tarafindan korunur (medya kendi dogal oraninda olceklenir);
// burada boyut HESAPLAMIYORUZ -> oynatma durumundan bagimsiz olarak oran bozulmaz.
function updatePreview() {
  const f = selectedId ? filesById(selectedId) : null;
  const fpath = f ? f.path : null;
  if (fpath === previewLoadedPath) {
    // Ayni medya zaten yuklu: sadece adi guncelle, yeniden yukleme/oynatma kesintisi YOK
    previewName.textContent = f ? f.base : '';
    return;
  }
  previewLoadedPath = fpath;

  stopPreviewVideo();
  const token = ++previewToken;

  previewImg.onload = null; previewImg.onerror = null;
  previewImg.hidden = true; previewImg.removeAttribute('src');
  previewVideo.hidden = true;
  previewPlay.hidden = true;
  previewMute.hidden = true;
  previewEmpty.style.display = '';

  if (!f) { previewName.textContent = ''; return; }
  previewName.textContent = f.base;
  if (!window.api || !window.api.mediaUrl) return;

  const src = window.api.mediaUrl(f.path);

  if (f.kind === 'video') {
    previewVideo.muted = true;
    previewVideo.loop = true;
    previewVideo.preload = 'metadata';
    updateMuteIcon();
    previewVideo.onloadedmetadata = () => {
      if (token !== previewToken) return;
      try { previewVideo.currentTime = 0.04; } catch (_) {} // ilk kareyi cozdur
    };
    previewVideo.onseeked = () => {
      if (token !== previewToken) return;
      previewVideo.onseeked = null;
      previewEmpty.style.display = 'none';
      previewVideo.hidden = false;
      previewPlay.hidden = false;
      previewMute.hidden = false;
    };
    previewVideo.onerror = () => { if (token === previewToken) fallbackThumb(f); };
    previewVideo.src = src;
    previewVideo.load();
  } else {
    previewImg.onload = () => {
      if (token !== previewToken) return;
      previewEmpty.style.display = 'none';
      previewImg.hidden = false;
    };
    previewImg.onerror = () => { if (token === previewToken) fallbackThumb(f); };
    previewImg.src = src;
  }
}

// HEIC/RAW vb. dogrudan acilamazsa OS kucuk resmini goster
function fallbackThumb(f) {
  previewImg.onload = null; previewImg.onerror = null;
  const th = thumbCache.get(f.path);
  if (th && th.url) {
    previewImg.src = th.url;
    previewImg.hidden = false;
    previewEmpty.style.display = 'none';
  } else {
    previewImg.hidden = true;
    previewEmpty.style.display = '';
  }
  previewPlay.hidden = true;
  previewMute.hidden = true;
}

/* Oynatma: Space -> ilk 3 sn dongu; Shift+Space -> tum video dongu */
function startPlayback(mode, fromStart) {
  if (!previewVideo.getAttribute('src')) return;
  playMode = mode;
  previewStage.classList.add('playing');
  previewPlay.hidden = true;
  previewVideo.hidden = false;
  previewEmpty.style.display = 'none';
  if (fromStart) { try { previewVideo.currentTime = 0; } catch (_) {} }
  previewVideo.play().catch(() => {});
}

function pausePlayback() {
  previewStage.classList.remove('playing');
  try { previewVideo.pause(); } catch (_) {}
  previewPlay.hidden = false;
}

// Space (shift=false): 3 sn dongu baslat/durdur. Shift+Space (shift=true): tum video dongu.
function togglePlayback(shift) {
  if (!previewVideo.getAttribute('src')) return;
  if (shift) { startPlayback('full', true); return; }
  if (previewVideo.paused) {
    const atStill = previewVideo.currentTime < 0.06 || previewVideo.currentTime >= 3;
    startPlayback('3s', atStill);
  } else {
    pausePlayback();
  }
}

function updateMuteIcon() {
  previewMute.textContent = previewVideo.muted ? '🔇' : '🔊';
  previewMute.title = previewVideo.muted ? t('muteOn') : t('muteOff');
}

function stopPreviewVideo() {
  if (!previewVideo) return;
  previewStage.classList.remove('playing');
  previewVideo.onloadedmetadata = null;
  previewVideo.onseeked = null;
  previewVideo.onerror = null;
  try { previewVideo.pause(); } catch (_) {}
  previewVideo.removeAttribute('src');
  try { previewVideo.load(); } catch (_) {}
  previewVideo.hidden = true;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function updateStatusAndApply() {
  if (busy) return;
  if (files.length === 0) {
    setStatus(t('statusStart'));
    btnApply.disabled = true;
    return;
  }
  if (scope === 'selected' && marked.size === 0) {
    setStatus(t('statusNoSel'), 'err');
    btnApply.disabled = true;
    return;
  }
  const bad = files.filter((f) => f.bad || f.dup).length;
  const changed = files.filter((f) => f.newBase !== f.base).length;
  const scopeNote = scope === 'selected' ? t('scopeMarked', { n: marked.size }) : t('scopeFiles', { n: files.length });

  if (bad > 0) {
    setStatus(t('statusBad', { n: bad }), 'err');
    btnApply.disabled = true;
  } else if (changed === 0) {
    setStatus(t('statusNoChange', { scope: scopeNote }));
    btnApply.disabled = true;
  } else {
    setStatus(t('statusWillRename', { scope: scopeNote, n: changed }));
    btnApply.disabled = false;
  }
}

function setStatus(text, cls) {
  statusEl.className = 'status' + (cls ? ' ' + cls : '');
  statusEl.textContent = text;
}
let flashTimer = null;
function flashStatus(text, cls) {
  setStatus(text, cls);
  clearTimeout(flashTimer);
  flashTimer = setTimeout(updateStatusAndApply, 1800);
}

/* =====================================================================
   Surukle-birak: disaridan dosya ekleme + satir siralama
===================================================================== */
let draggingEl = null;

window.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (!draggingEl && e.dataTransfer && [...e.dataTransfer.types].includes('Files')) {
    dropOverlay.classList.add('on');
  }
});
window.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null) dropOverlay.classList.remove('on');
});
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropOverlay.classList.remove('on');
  if (draggingEl) return; // ic siralama
  const dt = e.dataTransfer;
  if (!dt || !dt.files || dt.files.length === 0) return;
  const paths = [];
  for (const file of dt.files) {
    const p = window.api.pathForFile(file);
    if (p) paths.push(p);
  }
  if (!paths.length) return;
  const metas = await window.api.getMeta(paths);
  addFiles(metas);
});

listEl.addEventListener('dragstart', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  draggingEl = row;
  row.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/x-reorder', row.dataset.id); } catch (_) {}
});
listEl.addEventListener('dragover', (e) => {
  if (!draggingEl) return;
  e.preventDefault();
  const after = getDragAfter(e.clientY);
  if (after == null) listEl.appendChild(draggingEl);
  else listEl.insertBefore(draggingEl, after);
});
listEl.addEventListener('dragend', () => {
  if (!draggingEl) return;
  draggingEl.classList.remove('dragging');
  draggingEl = null;
  commitOrderFromDOM();
});

function getDragAfter(y) {
  const rows = [...listEl.querySelectorAll('.row:not(.dragging)')];
  let closest = null, closestOffset = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const box = row.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closestOffset) { closestOffset = offset; closest = row; }
  }
  return closest;
}

function commitOrderFromDOM() {
  const order = [...listEl.querySelectorAll('.row')].map((r) => parseInt(r.dataset.id, 10));
  const byId = new Map(files.map((f) => [f.id, f]));
  const next = order.map((id) => byId.get(id)).filter(Boolean);
  if (next.length === files.length) {
    files = next;
    els.sortKey.value = 'manual';
  }
  recompute();
}

/* =====================================================================
   Uygula / Geri Al
===================================================================== */
async function apply() {
  const changed = files.filter((f) => f.newBase !== f.base);
  if (changed.length === 0 || files.some((f) => f.bad || f.dup)) return;

  const ops = changed.map((f) => ({ oldPath: f.path, dir: f.dir, ext: f.ext, newBase: f.newBase }));

  setBusy(true, t('busyRenaming', { n: ops.length }));
  const res = await window.api.rename(ops);
  setBusy(false);

  if (!res.ok) {
    if (res.conflicts) {
      const names = res.conflicts.slice(0, 3).map((c) => c.newBase).join(', ') + (res.conflicts.length > 3 ? '…' : '');
      setStatus(t('errConflict', { names: names }), 'err');
    } else {
      setStatus(t('errGeneric', { msg: res.error || '?' }), 'err');
    }
    return;
  }

  const map = new Map(res.results.map((r) => [r.from, r]));
  files.forEach((f) => {
    const r = map.get(f.path);
    if (r) {
      const ne = nameAndExt(baseName(r.to));
      if (thumbCache.has(f.path)) thumbCache.set(r.to, thumbCache.get(f.path));
      if (previewLoadedPath === f.path) previewLoadedPath = r.to;
      f.path = r.to;
      f.base = baseName(r.to);
      f.nameNoExt = ne.nameNoExt;
      f.ext = ne.ext || f.ext;
      if (f.manual) f.manualName = f.base;     // uygulanan ad artik gercek ad
    }
  });

  lastOperation = res.results;
  btnUndo.disabled = false;

  // Metin alanlarini notr birak (zincirleme islem icin)
  els.addPrefix.value = '';
  els.addSuffix.value = '';
  els.repFind.value = '';
  els.repWith.value = '';

  recompute();
  flashStatus(t('doneRenamed', { n: res.results.length }), 'ok');
}

async function undo() {
  if (!lastOperation) return;
  const ops = lastOperation.map((r) => ({
    oldPath: r.to, dir: r.dir, ext: r.ext, newBase: baseName(r.from)
  }));

  setBusy(true, t('busyUndoing'));
  const res = await window.api.rename(ops);
  setBusy(false);

  if (!res.ok) {
    setStatus(t('errUndo', { msg: res.error || (res.conflicts ? t('dupName') : '?') }), 'err');
    return;
  }

  const map = new Map(res.results.map((r) => [r.from, r]));
  files.forEach((f) => {
    const r = map.get(f.path);
    if (r) {
      const ne = nameAndExt(baseName(r.to));
      if (thumbCache.has(f.path)) thumbCache.set(r.to, thumbCache.get(f.path));
      if (previewLoadedPath === f.path) previewLoadedPath = r.to;
      f.path = r.to;
      f.base = baseName(r.to);
      f.nameNoExt = ne.nameNoExt;
      f.ext = ne.ext || f.ext;
      if (f.manual) f.manualName = f.base;     // uygulanan ad artik gercek ad
    }
  });

  lastOperation = null;
  btnUndo.disabled = true;
  recompute();
  flashStatus(t('doneUndone'), 'ok');
}

function setBusy(on, text) {
  busy = on;
  btnApply.disabled = on;
  btnUndo.disabled = on || !lastOperation;
  if (on && text) setStatus(text, 'busy');
  if (!on) updateStatusAndApply();
}

/* =====================================================================
   Segmented yardimci
===================================================================== */
function setSegment(groupEl, val) {
  groupEl.dataset.value = val;
  groupEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.val === val));
}

/* =====================================================================
   Olaylar
===================================================================== */
$('btnAdd').addEventListener('click', async () => {
  const metas = await window.api.openFiles();
  addFiles(metas);
});
btnClear.addEventListener('click', clearAll);
btnApply.addEventListener('click', apply);
btnUndo.addEventListener('click', undo);

// Onizleme oynatma kontrolleri
previewPlay.addEventListener('click', () => startPlayback('3s', true));
previewVideo.addEventListener('click', () => togglePlayback(false));
previewMute.addEventListener('click', (e) => {
  e.stopPropagation();
  previewVideo.muted = !previewVideo.muted;
  updateMuteIcon();
});
// Oynatma modu: '3s' ise ilk 3 saniyede dongu yap; 'full' ise dogal loop (tum video)
previewVideo.addEventListener('timeupdate', () => {
  if (playMode === '3s' && previewVideo.currentTime >= 3) previewVideo.currentTime = 0;
});

// Splitter: onizleme/kontrol panelini surukleyerek genislet/darat (oran bozulmaz)
(() => {
  const splitter = $('splitter');
  const controlsEl = $('controls');
  if (!splitter || !controlsEl) return;
  let dragging = false;
  splitter.addEventListener('mousedown', (e) => {
    dragging = true;
    splitter.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const rtl = document.documentElement.dir === 'rtl';
    let w = rtl ? e.clientX : (window.innerWidth - e.clientX); // RTL'de kontrol paneli solda
    const maxW = Math.min(window.innerWidth - 360, 1100);
    w = Math.max(300, Math.min(maxW, w));
    controlsEl.style.flex = '0 0 ' + w + 'px';
    controlsEl.style.width = w + 'px';
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    splitter.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
})();

// Satir tiklamasi: Shift+tik -> aralik (capadan buraya), Ctrl/Cmd veya onay kutusu -> tekli
// isaretle/kaldir, sade tik (ad/kucuk resim) -> sadece onizleme. Onay kutulari gorsel
// gostergedir (pointer-events:none); tiklama satira gelir, yani Shift her yerde aralik secer.
listEl.addEventListener('click', (e) => {
  const rm = e.target.closest('.remove');
  if (rm) { removeFile(parseInt(rm.dataset.id, 10)); return; }
  if (e.target.closest('.newname-edit')) return;
  const row = e.target.closest('.row');
  if (!row) return;
  const id = parseInt(row.dataset.id, 10);
  const index = files.findIndex((f) => f.id === id);
  const applyScope = () => { if (scope !== 'selected') setScope('selected'); else recompute(); };

  if (e.shiftKey && lastClickIndex >= 0 && lastClickIndex < files.length) {
    e.preventDefault(); // metin secimini engelle
    const a = Math.min(lastClickIndex, index);
    const b = Math.max(lastClickIndex, index);
    marked.clear(); // yeni Shift secimi eski secimi siler (Finder/Explorer gibi)
    for (let i = a; i <= b; i++) marked.add(files[i].id); // capadan buraya tum araligi isaretle
    applyScope();
    selectFile(id);
    return; // capa (lastClickIndex) yerinde kalir
  }

  if (e.metaKey || e.ctrlKey || e.target.closest('.row-check')) {
    if (marked.has(id)) marked.delete(id); else marked.add(id);
    lastClickIndex = index;
    applyScope();
    selectFile(id);
    return;
  }

  // sade tik -> sadece onizleme (isareti bozmaz), capayi guncelle
  lastClickIndex = index;
  selectFile(id);
});

// Tumunu sec / birak
$('selAll').addEventListener('change', (e) => {
  if (e.target.checked) files.forEach((f) => marked.add(f.id));
  else marked.clear();
  recompute();
});
$('selClear').addEventListener('click', () => { marked.clear(); recompute(); });

// Yeni ada cift tikla -> elle yeniden adlandir
listEl.addEventListener('dblclick', (e) => {
  const span = e.target.closest('.newname');
  if (!span || !span.dataset.id) return;
  startEdit(parseInt(span.dataset.id, 10));
});

function startEdit(id) {
  const f = filesById(id);
  if (!f) return;
  const span = listEl.querySelector('.newname[data-id="' + id + '"]');
  if (!span) return;

  editingId = id;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'newname-edit';
  input.spellcheck = false;
  input.value = f.newBase;
  span.replaceWith(input);
  input.focus();
  const dot = f.newBase.lastIndexOf('.');
  if (dot > 0) input.setSelectionRange(0, dot); else input.select();

  let done = false;
  const commit = (save) => {
    if (done) return;
    done = true;
    editingId = null;
    if (save) {
      const val = input.value.trim();
      if (val === '') { f.manual = false; f.manualName = ''; }   // bos -> otomatige don
      else { f.manual = true; f.manualName = val; }
    }
    recompute();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(true); }
    else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
  });
  input.addEventListener('blur', () => commit(true));
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    mode = tab.dataset.mode;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.panel').forEach((p) => {
      p.classList.toggle('hidden', p.dataset.panel !== mode);
    });
    recompute();
  });
});

document.querySelectorAll('.segmented').forEach((seg) => {
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (seg.id === 'scopeToggle') { setScope(b.dataset.val); return; }
    setSegment(seg, b.dataset.val);
    recompute();
  });
});

[
  els.numBase, els.numStart, els.numStep, els.numPad, els.numSep,
  els.addPrefix, els.addSuffix, els.repFind, els.repWith, els.repCase, els.repExt
].forEach((el) => {
  el.addEventListener('input', recompute);
  el.addEventListener('change', recompute);
});

els.sortKey.addEventListener('change', () => { sortFiles(); recompute(); });
els.sortDir.addEventListener('click', () => {
  const next = els.sortDir.dataset.value === 'asc' ? 'desc' : 'asc';
  els.sortDir.dataset.value = next;
  els.sortDir.textContent = next === 'asc' ? '↑' : '↓';
  sortFiles();
  recompute();
});

window.addEventListener('keydown', (e) => {
  // Space: secili video onizlemesini oynat/durdur · Shift+Space: tum videoyu dongude oynat.
  // (Cmd/Ctrl + O/Z/A/D/Return menu hizlandiricilari tarafindan ele alinir.)
  if (e.code === 'Space' && !isTextFocused()) {
    const f = selectedId ? filesById(selectedId) : null;
    if (f && f.kind === 'video' && previewVideo.getAttribute('src')) {
      e.preventDefault();
      togglePlayback(e.shiftKey);
    }
  }
});

// Dil & menu baglantilari
if (window.api && window.api.onMenu) window.api.onMenu(handleMenu);
if (window.api && window.api.onLang) window.api.onLang(applyLanguage);
applyLanguage((function () { try { return localStorage.getItem('lang') || 'tr'; } catch (_) { return 'tr'; } })());
if (window.api && window.api.setLang) window.api.setLang(lang); // menuyu kayitli dile gore senkronla

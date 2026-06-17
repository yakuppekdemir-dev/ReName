'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeImage, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { pathToFileURL } = require('url');
const { renameBatch } = require('./renamer');
const I18N = require('./i18n');

const isMac = process.platform === 'darwin';
let currentLang = 'tr';

// Uygulama adi (menu, hakkinda paneli, dock). Paketlenmis surumde productName gecerlidir.
app.setName('ReName');

// Yerel medyayi (video/foto) renderer'a guvenli sekilde sunmak icin ozel sema.
// file:// kisitlamalarini ve CSP sorunlarini asar; aralikli (range) istekleri destekler.
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

// Dosya secme penceresinde gosterilecek medya uzantilari
const IMAGE_EXTS = [
  'jpg', 'jpeg', 'png', 'gif', 'heic', 'heif', 'webp', 'tif', 'tiff',
  'bmp', 'svg', 'raw', 'cr2', 'cr3', 'nef', 'arw', 'dng', 'orf', 'rw2', 'raf'
];
const VIDEO_EXTS = [
  'mp4', 'mov', 'm4v', 'avi', 'mkv', 'wmv', 'flv', 'webm', 'mpg', 'mpeg',
  '3gp', 'm2ts', 'mts', 'ts', 'hevc'
];

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1140,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    title: 'ReName',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: '#16171a',
    autoHideMenuBar: true,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 16, y: 20 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));
}

// Menu eylemini odaktaki pencereye gonder
function sendAction(action) {
  const w = BrowserWindow.getFocusedWindow() || win;
  if (w) w.webContents.send('menu', action);
}

function setLang(lang) {
  currentLang = lang;
  buildMenu(lang);
  const w = BrowserWindow.getFocusedWindow() || win;
  if (w) w.webContents.send('lang', lang); // arayuze de bildir
}

function showShortcuts(lang) {
  dialog.showMessageBox(win || BrowserWindow.getFocusedWindow(), {
    type: 'info',
    title: I18N.t(lang, 'scTitle'),
    message: I18N.t(lang, 'scTitle'),
    detail: I18N.t(lang, 'scBody'),
    buttons: ['OK']
  });
}

// Markali, cok dilli "Hakkinda" penceresi
let aboutWin = null;
function openAbout() {
  if (aboutWin && !aboutWin.isDestroyed()) { aboutWin.focus(); return; }
  aboutWin = new BrowserWindow({
    width: 440, height: 512,
    resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    title: I18N.t(currentLang, 'miAbout'),
    backgroundColor: '#16171a',
    autoHideMenuBar: true,
    parent: win || undefined,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  aboutWin.setMenuBarVisibility(false);
  const u = pathToFileURL(path.join(__dirname, 'about.html'));
  u.searchParams.set('lang', currentLang);
  u.searchParams.set('v', app.getVersion());
  aboutWin.loadURL(u.href);
  aboutWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  aboutWin.once('ready-to-show', () => aboutWin.show());
  aboutWin.on('closed', () => { aboutWin = null; });
}

// i18n'li tam uygulama menusu (kisayollar + dil secimi)
function buildMenu(lang) {
  const tr = (k) => I18N.t(lang, k);
  const langItem = (code) => ({
    label: I18N.STR[code].langName, type: 'radio', checked: lang === code,
    click: () => setLang(code)
  });

  const template = [];

  if (isMac) {
    template.push({
      label: 'ReName',
      submenu: [
        { label: tr('miAbout'), click: () => openAbout() },
        { type: 'separator' },
        { label: tr('miHide'), role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { label: tr('miQuit'), role: 'quit' }
      ]
    });
  }

  template.push({
    label: tr('mFile'),
    submenu: [
      { label: tr('miAdd'), accelerator: 'CmdOrCtrl+O', click: () => sendAction('add') },
      { label: tr('miClearList'), click: () => sendAction('clear') },
      { type: 'separator' },
      { label: tr('miApply'), accelerator: 'CmdOrCtrl+Return', click: () => sendAction('apply') },
      { label: tr('miUndo'), accelerator: 'CmdOrCtrl+Z', click: () => sendAction('undo') },
      ...(isMac ? [] : [{ type: 'separator' }, { label: tr('miQuit'), role: 'quit' }])
    ]
  });

  template.push({
    label: tr('mEdit'),
    submenu: [
      { label: tr('miSelAll'), accelerator: 'CmdOrCtrl+A', click: () => sendAction('select-all') },
      { label: tr('miDeselAll'), accelerator: 'CmdOrCtrl+D', click: () => sendAction('deselect-all') },
      { type: 'separator' },
      { label: tr('miCut'), role: 'cut' },
      { label: tr('miCopy'), role: 'copy' },
      { label: tr('miPaste'), role: 'paste' }
    ]
  });

  template.push({
    label: tr('mPlay'),
    submenu: [
      { label: tr('miPlay3'), click: () => sendAction('play3') },
      { label: tr('miPlayFull'), click: () => sendAction('playfull') },
      { label: tr('miMute'), click: () => sendAction('mute') }
    ]
  });

  template.push({
    label: tr('mView'),
    submenu: [
      { label: tr('miReload'), role: 'reload' },
      { label: tr('miDevTools'), role: 'toggleDevTools' },
      { type: 'separator' },
      { label: tr('miZoomReset'), role: 'resetZoom' },
      { label: tr('miZoomIn'), role: 'zoomIn' },
      { label: tr('miZoomOut'), role: 'zoomOut' },
      { type: 'separator' },
      { label: tr('miFull'), role: 'togglefullscreen' }
    ]
  });

  template.push({ label: tr('mLang'), submenu: I18N.langs.map(langItem) });

  template.push({
    label: tr('mHelp'),
    submenu: [
      { label: tr('miShortcuts'), accelerator: 'CmdOrCtrl+/', click: () => showShortcuts(lang) },
      ...(isMac ? [] : [{ type: 'separator' }, { label: tr('miAbout'), click: () => openAbout() }])
    ]
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  // media://local/<encodeURIComponent(tamYol)> -> dosyayi servis et
  protocol.handle('media', (request) => {
    try {
      const filePath = decodeURIComponent(new URL(request.url).pathname.slice(1));
      return net.fetch(pathToFileURL(filePath).href);
    } catch (_) {
      return new Response('not found', { status: 404 });
    }
  });

  app.setAboutPanelOptions({ applicationName: 'ReName', applicationVersion: app.getVersion() });
  buildMenu(currentLang);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

/* ----------------------------- Yardimcilar ----------------------------- */

async function statToMeta(filePath) {
  const st = await fsp.stat(filePath);
  if (!st.isFile()) return null;
  const base = path.basename(filePath);
  const ext = path.extname(base);
  const nameNoExt = ext ? base.slice(0, base.length - ext.length) : base;
  const lower = ext.replace('.', '').toLowerCase();
  let kind = 'file';
  if (IMAGE_EXTS.includes(lower)) kind = 'image';
  else if (VIDEO_EXTS.includes(lower)) kind = 'video';
  return {
    path: filePath,
    dir: path.dirname(filePath),
    base,
    nameNoExt,
    ext,
    kind,
    size: st.size,
    birthtimeMs: st.birthtimeMs,
    mtimeMs: st.mtimeMs
  };
}

async function collectMeta(paths) {
  const out = [];
  for (const p of paths) {
    try {
      const m = await statToMeta(p);
      if (m) out.push(m);
    } catch (_) {
      /* erisilemeyen dosyayi atla */
    }
  }
  return out;
}

/* ------------------------------- IPC ----------------------------------- */

// Dosya secme penceresi
ipcMain.handle('dialog:openFiles', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Fotograf veya video sec',
    buttonLabel: 'Ekle',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Medya (foto & video)', extensions: [...IMAGE_EXTS, ...VIDEO_EXTS] },
      { name: 'Tum dosyalar', extensions: ['*'] }
    ]
  });
  if (res.canceled) return [];
  return collectMeta(res.filePaths);
});

// Surukle-birak ile gelen yollarin meta bilgisi
ipcMain.handle('files:meta', async (_e, paths) => collectMeta(paths));

// Finder/Explorer'da goster
ipcMain.handle('shell:reveal', async (_e, p) => {
  try { shell.showItemInFolder(p); } catch (_) {}
});

// Arayuz baslangicta kayitli dili bildirir -> menuyu o dile gore kur
ipcMain.handle('lang:set', (_e, lang) => {
  if (I18N.langs.indexOf(lang) >= 0) { currentLang = lang; buildMenu(lang); }
});

// Kucuk resim: mac'te QuickLook, Windows'ta Shell uretir.
// Video'nun ilk karesini, HEIC/RAW foto onizlemesini de verir; harici arac gerekmez.
ipcMain.handle('thumb:get', async (_e, filePath, maxSize) => {
  try {
    const size = maxSize || 320;
    const img = await nativeImage.createThumbnailFromPath(filePath, { width: size, height: size });
    if (!img || img.isEmpty()) return null;
    const s = img.getSize();
    return { url: img.toDataURL(), w: s.width, h: s.height };
  } catch (_) {
    return null;
  }
});

// Iki asamali yeniden adlandirma. Mantik src/renamer.js icindedir (test edilebilir).
ipcMain.handle('files:rename', async (_e, ops) => renameBatch(ops));

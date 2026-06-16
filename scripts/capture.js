'use strict';
// Gercek arayuzu gercek (farkli en-boy oranli) goruntu dosyalariyla doldurup
// PNG'ye ceker. Ayrica media:// protokolunu (video servis hatti) dogrular.
// Izin gerektirmez; sadece Electron kullanir.

const { app, BrowserWindow, ipcMain, nativeImage, nativeTheme, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const cp = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

ipcMain.handle('lang:set', () => {}); // capture'da menu yok; no-op

ipcMain.handle('thumb:get', async (_e, filePath, maxSize) => {
  try {
    const size = maxSize || 320;
    const img = await nativeImage.createThumbnailFromPath(filePath, { width: size, height: size });
    if (!img || img.isEmpty()) return null;
    const s = img.getSize();
    return { url: img.toDataURL(), w: s.width, h: s.height };
  } catch (_) { return null; }
});

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark';

  protocol.handle('media', (request) => {
    try {
      const filePath = decodeURIComponent(new URL(request.url).pathname.slice(1));
      return net.fetch(pathToFileURL(filePath).href);
    } catch (_) { return new Response('not found', { status: 404 }); }
  });

  // Farkli en-boy oranli gercek goruntuler uret (app ikonunu kopyalayip yeniden boyutla)
  const tmp = path.join(ROOT, '.preview-tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const src = path.join(ROOT, 'build', 'icon.png');
  const specs = [
    ['IMG_dikey.png', 1020, 680],   // portre 2:3
    ['IMG_genis.png', 540, 960],    // yatay 16:9
    ['DSC_0090.png', 760, 760],     // kare
    ['deniz-clip.png', 600, 1024],  // genis
    ['kayit.png', 760, 760],
    ['manzara.png', 760, 760]
  ];
  for (const [n, h, w] of specs) {
    const dst = path.join(tmp, n);
    fs.copyFileSync(src, dst);
    try { cp.execSync('sips -z ' + h + ' ' + w + ' ' + JSON.stringify(dst), { stdio: 'ignore' }); } catch (_) {}
  }

  // media:// protokolunu dogrula
  try {
    const r = await net.fetch('media://local/' + encodeURIComponent(path.join(tmp, 'IMG_genis.png')));
    console.log('media protokol durumu:', r.status, '(' + (r.headers.get('content-type') || '?') + ')');
  } catch (e) { console.log('media protokol hata:', e.message); }

  const metas = specs.map(([n], i) => {
    const dot = n.lastIndexOf('.');
    return {
      path: path.join(tmp, n), dir: tmp, base: n,
      nameNoExt: n.slice(0, dot), ext: n.slice(dot),
      kind: /clip|kayit/.test(n) ? 'video' : 'image',
      size: 1000000 + i, birthtimeMs: i, mtimeMs: i
    };
  });

  const win = new BrowserWindow({
    width: 1140, height: 780, show: false,
    webPreferences: {
      preload: path.join(ROOT, 'src', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.log('RENDERER:', message);
  });
  await win.loadFile(path.join(ROOT, 'src', 'index.html'));

  const body =
    'addFiles(' + JSON.stringify(metas) + ');' +
    'document.getElementById("numBase").value = "Tatil";' +
    'recompute();' +
    'var clickRow = function(base, opts){var row=[].slice.call(document.querySelectorAll(".row")).find(function(r){var o=r.querySelector(".otext");return o&&o.textContent===base;});if(!row)return;row.querySelector(".otext").dispatchEvent(new MouseEvent("click",Object.assign({bubbles:true,cancelable:true},opts||{})));};' +
    'clickRow("deniz-clip.png");' +
    'clickRow("kayit.png",{shiftKey:true});' +
    'var s=files.find(function(f){return f.base==="IMG_dikey.png";}); if(s) selectFile(s.id);' +
    (process.env.RN_LANG ? 'applyLanguage(' + JSON.stringify(process.env.RN_LANG) + ');' : '');

  const result = await win.webContents.executeJavaScript(
    '(function(){try{' + body + 'return "OK "+JSON.stringify({scope:scope,count:marked.size});}catch(e){return "ERR "+String((e&&e.stack)||e);}})()'
  );
  console.log('INJECT:', result);

  await new Promise((r) => setTimeout(r, 2200));

  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(ROOT, 'preview.png'), img.toPNG());
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('preview yazildi: preview.png');
  app.quit();
});

'use strict';
// build/icon.svg dosyasini 1024x1024 seffaf PNG'ye render eder (build/icon.png).
// Harici arac gerektirmez; sadece Electron kullanir.

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');

app.commandLine.appendSwitch('force-color-profile', 'srgb');

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(ROOT, 'build', 'icon.svg'), 'utf8');
  const html =
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<style>html,body{margin:0;padding:0;background:transparent;width:1024px;height:1024px;overflow:hidden}' +
    'svg{display:block}</style></head><body>' + svg + '</body></html>';

  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: false }
  });

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise(function (r) { setTimeout(r, 400); });

  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(ROOT, 'build', 'icon.png'), img.toPNG());
  console.log('icon yazildi: build/icon.png  (' + img.getSize().width + 'x' + img.getSize().height + ')');
  app.quit();
});

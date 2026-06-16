'use strict';
// Gelistirmede (npm start) macOS menu cubugunda "Electron" yerine "ReName" gostermek icin
// dev Electron.app'in Info.plist'ini yamalar. Sadece macOS'ta calisir; paketlenmis surumde
// (npm run dist:*) productName="ReName" zaten gecerli oldugu icin gerek yoktur.

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

if (process.platform !== 'darwin') process.exit(0);

const plist = path.join(
  __dirname, '..', 'node_modules', 'electron', 'dist',
  'Electron.app', 'Contents', 'Info.plist'
);

try {
  if (!fs.existsSync(plist)) process.exit(0);
  const before = fs.readFileSync(plist, 'utf8');
  if (/<string>ReName<\/string>/.test(before)) process.exit(0); // zaten yamali

  for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
    try {
      cp.execSync('plutil -replace ' + key + ' -string ReName ' + JSON.stringify(plist), { stdio: 'ignore' });
    } catch (_) { /* plutil yoksa sessiz gec */ }
  }
  console.log('dev: Electron.app menu adi -> ReName');
} catch (_) { /* yoksay */ }

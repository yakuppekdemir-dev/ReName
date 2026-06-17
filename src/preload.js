'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Yerel dosya secme penceresini acar
  openFiles: () => ipcRenderer.invoke('dialog:openFiles'),
  // Klasor secme penceresi (icindeki tum medyayi alir)
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  // Surukle-birak yollari -> meta bilgisi
  getMeta: (paths) => ipcRenderer.invoke('files:meta', paths),
  // Yeniden adlandirma islemi
  rename: (ops) => ipcRenderer.invoke('files:rename', ops),
  // Surukle-birakta File nesnesinden gercek dosya yolunu alir (Electron 30+)
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch (_) { return file && file.path ? file.path : ''; }
  },
  // Finder/Explorer'da goster
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
  // Kucuk resim {url,w,h} - video ilk karesi / foto onizlemesi
  getThumb: (p, size) => ipcRenderer.invoke('thumb:get', p, size),
  // Yerel medya icin guvenli URL (video oynatma)
  mediaUrl: (p) => 'media://local/' + encodeURIComponent(p),
  // Dil & menu
  setLang: (lang) => ipcRenderer.invoke('lang:set', lang),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, action) => cb(action)),
  onLang: (cb) => ipcRenderer.on('lang', (_e, lang) => cb(lang)),
  platform: process.platform
});

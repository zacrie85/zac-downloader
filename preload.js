const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('klip', {
  // v1.6.1: path preload untuk webview (shim tombol MDM, bebas CSP halaman)
  mdmPreloadPath: () => {
    try { return ipcRenderer.sendSync('mdm:preload-path'); } catch (e) { return ''; }
  },
  getInfo: () => ipcRenderer.invoke('app:getInfo'),
  engineVersion: () => ipcRenderer.invoke('engine:version'),
  downloadStart: (url, quality, opts) => ipcRenderer.invoke('download:start', url, quality, opts),
  downloadCancel: (id) => ipcRenderer.invoke('download:cancel', id),
  setConcurrent: (n) => ipcRenderer.invoke('download:setConcurrent', n),
  listDownloads: () => ipcRenderer.invoke('downloads:list'),
  openFolder: () => ipcRenderer.invoke('downloads:openFolder'),
  chooseFolder: () => ipcRenderer.invoke('downloads:chooseFolder'),
  openFile: (p) => ipcRenderer.invoke('downloads:openFile', p),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  updateEngine: () => ipcRenderer.invoke('engine:update'),
  mediaList: () => ipcRenderer.invoke('media:list'),
  mediaClear: () => ipcRenderer.invoke('media:clear'),
  // v1.5.1: validasi & resolusi link stream Vidio (dari inject JS browser built-in)
  resolveVidio: (payload) => ipcRenderer.invoke('vidio:resolve', payload),
  // v1.5.1: validasi & resolusi daftar episode GoodShort
  resolveGoodshort: (payload) => ipcRenderer.invoke('goodshort:resolve', payload),
  // v1.6.0: Mister Download Manager dibundel (bin/mdm) — status & buka
  mdmStatus: () => ipcRenderer.invoke('mdm:status'),
  mdmOpen: () => ipcRenderer.invoke('mdm:open'),
  // v1.6.1: source shim+video.js MDM untuk di-inject ke tiap webview
  mdmShim: () => ipcRenderer.invoke('mdm:shim'),
  // v1.6.2: session restore — simpan & pulihkan tab terakhir
  sessionSave: (data) => ipcRenderer.invoke('session:save', data),
  sessionSaveSync: (data) => {
    try { return ipcRenderer.sendSync('session:save-sync', data); } catch (e) { return false; }
  },
  sessionLoad: () => ipcRenderer.invoke('session:load'),
  // v1.6.2: mirror Android (scrcpy) — info server lokal untuk tab Android
  mirrorInfo: () => ipcRenderer.invoke('mirror:info'),
  onEvent: (cb) => {
    const h = (e, d) => { try { cb(d); } catch (err) { console.error('event handler', err); } };
    ipcRenderer.on('download:event', h);
    return () => ipcRenderer.removeListener('download:event', h);
  }
});

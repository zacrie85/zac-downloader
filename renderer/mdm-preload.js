// v1.6.1: preload untuk webview Zac Downloader — menjembatani shim video.js
// MDM (di-inject lewat executeJavaScript) ke main process. IPC ini bebas
// dari CSP halaman (fetch ke localhost bisa diblokir CSP situs ketat).
const { contextBridge, ipcRenderer } = require('electron');

try {
  contextBridge.exposeInMainWorld('__mdmIpc', {
    send: (msg) => ipcRenderer.invoke('mdm:page-msg', msg)
  });
} catch (e) {}

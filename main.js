/**
 * ZAC DOWNLOADER v1.6.6 (fork dari Klip Downloader v1.5.3 oleh zacrie85)
 * Downloader video + browser built-in multi-tab (session restore) + media
 * capture + MDM dibundel + mirror Android scrcpy (tab Android, tanpa emulator).
 * v1.6.6: HOTFIX mirror — TDZ "Cannot access 'o' before initialization" dari
 * v1.6.5 + STARTTEST baru yang menjalankan start() sesungguhnya.
 */
const { app, BrowserWindow, ipcMain, shell, clipboard, Menu, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const { DownloadManager, MEDIA_EXTS } = require('./lib/downloader');
const { createMediaTracker, isMediaContentType, shouldCapture } = require('./lib/mediacapture');
const { createMirrorServer } = require('./lib/mirror');

// ---------- App flags ----------
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// UA Chrome bersih agar YouTube dkk. tidak menandai aplikasi sebagai browser "tidak aman"
app.userAgentFallback = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

const SMOKE = process.env.KLIP_SMOKE === '1';
if (SMOKE) app.commandLine.appendSwitch('disable-gpu'); // stabil di Xvfb (WebCodecs tetap dekode via software)
let win = null;
let dm = null;
let outDir = null;
let settings = {};
let ytdlpPath = null;
let ffmpegPath = null;
let mediaTracker = null;
let mirror = null; // v1.6.2: server mirror Android (scrcpy)

// ---------- Settings (folder simpan tersimpan permanen) ----------
function settingsPath() { return path.join(app.getPath('userData'), 'settings.json'); }
function loadSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) || {}; } catch (e) { return {}; }
}
function saveSettings() {
  try { fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf8'); } catch (e) {}
}

// ---------- v1.6.2: session restore (tab terakhir dibuka lagi saat app dijalankan) ----------
function sessionPath() { return path.join(app.getPath('userData'), 'session.json'); }
let sessionSaveTimer = null;
function writeSessionJson(data) {
  try {
    if (!data || !Array.isArray(data.tabs)) return;
    const tmp = sessionPath() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ ver: app.getVersion(), saved: Date.now(), tabs: data.tabs.slice(0, 15) }), 'utf8');
    fs.renameSync(tmp, sessionPath());
  } catch (e) {}
}
function saveSessionJson(data, immediate = false) {
  if (immediate) { clearTimeout(sessionSaveTimer); sessionSaveTimer = null; writeSessionJson(data); return; }
  clearTimeout(sessionSaveTimer);
  sessionSaveTimer = setTimeout(() => writeSessionJson(data), 300);
}
function loadSessionJson() {
  try {
    const j = JSON.parse(fs.readFileSync(sessionPath(), 'utf8'));
    if (j && Array.isArray(j.tabs)) return { tabs: j.tabs };
  } catch (e) {}
  return { tabs: [] };
}

// ---------- Helpers ----------
function resolveBin(...names) {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(__dirname, 'bin');
  for (const n of names) {
    const p = path.join(base, n);
    if (fs.existsSync(p)) return p;
  }
  for (const n of names) {
    if (path.isAbsolute(n) && fs.existsSync(n)) return n;
  }
  return names[0]; // fallback: biarkan OS cari di PATH
}

// ---------- v1.6.0: Mister Download Manager (MDM) dibundel ----------
// MDM portable v0.5.2 (GPL-3.0, github.com/anefzaoui/misterdownloadmanager,
// SHA256 terverifikasi vs SHA256SUMS.txt resmi) ikut dipaketkan di bin/mdm/ →
// di aplikasi terpasang: resources/bin/mdm/. Aplikasi berjalan terpisah.
function resolveMdmExe() {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'bin', 'mdm')
    : path.join(__dirname, 'bin', 'mdm');
  const isMdmExe = (nm) => /misterdownloadmanager\.exe$/i.test(nm);
  try {
    for (const d of fs.readdirSync(base, { withFileTypes: true })) {
      if (d.isFile() && isMdmExe(d.name)) return path.join(base, d.name);
      if (d.isDirectory()) {
        const sub = path.join(base, d.name);
        try {
          for (const f of fs.readdirSync(sub, { withFileTypes: true })) {
            if (f.isFile() && isMdmExe(f.name)) return path.join(sub, f.name);
          }
        } catch (e) {}
      }
    }
  } catch (e) {}
  return null;
}

// ---------- v1.6.1: Extension MDM di dalam browser built-in ----------
// Extension Chromium resmi MDM (dibundel di bin/mdm/…/extension/chromium)
// dimuat ke session 'persist:browser' → tombol "Download video" muncul di
// halaman, klik link file/alternatif-klik diserap ke MDM, torrent & magnet
// bisa langsung dari dalam browser, popup/opsi MDM tinggal satu klik.
//
// Electron TIDAK mendukung chrome.runtime.sendNativeMessage (native
// messaging). Solusi: background.js extension dipatch saat startup —
// fungsi native() mengirim pesan lewat HTTP POST ke jembatan lokal
// (127.0.0.1, port acak) yang di-host main process ini. Jembatan
// meneruskannya ke misterdownloadmanager-nmhost.exe memakai protokol
// native messaging RESMI (framing 4-byte LE + JSON via stdin/stdout) —
// persis seperti Chrome. nmhost otomatis menjalankan MDM bila belum jalan.
let mdmExtId = null;        // id extension hasil loadExtension (untuk arg origin nmhost)
let mdmNm = null;           // child process nmhost (di-reuse antar pesan)
let mdmNmBuf = Buffer.alloc(0);
let mdmNmWaiters = [];      // antrean {resolve, reject, timer} (native messaging = berurutan)
let mdmBridgeSrv = null;
let mdmBridgePort = 0;
let mdmSession = null;      // session 'persist:browser' (untuk cookies video)
let mdmShimJs = '';         // JS shim + video.js yang di-inject ke tiap webview
const mdmHiddenSites = new Set(); // situs yang di-hide user (tombol video)

function resolveMdmDir() {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'bin', 'mdm')
    : path.join(__dirname, 'bin', 'mdm');
  try {
    for (const d of fs.readdirSync(base, { withFileTypes: true })) {
      if (d.isDirectory() && d.name.startsWith('MisterDownloadManager')) return path.join(base, d.name);
    }
  } catch (e) {}
  return null;
}

function mdmNmDrop(err) {
  try { if (mdmNm) mdmNm.kill(); } catch (e) {}
  mdmNm = null;
  mdmNmBuf = Buffer.alloc(0);
  const ws = mdmNmWaiters; mdmNmWaiters = [];
  for (const w of ws) { clearTimeout(w.timer); w.reject(err || new Error('no answer')); }
}

function mdmNmEnsure() {
  if (mdmNm) return mdmNm;
  const dir = resolveMdmDir();
  if (!dir) return null;
  const exe = path.join(dir, 'misterdownloadmanager-nmhost.exe');
  if (!fs.existsSync(exe)) return null;
  // Chrome menjalankan native host dengan SATU argumen: origin pemanggil
  const origin = mdmExtId
    ? `chrome-extension://${mdmExtId}/`
    : 'chrome-extension://ejoleppdfjgndddcjoehopknlglojp/';
  try {
    mdmNm = spawn(exe, [origin], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  } catch (e) { mdmNm = null; return null; }
  mdmNm.on('error', () => mdmNmDrop());
  mdmNm.on('close', () => mdmNmDrop());
  mdmNm.stdout.on('data', (chunk) => {
    mdmNmBuf = Buffer.concat([mdmNmBuf, chunk]);
    // protokol native messaging: uint32 LE panjang + JSON, berurutan
    while (mdmNmBuf.length >= 4) {
      const len = mdmNmBuf.readUInt32LE(0);
      if (mdmNmBuf.length < 4 + len) break;
      const json = mdmNmBuf.slice(4, 4 + len).toString('utf8');
      mdmNmBuf = mdmNmBuf.slice(4 + len);
      let msg = {};
      try { msg = JSON.parse(json); } catch (e) {}
      const w = mdmNmWaiters.shift();
      if (w) { clearTimeout(w.timer); w.resolve(msg); }
    }
  });
  return mdmNm;
}

function mdmNativeRequest(msg) {
  return new Promise((resolve, reject) => {
    const p = mdmNmEnsure();
    if (!p) return reject(new Error('no answer'));
    const timer = setTimeout(() => mdmNmDrop(), 25000);
    mdmNmWaiters.push({ resolve, reject, timer });
    try {
      const body = Buffer.from(JSON.stringify(msg), 'utf8');
      const head = Buffer.alloc(4);
      head.writeUInt32LE(body.length, 0);
      p.stdin.write(Buffer.concat([head, body]));
    } catch (e) { clearTimeout(timer); mdmNmDrop(e); }
  });
}

// Cookies halaman dalam format header "a=b; c=d" (dari session browser)
async function mdmCookieHeader(url) {
  try {
    const cookies = await mdmSession.cookies.get({ url });
    return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  } catch (e) { return ''; }
}

function mdmBrands() {
  return ['Chromium', 'Google Chrome'];
}

// ---- Pesan dari SHIM di halaman (video.js yang di-inject ke webview) ----
// Video.js berjalan di world utama halaman (content script Electron tidak
// meng-injek ke webview), jadi pesan "background"-nya diimplement di sini:
// panel → izinkan tombol; video → native {video:true,…} + cookies session;
// hide-site/options → diteruskan ke MDM.
async function mdmPageMessage(msg, pageUrl) {
  const page = isValidHttpUrl(pageUrl) ? pageUrl : '';
  if (!msg || typeof msg !== 'object') return { ok: false };
  if (msg.type === 'panel') {
    if (!page) return { on: false };
    const host = new URL(page).hostname;
    return { on: !mdmHiddenSites.has(host) };
  }
  if (msg.type === 'video' && page) {
    // video.js sudah menghitung URL video (videoPage) & src-nya. Src blob:
    // (YouTube MSE) tidak bisa diambil dari halaman — URL halaman tetap
    // dikirim; MDM memakai engine yt-dlp-nya sendiri untuk itu.
    const named = /^https?:/i.test(msg.url || '') ? msg.url : page;
    const src = /^https?:/i.test(msg.src || '') ? msg.src : '';
    const cookies = await mdmCookieHeader(src || named);
    const reply = await mdmNativeRequest({
      video: true,
      url: named,
      ...(src ? { src } : {}),
      title: typeof msg.title === 'string' ? msg.title.slice(0, 300) : '',
      referrer: page !== named ? page : '',
      cookies,
      userAgent: app.userAgentFallback,
      brands: mdmBrands(),
      v: '0.5.2'
    });
    return { ok: Boolean(reply.ok), why: reply.why };
  }
  if (msg.type === 'hide-site' && page) {
    mdmHiddenSites.add(new URL(page).hostname);
    try { await mdmNativeRequest({ hideSite: new URL(page).hostname }); } catch (e) {}
    return { ok: true };
  }
  if (msg.type === 'options') {
    try {
      const reply = await mdmNativeRequest({ openOptions: true });
      return { ok: Boolean(reply.ok) };
    } catch (e) { return { ok: false }; }
  }
  return { ok: false };
}

// Jembatan HTTP untuk background.js extension (yang sudah dipatch) dan
// untuk shim di halaman (/page).
function mdmBridgeStart() {
  return new Promise((resolve) => {
    mdmBridgeSrv = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      const isNative = req.method === 'POST' && req.url.startsWith('/native');
      const isPage = req.method === 'POST' && req.url.startsWith('/page');
      // Halaman uji tombol MDM (dipakai smoke test KLIP_TABTEST)
      if (req.method === 'GET' && req.url === '/test.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!DOCTYPE html><html><body style="margin:0"><video controls width="640" height="360" style="display:block"></video></body></html>');
        return;
      }
      if (!isNative && !isPage) { res.writeHead(404); res.end(); return; }
      let body = '';
      req.on('data', (d) => { body += d; if (body.length > 2e6) req.destroy(); });
      req.on('end', async () => {
        let msg = null;
        try { msg = JSON.parse(body); } catch (e) {}
        if (!msg || typeof msg !== 'object') { res.writeHead(400); res.end(); return; }
        if (SMOKE) console.log('[mdm-ext] bridge request:', (isPage ? 'page ' : '') + JSON.stringify(msg).slice(0, 140));
        try {
          let reply = {};
          if (isPage) {
            reply = await mdmPageMessage(msg.pageMsg, msg.pageUrl);
          } else {
            reply = await mdmNativeRequest(msg);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(reply || {}));
        } catch (e) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, why: 'not-running' }));
        }
      });
    });
    mdmBridgeSrv.listen(0, '127.0.0.1', () => {
      mdmBridgePort = mdmBridgeSrv.address().port;
      resolve(mdmBridgePort);
    });
  });
}

// ---------- v1.6.3: tombol video tahan Trusted Types ----------
// Situs dengan Trusted Types CSP (YouTube, Google, dsb.) memblokir SEMUA jalur
// injeksi HTML: shadow.innerHTML DAN DOMParser.parseFromString — keduanya
// melempar "This document requires 'TrustedHTML' assignment" sehingga script
// tombol mati total dan tombol "Download video" hilang. Solusi: bangun DOM
// tombol secara eksplisit (createElement + appendChild) — 100% bebas sink
// Trusted Types. mdmPatchVideoJs() mengganti statement innerHTML di video.js
// dengan pemanggilan builder ini.
const MDM_DOM_BUILDER = [
  'try{globalThis.__mdmBuildShadowDOM=function(sh){try{',
  'var E=function(tag,attrs){var n=document.createElement(tag);for(var k in attrs)n.setAttribute(k,attrs[k]);return n};',
  'var SVG="http://www.w3.org/2000/svg";',
  'var pill=E("div",{class:"pill",part:"pill"});',
  'var go=E("button",{class:"go",type:"button"});',
  'var img=document.createElement("img");img.setAttribute("alt","");img.setAttribute("draggable","false");',
  'var label=E("span",{class:"label"});go.appendChild(img);go.appendChild(label);',
  'var more=E("button",{class:"more",type:"button"});more.setAttribute("aria-haspopup","menu");more.setAttribute("aria-expanded","false");',
  'var svg=document.createElementNS(SVG,"svg");',
  'svg.setAttribute("viewBox","0 0 12 12");svg.setAttribute("fill","none");svg.setAttribute("stroke","currentColor");',
  'svg.setAttribute("stroke-width","1.6");svg.setAttribute("stroke-linecap","round");svg.setAttribute("stroke-linejoin","round");svg.setAttribute("aria-hidden","true");',
  'var pth=document.createElementNS(SVG,"path");pth.setAttribute("d","M3 4.5 6 7.5l3-3");svg.appendChild(pth);more.appendChild(svg);',
  'pill.appendChild(go);pill.appendChild(more);',
  'var menu=E("div",{class:"menu",role:"menu"});',
  '["download","hide","never","settings"].forEach(function(act,i){if(i===1||i===3)menu.appendChild(document.createElement("hr"));menu.appendChild(E("button",{role:"menuitem","data-act":act}));});',
  'sh.appendChild(pill);sh.appendChild(menu);',
  '}catch(e){}}}catch(e){}\n'
].join('');
function mdmPatchVideoJs(src) {
  // Tangkap SELURUH statement (template literal + titik-koma) lalu ganti dengan
  // pemanggilan builder DOM eksplisit (struktur node identik dengan template).
  return src.replace(
    /shadow\.innerHTML \+= (`(?:[^`\\]|\\.)*`);/,
    '__mdmBuildShadowDOM(shadow);'
  );
}

// Salin extension ke userData (folder asli di resources tak boleh diubah),
// patch background.js (sendNativeMessage → bridge), lalu muat.
async function startMdmExtension(bSession) {
  const dir = resolveMdmDir();
  const extSrc = dir ? path.join(dir, 'extension', 'chromium') : null;
  if (!extSrc || !fs.existsSync(path.join(extSrc, 'manifest.json'))) return;

  await mdmBridgeStart();
  const patched = path.join(app.getPath('userData'), 'mdm-extension');
  try { fs.rmSync(patched, { recursive: true, force: true }); } catch (e) {}
  try { fs.cpSync(extSrc, patched, { recursive: true }); } catch (e) { return; }

  const bgPath = path.join(patched, 'background.js');
  let bg = fs.readFileSync(bgPath, 'utf8');
  const anchor = 'const HOST = "com.misterdownloadmanager.host";';
  const call = 'const reply = (await withTimeout(ext.runtime.sendNativeMessage(HOST, sent), ms)) || {};';
  if (!bg.includes(anchor) || !bg.includes(call)) return;
  const bridgeCode = `
// Zac Downloader: Electron tidak punya native messaging — pesan ke app
// diteruskan lewat jembatan HTTP lokal yang di-host main process aplikasi.
const BRIDGE_URL = "http://127.0.0.1:${mdmBridgePort}/native";
async function bridgeSend(sent) {
  let r;
  try {
    r = await fetch(BRIDGE_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sent) });
  } catch (e) {
    throw new Error("no answer");
  }
  if (!r.ok) throw new Error("no answer");
  return (await r.json().catch(() => ({}))) || {};
}`;
  bg = bg.replace(anchor, anchor + '\n' + bridgeCode);
  bg = bg.replace(call, 'const reply = (await withTimeout(bridgeSend(sent), ms)) || {};');
  // Electron tidak punya chrome.contextMenus & chrome.action — beri guard
  // supaya service worker tidak mati saat startup (API lain sudah ter-guard
  // oleh extension itu sendiri: scripting, DNR, proxy, downloads).
  bg = bg.replace(
    'ext.contextMenus.onClicked.addListener(async (info, tab) => {',
    'if (ext.contextMenus) ext.contextMenus.onClicked.addListener(async (info, tab) => {'
  );
  bg = bg.replace(
    'ext.contextMenus.removeAll(() => {',
    'if (!ext.contextMenus) return; ext.contextMenus.removeAll(() => {'
  );
  bg = bg.replace(
    'const action = ext.action ?? ext.browserAction;',
    'const action = (ext.action ?? ext.browserAction) || new Proxy({}, { get: () => () => {} });'
  );
  fs.writeFileSync(bgPath, bg, 'utf8');

  // Penanda injeksi content script (pemecahan masalah & smoke test)
  try {
    const pg = fs.readFileSync(path.join(patched, 'page.js'), 'utf8');
    fs.writeFileSync(path.join(patched, 'page.js'),
      'try{console.log("[MDM-EXT] page.js aktif di", location.hostname)}catch(e){}\n' + pg, 'utf8');
    const vd = fs.readFileSync(path.join(patched, 'video.js'), 'utf8');
    fs.writeFileSync(path.join(patched, 'video.js'),
      'try{console.log("[MDM-EXT] video.js aktif di", location.hostname)}catch(e){}\n' + MDM_DOM_BUILDER + mdmPatchVideoJs(vd), 'utf8');
  } catch (e) {}

  try {
    const loaded = await bSession.loadExtension(patched, { allowFileAccess: false });
    mdmExtId = loaded.id;
    console.log('[mdm-ext] extension MDM dimuat:', loaded.name, loaded.version, 'id=' + loaded.id);
  } catch (e) {
    console.log('[mdm-ext] gagal memuat extension:', e.message);
  }

  // ---- Shim untuk video.js di dalam webview ----
  // Content script Electron tidak meng-injek ke <webview>, jadi video.js
  // (penanda tombol "Download video") di-inject manual lewat executeJavaScript
  // oleh renderer. Shim menyediakan chrome.browser API minimal yang
  // dibutuhkan video.js: runtime.sendMessage (→ bridge /page), i18n
  // (locale id/en dari _locales), storage.local (localStorage).
  mdmSession = bSession;
  try {
    const localesDir = path.join(extSrc, '_locales');
    let loc = null;
    for (const lang of ['id', 'en']) {
      try { loc = JSON.parse(fs.readFileSync(path.join(localesDir, lang, 'messages.json'), 'utf8')); break; } catch (e) {}
    }
    const videoSrc = mdmPatchVideoJs(fs.readFileSync(path.join(extSrc, 'video.js'), 'utf8'));
    const shim = `
(() => {
  if (window.__mdmShimLoaded) return;
  window.__mdmShimLoaded = true;
  const BRIDGE = "http://127.0.0.1:${mdmBridgePort}/page";
  const LOCALES = ${JSON.stringify(loc || {})};
  const fill = (s, subs) => String(s == null ? "" : s).replace(/\\$(\\d)/g, (_, i) => (subs && subs[i - 1] != null ? String(subs[i - 1]) : ""));
  const shim = {
    runtime: {
      id: "mdm-electron-shim",
      sendMessage: (m) => {
        // Utama: IPC dari preload webview (bebas CSP halaman). Cadangan: fetch
        // ke jembatan HTTP lokal.
        if (window.__mdmIpc && window.__mdmIpc.send) {
          return window.__mdmIpc.send({ pageMsg: m, pageUrl: location.href }).catch(() => ({ ok: false }));
        }
        return fetch(BRIDGE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pageMsg: m, pageUrl: location.href }) }).then((r) => r.json()).catch(() => ({ ok: false }));
      }
    },
    i18n: {
      getMessage: (key, subs) => {
        if (key === "@@bidi_dir") return "ltr";
        const m = LOCALES[key];
        if (!m) return "";
        const text = typeof m === "string" ? m : (m.message || "");
        return fill(text, subs);
      }
    },
    storage: {
      local: {
        get: (defs) => {
          const out = {};
          try {
            const keys = defs && typeof defs === "object" ? defs : {};
            for (const k of Object.keys(keys)) {
              const raw = localStorage.getItem("mdm." + k);
              out[k] = raw == null ? keys[k] : JSON.parse(raw);
            }
            return Promise.resolve(out);
          } catch (e) { return Promise.resolve(out); }
        },
        set: (o) => {
          try { for (const [k, v] of Object.entries(o || {})) localStorage.setItem("mdm." + k, JSON.stringify(v)); } catch (e) {}
          return Promise.resolve();
        }
      }
    }
  };
  try { window.browser = shim; } catch (e) {}
  try { if (!window.chrome) window.chrome = shim; } catch (e) {}
  // Hybrid rAF: native rAF bila hidup, fallback timer bila di-throttle
  // (window tersembunyi/occluded) — agar tombol MDM tetap bereaksi.
  try {
    const origRaf = window.requestAnimationFrame.bind(window);
    const origCaf = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => {
      let done = false, t = null, k = null;
      const clear = () => { if (t != null) { clearTimeout(t); t = null; } if (k != null) { try { origCaf(k); k = null; } catch (e) {} } };
      const finish = (v) => { if (done) return; done = true; clear(); try { cb(v); } catch (e) {} };
      const cancel = () => { if (done) return; done = true; clear(); };
      try { k = origRaf(finish); } catch (e) {}
      t = setTimeout(() => finish(Date.now()), 32);
      return { __mdmToken: true, cancel };
    };
    window.cancelAnimationFrame = (tok) => { try { if (tok && typeof tok.cancel === 'function') tok.cancel(); else origCaf(tok); } catch (e) {} };
  } catch (e) {}
})();`;
    mdmShimJs = shim + '\n' + MDM_DOM_BUILDER + '\ntry {\n' + videoSrc + '\n} catch (e) { console.log("[MDM-EXT] video.js error:", e && e.message); }';
    console.log('[mdm-ext] shim tombol video siap (' + mdmShimJs.length + ' bytes)');
  } catch (e) {
    mdmShimJs = '';
  }
}

async function startMdmIntegration(bSession) {
  try { await startMdmExtension(bSession); } catch (e) {}
}

app.on('before-quit', () => {
  try { if (mdmNm) mdmNm.kill(); } catch (e) {}
  try { if (mdmBridgeSrv) mdmBridgeSrv.close(); } catch (e) {}
});

function resolveOutDir() {
  const candidates = [];
  try { candidates.push(app.getPath('videos')); } catch (e) {}
  try { candidates.push(app.getPath('downloads')); } catch (e) {}
  try { candidates.push(app.getPath('home')); } catch (e) {}
  for (const c of candidates) {
    try {
      const dir = path.join(c, 'Zac Downloader');
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    } catch (e) { /* coba kandidat berikutnya */ }
  }
  return app.getPath('temp');
}

function send(evt) {
  try { if (win && !win.isDestroyed()) win.webContents.send('download:event', evt); } catch (e) {}
}

function isValidHttpUrl(u) {
  try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:'; } catch (e) { return false; }
}

// Ekspor cookies dari browser built-in ke file format Netscape (membantu
// yt-dlp melewati "Sign in to confirm you're not a bot" milik YouTube bila
// user sudah login di browser aplikasi)
async function exportBrowserCookies() {
  try {
    const s = session.fromPartition('persist:browser');
    const cookies = await s.cookies.get({});
    if (!cookies.length) return null;
    const lines = ['# Netscape HTTP Cookie File', '# Generated by Zac Downloader'];
    for (const c of cookies) {
      const domain = c.domain || '';
      if (!domain) continue;
      const includeSub = domain.startsWith('.') ? 'TRUE' : 'FALSE';
      const dom = domain.startsWith('.') ? domain : domain;
      const secure = c.secure ? 'TRUE' : 'FALSE';
      const expiry = c.session ? '2000000000' : String(Math.floor(c.expirationDate || 2000000000));
      lines.push([dom, includeSub, c.path || '/', secure, expiry, c.name, c.value].join('\t'));
    }
    if (lines.length <= 2) return null;
    const p = path.join(app.getPath('userData'), 'browser-cookies.txt');
    fs.writeFileSync(p, lines.join('\n'), 'utf8');
    return p;
  } catch (e) { return null; }
}

// ---------- Single instance ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);

    settings = loadSettings();
    // Folder tersimpan bila masih ada, kalau tidak pakai default Videos\Zac Downloader
    let saved = (settings.outDir && typeof settings.outDir === 'string') ? settings.outDir : null;
    if (saved) {
      try {
        fs.mkdirSync(saved, { recursive: true });
        outDir = saved;
      } catch (e) { saved = null; }
    }
    if (!saved) outDir = resolveOutDir();

    ytdlpPath = process.env.KLIP_YTDLP || resolveBin('yt-dlp.exe');
    ffmpegPath = process.env.KLIP_FFMPEG || resolveBin('ffmpeg.exe', 'ffmpeg');

    // Session browser (persisten: cookie & login tersimpan)
    const bSession = session.fromPartition('persist:browser');
    try { bSession.setUserAgent(app.userAgentFallback); } catch (e) {}
    bSession.setPermissionRequestHandler((wc, permission, cb) => {
      const ok = ['media', 'fullscreen', 'audioCapture', 'videoCapture', 'clipboard-sanitized-write'].includes(permission);
      cb(ok);
    });

    // v1.6.1: extension MDM di browser built-in — tombol "Download video",
    // klik link file → MDM, torrent/magnet, popup & opsi MDM. (Dipasang
    // SEBELUM halaman pertama dibuat agar content script ikut sejak awal.)
    if (process.env.KLIP_NO_MDMEXT !== '1') {
      await startMdmIntegration(bSession);
    }

    dm = new DownloadManager({
      ytdlpPath,
      ffmpegPath,
      outDir,
      onEvent: (evt) => send(evt),
      cookiesProvider: exportBrowserCookies
    });

    // v1.3.0: pelacak media dari browser built-in (FlickReels, Shortical,
    // GoodShort, dan situs apa pun yang video-nya tidak bisa diambil yt-dlp)
    mediaTracker = createMediaTracker((evt) => send(evt));
    attachMediaCapture(bSession);

    // v1.6.2: server mirror Android (scrcpy) — tab Android di browser built-in
    if (process.env.KLIP_NO_MIRROR !== '1') {
      try {
        mirror = createMirrorServer({
          resolveAdb: () => process.env.KLIP_ADB || resolveBin(path.join('scrcpy', 'adb.exe'), path.join('scrcpy', 'adb'), 'adb'),
          resolveScrcpyBin: (...names) => resolveBin(...names),
          serverJar: resolveBin(path.join('scrcpy', 'scrcpy-server')),
          isSmoke: SMOKE,
          onLog: (l) => console.log(l)
        });
        await mirror.start();
        if (process.env.KLIP_FAKE_MIRROR === '1') {
          // smoke test: simulasi device scrcpy (stream H.264/Opus sintetis)
          setTimeout(() => { try { mirror.startFakeSession(); } catch (e) {} }, 1200);
        }
      } catch (e) {
        console.log('[mirror] gagal start:', e.message);
      }
    }

    createWindow();
    registerIpc();
    registerSiteResolveIpc();
  });

  app.on('before-quit', () => {
    try { if (mdmNm) mdmNm.kill(); } catch (e) {}
    try { if (mdmBridgeSrv) mdmBridgeSrv.close(); } catch (e) {}
    try { if (mirror) mirror.stop(); } catch (e) {}
  });

  app.on('window-all-closed', () => {
    try { if (dm) dm.cancelAll(); } catch (e) {}
    app.quit();
  });
}

// ---------- Window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1520,
    height: 940,
    minWidth: 1160,
    minHeight: 700,
    backgroundColor: '#0b1020',
    title: 'Zac Downloader',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      spellcheck: false
    }
  });

  win.once('ready-to-show', () => win.show());
  win.on('page-title-updated', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  if (SMOKE) {
    win.webContents.on('console-message', (e, level, msg) => {
      console.log('[renderer]', msg);
    });
    win.webContents.on('did-finish-load', () => {
      console.log('SMOKE: renderer loaded');
      if (process.env.KLIP_TABTEST) {
        // v1.6.0: self-test fitur multi-tab (klik + → navigasi → tutup tab → window.open)
        setTimeout(async () => {
          try {
            const r = await win.webContents.executeJavaScript(`(async () => {
              const $ = (id) => document.getElementById(id);
              const out = {};
              out.tabsAwal = document.querySelectorAll('.btab').length;
              $('btnNewTab').click();                       // 1) buka tab baru
              await new Promise((r) => setTimeout(r, 500));
              out.tabsBaru = document.querySelectorAll('.btab').length;
              out.tabAktif = document.querySelectorAll('.btab.active').length;
              out.addrTabBaru = $('addrInput').value;       // harus kosong (halaman newtab)
              $('addrInput').value = 'example.org';         // 2) navigasi tab aktif
              $('btnGo').click();
              await new Promise((r) => setTimeout(r, 3000));
              out.addrSetelahGo = $('addrInput').value;
              out.judulTab = [...document.querySelectorAll('.btab .bt-title')].map((x) => x.textContent);
              const act = document.querySelector('.btab.active .bt-close');
              if (act) act.click();                         // 3) tutup tab aktif
              await new Promise((r) => setTimeout(r, 400));
              out.tabsAkhir = document.querySelectorAll('.btab').length;
              out.addrAkhir = $('addrInput').value;         // kembali ke tab 1 (YouTube)
              return out;
            })()`, true);
            console.log('TABTEST ' + JSON.stringify(r));
            // 4) alur "buka di tab baru": window.open dari dalam webview
            //    (jalur yang sama dgn klik-tengah / Ctrl+klik / target=_blank)
            const { webContents } = require('electron');
            const wvc = webContents.getAllWebContents().find((c) => c.getType() === 'webview');
            if (wvc) {
              wvc.on('console-message', (e2, l2, m2) => {
                if (/MDM-EXT/.test(String(m2))) console.log('[wv]', String(m2).slice(0, 140));
              });
              await wvc.executeJavaScript("window.open('https://example.com/')", true);
              await new Promise((r) => setTimeout(r, 2500));
              const r2 = await win.webContents.executeJavaScript(`({
                tabs: document.querySelectorAll('.btab').length,
                addr: document.getElementById('addrInput').value,
                judul: [...document.querySelectorAll('.btab .bt-title')].map((x) => x.textContent)
              })`, true);
              console.log('TABTEST2 ' + JSON.stringify(r2));
              // v1.6.1: end-to-end tombol "Download video" MDM — buka halaman
              // uji berisi <video>, gerakkan pointer, tombol harus ter-mount
              try {
                const onMsg = (e2, l2, m2) => { const s2 = String(m2); if (!/Electron Security/.test(s2)) console.log('[wv]', s2.slice(0, 160)); };
                wvc.on('console-message', onMsg);
                await wvc.loadURL(`http://127.0.0.1:${mdmBridgePort}/test.html`);
                await new Promise((r) => setTimeout(r, 3000));
                // trigger hover via input event asli + fallback dispatch manual
                try { wvc.sendInputEvent({ type: 'mouseMove', x: 320, y: 180 }); } catch (e) {}
                await wvc.executeJavaScript(`(async () => {
                  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
                  const rafOk = await new Promise((res) => {
                    const t = setTimeout(() => res(false), 1500);
                    requestAnimationFrame(() => { clearTimeout(t); res(true); });
                  });
                  for (let i = 0; i < 4; i++) {
                    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 320, clientY: 180, bubbles: true, composed: true }));
                    await sleep(350);
                  }
                  return { rafOk, at: (document.elementFromPoint(320, 180) || {}).tagName || null };
                })()`, true).then((p) => console.log('MDMPROBE ' + JSON.stringify(p))).catch(() => {});
                await new Promise((r) => setTimeout(r, 1200));
                const r3 = await wvc.executeJavaScript(`({
                  shim: Boolean(window.__mdmShimLoaded),
                  ipc: Boolean(window.__mdmIpc),
                  alive: Boolean(window.__mdmVideoButton && window.__mdmVideoButton.alive && window.__mdmVideoButton.alive()),
                  btn: Boolean(document.querySelector('mdm-video-button'))
                })`, true);
                console.log('MDMBTN ' + JSON.stringify(r3));
                wvc.off('console-message', onMsg);
              } catch (e) { console.log('MDMBTN_FAIL ' + e.message); }
            } else {
              console.log('TABTEST2 webview tidak ditemukan');
            }
          } catch (e) { console.log('TABTEST_FAIL ' + e.message); }
          console.log('SMOKE_OK');
          app.quit();
        }, 2500);
      } else {
        // v1.6.2: KLIP_SESSTEST — uji session restore dalam 2 fase:
        //   fase 1: buka/navigasi/tutup tab → quit (session.json tersimpan)
        //   fase 2: app dibuka lagi → tab harus kembali persis
        const sess = process.env.KLIP_SESSTEST;
        const holdMs = (parseInt(process.env.KLIP_SMOKE_HOLD, 10) || 0) * 1000;
        if (sess === '1' || sess === '2') {
          setTimeout(async () => {
            try {
              if (sess === '1') {
                const r = await win.webContents.executeJavaScript(`(async () => {
                  const $ = (id) => document.getElementById(id);
                  const out = { tabsAwal: document.querySelectorAll('.btab').length };
                  console.log('[sesstest] langkah 1: buka tab');
                  $('btnNewTab').click();                       // tab 2 → example.org
                  await new Promise((r) => setTimeout(r, 600));
                  console.log('[sesstest] langkah 2: navigasi example.org');
                  $('addrInput').value = 'https://example.org/';
                  $('btnGo').click();
                  await new Promise((r) => setTimeout(r, 2500));
                  console.log('[sesstest] langkah 3: buka tab 3');
                  $('btnNewTab').click();                       // tab 3 → example.com
                  await new Promise((r) => setTimeout(r, 600));
                  console.log('[sesstest] langkah 4: navigasi example.com');
                  $('addrInput').value = 'https://example.com/';
                  $('btnGo').click();
                  await new Promise((r) => setTimeout(r, 2500));
                  console.log('[sesstest] langkah 5: tutup tab 2');
                  const close2 = document.querySelectorAll('.btab')[1];
                  if (close2) close2.querySelector('.bt-close').click(); // tutup example.org
                  await new Promise((r) => setTimeout(r, 900));
                  out.tabsAkhir = document.querySelectorAll('.btab').length;
                  out.addr = $('addrInput').value;
                  console.log('[sesstest] selesai');
                  return out;
                })()`, true);
                console.log('SESSTEST1 ' + JSON.stringify(r));
              } else {
                const r = await win.webContents.executeJavaScript(`(() => ({
                  tabs: document.querySelectorAll('.btab').length,
                  addr: document.getElementById('addrInput').value,
                  judul: [...document.querySelectorAll('.btab .bt-title')].map((x) => x.textContent),
                  aktif: [...document.querySelectorAll('.btab')].findIndex((x) => x.classList.contains('active'))
                }))()`, true);
                console.log('SESSTEST2 ' + JSON.stringify(r));
                console.log('SESSTEST2_PASS ' + (r.tabs === 2 && /example\.com/.test(r.addr) ? 'YA' : 'TIDAK'));
              }
            } catch (e) { console.log('SESSTEST_FAIL ' + e.message); }
            console.log('SMOKE_OK');
            app.quit();
          }, sess === '1' ? 2500 : 5000);
        } else if (holdMs > 0) {
          setTimeout(() => {
            console.log('SMOKE_OK');
            app.quit();
          }, holdMs);
        } else {
          setTimeout(() => {
            console.log('SMOKE_OK');
            app.quit();
          }, 3000);
        }
      }
    });
    if (process.env.KLIP_SHOT) {
      setTimeout(async () => {
        try {
          const img = await win.webContents.capturePage();
          fs.writeFileSync(process.env.KLIP_SHOT, img.toPNG());
          console.log('SHOT_SAVED');
        } catch (e) { console.log('SHOT_FAIL ' + e.message); }
      }, 2200);
    }
  }
}

// ---------- v1.3.0: Media capture dari session browser ----------
// Memantau SEMUA request di session 'persist:browser'. Bila ada yang
// berupa media (ekstensi .m3u8/.mp4/dll, resourceType 'media', atau
// Content-Type video/audio), catat URL-nya + referer-nya lalu kabari UI.
function attachMediaCapture(bSession) {
  const filter = { urls: ['*://*/*'] };

  const wr = bSession.webRequest;

  // 1) Deteksi berdasar URL / resourceType (paling cepat)
  wr.onBeforeSendHeaders(filter, (details, cb) => {
    try {
      if (shouldCapture(details.url, details.resourceType)) {
        mediaTracker.note(details.url, details.referrer || '');
      }
    } catch (e) {}
    cb({ requestHeaders: details.requestHeaders });
  });

  // 2) Deteksi berdasar Content-Type respons (menangkap CDN tanpa ekstensi)
  wr.onResponseStarted(filter, (details) => {
    try {
      const h = details.responseHeaders || {};
      let ct = '';
      for (const k of Object.keys(h)) {
        if (k.toLowerCase() === 'content-type') { ct = Array.isArray(h[k]) ? h[k][0] : h[k]; break; }
      }
      if (isMediaContentType(ct) && !/text\/html/i.test(ct)) {
        mediaTracker.note(details.url, details.referrer || '');
      }
    } catch (e) {}
  });
}

// ---------- Webview handling (browser box) ----------
app.on('web-contents-created', (ev, contents) => {
  if (contents.getType() === 'webview') {
    // v1.6.0: link target=_blank / Ctrl+klik / klik-tengah → tab BARU di
    // browser built-in (dulu: dimuat di webview yang sama).
    contents.setWindowOpenHandler(({ url, disposition }) => {
      if (isValidHttpUrl(url)) {
        const activate = disposition !== 'background-tab';
        try { if (win && !win.isDestroyed()) win.webContents.send('download:event', { type: 'open-tab', url, activate }); } catch (e) {}
      }
      return { action: 'deny' };
    });
    contents.on('did-fail-load', (e, code, desc, url, isMain) => {
      if (isMain && code !== -3 && win) {
        send({ type: 'browser-fail', code, desc });
      }
    });
    if (SMOKE) {
      // smoke: relay log dari dalam webview (tab Android dll.) ke stdout
      contents.on('console-message', (e2, l2, m2) => {
        const s = String(m2);
        if (!/Electron Security/.test(s)) console.log('[wv]', s.slice(0, 200));
      });
    }
    // v1.6.0: menu klik-kanan di dalam browser built-in
    contents.on('context-menu', (e, params) => showBrowserContextMenu(contents, params));
  }
});

// Menu klik-kanan browser built-in: buka link/gambar di tab baru, salin
// alamat, navigasi. Dikirim ke renderer lewat event 'open-tab'.
function showBrowserContextMenu(contents, params) {
  const items = [];
  if (params.linkURL && isValidHttpUrl(params.linkURL)) {
    items.push({
      label: 'Buka link di tab baru',
      click: () => { try { win.webContents.send('download:event', { type: 'open-tab', url: params.linkURL, activate: true }); } catch (e) {} }
    });
    items.push({
      label: 'Salin alamat link',
      click: () => { try { clipboard.writeText(params.linkURL); } catch (e) {} }
    });
  }
  if (params.mediaType === 'image' && params.srcURL && isValidHttpUrl(params.srcURL)) {
    if (items.length) items.push({ type: 'separator' });
    items.push({
      label: 'Buka gambar di tab baru',
      click: () => { try { win.webContents.send('download:event', { type: 'open-tab', url: params.srcURL, activate: true }); } catch (e) {} }
    });
    items.push({
      label: 'Salin alamat gambar',
      click: () => { try { clipboard.writeText(params.srcURL); } catch (e) {} }
    });
  }
  if (items.length) items.push({ type: 'separator' });
  let canBack = false, canFwd = false;
  try { canBack = contents.navigationHistory.canGoBack(); canFwd = contents.navigationHistory.canGoForward(); } catch (e) {}
  items.push({ label: 'Kembali', enabled: canBack, click: () => { try { contents.goBack(); } catch (e) {} } });
  items.push({ label: 'Maju', enabled: canFwd, click: () => { try { contents.goForward(); } catch (e) {} } });
  items.push({ label: 'Muat ulang', click: () => { try { contents.reload(); } catch (e) {} } });
  try { Menu.buildFromTemplate(items).popup({ window: win }); } catch (e) {}
}

// ---------- v1.5.1: Vidio (vidio.com) — resolusi link stream ----------
// Video modern Vidio tidak lagi menyediakan playlist.m3u8 publik (404) dan
// konten premium butuh session. Player web-nya meminta token lewat
// POST /live/{id}/tokens dari KONTEKS HALAMAN (cookie+CSRF browser).
// Renderer meng-inject JS ke browser built-in → kandidat URL stream →
// main memvalidasi (GET, harus #EXTM3U / mp4) → dipakai untuk download.

const VIDIO_PAGE_RE = /^https?:\/\/(?:www\.)?vidio\.com\/(watch|embed)\/(\d+)(?:-[^/?#]*)?/i;
const VIDIO_LIVE_RE = /^https?:\/\/(?:www\.)?vidio\.com\/live\/(\d+)/i;

// Validasi cepat URL stream: 1 redirect, baca chunk pertama, cek konten
function checkStreamUrl(url, referer) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const lib = u.protocol === 'https:' ? require('https') : require('http');
      const req = lib.get(u, {
        headers: {
          'User-Agent': app.userAgentFallback,
          'Accept': '*/*',
          ...(referer ? { 'Referer': referer } : {})
        }, timeout: 9000
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && !res.headers.location.startsWith('/drm')) {
          res.resume();
          const next = new URL(res.headers.location, u).href;
          return checkStreamUrl(next, referer).then(resolve);
        }
        if (res.statusCode !== 200) { res.resume(); return resolve({ ok: false, reason: 'HTTP ' + res.statusCode }); }
        let buf = '';
        let done = false;
        res.on('data', (d) => {
          if (done) return;
          done = true;
          buf += d.toString('utf8');
          res.destroy();
          if (buf.includes('#EXTM3U') || buf.includes('#EXT-X')) return resolve({ ok: true, url });
          if (buf.length > 4) return resolve({ ok: true, url }); // mp4/mpd biasanya binary → anggap OK
          resolve({ ok: false, reason: 'isi kosong' });
        });
        res.on('error', () => { if (!done) { done = true; resolve({ ok: false, reason: 'koneksi terputus' }); } });
      });
      req.on('timeout', () => { try { req.destroy(new Error('timeout')); } catch (e) {} });
      req.on('error', (e) => resolve({ ok: false, reason: e.message }));
    } catch (e) { resolve({ ok: false, reason: e.message }); }
  });
}

function safeOutName(title) {
  let s = String(title || '');
  // buang suffix situs SEBELUM strip karakter ilegal (jika tidak, '|' hilang duluan
  // dan suffix 'Vidio'/'GoodShort' menempel di nama file)
  s = s.replace(/\s*[|\u2013\u2014-]\s*Vidio.*$/i, '');
  s = s.replace(/\s*[|\u2013\u2014-]\s*GoodShort.*$/i, '');
  s = s.replace(/\s*[\u2013\u2014-]\s*Nonton.*$/i, '');
  s = s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  return ((s.length > 90 ? s.slice(0, 90).trim() : s) || 'video-situs');
}

function registerSiteResolveIpc() {
  // v1.5.1: Vidio — kandidat URL stream dari inject JS, divalidasi satu per satu
  ipcMain.handle('vidio:resolve', async (e, payload = {}) => {
    const candidates = Array.isArray(payload.candidates) ? payload.candidates.filter((x) => typeof x === 'string' && /^https?:\/\//.test(x)).slice(0, 6) : [];
    const referer = 'https://www.vidio.com/';
    const outName = safeOutName(payload.title);
    for (const c of candidates) {
      const v = await checkStreamUrl(c, referer);
      if (v.ok) return { ok: true, url: v.url, outName, via: c === v.url ? 'direct' : 'redirect' };
    }
    return { ok: false, reason: candidates.length ? 'semua kandidat tidak valid' : 'tidak ada kandidat', outName };
  });

  // v1.5.1: GoodShort — daftar episode (1 atau banyak) dari inject JS.
  // Entri pertama divalidasi; sisanya dipercaya (baru saja diambil dari API situs).
  ipcMain.handle('goodshort:resolve', async (e, payload = {}) => {
    const title = safeOutName(payload.title || 'goodshort');
    const raw = Array.isArray(payload.entries) ? payload.entries
      .filter((x) => x && typeof x.url === 'string' && /^https?:\/\//.test(x.url))
      .slice(0, 200) : [];
    if (!raw.length) return { ok: false, reason: 'tidak ada kandidat episode' };
    const v = await checkStreamUrl(raw[0].url, 'https://www.goodshort.com/');
    if (!v.ok) return { ok: false, reason: 'link episode ' + (v.reason || 'tidak valid') };
    // v1.5.2: nama file unik dalam satu batch — kalau dua entri menghasilkan
    // nama sama, tambahkan suffix (2), (3) … supaya tidak saling menimpa
    const seen = new Map();
    const entries = raw.map((x, i) => {
      let nm = `${title} - EP ${x.ep || i + 1}`;
      const dup = (seen.get(nm) || 0) + 1;
      seen.set(nm, dup);
      if (dup > 1) nm = `${nm} (${dup})`;
      return { url: i === 0 ? v.url : x.url, outName: nm };
    });
    return { ok: true, entries, outName: title };
  });
}

// ---------- Playlist helpers ----------
function isPlaylistUrl(u) {
  // watch?v=... → selalu single video (walau ada &list=...)
  if (/youtube\.com\/watch\?/i.test(u)) return false;
  // v1.4.0: URL drama BiliBili TV TANPA ep id → 1 drama berisi banyak episode
  //   bilibili.tv/id/play/2130147          → playlist (seluruh episode drama)
  //   bilibili.tv/id/play/2130147/13810256 → episode tunggal, bukan playlist
  if (/bilibili\.tv\/(?:[a-zA-Z]{2}(?:-[a-zA-Z0-9]{2,6})?\/)?play\/\d+\/?([?#]|$)/i.test(u)) return true;
  // v1.5.0: URL drama Dramaharian TANPA ep → seluruh episode (yang gratis) masuk antrean
  //   dramaharian.com/drama/{provider}/{bookId}           → playlist
  //   dramaharian.com/tonton/{provider}/{bookId}/{ep}     → episode tunggal
  if (/dramaharian\.com\/drama\/[\w.-]+\/[^/?#]+\/?([?#]|$)/i.test(u)) return true;
  return (
    /[?&]list=/i.test(u) ||
    /youtube\.com\/playlist\?/i.test(u) ||
    /youtube\.com\/channel\//i.test(u) ||
    /youtube\.com\/@[\w.-]+(\/videos?)?\/?$/i.test(u)
  );
}

// ---------- v1.5.0: Dramaharian (dramaharian.com) ----------
// Situs short drama agregator multi-provider (dramabite, dramawave, flextv,
// flickreels, freereels, dll). Video diambil lewat API resmi situs:
//   GET /api/browse/chapters/{bookId}?provider={prov}  → daftar episode
//   GET /api/content/watch/{bookId}/{ep}?provider={prov} → URL .m3u8
// Header X-Device-Id (UUID stabil) dibutuhkan utk kuota tamu (~100 episode).

const DRAMAHARIAN_RE = /^https?:\/\/(?:www\.)?dramaharian\.com\/(drama|tonton)\/([\w.-]+)\/([^/?#]+)(?:\/?(\d+)?(?:[?#].*)?)?$/i;

// Sanitasi nama file Windows (sama gaya dgn --windows-filenames)
function safeFilename(s, max = 90) {
  const clean = String(s || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (clean.length > max ? clean.slice(0, max).trim() : clean) || 'video';
}

// UUID stabil per-installasi (disimpan di settings.json)
function dramaharianDeviceId() {
  if (!settings.drhDevice) {
    settings.drhDevice = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
    saveSettings();
  }
  return settings.drhDevice;
}

function httpGetJson(url, headers, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? require('https') : require('http');
    const req = lib.get(u, {
      headers: Object.assign({
        'Accept': 'application/json',
        'User-Agent': app.userAgentFallback,
        'Accept-Language': 'id-ID,id;q=0.9'
      }, headers || {})
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return httpGetJson(new URL(res.headers.location, u).href, headers, timeoutMs).then(resolve, reject);
      }
      let out = '';
      res.on('data', (d) => { out += d.toString(); });
      res.on('end', () => {
        try { resolve(JSON.parse(out)); } catch (e) { reject(new Error('respon JSON tidak valid')); }
      });
    });
    req.on('error', reject);
    const to = setTimeout(() => { try { req.destroy(new Error('timeout')); } catch (e) {} }, timeoutMs);
    req.on('close', () => clearTimeout(to));
  });
}

// URL m3u8 untuk 1 episode (atau null bila episode berbayar/terkunci)
async function dramaharianEpisodeUrl(provider, bookId, ep) {
  const api = `https://dramaharian.com/api/content/watch/${encodeURIComponent(bookId)}/${ep}?provider=${encodeURIComponent(provider)}`;
  const j = await httpGetJson(api, { 'X-Device-Id': dramaharianDeviceId() });
  const d = j && j.data;
  const vid = d && (d.video || (d.chapter && d.chapter.video));
  return (vid && (vid.hls || vid.default || vid.mp4)) || null;
}

// Ekspansi URL dramaharian → daftar {url, title, outName}
//   /drama/{prov}/{bookId}        → SEMUA episode gratis
//   /tonton/{prov}/{bookId}/{ep}  → episode tunggal itu saja
async function expandDramaharian(url, sendEvt) {
  const m = String(url).match(DRAMAHARIAN_RE);
  if (!m) return null;
  const [, mode, provider, bookId, epStr] = m;
  const dh = (msg) => { try { sendEvt({ type: 'dh-info', line: msg }); } catch (e) {} };

  // Judul drama dari og:title halaman SSR (fallback: provider+bookId)
  let dramaTitle = `${provider} ${bookId}`;
  try {
    const html = await new Promise((resolve) => {
      const u = new URL(`https://dramaharian.com/drama/${provider}/${encodeURIComponent(bookId)}`);
      require('https').get(u, { headers: { 'User-Agent': app.userAgentFallback } }, (res) => {
        let out = '';
        res.on('data', (d) => { out += d.toString(); });
        res.on('end', () => resolve(out));
      }).on('error', () => resolve(''));
      setTimeout(() => resolve(''), 12000);
    });
    const t = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i);
    if (t) dramaTitle = t[1].replace(/\s*—\s*Nonton Drama.*$/i, '').replace(/\s*\|\s*Dramaharian.*$/i, '').trim();
  } catch (e) {}
  const baseName = safeFilename(dramaTitle);

  // Episode tunggal dari /tonton/...
  if (mode === 'tonton' || epStr) {
    const ep = parseInt(epStr, 10) || 1;
    dh(`Mengambil link episode ${ep} …`);
    const vurl = await dramaharianEpisodeUrl(provider, bookId, ep);
    if (!vurl) throw new Error(`Episode ${ep} tidak tersedia (kemungkinan episode berbayar/terkunci).`);
    return [{ url: vurl, title: `${dramaTitle} — EP ${ep}`, outName: `${baseName} - EP ${ep}` }];
  }

  // Drama penuh → ambil daftar episode, saring yang gratis
  dh('Membaca daftar episode …');
  const chap = await httpGetJson(
    `https://dramaharian.com/api/browse/chapters/${encodeURIComponent(bookId)}?provider=${encodeURIComponent(provider)}`,
    { 'X-Device-Id': dramaharianDeviceId() }
  );
  const chapters = (chap && chap.data) || [];
  if (!chapters.length) throw new Error('Daftar episode kosong — cek URL drama.');
  const freeEps = chapters
    .filter((c) => c && Number(c.isCharge) === 0)
    .map((c) => parseInt(c.chapterId, 10))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  const locked = chapters.length - freeEps.length;
  if (!freeEps.length) throw new Error('Semua episode drama ini berbayar/terkunci.');

  dh(`${freeEps.length} episode gratis terdeteksi${locked ? ` (${locked} episode berbayar dilewati)` : ''} — mengambil link video …`);
  const entries = [];
  let fail = 0;
  for (const ep of freeEps.slice(0, 200)) {
    try {
      const vurl = await dramaharianEpisodeUrl(provider, bookId, ep);
      if (vurl) entries.push({ url: vurl, title: `${dramaTitle} — EP ${ep}`, outName: `${baseName} - EP ${ep}` });
      else fail++;
    } catch (e) { fail++; }
    if (entries.length && entries.length % 10 === 0) dh(`Progres: ${entries.length} link siap …`);
  }
  if (!entries.length) throw new Error('Tidak ada episode gratis yang bisa diambil saat ini (kuota tamu mungkin habis — coba lagi nanti).');
  if (fail) dh(`${fail} episode dilewati (terkunci/kuota).`);
  return entries;
}

function spawnEnv() {
  return Object.assign({}, process.env, {
    PATH: path.dirname(ytdlpPath) + path.delimiter + (process.env.PATH || '')
  });
}

// Baca isi playlist (cepat, --flat-playlist, tanpa metadata detail)
function expandPlaylist(url) {
  return new Promise((resolve, reject) => {
    const args = ['-J', '--flat-playlist', '--playlist-items', '1-200', url];
    let out = '';
    let err = '';
    let proc;
    try {
      proc = spawn(ytdlpPath, args, { windowsHide: true, env: spawnEnv() });
    } catch (e) { return reject(e); }
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });
    const to = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (e) {}
      reject(new Error('timeout membaca playlist'));
    }, 90000);
    proc.on('error', (e) => { clearTimeout(to); reject(e); });
    proc.on('close', () => {
      clearTimeout(to);
      try {
        const j = JSON.parse(out);
        if (j && j._type === 'playlist' && Array.isArray(j.entries)) {
          const entries = j.entries
            .filter((x) => x && (x.url || x.id))
            .map((x) => ({
              url: x.url || ('https://www.youtube.com/watch?v=' + x.id),
              title: x.title || null
            }));
          resolve(entries);
        } else {
          resolve(null); // bukan playlist → diperlakukan single
        }
      } catch (e) {
        reject(new Error((err.split('\n').filter(l => l.startsWith('ERROR:')).pop() || 'format playlist tidak dikenali').slice(0, 300)));
      }
    });
  });
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('app:getInfo', () => ({
    version: app.getVersion(),
    outDir,
    platform: process.platform,
    ytdlpPath,
    ffmpegPath,
    autoAndroid: process.env.KLIP_AUTO_ANDROID === '1'
  }));

  ipcMain.handle('engine:version', async () => {
    return await new Promise((resolve) => {
      let out = '';
      let proc;
      try {
        proc = spawn(ytdlpPath, ['--version'], { windowsHide: true });
      } catch (e) { return resolve(null); }
      proc.stdout.on('data', (d) => { out += d.toString(); });
      proc.on('error', () => resolve(null));
      proc.on('close', () => resolve((out.trim() || null)));
      setTimeout(() => { try { proc.kill(); } catch (e) {} resolve(out.trim() || null); }, 8000);
    });
  });

  ipcMain.handle('download:start', async (e, url, quality, opts = {}) => {
    url = String(url || '');
    if (!isValidHttpUrl(url)) return { error: 'URL tidak valid. Contoh: https://youtu.be/xxxx' };
    const mode = opts && opts.mode === 'mp3' ? 'mp3' : 'video';
    const thumb = !(opts && opts.thumb === false);

    // Playlist → pecah jadi banyak download (antrean otomatis, paralel)
    // v1.5.1: link stream hasil resolusi inject-JS browser (Vidio/GoodShort)
    // → antre langsung tanpa yt-dlp (yt-dlp gagal utk video modern + WAF)
    if (Array.isArray(opts.directEntries) && opts.directEntries.length) {
      const ref = (opts.referer && String(opts.referer)) || null;
      const list = opts.directEntries.slice(0, opts.directEntries.length > 1 ? 200 : 1);
      let added = 0, lastErr = null;
      for (const en of list) {
        if (!en || !isValidHttpUrl(en.url)) { lastErr = 'URL tidak valid'; continue; }
        const v = await checkStreamUrl(en.url, ref);
        if (!v.ok) { lastErr = v.reason; continue; }
        const r = dm.start(v.url, quality, { mode, thumb: false, title: en.outName || null, outName: en.outName || null, referer: ref });
        if (r && !r.error) added++;
      }
      if (added > 0) {
        if (list.length > 1) send({ type: 'playlist-info', count: added });
        return { playlist: list.length > 1, count: added };
      }
      return { error: 'Link video tidak valid/kedaluwarsa (' + (lastErr || 'tidak diketahui') + '). Buka ulang halamannya di browser aplikasi lalu coba lagi.' };
    }
    if (isPlaylistUrl(url)) {
      // v1.5.0: Dramaharian — ekspansi episode lewat API situs (bukan yt-dlp)
      if (/dramaharian\.com\//i.test(url)) {
        send({ type: 'playlist-start', url });
        try {
          const entries = await expandDramaharian(url, send);
          if (entries && entries.length) {
            let added = 0;
            for (const en of entries.slice(0, 200)) {
              const r = dm.start(en.url, quality, { mode, thumb: false, title: en.title, outName: en.outName, referer: 'https://dramaharian.com/' });
              if (r && !r.error) added++;
            }
            send({ type: 'playlist-info', count: added });
            return { playlist: true, count: added };
          }
          return { error: 'Tidak ada episode yang bisa diambil dari URL ini.' };
        } catch (err) {
          return { error: 'Dramaharian: ' + err.message };
        }
      }
      send({ type: 'playlist-start', url });
      try {
        const entries = await expandPlaylist(url);
        if (entries && entries.length) {
          let added = 0;
          for (const en of entries.slice(0, 200)) {
            const r = dm.start(en.url, quality, { mode, title: en.title, thumb });
            if (r && !r.error) added++;
          }
          send({ type: 'playlist-info', count: added });
          return { playlist: true, count: added };
        }
        // bukan playlist → lanjut sebagai single
      } catch (err) {
        return { error: 'Gagal membaca playlist: ' + err.message };
      }
    }

    // v1.3.0: referer dari media capture (CDN drama biasanya cek Referer)
    const referer = opts && typeof opts.referer === 'string' ? opts.referer : null;
    return dm.start(url, quality, { mode, thumb, referer });
  });

  ipcMain.handle('media:list', () => (mediaTracker ? mediaTracker.list().slice(0, 12) : []));

  ipcMain.handle('media:clear', () => { if (mediaTracker) mediaTracker.clear(); return true; });

  ipcMain.handle('download:cancel', (e, id) => {
    if (id) return dm.cancel(String(id));
    return false;
  });

  ipcMain.handle('download:setConcurrent', (e, n) => {
    return dm.setMaxConcurrent(n);
  });

  ipcMain.handle('downloads:list', async () => {
    try {
      const files = [];
      for (const f of fs.readdirSync(outDir)) {
        const ext = path.extname(f).toLowerCase();
        if (!MEDIA_EXTS.includes(ext)) continue;
        const p = path.join(outDir, f);
        try {
          const st = fs.statSync(p);
          if (st.isFile()) files.push({ path: p, name: f, size: st.size, mtime: st.mtimeMs });
        } catch (e) {}
      }
      files.sort((a, b) => b.mtime - a.mtime);
      return files.slice(0, 100);
    } catch (e) { return []; }
  });

  ipcMain.handle('downloads:openFolder', async () => {
    const r = await shell.openPath(outDir);
    return r || true;
  });

  ipcMain.handle('downloads:chooseFolder', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Pilih folder hasil download',
      defaultPath: outDir,
      properties: ['openDirectory', 'createDirectory']
    });
    if (r.canceled || !r.filePaths.length) return { ok: false };
    outDir = r.filePaths[0];
    if (dm) dm.outDir = outDir;
    settings.outDir = outDir;
    saveSettings();
    return { ok: true, outDir };
  });

  ipcMain.handle('downloads:openFile', async (e, p) => {
    try {
      const rp = path.resolve(String(p));
      if (!rp.startsWith(path.resolve(outDir))) return { error: 'Akses ditolak' };
      const r = await shell.openPath(rp);
      return r ? { error: r } : true;
    } catch (err) { return { error: err.message }; }
  });

  ipcMain.handle('clipboard:read', () => {
    const t = clipboard.readText() || '';
    return t.trim();
  });

  ipcMain.handle('engine:update', async () => {
    const st = dm.getStatus();
    if (st.active > 0 || st.queued > 0) {
      return { error: 'Tidak bisa update engine saat masih ada download berjalan/antre.' };
    }
    return await new Promise((resolve) => {
      let out = '';
      let proc;
      try {
        proc = spawn(ytdlpPath, ['-U'], { windowsHide: true });
      } catch (e) { return resolve({ error: e.message }); }
      const onData = (d) => {
        const s = d.toString();
        out += s;
        s.split('\n').map(x => x.trim()).filter(Boolean).forEach(l => send({ type: 'engine-update', line: l }));
      };
      proc.stdout.on('data', onData);
      proc.stderr.on('data', onData);
      proc.on('error', (err) => resolve({ error: err.message }));
      proc.on('close', (code) => {
        resolve({ ok: code === 0, output: out.slice(-1000), updated: /Updated|restart/i.test(out) });
      });
      setTimeout(() => { try { proc.kill(); } catch (e) {} resolve({ ok: true, output: out.slice(-1000) }); }, 120000);
    });
  });

  // ---------- v1.6.0: Mister Download Manager (MDM) dibundel ----------
  ipcMain.handle('mdm:status', () => {
    const p = resolveMdmExe();
    return { ok: !!p, path: p };
  });

  // v1.6.1: source shim+video.js untuk di-inject ke webview (tombol MDM)
  ipcMain.handle('mdm:shim', () => mdmShimJs);

  // v1.6.1: path preload webview — ditanya via sendSync (preload sandboxed
  // tidak punya __dirname yang bisa diandalkan)
  ipcMain.on('mdm:preload-path', (e) => {
    e.returnValue = path.join(__dirname, 'renderer', 'mdm-preload.js');
  });

  // v1.6.1: pesan shim video.js dari preload webview (bebas CSP halaman)
  ipcMain.handle('mdm:page-msg', async (e, payload) => {
    try {
      const msg = payload && typeof payload === 'object' ? payload : {};
      if (SMOKE) console.log('[mdm-ext] page-msg:', JSON.stringify(msg.pageMsg || {}).slice(0, 140));
      return await mdmPageMessage(msg.pageMsg, msg.pageUrl);
    } catch (err) {
      return { ok: false };
    }
  });

  ipcMain.handle('mdm:open', () => {    const p = resolveMdmExe();
    if (!p) {
      return { error: 'Mister Download Manager tidak ditemukan di paket (bin/mdm). Gunakan paket Windows v1.6.0 yang sudah dibundel MDM.' };
    }
    // spawn error event-nya asinkron → tunggu sebentar agar gagal bisa dilaporkan
    return new Promise((resolve) => {
      let settled = false;
      const done = (r) => { if (!settled) { settled = true; resolve(r); } };
      try {
        // detached: MDM tetap hidup walau Zac Downloader ditutup
        const child = spawn(p, [], { detached: true, stdio: 'ignore', windowsHide: false });
        child.on('error', (err) => done({ error: 'Gagal menjalankan MDM: ' + err.message }));
        child.unref();
      } catch (e) {
        done({ error: 'Gagal menjalankan MDM: ' + e.message });
      }
      setTimeout(() => done({ ok: true }), 1500);
    });
  });

  // ---------- v1.6.2: mirror Android (scrcpy) + session restore ----------
  ipcMain.handle('mirror:info', () => {
    return Object.assign({ port: mirror ? mirror.port : 0 }, mirror ? mirror.info() : { running: false });
  });

  ipcMain.handle('session:save', (e, data) => { saveSessionJson(data, false); return true; });

  ipcMain.on('session:save-sync', (e, data) => { saveSessionJson(data, true); e.returnValue = true; });

  ipcMain.handle('session:load', () => loadSessionJson());
}

process.on('uncaughtException', (err) => {
  console.error('[main] uncaught:', err);
});

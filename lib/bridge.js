/**
 * lib/bridge.js — Jembatan Zac Downloader <-> ChordKu (v1.7.0).
 *
 * Komunikasi lewat folder file JSON (tanpa port/socket, aman offline):
 *   inbox.json  : Zac -> ChordKu {ts, mode: url|browser|file|both, url,
 *                 path, title, source} — ditulis atomik (tmp + rename)
 *   status.json : ChordKu -> Zac {pid, version, ts} detak jantung
 *
 * ChordKu (Python, app/zac_bridge.py) membaca folder yang sama. Lokasi:
 *   Windows : %APPDATA%/ZacChordKuBridge
 *   lainnya : ~/.zac-chordku-bridge
 * Override utk tes: env CHORDKU_BRIDGE_DIR.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const BRIDGE_DIRNAME = 'ZacChordKuBridge';
const MODES = new Set(['url', 'browser', 'file', 'both']);

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  return dir;
}

function bridgeDir(env) {
  env = env || process.env;
  if (env.CHORDKU_BRIDGE_DIR) return ensureDir(env.CHORDKU_BRIDGE_DIR);
  if (process.platform === 'win32') {
    const base = env.APPDATA ||
      path.join(env.USERPROFILE || '', 'AppData', 'Roaming');
    return ensureDir(path.join(base, BRIDGE_DIRNAME));
  }
  return ensureDir(path.join(env.HOME || '/tmp', '.zac-chordku-bridge'));
}

function inboxPath(dir) { return path.join(dir, 'inbox.json'); }
function statusPath(dir) { return path.join(dir, 'status.json'); }

/**
 * Susun pesan valid. Return null bila tidak valid:
 * mode file butuh path; url/browser/both butuh url.
 */
function buildMessage({ mode, url, path: filePath, title, source }, ts) {
  const m = {
    ts: Number.isFinite(ts) ? ts : Date.now() / 1000,
    mode: MODES.has(String(mode || '').toLowerCase())
      ? String(mode).toLowerCase() : 'url',
    url: String(url || '').trim(),
    path: String(filePath || '').trim(),
    title: String(title || '').trim(),
    source: String(source || 'hub'),
  };
  if (m.mode === 'file' && !m.path) return null;
  if (m.mode !== 'file' && !m.url) return null;
  return m;
}

/** Tulis pesan inbox secara atomik. Return pesan atau null. */
function sendMessage(dir, msg, ts) {
  const m = buildMessage(msg, ts);
  if (!m) return null;
  try {
    const tmp = path.join(dir, '.inbox-' + Date.now() + '-' +
      Math.floor(Math.random() * 1e6) + '.tmp');
    fs.writeFileSync(tmp, JSON.stringify(m), 'utf8');
    fs.renameSync(tmp, inboxPath(dir));
    return m;
  } catch (e) {
    return null;
  }
}

function readInbox(dir) {
  try {
    const d = JSON.parse(fs.readFileSync(inboxPath(dir), 'utf8'));
    return (d && typeof d === 'object' && !Array.isArray(d)) ? d : null;
  } catch (e) { return null; }
}

/** Detak jantung ChordKu + flag hidup (usia < maxAge detik). */
function readStatus(dir, maxAge = 15) {
  try {
    const d = JSON.parse(fs.readFileSync(statusPath(dir), 'utf8'));
    const age = Math.max(0, Date.now() / 1000 - Number(d.ts || 0));
    return Object.assign({}, d, {
      age,
      running: Number.isFinite(age) && age <= maxAge,
    });
  } catch (e) {
    return { running: false, version: '', age: null };
  }
}

/**
 * Lokasi ChordKu.exe (dibundel di bin/chordku lewat extraResources).
 * Urutan: env CHORDKU_EXE -> <resources>/bin/chordku/ChordKu.exe
 * (paket terpasang) -> <proyek>/bin/chordku/ChordKu.exe (mode dev).
 */
function resolveChordKuExe({ isPackaged, resourcesPath, dirname, env }) {
  env = env || process.env;
  if (env.CHORDKU_EXE && fs.existsSync(env.CHORDKU_EXE)) {
    return env.CHORDKU_EXE;
  }
  const candidates = [];
  if (isPackaged && resourcesPath) {
    candidates.push(path.join(resourcesPath, 'bin', 'chordku', 'ChordKu.exe'));
  }
  if (dirname) {
    candidates.push(path.join(dirname, 'bin', 'chordku', 'ChordKu.exe'));
  }
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch (e) {}
  }
  return null;
}

module.exports = {
  BRIDGE_DIRNAME, MODES, bridgeDir, ensureDir, inboxPath, statusPath,
  buildMessage, sendMessage, readInbox, readStatus, resolveChordKuExe,
};

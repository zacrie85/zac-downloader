/**
 * scripts/test_bridge.js — unit test lib/bridge.js (jembatan ChordKu v1.7.0).
 * Jalankan: node scripts/test_bridge.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const bridge = require('../lib/bridge');

let fails = 0;
function check(name, cond, extra = '') {
  console.log((cond ? 'PASS' : 'FAIL'), '-', name, extra);
  if (!cond) fails++;
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'zac-bridge-test-'));
const ENV = { CHORDKU_BRIDGE_DIR: TMP, APPDATA: TMP, USERPROFILE: TMP, HOME: TMP };

// ---- bridgeDir ----
check('bridgeDir mengikuti env override', bridge.bridgeDir(ENV) === TMP &&
  fs.existsSync(TMP));
const ENVWIN = { APPDATA: TMP, USERPROFILE: TMP, HOME: TMP };
const fakeWinDir = bridge.bridgeDir(ENVWIN); // platform asli; di linux -> HOME
check('bridgeDir tanpa override tetap tersedia (fallback)', !!fakeWinDir &&
  fs.existsSync(fakeWinDir), fakeWinDir);

// ---- buildMessage: validasi ----
check('url tanpa URL ditolak', bridge.buildMessage({ mode: 'url', url: '' }) === null);
check('file tanpa path ditolak', bridge.buildMessage({ mode: 'file', path: '' }) === null);
const m = bridge.buildMessage({ mode: 'both', url: 'https://youtu.be/x',
  source: 'browser', title: 'Lagu' }, 1000.5);
check('pesan both valid', !!m && m.mode === 'both' && m.ts === 1000.5);
check('mode tak dikenal -> url', bridge.buildMessage({ mode: 'aneh',
  url: 'https://x' }, 1).mode === 'url');

// ---- sendMessage: atomik & terbaca ----
const sent = bridge.sendMessage(TMP, { mode: 'url',
  url: 'https://www.youtube.com/watch?v=abc', source: 'browser' }, 1234.0);
check('sendMessage tertulis', !!sent);
const got = bridge.readInbox(TMP);
check('inbox terbaca utuh', got && got.mode === 'url' &&
  got.url === 'https://www.youtube.com/watch?v=abc' && got.ts === 1234.0);
check('tidak ada file tmp tersisa',
  fs.readdirSync(TMP).filter((f) => f.startsWith('.inbox-')).length === 0,
  JSON.stringify(fs.readdirSync(TMP)));

// ---- readStatus: hidup & kedaluwarsa ----
check('status awal: belum jalan', bridge.readStatus(TMP).running === false);
fs.writeFileSync(bridge.statusPath(TMP),
  JSON.stringify({ pid: 42, version: '1.0.7', ts: Date.now() / 1000 }));
const st = bridge.readStatus(TMP);
check('status hidup setelah heartbeat', st.running === true &&
  st.version === '1.0.7' && st.age < 5);
fs.writeFileSync(bridge.statusPath(TMP),
  JSON.stringify({ pid: 42, version: '1.0.7', ts: Date.now() / 1000 - 1 }));
check('status mati bila maxAge 0', bridge.readStatus(TMP, 0).running === false);
fs.writeFileSync(bridge.statusPath(TMP),
  JSON.stringify({ pid: 42, version: '1.0.7', ts: Date.now() / 1000 - 600 }));
check('status kedaluwarsa (600 dtk)', bridge.readStatus(TMP).running === false);

// ---- resolveChordKuExe ----
const fakeRes = fs.mkdtempSync(path.join(os.tmpdir(), 'zac-res-'));
const exePath = path.join(fakeRes, 'bin', 'chordku', 'ChordKu.exe');
fs.mkdirSync(path.dirname(exePath), { recursive: true });
fs.writeFileSync(exePath, 'MZ-fake');
check('resolve: packaged -> resources/bin/chordku',
  bridge.resolveChordKuExe({ isPackaged: true, resourcesPath: fakeRes,
    dirname: '/dev/null-dir', env: {} }) === exePath);
const fakeProj = fs.mkdtempSync(path.join(os.tmpdir(), 'zac-proj-'));
const exeDev = path.join(fakeProj, 'bin', 'chordku', 'ChordKu.exe');
fs.mkdirSync(path.dirname(exeDev), { recursive: true });
fs.writeFileSync(exeDev, 'MZ-fake');
check('resolve: dev -> <proyek>/bin/chordku',
  bridge.resolveChordKuExe({ isPackaged: false, resourcesPath: fakeRes,
    dirname: fakeProj, env: {} }) === exeDev);
const envExe = path.join(TMP, 'custom.exe');
fs.writeFileSync(envExe, 'MZ');
check('resolve: env CHORDKU_EXE menang',
  bridge.resolveChordKuExe({ isPackaged: true, resourcesPath: fakeRes,
    dirname: fakeProj, env: { CHORDKU_EXE: envExe } }) === envExe);
check('resolve: tidak ada -> null',
  bridge.resolveChordKuExe({ isPackaged: false, resourcesPath: '/none',
    dirname: '/none2', env: {} }) === null);

// ---- pesan file end-to-end ----
bridge.sendMessage(TMP, { mode: 'file', path: 'D:\\Musik\\lagu.mp3',
  title: 'Pujaan Hati', source: 'download' }, 2345.0);
const got2 = bridge.readInbox(TMP);
check('pesan file terbaca (mode file + path)', got2.mode === 'file' &&
  got2.path === 'D:\\Musik\\lagu.mp3');

console.log('\n' + (fails ? fails + ' gagal' : 'SEMUA TES JEMBATAN ZAC v1.7.0 LULUS'));
process.exit(fails ? 1 : 0);

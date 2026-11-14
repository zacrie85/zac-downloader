#!/usr/bin/env node
/**
 * STARTTEST — tes START() mirror.js yang SESUNGGUHNYA (bukan fake session).
 *
 * Latar: v1.6.5 crash "Cannot access 'o' before initialization" (TDZ) lolos
 * dari semua tes lama karena jalur fake session tidak pernah memanggil
 * start(). Tes ini menjalankan start() penuh dengan:
 *  - "adb" palsu (bash) yang mencatat setiap invokasi dan menjawab skenario
 *  - emulator server scrcpy (TCP) yang meniru handshake 3 socket DENGAN
 *    framing scrcpy ASLI [4B size][1B type][payload] berisi SPS/PPS/GOP
 *    H.264 + Opus asli dari lib/fake-streams.json (v1.6.8 menguji translator):
 *      video [1B dummy][64B nama][4B codec h264] + config + data frames
 *      audio [1B dummy][4B opus | 4B disable] + config + data frames
 *      control [1B dummy]
 *  - mode "crash": shell server langsung keluar + stderr → wajib gagal cepat
 *    dengan pesan yang memuat stderr HP (validasi fix fail-fast v1.6.5)
 *
 * Kasus:
 *  1. ok      : audio=true stayAwake=true  → ok, audio aktif, svc+brand+args ok
 *  2. noaudio : audio=true                 → ok, audio:false (kode disable)
 *  3. crash   : audio=false                → error, pesan memuat stderr, cepat
 *
 * Jalankan: node scripts/test-start-real.js  (Linux, tanpa electron)
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createMirrorServer } = require(path.join(__dirname, '..', 'lib', 'mirror.js'));

let failures = 0;
function assert(cond, label) {
  if (cond) { console.log('  ✓ ' + label); } else { failures++; console.log('  ✗ ' + label); }
}

// ---------- file fixture (dibuat di tmpdir) ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'starttest-'));
const fakeDir = path.join(tmp, 'bin');
fs.mkdirSync(fakeDir, { recursive: true });
const fakeAdb = path.join(fakeDir, 'adb');
const fakeEmu = path.join(fakeDir, 'scrcpy_emu.js');
const fakeJar = path.join(fakeDir, 'scrcpy-server.jar');
fs.writeFileSync(fakeJar, 'fake-jar\n');
const adbLog = path.join(tmp, 'adb.log');
const modeFile = path.join(tmp, 'mode');
fs.writeFileSync(modeFile, 'ok');
const FSTREAMS = path.join(__dirname, '..', 'lib', 'fake-streams.json'); // H264/Opus nyata

// fake adb: catat invokasi; jawab sesuai skenario mode
// pemetaan argumen: adb -s SER push|forward|shell|get-state → $1=-s $2=SER $3=subperintah
fs.writeFileSync(fakeAdb, `#!/bin/bash
echo "adb $*" >> "${adbLog}"
MODE=$(cat "${modeFile}" 2>/dev/null || echo ok)
if [ "$1" = "start-server" ]; then exit 0; fi
if [ "$3" = "get-state" ]; then echo device; exit 0; fi
if [ "$3" = "push" ]; then echo "pushed"; exit 0; fi
if [ "$3" = "forward" ]; then
  PORT="$4"; PORT="\${PORT#tcp:}"
  if [ "$MODE" != "crash" ]; then
    setsid node "${fakeEmu}" "$PORT" "$MODE" "${FSTREAMS}" >/dev/null 2>&1 &
  fi
  exit 0
fi
if [ "$3" = "shell" ]; then
  if [ "$4" = "getprop" ]; then echo Xiaomi; exit 0; fi
  if [ "$4" = "svc" ]; then exit 0; fi
  if [ "$5" = "app_process" ]; then
    if [ "$MODE" = "crash" ]; then
      echo "ERROR: simulasi server crash di HP" >&2
      exit 1
    fi
    exec sleep 600   # adb shell asli tetap hidup selama server jalan
  fi
fi
exit 0
`, { mode: 0o755 });

// emulator scrcpy: 3 koneksi berurutan video → audio → control
// mode:
//  ok       : normal (dummy+header+frame / opus / dummy)
//  noaudio  : audio kirim kode disable
//  noctl    : socket control DITERIMA tapi tidak pernah dikirim apa pun
//             (simulasi server yang lambat accept / tanpa dummy — v1.6.7)
//  two2sock : server hanya buka 2 socket (video, control) — koneksi ke-2
//             client (audio) mengambil slot kontrol → slot asli kosong;
//             mensimulasikan server yang menonaktifkan audio lebih awal
//  stall    : handshake lengkap tapi TIDAK ADA data video setelahnya
//             (simulasi server menggantung — watchdog v1.6.7)
//  crash    : shell server langsung keluar (ditangani fake adb, bukan emu)
fs.writeFileSync(fakeEmu, `const net = require('net');
const fs = require('fs');
const port = parseInt(process.argv[2], 10);
const mode = process.argv[3] || 'ok';
let n = 0;
// v1.6.8: frame scrcpy ASLI [4B size][1B type][payload] dengan data H.264/Opus
// nyata dari lib/fake-streams.json — menguji translator app-side
let REAL = null;
try {
  const j = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
  const SC = Buffer.from([0, 0, 0, 1]);
  REAL = {
    vcfg: { t: 0, d: Buffer.concat([SC, Buffer.from(j.sps, 'base64'), SC, Buffer.from(j.pps, 'base64')]) },
    gop: (j.gop || []).slice(0, 3).map((g) => ({ t: 1, d: Buffer.concat([SC, Buffer.from(g.d, 'base64')]) })),
    acfg: { t: 0, d: Buffer.from(j.opusHead, 'base64') },
    aframes: (j.opusFrames || []).slice(0, 2).map((s) => ({ t: 1, d: Buffer.from(s, 'base64') }))
  };
} catch (e) {}
function sendFrame(sock, f) {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(f.d.length, 0);
  sock.write(Buffer.concat([size, Buffer.from([f.t]), f.d]));
}
function videoFull(sock) {
  const name = Buffer.alloc(64);
  Buffer.from('Zac Test Device\\u0000', 'utf8').copy(name);
  sock.write(Buffer.concat([Buffer.from([0]), name, Buffer.from([0x68,0x32,0x36,0x34])]));
  if (mode === 'stall') return; // header saja — TIDAK ada data lanjutan
  if (REAL) { sendFrame(sock, REAL.vcfg); for (const f of REAL.gop) sendFrame(sock, f); }
}
const srv = net.createServer((sock) => {
  n++;
  if (mode === 'two2sock') {
    if (n === 1) videoFull(sock);
    else if (n === 2) sock.write(Buffer.from([0])); // dummy slot kontrol
    // koneksi ke-3 dst: diterima server, tidak pernah dikirim apa pun
    return;
  }
  if (n === 1) { // video
    videoFull(sock);
  } else if (n === 2) { // audio: opus atau kode disable
    const code = mode === 'noaudio' ? Buffer.from([0,0,0,0]) : Buffer.from([0x6f,0x70,0x75,0x73]);
    sock.write(Buffer.concat([Buffer.from([0]), code]));
    if (mode !== 'noaudio' && REAL) { sendFrame(sock, REAL.acfg); for (const f of REAL.aframes) sendFrame(sock, f); }
  } else { // control
    if (mode === 'noctl') return; // accept tapi bisu
    sock.write(Buffer.from([0]));
  }
});
srv.listen(port, '127.0.0.1');
setTimeout(() => process.exit(0), 40000);
`);

function readLog() { try { return fs.readFileSync(adbLog, 'utf8'); } catch (e) { return ''; } }

async function runCase(label, mode, opts, check) {
  console.log('== KASUS: ' + label + ' (mode=' + mode + ') ==');
  fs.writeFileSync(modeFile, mode);
  fs.writeFileSync(adbLog, '');
  const logs = [];
  const mgr = createMirrorServer({
    resolveAdb: () => fakeAdb,
    serverJar: fakeJar,
    isSmoke: false,
    onLog: (l) => logs.push(l),
  });
  const t0 = Date.now();
  const r = await mgr.startSession(Object.assign({ serial: 'TEST0001' }, opts));
  const dt = Date.now() - t0;
  if (!r.ok) console.log('  (info) error startSession: ' + String(r.error).slice(0, 120));
  await check(r, logs, readLog(), dt, mgr);
  mgr.stopSession();
  await new Promise((res) => setTimeout(res, 300));
}

(async () => {
  // 1) jalur sukses penuh — kalau ada TDZ/urutan deklarasi, crash di sini
  await runCase('sukses + audio + stayAwake', 'ok', { audio: true, stayAwake: true, maxSize: 720 }, (r, logs, log, dt, mgr) => {
    assert(r.ok === true, 'startSession ok (bukan crash TDZ)');
    assert(r.name === 'Zac Test Device', 'nama device dari header video: ' + r.name);
    assert(r.audio === true, 'audio aktif (opus)');
    assert(logs.some((l) => l.includes('layar HP tetap menyala')), 'blok svc power jalan (o sudah terdefinisi)');
    assert(logs.some((l) => l.includes('Xiaomi/MIUI terdeteksi')), 'deteksi brand Xiaomi jalan');
    assert(log.includes('cleanup=false'), 'arg server memuat cleanup=false');
    assert(/stay_awake=false/.test(log), 'arg server memuat stay_awake=false');
    assert(/audio=auto/.test(log), 'arg server memuat audio=auto');
    assert(/max_size=720/.test(log), 'arg server memuat max_size=720');
    assert(log.includes('getprop brand dipanggil') || log.includes('ro.product.brand'), 'getprop brand dipanggil');
    assert(log.includes('svc power stayon true'), 'svc power stayon true dipanggil');
    assert(dt < 15000, 'durasi ' + dt + 'ms (cepat, tidak menunggu deadline)');
    // v1.6.8: translator framing scrcpy asli → protokol renderer
    assert(logs.some((l) => /sessionMeta \d+x\d+ \(dari SPS\)/.test(l)), 'v1.6.8: sessionMeta dari SPS (translator video)');
    assert(mgr.session && mgr.session.videoBacklog && (mgr.session.videoBacklog[0] & 0x80) === 0x80, 'backlog video diawali sessionMeta (protokol renderer)');
    assert(mgr.session && mgr.session.audioBacklog && mgr.session.audioBacklog.length > 16, 'backlog audio terkonversi (meta + opus)');
  });

  // 2) audio tidak didukung → kode disable → mirror video saja
  await runCase('audio disable (Android ≤10)', 'noaudio', { audio: true, stayAwake: false }, (r, logs, log) => {
    assert(r.ok === true, 'startSession ok');
    assert(r.audio === false, 'audio:false via kode disable');
    assert(logs.some((l) => l.includes('audio tidak tersedia')), 'pesan fallback audio');
    assert(!/svc power stayon true/.test(log), 'stayAwake=false → svc tidak dipanggil');
  });

  // 3) server langsung mati + stderr → gagal CEPAT dengan pesan berisi stderr
  await runCase('server crash + stderr', 'crash', { audio: false }, (r, logs, log, dt) => {
    assert(r.ok !== true && !!r.error, 'startSession gagal dengan error');
    assert(r.error.includes('simulasi server crash'), 'pesan memuat stderr HP: ' + String(r.error).slice(0, 80));
    assert(dt < 15000, 'gagal cepat (' + dt + 'ms), bukan menunggu deadline penuh');
    assert(logs.some((l) => l.includes('server device keluar')), 'log: server device keluar');
  });

  // 4) server bisu di socket kontrol — v1.6.7: mirror tetap jalan
  await runCase('socket kontrol bisu (tanpa dummy)', 'noctl', { audio: true, stayAwake: true }, (r, logs) => {
    assert(r.ok === true, 'startSession ok meski kontrol tanpa byte sambutan');
    assert(logs.some((l) => l.includes('tanpa byte sambutan')), 'log: lanjut tanpa byte kontrol');
    assert(r.audio === true, 'audio tetap aktif');
  });

  // 5) server 2-socket (audio dimatikan lebih awal) → self-heal via retry tanpa audio
  await runCase('server 2-socket → retry tanpa audio', 'two2sock', { audio: true }, (r, logs) => {
    assert(r.ok === true, 'percobaan ke-2 sukses (audio=false)');
    assert(r.audio === false, 'audio:false');
    assert(logs.some((l) => l.includes('percobaan dengan audio gagal')), 'log: retry terpicu');
    assert(logs.some((l) => l.includes('mirror jalan TANPA audio')), 'log: catatan fallback audio');
  });

  // 6) handshake lengkap tapi tidak ada data video → watchdog stall
  await runCase('server menggantung → watchdog stall', 'stall', { audio: false, stallAfterMs: 1500 }, async (r, logs, log, dt, mgr) => {
    assert(r.ok === true, 'startSession ok (server hidup)');
    const msgs = [];
    if (mgr.session) mgr.session.broadcastCtl = (o) => msgs.push(o);
    await new Promise((res) => setTimeout(res, 2600));
    assert(msgs.some((m) => m.t === 'session' && m.state === 'stall'), 'watchdog mengirim state stall');
    assert(logs.some((l) => l.includes('WATCHDOG')), 'log: watchdog');
  });

  console.log(failures === 0 ? 'STARTTEST PASS (semua kasus lulus)' : 'STARTTEST GAGAL: ' + failures + ' asersi');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('STARTTEST ERROR:', e.stack || e.message); process.exit(1); });

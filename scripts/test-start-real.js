#!/usr/bin/env node
/**
 * STARTTEST — tes START() mirror.js yang SESUNGGUHNYA (bukan fake session).
 *
 * Latar: v1.6.5 crash "Cannot access 'o' before initialization" (TDZ) lolos
 * dari semua tes lama karena jalur fake session tidak pernah memanggil
 * start(). Tes ini menjalankan start() penuh dengan:
 *  - "adb" palsu (bash) yang mencatat setiap invokasi dan menjawab skenario
 *  - emulator server scrcpy (TCP) yang meniru handshake 3 socket:
 *      video [1B dummy][64B nama][4B codec h264] (+backlog frame)
 *      audio [1B dummy][4B opus | 4B disable]   (mode ok / noaudio)
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
    setsid node "${fakeEmu}" "$PORT" "$MODE" >/dev/null 2>&1 &
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
fs.writeFileSync(fakeEmu, `const net = require('net');
const port = parseInt(process.argv[2], 10);
const mode = process.argv[3] || 'ok';
let n = 0;
const srv = net.createServer((sock) => {
  n++;
  if (n === 1) { // video
    const name = Buffer.alloc(64);
    Buffer.from('Zac Test Device\\u0000', 'utf8').copy(name);
    sock.write(Buffer.concat([Buffer.from([0]), name, Buffer.from([0x68,0x32,0x36,0x34])]));
    const meta = Buffer.alloc(12); meta[0] = 2; meta.writeUInt32BE(4, 8);
    sock.write(Buffer.concat([meta, Buffer.from([0,0,0,1])])); // backlog frame
  } else if (n === 2) { // audio: opus atau kode disable
    const code = mode === 'noaudio' ? Buffer.from([0,0,0,0]) : Buffer.from([0x6f,0x70,0x75,0x73]);
    sock.write(Buffer.concat([Buffer.from([0]), code]));
  } else { sock.write(Buffer.from([0])); } // control
});
srv.listen(port, '127.0.0.1');
setTimeout(() => process.exit(0), 30000);
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
  check(r, logs, readLog(), dt);
  mgr.stopSession();
  await new Promise((res) => setTimeout(res, 300));
}

(async () => {
  // 1) jalur sukses penuh — kalau ada TDZ/urutan deklarasi, crash di sini
  await runCase('sukses + audio + stayAwake', 'ok', { audio: true, stayAwake: true, maxSize: 720 }, (r, logs, log, dt) => {
    assert(r.ok === true, 'startSession ok (bukan crash TDZ)');
    assert(r.name === 'Zac Test Device', 'nama device dari header video: ' + r.name);
    assert(r.audio === true, 'audio aktif (opus)');
    assert(logs.some((l) => l.includes('layar HP tetap menyala')), 'blok svc power jalan (o sudah terdefinisi)');
    assert(logs.some((l) => l.includes('Xiaomi/MIUI terdeteksi')), 'deteksi brand Xiaomi jalan');
    assert(log.includes('cleanup=false'), 'arg server memuat cleanup=false');
    assert(/stay_awake=false/.test(log), 'arg server memuat stay_awake=false');
    assert(/audio=auto/.test(log), 'arg server memuat audio=auto');
    assert(/max_size=720/.test(log), 'arg server memuat max_size=720');
    assert(/getprop ro.product.brand/.test(log), 'getprop brand dipanggil');
    assert(/svc power stayon true/.test(log), 'svc power stayon true dipanggil');
    assert(dt < 20000, 'durasi ' + dt + 'ms (cepat, tidak menunggu deadline)');
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

  console.log(failures === 0 ? 'STARTTEST PASS (semua kasus lulus)' : 'STARTTEST GAGAL: ' + failures + ' asersi');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('STARTTEST ERROR:', e.stack || e.message); process.exit(1); });

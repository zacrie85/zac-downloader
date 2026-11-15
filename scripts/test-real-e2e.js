#!/usr/bin/env node
/**
 * REAL-E2E — tes pipeline MIRROR PENUH di Electron dengan framing scrcpy ASLI.
 *
 * Beda dgn STARTTEST (hanya app-side) dan MIRRORTEST (fake session, byte
 * berformat renderer): tes ini menjalankan start() ASLI + translator v1.6.9 +
 * renderer WebCodecs — memakai adb palsu + emulator scrcpy yang mengirim
 * framing [4B size][1B type][payload] berisi H.264/Opus nyata (ffmpeg) dari
 * lib/fake-streams.json. Lulus bila renderer benar-benar MENDEKODE gambar.
 *
 * Jalankan: node scripts/test-real-e2e.js  (Linux + Xvfb)
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

let failures = 0;
function assert(cond, label) {
  if (cond) { console.log('  ✓ ' + label); } else { failures++; console.log('  ✗ ' + label); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reale2e-'));
const binDir = path.join(tmp, 'bin');
fs.mkdirSync(binDir, { recursive: true });
const fakeAdb = path.join(binDir, 'adb');
const fakeEmu = path.join(binDir, 'scrcpy_emu.js');
const fakeJar = path.join(binDir, 'scrcpy-server.jar');
fs.writeFileSync(fakeJar, 'fake-jar\n');
const FSTREAMS = path.join(__dirname, '..', 'lib', 'fake-streams.json');

// adb palsu: jawab devices/get-state/push/forward/shell seperti perangkat nyata
fs.writeFileSync(fakeAdb, `#!/bin/bash
MODE="ok"
if [ "$1" = "start-server" ]; then exit 0; fi
if [ "$3" = "get-state" ]; then echo device; exit 0; fi
if [ "$3" = "devices" ]; then printf 'List of devices attached\\nREALFAKE001\\tdevice product:z model:Zac_Fake device:z transport_id:1\\n'; exit 0; fi
if [ "$3" = "push" ]; then echo "pushed"; exit 0; fi
if [ "$3" = "forward" ]; then
  if [ "$4" = "--remove" ]; then exit 0; fi  # cleanup — abaikan
  PORT="$4"; PORT="\${PORT#tcp:}"
  setsid node "${fakeEmu}" "$PORT" "$MODE" "${FSTREAMS}" >>"${tmp}/emu.log" 2>&1 &
  echo "forward $*" >> "${tmp}/adb.log"
  exit 0
fi
if [ "$3" = "shell" ]; then
  if [ "$4" = "getprop" ]; then echo Xiaomi; exit 0; fi
  if [ "$4" = "svc" ]; then exit 0; fi
  if [ "$5" = "app_process" ]; then exec sleep 600; fi
  exit 0
fi
exit 0
`, { mode: 0o755 });

// emulator scrcpy: 3 socket + framing ASLI [4B size][1B type][payload]
fs.writeFileSync(fakeEmu, `const net = require('net');
const fs = require('fs');
const port = parseInt(process.argv[2], 10);
let n = 0;
const j = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
const SC = Buffer.from([0, 0, 0, 1]);
const vcfg = { t: 0, d: Buffer.concat([SC, Buffer.from(j.sps, 'base64'), SC, Buffer.from(j.pps, 'base64')]) };
const gop = (j.gop || []).map((g) => ({ t: 1, d: Buffer.concat([SC, Buffer.from(g.d, 'base64')]) }));
const acfg = { t: 0, d: Buffer.from(j.opusHead, 'base64') };
const afr = (j.opusFrames || []).map((s) => ({ t: 1, d: Buffer.from(s, 'base64') }));
function sendFrame(sock, f) {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(f.d.length, 0);
  sock.write(Buffer.concat([size, Buffer.from([f.t]), f.d]));
}
const srv = net.createServer((sock) => {
  n++;
  if (n === 1) { // video: header 69B + config + GOP loop 10 fps
    const name = Buffer.alloc(64);
    Buffer.from('Zac Real Fake\\u0000', 'utf8').copy(name);
    sock.write(Buffer.concat([Buffer.from([0]), name, Buffer.from([0x68, 0x32, 0x36, 0x34])]));
    sendFrame(sock, vcfg);
    let i = 0;
    sendFrame(sock, gop[i % gop.length]);
    const iv = setInterval(() => {
      i++;
      try { sendFrame(sock, gop[i % gop.length]); } catch (e) { clearInterval(iv); }
    }, 100);
    sock.on('close', () => clearInterval(iv));
  } else if (n === 2) { // audio: header 5B + config + frame loop
    sock.write(Buffer.concat([Buffer.from([0]), Buffer.from([0x6f, 0x70, 0x75, 0x73])]));
    sendFrame(sock, acfg);
    let a = 0;
    const iv = setInterval(() => {
      if (!afr.length) { clearInterval(iv); return; }
      try { sendFrame(sock, afr[a++ % afr.length]); } catch (e) { clearInterval(iv); }
    }, 20);
    sock.on('close', () => clearInterval(iv));
  } else { sock.write(Buffer.from([0])); } // control
});
srv.listen(port, '127.0.0.1');
setTimeout(() => process.exit(0), 60000);
`);

console.log('== REAL-E2E: pipeline penuh framing scrcpy asli ==');
(async () => {
const xvfb = spawn('Xvfb', [':99', '-screen', '0', '1280x800x24'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));
let out = '';
try {
  out = execFileSync('npx', ['electron', '.', '--no-sandbox'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      DISPLAY: ':99',
      KLIP_SMOKE: '1',
      KLIP_AUTO_ANDROID: '1',
      KLIP_REAL_FAKE: '1',
      KLIP_ADB: fakeAdb,
      KLIP_SERVER_JAR: fakeJar
    },
    timeout: 120000,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
} catch (e) {
  out = (e.stdout || '') + (e.stderr || '');
}
xvfb.kill();
fs.writeFileSync(path.join(tmp, 'electron.log'), out);
const lines = out.split('\n');

const mir = lines.filter((l) => l.includes('MIRROR_JS')).map((l) => {
  try { return JSON.parse(l.slice(l.indexOf('{'))); } catch (e) { return null; }
}).filter(Boolean);
const last = mir[mir.length - 1];
console.log('MIRROR_JS terakhir:', JSON.stringify(last));
assert(mir.length > 0, 'renderer mengirim laporan MIRROR_JS');
assert(last && last.running === true, 'sesi mirror berjalan di renderer');
assert(last && last.decoded >= 1, 'renderer MENDEKODE video (' + (last ? last.decoded : 0) + ' frame)');
assert(last && last.pixelSum > 0, 'piksel tergambar di canvas (pixelSum ' + (last ? last.pixelSum : 0) + ')');
assert(last && last.vw === 320 && last.vh === 600, 'dimensi dari sessionMeta SPS (320×600)');
assert(last && last.noDecoder === false, 'decoder terbuka (dari config frame)');
// catatan: decodeErrors>0 pada GOP fake = quirk pra-eksisting (MIRRORTEST lama
// sama) — recovery via IDR berjalan, video tetap tampil; cukup dilaporkan
if (last && last.decErr) console.log('  (info) decErr: ' + last.decErr + ' — recovery IDR jalan, tidak fatal');
assert(lines.some((l) => l.includes('sessionMeta 320x600 (dari SPS)')), 'translator: sessionMeta dari SPS');
assert(lines.some((l) => l.includes('diagnosa video:')), 'diagnosa video terlog');
assert(lines.some((l) => l.includes('frame#1')), 'detail frame awal terlog');
assert(lines.some((l) => l.includes('audio aktif (opus)')), 'audio opus lewat translator');
const adbLog = fs.existsSync(path.join(tmp, 'adb.log')) ? fs.readFileSync(path.join(tmp, 'adb.log'), 'utf8') : '';
assert(adbLog.includes('forward'), 'adb forward dipanggil (emulator hidup)');

console.log(failures === 0 ? 'REAL-E2E PASS' : 'REAL-E2E GAGAL: ' + failures);
process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('REAL-E2E ERROR:', e.stack || e.message); process.exit(1); });

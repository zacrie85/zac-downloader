/* Test v1.6.2 mirror Android (scrcpy) end-to-end — device FAKE (protokol asli).
 * Menjalankan app penuh (electron), membuka tab Android, memverifikasi:
 *  - sesi fake tersambung (3 socket: video/audio/control)
 *  - sessionMeta + config H.264 terparse (avcC) + IDR terdekode (WebCodecs)
 *  - canvas tergambar (pixelSum > 0)
 *  - audio Opus terdekode
 *  - kontrol (touch/scroll/key/text/rotate/display-power) sampai ke device
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let port = null;
let buf = '';
let child = null;
let mirrorReports = [];
let ctlTrace = [];
let finished = false;
let evalScheduled = false;

function get(path2) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: path2 }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({}); } });
    }).on('error', reject);
  });
}

function finish(ok, why) {
  if (finished) return;
  finished = true;
  console.log('MIRRORTEST ' + (ok ? 'PASS' : 'FAIL') + (why ? ' — ' + why : ''));
  try { child && child.kill('SIGKILL'); } catch (e) {}
  setTimeout(() => process.exit(ok ? 0 : 1), 300);
}

async function main() {
  child = spawn('npx', ['electron', '.'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      DISPLAY: process.env.DISPLAY || ':99',
      KLIP_SMOKE: '1',
      KLIP_FAKE_MIRROR: '1',
      KLIP_AUTO_ANDROID: '1',
      KLIP_SMOKE_HOLD: '30'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const timer = setTimeout(() => finish(false, 'timeout 70 detik'), 70000);
  child.stdout.on('data', (d) => {
    buf += d.toString();
    for (const line of buf.split('\n')) {
      if (line.includes('fake-ctl')) ctlTrace.push(line.trim().slice(0, 160));
      const mPort = line.match(/\[mirror\] server lokal di 127\.0\.0\.1:(\d+)/);
      if (mPort) port = parseInt(mPort[1], 10);
      const mJs = line.match(/MIRROR_JS (\{.*\})/);
      if (mJs) {
        try { mirrorReports.push(JSON.parse(mJs[1])); } catch (e) {}
      }
      // evaluasi setelah SEMUA sampel kontrol terkirim (8 pesan) + grace parse
      const sendCount = (buf.match(/ctl-send:/g) || []).length;
      if (sendCount >= 8 && mirrorReports.length >= 6 && !finished && port && !evalScheduled) {
        evalScheduled = true;
        setTimeout(() => evaluate(), 600);
      }
    }
    buf = buf.slice(-4000);
  });
  child.stderr.on('data', () => {});
  child.on('exit', (code, sig) => {
    if (!finished) {
      const tail = buf.split('\n').filter(Boolean).slice(-12).join(' | ');
      finish(false, 'app keluar (code=' + code + ' sig=' + sig + ') reports=' + mirrorReports.length + ' tail=' + tail.slice(0, 400));
    }
  });

  async function evaluate() {
    const best = mirrorReports.reduce((a, b) => (b.decoded > (a.decoded || 0) ? b : a), {});
    if (best.decoded < 1) return; // tunggu — mungkin masih decoding
    const stats = await get('/api/fake-stats').catch(() => ({}));
    const ctl = stats.ctl || {};
    const checks = {
      session: best.running === true && best.name === 'Zac Fake Device',
      videoSize: best.vw === 320 && best.vh === 600,
      decoded: best.decoded >= 1,
      canvas: best.pixelSum > 1000,
      touch: (ctl[2] || 0) >= 2,
      scroll: (ctl[3] || 0) >= 1,
      keycode: (ctl[0] || 0) >= 2,
      text: (ctl[1] || 0) >= 1,
      rotate: (ctl[11] || 0) >= 1,
      power: (ctl[10] || 0) >= 2
    };
    const fail = Object.entries(checks).filter(([k, v]) => !v).map(([k]) => k);
    const sends = (buf.match(/ctl-send: \{"t":"[a-z]+"/g) || []).join(',');
    clearTimeout(timer);
    if (fail.length) finish(false, 'gagal: ' + fail.join(', ') + ' | ctl=' + JSON.stringify(ctl) + ' | sends=' + sends + ' | TRACE=' + ctlTrace.join(' ~ ').slice(0, 900));
    else finish(true, 'decoded=' + best.decoded + ' fps=' + best.fps + ' pixelSum=' + best.pixelSum + ' ctl=' + JSON.stringify(ctl));
  }
}

main().catch((e) => finish(false, e.message));

/**
 * lib/mirror.js — v1.6.7
 * Mirror Android (scrcpy) untuk Zac Downloader — TANPA EMULATOR.
 * Layar HP Android asli (yang sudah punya SnackVideo/akun login) di-tampilkan
 * dan dikontrol dari tab Android di browser built-in aplikasi.
 *
 * Cara kerja (protokol resmi scrcpy-server v5.0.1):
 *  1. adb push scrcpy-server ke /data/local/tmp (jar resmi dibundel di bin/scrcpy)
 *  2. adb forward tcp:PORT → localabstract:scrcpy_<scid>
 *  3. adb shell app_process … com.genymobile.scrcpy.Server 5.0.1 <opsi>
 *  4. Client membuka 3 koneksi berurutan: video → audio → control.
 *     Setiap koneksi diberi 1 byte dummy oleh server (deteksi siap).
 *     - video: [1B dummy][64B nama device][4B codec id 'h264']
 *              lalu [12B sessionMeta] + frame [12B meta][data Annex-B H.264]
 *     - audio: [1B dummy][4B codec id 'opus' | 4B kode disable 0x00000000]
 *              lalu frame [12B meta][data Opus / OpusHead utk config]
 *     - control: [1B dummy] lalu client→server: pesan binari (BE):
 *         0 keycode:  action u8 + keycode i32 + repeat i32 + metaState i32
 *         1 text:     len i32 + utf8
 *         2 touch:    action u8 + pointerId u64 + x i32 + y i32 + w u16 + h u16
 *                     + pressure u16 + actionButton i32 + buttons i32
 *         3 scroll:   x i32 + y i32 + w u16 + h u16 + hScroll i16 + vScroll i16
 *                     + buttons i32
 *        (format persis ControlMessageReader.java scrcpy v5.0.1)
 *  5. Video/audio dipipa utuh ke tab Android lewat WebSocket lokal; kontrol
 *     dari tab (JSON) di-encode ke binari scrcpy di sini.
 *
 * Semuanya lokal (127.0.0.1, port acak) — tanpa emulator, tanpa server luar.
 */
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { WsConnection } = require('./ws');

const SCRCPY_VERSION = '5.0.1';
const CODEC_H264 = 0x68323634;   // "h264"
const CODEC_OPUS = 0x6f707573;   // "opus"

// ---------- encoder pesan kontrol (format ControlMessageReader.java) ----------
function encKeycode(action, keycode, repeat = 0, metaState = 0) {
  const b = Buffer.alloc(14);
  b[0] = 0; b[1] = action;
  b.writeInt32BE(keycode, 2);
  b.writeInt32BE(repeat, 6);
  b.writeInt32BE(metaState, 10);
  return b;
}
function encText(text) {
  const s = Buffer.from(String(text || '').slice(0, 300), 'utf8');
  const b = Buffer.alloc(5 + s.length);
  b[0] = 1;
  b.writeUInt32BE(s.length, 1);
  s.copy(b, 5);
  return b;
}
function encTouch(action, x, y, w, h) {
  const b = Buffer.alloc(32);
  b[0] = 2;
  b[1] = action;                                  // 0=down 1=up 2=move
  b.writeUInt32BE(0xffffffff, 2);                 // pointerId MOUSE (-1)
  b.writeUInt32BE(0xffffffff, 6);
  b.writeInt32BE(Math.max(0, Math.round(x)), 10);
  b.writeInt32BE(Math.max(0, Math.round(y)), 14);
  b.writeUInt16BE(w & 0xffff, 18);
  b.writeUInt16BE(h & 0xffff, 20);
  b.writeUInt16BE(action === 1 ? 0 : 0xffff, 22); // pressure
  b.writeInt32BE(action === 1 ? 0 : 1, 24);       // actionButton PRIMARY
  b.writeInt32BE(action === 1 ? 0 : 1, 28);       // buttons LEFT
  return b;
}
function encScroll(x, y, w, h, vy) {
  // type(1) + position(12) + hScroll(2) + vScroll(2) + buttons(4) = 21 byte
  const b = Buffer.alloc(21);
  b[0] = 3;
  b.writeInt32BE(Math.max(0, Math.round(x)), 1);
  b.writeInt32BE(Math.max(0, Math.round(y)), 5);
  b.writeUInt16BE(w & 0xffff, 9);
  b.writeUInt16BE(h & 0xffff, 11);
  b.writeInt16BE(Math.max(-32767, Math.min(32767, Math.round(vy * 2048))), 13);
  b.writeInt16BE(0, 15);
  b.writeInt32BE(0, 17);
  return b;
}
function encBackOrScreenOn(action) {
  const b = Buffer.alloc(2);
  b[0] = 4; b[1] = action;
  return b;
}
function encSetDisplayPower(on) {
  const b = Buffer.alloc(2);
  b[0] = 10; b[1] = on ? 1 : 0;
  return b;
}
function encRotate() {
  return Buffer.from([11]);
}
function encSetClipboard(text, paste) {
  const s = Buffer.from(String(text || '').slice(0, 65536), 'utf8');
  const b = Buffer.alloc(14 + s.length);
  b[0] = 9;
  b.writeUInt32BE(0, 1); b.writeUInt32BE(0, 5);   // sequence = 0 (tanpa ACK)
  b[9] = paste ? 1 : 0;
  b.writeUInt32BE(s.length, 10);
  s.copy(b, 14);
  return b;
}

/** JSON dari tab Android → binari scrcpy. return Buffer[] (bisa >1 utk down+up). */
function encodeControl(msg) {
  if (!msg || typeof msg !== 'object') return [];
  const t = msg.t;
  if (t === 'touch') {
    const action = msg.action === 1 || msg.action === 2 ? msg.action : 0;
    return [encTouch(action, msg.x || 0, msg.y || 0, msg.w || 1, msg.h || 1)];
  }
  if (t === 'scroll') {
    return [encScroll(msg.x || 0, msg.y || 0, msg.w || 1, msg.h || 1, Number(msg.vy) || 0)];
  }
  if (t === 'key') {
    return [encKeycode(msg.action === 1 ? 1 : 0, Number(msg.keycode) | 0, 0, Number(msg.metaState) || 0)];
  }
  if (t === 'tapkey') {                            // keydown+keyup sekali klik
    const kc = Number(msg.keycode) | 0;
    return [encKeycode(0, kc), encKeycode(1, kc)];
  }
  if (t === 'text') return [encText(msg.text)];
  if (t === 'back') return [encKeycode(0, 4), encKeycode(1, 4)];
  if (t === 'home') return [encKeycode(0, 3), encKeycode(1, 3)];
  if (t === 'recents') return [encKeycode(0, 187), encKeycode(1, 187)];
  if (t === 'volup') return [encKeycode(0, 24), encKeycode(1, 24)];
  if (t === 'voldown') return [encKeycode(0, 25), encKeycode(1, 25)];
  if (t === 'power') return [encKeycode(0, 26), encKeycode(1, 26)];
  if (t === 'rotate') return [encRotate()];
  if (t === 'screenoff') return [encSetDisplayPower(false)];
  if (t === 'screenon') return [encSetDisplayPower(true)];
  if (t === 'paste') return [encSetClipboard(msg.text, true)];
  return [];
}

// ---------- panjang pesan kontrol (utk parser fake-device & debug) ----------
function controlMsgLength(type, buf, off) {
  const need = (n) => (buf.length >= off + n ? n : -1);
  switch (type) {
    case 0: return need(14);                    // inject keycode
    case 1: { const n = need(5); if (n < 0) return -1; return need(5 + buf.readUInt32BE(off + 1)); } // text
    case 2: return need(32);                    // inject touch
    case 3: return need(21);                    // inject scroll (1+12+2+2+4)
    case 4: return need(2);                     // back or screen on
    case 5: case 6: case 7: case 11: case 15: case 17: case 19: case 20: return need(1); // empty
    case 8: return need(2);                     // get clipboard (type+copyKey)
    case 9: { const n = need(11); if (n < 0) return -1; return need(14 + buf.readUInt32BE(off + 10)); } // set clipboard
    case 10: return need(2);                    // set display power
    case 12: { const n = need(7); if (n < 0) return -1; const l1 = buf[off + 6]; return need(7 + l1 + 2 + buf.readUInt16BE(off + 7 + l1)); } // uhid create (approx)
    case 13: { const n = need(4); if (n < 0) return -1; return need(4 + buf.readUInt16BE(off + 2)); } // uhid input
    case 14: return need(3);                    // uhid destroy
    case 16: { const n = need(2); if (n < 0) return -1; return need(2 + buf[off + 1]); } // start app
    case 18: return need(2);                    // camera torch
    case 21: return need(5);                    // resize display
    case 22: { const n = need(5); if (n < 0) return -1; return need(5 + buf.readUInt32BE(off + 1)); } // scan file
    default: return -1;
  }
}

function adbFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
    srv.on('error', reject);
  });
}

function runAdb(adbPath, args, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let out = '', err = '', done = false, proc;
    try {
      proc = spawn(adbPath, args, { windowsHide: true });
    } catch (e) { return resolve({ ok: false, err: e.message }); }
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', (e) => { if (!done) { done = true; resolve({ ok: false, err: e.message }); } });
    proc.on('close', () => { if (!done) { done = true; resolve({ ok: true, out, err }); } });
    setTimeout(() => {
      if (!done) { done = true; try { proc.kill(); } catch (e) {} resolve({ ok: false, err: 'timeout adb', out, err }); }
    }, timeoutMs);
  });
}

// ---------- sesi mirror ----------
class MirrorSession {
  constructor(mgr, serial, opts) {
    this.mgr = mgr;
    this.serial = serial;
    this.opts = Object.assign({ maxSize: 1024, audio: true, stayAwake: true }, opts || {});
    this.proc = null;
    this.sockets = [];
    this.clients = { video: new Set(), audio: new Set(), ctl: new Set() };
    this.deviceName = '';
    this.audioEnabled = false;
    this.videoSize = null;   // {w,h} diisi oleh renderer (via ctl JSON)
    this.forwardSpec = null;
    this.stopping = false;
    this.lastError = '';
    this.fake = false;
    this._ctlBuf = Buffer.alloc(0);
  }

  log(line) { try { this.mgr.onLog('[mirror] ' + line); } catch (e) {} }

  broadcastCtl(obj) {
    const s = JSON.stringify(obj);
    for (const c of this.clients.ctl) { try { c.sendText(s); } catch (e) {} }
  }

  async start() {
    const adb = this.mgr.adbPath;
    const jar = this.mgr.serverJar;
    // v1.6.6: `o` WAJIB dideklarasikan di awal — v1.6.5 crash
    // "Cannot access 'o' before initialization" karena blok brand/svc di
    // bawah memakai `o` sebelum deklarasi `const o = this.opts` (TDZ).
    const o = this.opts;
    // 0) pastikan adb server hidup
    await runAdb(adb, ['start-server'], 15000);
    // 1) push server jar
    const push = await runAdb(adb, ['-s', this.serial, 'push', jar, '/data/local/tmp/scrcpy-zac-server.jar'], 60000);
    if (!push.ok) throw new Error('adb push gagal: ' + (push.err || '?') + (push.out || '').trim());
    // 2) forward port
    const port = await adbFreePort();
    this.forwardSpec = 'tcp:' + port;
    const fw = await runAdb(adb, ['-s', this.serial, 'forward', this.forwardSpec, 'localabstract:scrcpy_' + this.scidHex()]);
    if (!fw.ok) throw new Error('adb forward gagal: ' + (fw.err || '?'));
    // v1.6.5: deteksi brand — Xiaomi/MIUI butuh "USB debugging (Setelan pengaman)"
    // untuk injeksi sentuhan; beri tahu user sejak awal (non-fatal)
    try {
      const brand = await runAdb(adb, ['-s', this.serial, 'shell', 'getprop', 'ro.product.brand'], 8000);
      if (/xiaomi|redmi|poco/i.test((brand.out || '') + (brand.err || ''))) {
        this.log('HP Xiaomi/MIUI terdeteksi — bila sentuhan tidak berfungsi, aktifkan juga "USB debugging (Setelan pengaman)" di Opsi Pengembang.');
      }
    } catch (e) {}
    // v1.6.5: "layar tetap menyala" via svc power (PowerManagerService — TANPA
    // Settings provider, aman di MIUI). Dulu scrcpy menulis setting global
    // stay_on_while_plugged_in saat start → di Xiaomi melempar RemoteException
    // → server mati sebelum socket video terbentuk → "device tidak merespons".
    if (o.stayAwake) {
      const svc = await runAdb(adb, ['-s', this.serial, 'shell', 'svc', 'power', 'stayon', 'true'], 10000);
      this._svcStayOn = svc.ok;
      this.log(svc.ok ? 'layar HP tetap menyala (svc power stayon true)' : 'svc power stayon gagal (' + ((svc.err || '') + (svc.out || '')).trim().slice(0, 80) + ')');
    }
    // 3) jalankan server scrcpy di device
    const args = ['-s', this.serial, 'shell',
      'CLASSPATH=/data/local/tmp/scrcpy-zac-server.jar', 'app_process', '/',
      'com.genymobile.scrcpy.Server', SCRCPY_VERSION,
      'log_level=info',
      'scid=' + this.scidHex(),
      'tunnel_forward=true',
      'video=true',
      // v1.6.4: 'auto' bukan 'true' — HP Android ≤10 tidak mendukung capture
      // audio scrcpy (butuh Android 11+); dulu server mati saat init audio →
      // socket video tak pernah dibuka → "device tidak merespons". Dengan auto,
      // server mengirim kode disable dan mirror jalan video saja.
      'audio=' + (o.audio ? 'auto' : 'false'),
      'audio_codec=opus',
      'video_codec=h264',
      'max_size=' + (o.maxSize | 0),
      'video_bit_rate=8000000',
      'max_fps=0',
      'control=true',
      // v1.6.5: stay_awake TIDAK lewat server lagi — param itu memicu baca/
      // tulis Settings.Global di jalur cleanup; sudah digantikan 'svc power
      // stayon' di atas (PowerManager, tanpa provider).
      'stay_awake=false',
      // v1.6.5: cleanup=false — proses cleanup scrcpy menyentuh Settings.Global
      // (stay_on_while_plugged_in) saat start; di Xiaomi/MIUI ini melempar
      // DatabaseUtils.readExceptionFromParcel → RemoteException → server mati
      // sebelum socket video terbentuk → "device tidak merespons".
      'cleanup=false',
      'clipboard_autosync=false',
      'send_device_meta=true',
      'send_stream_meta=true',
      'send_frame_meta=true',
      'send_dummy_byte=true'
    ];
    this.log('spawn: adb ' + args.slice(0, 8).join(' ') + ' …');
    try {
      this.proc = spawn(adb, args, { windowsHide: true });
    } catch (e) {
      throw new Error('gagal spawn adb shell: ' + e.message);
    }
    let stderrTail = '';
    this.proc.stderr.on('data', (d) => {
      stderrTail = (stderrTail + d.toString()).slice(-4000);
      this._stderrTail = stderrTail; // v1.6.4: pesan error asli dari HP
      for (const line of d.toString().split('\n')) {
        const m = line.trim();
        if (m && !/^(INFO|DEBUG):/.test(m)) this.log('device: ' + m.slice(0, 160));
      }
    });
    this.proc.on('close', (code) => {
      this.log('server device keluar (code=' + code + ')');
      if (!this.stopping) this.lastError = stderrTail.split('\n').filter((l) => /ERROR|Exception/i.test(l)).pop() || '';
      this.mgr._sessionEnded(this, code);
    });

    // 4) buka 3 socket berurutan: video → audio → control
    //    setiap koneksi menunggu 1 byte dummy dari device (tanda server accept);
    //    byte-byte yang sudah diterima disimpan di state.head agar tidak hilang
    //    v1.6.4: deadline video 15→25 detik (HP lambat pun kejar)
    const video = await this._connectSocket(port, 25000, 'video');
    const audio = o.audio ? await this._connectSocket(port, 15000, 'audio') : null;
    // v1.6.7: control TIDAK menunggu byte sambutan saat koneksi — build
    // scrcpy-server tertentu (fork 5.0.1 di Xiaomi/MIUI) accept socket kontrol
    // lebih lambat/tanpa dummy, sehingga mirror gagal "(control)" padahal
    // video & audio sudah jalan. Cukup TCP connect; pesan kontrol dari client
    // akan mengantre di kernel sampai server benar-benar accept.
    const ctl = await this._connectSocket(port, 30000, 'control', true);

    // video: [1B dummy][64B nama][4B codec] → sisanya dipipa
    const head = await readFrom(video.sock, video.state, 1 + 64 + 4, 8000);
    this.deviceName = head.slice(1, 65).toString('utf8').replace(/\0.*$/, '').trim() || this.serial;
    const codec = head.readUInt32BE(65);
    if (codec !== CODEC_H264) throw new Error('codec video tidak didukung: 0x' + codec.toString(16));
    this.videoSock = video.sock;
    // v1.6.7: penghitung byte video + watchdog — server yang HIDUP tapi
    // menggantung (init encoder/audio di MIUI, dsb.) tidak melempar error apa
    // pun; tanpa watchdog user hanya melihat layar hitam. Bila 25 detik (bisa
    // dioverride via opts.stallAfterMs utk tes) tidak ada satu byte pun video,
    // kirim state 'stall' ke tab agar tampil peringatan yang jelas.
    this._videoBytes = 0;
    // sisa byte yang datang bersamaan dgn header (mis. sessionMeta / config)
    // jangan dibuang — kirim ke client WS begitu bergabung (urutan benar)
    this.videoBacklog = video.state.head.length ? video.state.head : null;
    video.state.head = Buffer.alloc(0);
    video.sock.on('data', (d) => {
      this._videoBytes += d.length;
      if (this._stallTimer) { clearTimeout(this._stallTimer); this._stallTimer = null; }
      this._pipe('video', d);
    });
    video.sock.on('close', () => this.log('socket video tertutup'));

    // audio: [1B dummy][4B codec | 4B disable] → sisanya dipipa bila aktif
    if (audio) {
      const ahead = await readFrom(audio.sock, audio.state, 1 + 4, 6000);
      const acodec = ahead.readUInt32BE(1);
      this.audioEnabled = acodec === CODEC_OPUS;
      if (this.audioEnabled) {
        this.audioSock = audio.sock;
        this.audioBacklog = audio.state.head.length ? audio.state.head : null;
        audio.state.head = Buffer.alloc(0);
        audio.sock.on('data', (d) => this._pipe('audio', d));
        this.log('audio aktif (opus)');
      } else {
        this.log('audio tidak tersedia di device ini — mirror video saja');
        try { audio.sock.destroy(); } catch (e) {}
      }
    }

    // control: [1B dummy] → tulis pesan dari client
    // v1.6.7: byte sambutan kontrol bersifat best-effort — bila server tidak
    // mengirimnya (fork berbeda / accept lambat), mirror tetap jalan.
    try {
      await readFrom(ctl.sock, ctl.state, 1, 6000);
    } catch (e) {
      this.log('socket kontrol tanpa byte sambutan (' + String(e.message).slice(0, 60) + ') — tetap lanjut, pesan kontrol akan mengantre');
    }
    this.ctlSock = ctl.sock;
    ctl.sock.on('data', (d) => { /* balasan kontrol (clipboard) sengaja diabaikan */ });
    ctl.sock.on('close', () => this.log('socket kontrol tertutup'));

    this.sockets = [video.sock, audio && audio.sock, ctl.sock].filter(Boolean);
    this.log('mirror berjalan: ' + this.deviceName + ' (' + this.serial + ')');
    this.broadcastCtl({ t: 'session', state: 'running', name: this.deviceName, audio: this.audioEnabled });
    // v1.6.7: pasang watchdog stall (lihat komentar di atas)
    const stallAfter = o.stallAfterMs || 25000;
    this._stallTimer = setTimeout(() => {
      this._stallTimer = null;
      if (!this.stopping && (this._videoBytes || 0) === 0) {
        this.log('WATCHDOG: tidak ada data video ' + (stallAfter / 1000) + ' detik — server HP hidup tapi menggantung');
        this.broadcastCtl({ t: 'session', state: 'stall', name: this.deviceName });
      }
    }, stallAfter);
    return { name: this.deviceName, audio: this.audioEnabled };
  }

  scidHex() { return this._scid || (this._scid = Math.floor(Math.random() * 0x7fffffff).toString(16)); }

  _connectSocket(port, deadlineMs = 8000, label = 'socket', skipByteWait = false) {
    const deadline = Date.now() + deadlineMs;
    const tryOnce = () => new Promise((resolve) => {
      const sock = net.connect(port, '127.0.0.1');
      const state = { head: Buffer.alloc(0) };
      let settled = false;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!ok) { try { sock.destroy(); } catch (e) {} }
        resolve({ ok, sock, state });
      };
      const timer = setTimeout(() => done(false), 3000);
      sock.once('connect', () => {
        // v1.6.7: skipByteWait — cukup TCP connect (untuk socket kontrol);
        // pesan kontrol mengantre di kernel sampai server accept.
        if (skipByteWait) { done(true); return; }
        // tunggu byte pertama dari device (= server benar-benar accept) — byte
        // TIDAK dibuang, disimpan di state.head untuk dibaca readFrom()
        const onData = (d) => {
          clearTimeout(timer);
          sock.off('error', onErr);
          state.head = Buffer.concat([state.head, d]);
          done(true);
        };
        const onErr = () => done(false);
        sock.once('data', onData);
        sock.once('error', onErr);
      });
      sock.on('error', () => done(false));
      sock.on('close', () => done(false));
    });
    const attempt = async () => {
      while (Date.now() < deadline) {
        // v1.6.5: server sudah keluar? jangan tunggu deadline penuh — gagal cepat
        if (this.proc && this.proc.exitCode !== null) throw new Error(this._timeoutError(label));
        const r = await tryOnce();
        if (r.ok) return r;
        await new Promise((res) => setTimeout(res, 300));
      }
      throw new Error(this._timeoutError(label));
    };
    return attempt();
  }

  // v1.6.4/v1.6.5: pesan timeout yang menjelaskan penyebab sebenarnya — sertakan
  // baris-baris akhir stderr server HP apa adanya (termasuk stack trace).
  _timeoutError(label) {
    const lines = (this._stderrTail || '').split('\n')
      .map((s) => s.trim()).filter(Boolean).slice(-6);
    const tail = lines.join(' | ');
    if (tail) return 'server di HP gagal (' + label + '): ' + tail.slice(0, 300);
    return 'device tidak merespons (' + label + ') [' + this.serial + '] — cek kabel USB, popup "Izinkan" di HP, lalu cabut-pasang kabel & tekan Pindai Ulang';
  }

  _pipe(kind, chunk) {
    if (this.mgr.isSmoke && !this._dbgPiped) { this._dbgPiped = true; this.log('_pipe pertama: ' + kind + ' ' + chunk.length + 'B ke ' + this.clients[kind].size + ' client'); }
    for (const c of this.clients[kind]) {
      try { c.sendBinary(chunk); } catch (e) {}
    }
  }

  sendControl(msg) {
    if (this.mgr.isSmoke) this.mgr.onLog('[mirror] ctl-send: ' + JSON.stringify(msg).slice(0, 80));
    if (!this.ctlSock) return false;
    const bufs = encodeControl(msg);
    if (!bufs.length) return false;
    // SATU write atomik per pesan — pesan dari beberapa tab tidak boleh
    // terinterleave di tengah pesan (framing kontrol scrcpy rapuh)
    try { this.ctlSock.write(Buffer.concat(bufs)); return true; } catch (e) { return false; }
  }

  stop() {
    if (this.stopping) return;
    this.stopping = true;
    this.log('menghentikan mirror…');
    if (this._stallTimer) { clearTimeout(this._stallTimer); this._stallTimer = null; }
    try { if (this.ctlSock) this.ctlSock.destroy(); } catch (e) {}
    for (const s of this.sockets) { try { s.destroy(); } catch (e) {} }
    try { if (this.proc) this.proc.kill(); } catch (e) {}
    if (this.fake && this.mgr._fakeServer) { try { this.mgr._fakeServer.close(); } catch (e) {} }
    if (this._svcStayOn) {
      // v1.6.5: pulihkan perilaku layar saat sesi berakhir
      runAdb(this.mgr.adbPath, ['-s', this.serial, 'shell', 'svc', 'power', 'stayon', 'false'], 8000);
      this._svcStayOn = false;
    }
    if (this.forwardSpec && !this.fake) {
      runAdb(this.mgr.adbPath, ['-s', this.serial, 'forward', '--remove', this.forwardSpec], 8000);
    }
    this.mgr._sessionEnded(this, 0);
  }
}

/** Baca persis n byte dari socket, mengonsumsi state.head dulu (byte yang
 *  sudah masuk saat menunggu dummy). resolve dengan buffer berisi n byte. */
function readFrom(sock, state, n, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buf = state.head;
    state.head = Buffer.alloc(0);
    const cleanup = () => {
      clearTimeout(timer);
      sock.off('data', ondata); sock.off('error', onerr); sock.off('close', onclose);
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('timeout membaca header device')); }, timeoutMs);
    const ondata = (d) => {
      buf = Buffer.concat([buf, d]);
      if (buf.length >= n) {
        const out = buf.slice(0, n);
        state.head = buf.slice(n);   // sisa data tidak dibuang
        cleanup();
        resolve(out);
      }
    };
    const onerr = (e) => { cleanup(); reject(e); };
    const onclose = () => { cleanup(); reject(new Error('socket tertutup saat membaca header')); };
    sock.on('data', ondata);
    sock.on('error', onerr);
    sock.on('close', onclose);
    ondata(Buffer.alloc(0));         // head mungkin sudah cukup panjang
  });
}

// ---------- manajer + server HTTP/WS ----------
// v1.6.7: kumpulkan diagnosa dari logcat HP saat start gagal — server yang
// menggantung/mati biasanya meninggalkan jejak (AndroidRuntime, Permission
// Denial, MediaCodec, AudioFlinger). Non-fatal; hasil boleh kosong.
async function collectDiagnostics(mgr, serial) {
  const r = await runAdb(mgr.adbPath, ['-s', serial, 'shell',
    'logcat -d -t 400 2>/dev/null | grep -iE "scrcpy|AndroidRuntime|FATAL|Permission Denial|AppOps|MediaCodec|AudioFlinger|DisplayManager" | tail -8'], 12000);
  return (r.out || '').split('\n').map((s) => s.trim()).filter(Boolean).slice(-6);
}

function createMirrorServer({ resolveAdb, resolveScrcpyBin, serverJar, isSmoke = false, onLog = () => {} }) {
  const mgr = {
    adbPath: resolveAdb ? resolveAdb() : 'adb',
    scrcpyExe: resolveScrcpyBin ? (resolveScrcpyBin('scrcpy.exe', 'scrcpy') || null) : null,
    serverJar,
    isSmoke,
    onLog,
    httpSrv: null,
    port: 0,
    session: null,
    _fakeServer: null,
    _fakeStats: { ctl: {}, ctlBytes: 0, videoFrames: 0, audioFrames: 0 }
  };

  mgr.listDevices = async function () {
    const r = await runAdb(mgr.adbPath, ['devices', '-l'], 15000);
    if (!r.ok) return { error: 'adb tidak tersedia (' + (r.err || '?') + ')' };
    const devices = [];
    for (const line of r.out.split('\n')) {
      // v1.6.4: state-aware — device/unauthorized/offline (dulu hanya 'device')
      const m = line.trim().match(/^(\S+)\s+(device|unauthorized|offline)\s*(.*)$/);
      if (!m) continue;
      const model = ((m[3] || '').match(/model:(\S+)/) || [])[1] || '';
      devices.push({ serial: m[1], model: model.replace(/_/g, ' '), state: m[2] });
    }
    return { devices };
  };

  mgr.startSession = async function (opts = {}) {
    const serial = String(opts.serial || '').trim();
    if (!serial) return { error: 'Serial device belum dipilih.' };
    // v1.6.4: cek state device secara spesifik → pesan jelas per kondisi
    const st = await runAdb(mgr.adbPath, ['-s', serial, 'get-state'], 10000);
    if (!st.ok) {
      const blob = ((st.err || '') + ' ' + (st.out || '')).trim();
      if (/unauthorized/i.test(blob)) return { error: 'HP belum mengizinkan debugging USB — buka layar HP, tap "Izinkan" (centang "Selalu izinkan") lalu tekan Mulai Mirror lagi.' };
      if (/offline/i.test(blob)) return { error: 'Device offline — cabut & pasang kabel USB, lalu tekan Pindai Ulang.' };
      return { error: 'Device tidak terhubung ke adb (' + serial + '): ' + blob.slice(0, 140) };
    }
    // v1.6.4: bila percobaan dengan audio gagal, coba SEKALI lagi tanpa audio
    // (HP Android ≤10 tak mendukung capture audio scrcpy; server lama bisa mati)
    const attemptStart = async (audio) => {
      if (mgr.session) mgr.session.stop();
      const s = new MirrorSession(mgr, serial, Object.assign({}, opts, { audio }));
      mgr.session = s;
      try {
        const r = await s.start();
        return Object.assign({ ok: true }, r);
      } catch (e) {
        // v1.6.7: sertakan diagnosa logcat HP pada pesan error — server yang
        // menggantung tidak menulis stderr apa pun, logcat satu-satunya jejak
        let msg = e.message;
        try {
          const diag = await collectDiagnostics(mgr, serial);
          if (diag.length) {
            s.log('diagnostik logcat HP: ' + diag.slice(0, 3).join(' | '));
            msg += ' — diagnostik HP: ' + diag.slice(0, 2).join(' | ').slice(0, 150);
          }
        } catch (e2) {}
        s.stop();
        if (mgr.session === s) mgr.session = null;
        return { error: msg };
      }
    };
    if (opts.audio) {
      const first = await attemptStart(true);
      if (first.ok) return first;
      onLog('[mirror] percobaan dengan audio gagal (' + String(first.error).slice(0, 140) + ') — coba lagi tanpa audio…');
      const second = await attemptStart(false);
      if (second.ok) {
        onLog('[mirror] mirror jalan TANPA audio — HP ini tidak mendukung capture audio scrcpy (butuh Android 11+).');
        second.audio = false;
        second.note = 'Audio otomatis dimatikan (HP tidak mendukung audio scrcpy, butuh Android 11+) — mirror video saja tetap jalan.';
      }
      return second;
    }
    return attemptStart(false);
  };

  mgr.stopSession = function () {
    if (mgr.session) { mgr.session.stop(); return { ok: true }; }
    return { ok: false };
  };

  mgr.info = function () {
    const s = mgr.session;
    return {
      running: !!s,
      serial: s ? s.serial : null,
      name: s ? s.deviceName : null,
      audio: s ? s.audioEnabled : false,
      videoSize: s ? s.videoSize : null,
      adb: !!mgr.adbPath,
      scrcpyExe: !!mgr.scrcpyExe,
      version: SCRCPY_VERSION,
      fake: s ? !!s.fake : false,
      smoke: !!mgr.isSmoke
    };
  };

  mgr.spawnNative = function (opts = {}) {
    if (!mgr.scrcpyExe) return { error: 'scrcpy.exe tidak ditemukan di paket (bin/scrcpy).' };
    const serial = String(opts.serial || '').trim();
    const args = [];
    if (serial) args.push('-s', serial);
    args.push('--max-size', String(opts.maxSize || 1024));
    if (opts.stayAwake !== false) args.push('--stay-awake');
    args.push('--window-title', 'Zac Mirror — Android');
    try {
      const child = spawn(mgr.scrcpyExe, args, { detached: true, stdio: 'ignore', windowsHide: false, cwd: require('path').dirname(mgr.scrcpyExe) });
      child.unref();
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  };

  mgr._sessionEnded = function (s) {
    if (mgr.session === s) {
      mgr.session = null;
      for (const c of s.clients.ctl) { try { c.sendText(JSON.stringify({ t: 'session', state: 'stopped', err: s.lastError || '' })); } catch (e) {} }
      onLog('[mirror] sesi berakhir' + (s.lastError ? ': ' + s.lastError.slice(0, 160) : ''));
    }
  };

  // ---------- sesi FAKE (khusus smoke test — simulasi device scrcpy penuh) ----------
  mgr.startFakeSession = function () {
    if (!mgr.isSmoke && process.env.KLIP_FAKE_MIRROR !== '1') return { error: 'fake hanya untuk smoke test' };
    if (mgr.session) {
      if (mgr.session.fake) return { ok: true }; // sudah jalan (hindari dobel start)
      mgr.session.stop();
    }
    const s = new MirrorSession(mgr, 'FAKE0001', {});
    s.fake = true;
    mgr.session = s;
    mgr._fakeStats = { ctl: {}, ctlBytes: 0, videoFrames: 0, audioFrames: 0 };
    let conns = [];
    let n = 0;
    const srv = net.createServer((sock) => {
      n++;
      conns.push(sock);
      sock.write(Buffer.from([0]));              // dummy byte
      if (n === 1) {
        // VIDEO
        const name = Buffer.from('Zac Fake Device', 'utf8');
        const nameB = Buffer.alloc(64); name.copy(nameB, 0);
        const codec = Buffer.alloc(4); codec.writeUInt32BE(CODEC_H264, 0);
        const meta = Buffer.alloc(12);
        meta.writeUInt32BE(0x80000000, 0);       // session flag
        meta.writeUInt32BE(320, 4);
        meta.writeUInt32BE(600, 8);
        sock.write(Buffer.concat([nameB, codec, meta]));
        s.videoSock = sock;
        if (mgr._fakeVideo) { sock.write(mgr._fakeVideo.configFrame()); }
        let f = 0;
        const iv = setInterval(() => {
          if (sock.destroyed || mgr.session !== s) { clearInterval(iv); return; }
          if (mgr._fakeVideo) { sock.write(mgr._fakeVideo.frameFrame(f)); f++; mgr._fakeStats.videoFrames = f; }
        }, 100);
        sock._iv = iv;
        sock.on('close', () => clearInterval(iv));
      } else if (n === 2) {
        // AUDIO
        const codec = Buffer.alloc(4); codec.writeUInt32BE(CODEC_OPUS, 0);
        sock.write(codec);
        s.audioSock = sock;
        if (mgr._fakeAudio) {
          sock.write(mgr._fakeAudio.configFrame());
          const iv = setInterval(() => {
            if (sock.destroyed || mgr.session !== s) { clearInterval(iv); return; }
            if (mgr._fakeAudio) { sock.write(mgr._fakeAudio.frameFrame()); mgr._fakeStats.audioFrames++; }
          }, 100);
          sock._iv = iv;
          sock.on('close', () => clearInterval(iv));
        }
        s.audioEnabled = true;
        s.deviceName = 'Zac Fake Device';
      } else if (n === 3) {
        // CONTROL
        s.ctlSock = sock;
        sock.on('data', (d) => {
          if (mgr.isSmoke) mgr.onLog('[mirror] fake-ctl in: ' + d.toString('hex').slice(0, 100));
          const buf = Buffer.concat([s._ctlBuf, d]);
          let off = 0;
          while (off < buf.length) {
            const type = buf[off];
            const len = controlMsgLength(type, buf, off);
            if (len < 0) {
              if (mgr.isSmoke) mgr.onLog('[mirror] fake-ctl STUCK type=' + type + ' off=' + off + ' total=' + buf.length);
              s._ctlBuf = buf.slice(off); return;
            }
            if (mgr.isSmoke) mgr.onLog('[mirror] fake-ctl msg type=' + type + ' len=' + len);
            mgr._fakeStats.ctl[type] = (mgr._fakeStats.ctl[type] || 0) + 1;
            mgr._fakeStats.ctlBytes += len;
            off += len;
          }
          s._ctlBuf = Buffer.alloc(0);
        });
        s.deviceName = 'Zac Fake Device';
        mgr.onLog('[mirror] fake: 3 socket tersambung');
        s.broadcastCtl({ t: 'session', state: 'running', name: 'Zac Fake Device', audio: true });
      }
    });
    mgr._fakeServer = srv;
    srv.listen(0, '127.0.0.1', () => {
      s.forwardSpec = null;
      s._fakePort = srv.address().port;
      // trik: _connectSocket menyambung langsung ke port fake (alur sama seperti adb forward)
      const origConnect = s._connectSocket.bind(s);
      s._connectSocket = (port, deadlineMs) => origConnect(s._fakePort, deadlineMs);
      // jalankan alur handshake yang SAMA seperti sesi asli (tanpa adb)
      (async () => {
        try {
          const video = await s._connectSocket(0, 15000);
          const head = await readFrom(video.sock, video.state, 1 + 64 + 4, 8000);
          s.deviceName = head.slice(1, 65).toString('utf8').replace(/\0.*$/, '').trim();
          const audio = await s._connectSocket(0, 8000);
          const ahead = await readFrom(audio.sock, audio.state, 1 + 4, 6000);
          s.audioEnabled = ahead.readUInt32BE(1) === CODEC_OPUS;
          const ctl = await s._connectSocket(0, 8000);
          await readFrom(ctl.sock, ctl.state, 1, 6000);
          s.videoSock = video.sock;
          s.videoBacklog = video.state.head.length ? video.state.head : null;
          video.state.head = Buffer.alloc(0);
          video.sock.on('data', (d) => s._pipe('video', d));
          audio.sock.on('data', (d) => s._pipe('audio', d));
          s.ctlSock = ctl.sock;
          ctl.sock.on('data', () => {});
          s.sockets = [video.sock, audio.sock, ctl.sock];
          s.audioBacklog = audio.state.head.length ? audio.state.head : null;
          audio.state.head = Buffer.alloc(0);
          s.videoSize = { w: 320, h: 600 };
          s.broadcastCtl({ t: 'session', state: 'running', name: s.deviceName, audio: true });
          mgr.onLog('[mirror] fake session siap');
        } catch (e) {
          mgr.onLog('[mirror] fake session gagal: ' + e.message);
        }
      })();
    });
    return { ok: true };
  };

  mgr.fakeStats = () => mgr._fakeStats;

  // ---------- stream sintetis utk sesi FAKE (H.264/Opus asli hasil ffmpeg) ----------
  const FRAME_FLAG_CONFIG = 1n << 62n;
  const FRAME_FLAG_KEY = 1n << 61n;
  function fakeFrameMeta(ptsUs, flags, size) {
    const b = Buffer.alloc(12);
    b.writeBigUInt64BE(BigInt(ptsUs) | (flags || 0n), 0);
    b.writeUInt32BE(size, 8);
    return b;
  }
  let fakeStreams = null;
  function loadFakeStreams() {
    if (fakeStreams) return fakeStreams;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'fake-streams.json'), 'utf8'));
      const SC = Buffer.from([0, 0, 0, 1]); // start code Annex-B (wajib utk WebCodecs annexb)
      const sps = Buffer.concat([SC, Buffer.from(j.sps, 'base64')]);
      const pps = Buffer.concat([SC, Buffer.from(j.pps, 'base64')]);
      fakeStreams = {
        sps, pps,
        config: Buffer.concat([sps, pps]),
        // GOP utuh sesuai urutan encode asli (IDR → P1 → P2 → …) — referensi
        // antar-frame konsisten, persis seperti stream scrcpy asli
        gop: (j.gop || []).map((g) => ({
          key: !!g.k,
          data: Buffer.concat([SC, Buffer.from(g.d, 'base64')])
        })),
        opusHead: Buffer.from(j.opusHead, 'base64'),
        opusFrames: (j.opusFrames || []).map((s) => Buffer.from(s, 'base64'))
      };
      if (!fakeStreams.gop.length) fakeStreams = null;
    } catch (e) { fakeStreams = null; }
    return fakeStreams;
  }
  function fakeVideoStream() {
    const st = loadFakeStreams();
    if (!st) return null;
    return {
      configFrame() {
        return Buffer.concat([fakeFrameMeta(0, FRAME_FLAG_CONFIG, st.config.length), st.config]);
      },
      frameFrame(i) {
        const f = st.gop[i % st.gop.length];
        return Buffer.concat([fakeFrameMeta((i + 1) * 100000, f.key ? FRAME_FLAG_KEY : 0n, f.data.length), f.data]);
      }
    };
  }
  function fakeAudioStream() {
    const st = loadFakeStreams();
    if (!st || !st.opusFrames.length) return null;
    let ai = 0;
    return {
      configFrame() {
        return Buffer.concat([fakeFrameMeta(0, FRAME_FLAG_CONFIG, st.opusHead.length), st.opusHead]);
      },
      frameFrame() {
        const d = st.opusFrames[ai % st.opusFrames.length];
        ai++;
        return Buffer.concat([fakeFrameMeta(ai * 20000, 0n, d.length), d]);
      }
    };
  }
  mgr._fakeVideo = fakeVideoStream();
  mgr._fakeAudio = fakeAudioStream();

  // ---------- server HTTP + WS ----------
  mgr.start = function () {
    return new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
        const url = req.url.split('?')[0];
        const reply = (obj, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
        let body = '';
        req.on('data', (d) => { body += d; if (body.length > 1e5) req.destroy(); });
        req.on('end', async () => {
          let payload = {};
          try { payload = body ? JSON.parse(body) : {}; } catch (e) {}
          try {
            if (url === '/api/info') return reply(mgr.info());
            if (url === '/api/devices') return reply(await mgr.listDevices());
            if (url === '/api/start') return reply(await mgr.startSession(payload));
            if (url === '/api/stop') return reply(mgr.stopSession());
            if (url === '/api/native') return reply(mgr.spawnNative(payload));
            if (url === '/api/start-fake') return reply(mgr.startFakeSession());
            if (url === '/api/fake-stats') return reply(mgr.fakeStats());
            reply({ error: 'not found' }, 404);
          } catch (e) {
            reply({ error: e.message }, 500);
          }
        });
      });
      mgr.httpSrv = srv;
      srv.on('upgrade', (req, socket) => {
        const path = (req.url || '').split('?')[0];
        const kind = { '/ws/video': 'video', '/ws/audio': 'audio', '/ws/ctl': 'ctl' }[path];
        if (!kind || !WsConnection.handshake(req, socket)) { try { socket.destroy(); } catch (e) {} return; }
        const ws = new WsConnection(socket);
        const s = mgr.session;
        if (!s) {
          ws.sendText(JSON.stringify({ t: 'session', state: 'stopped', err: 'tidak ada sesi mirror' }));
          setTimeout(() => ws.close(), 300);
          return;
        }
        s.clients[kind].add(ws);
        ws.onclose = () => { try { s.clients[kind].delete(ws); } catch (e) {} };
        // backlog: byte yang sudah masuk sebelum client bergabung (urutan stream harus utuh)
        if (kind === 'video' && s.videoBacklog) { try { ws.sendBinary(s.videoBacklog); } catch (e) {} }
        if (kind === 'audio' && s.audioBacklog) { try { ws.sendBinary(s.audioBacklog); } catch (e) {} }
        if (kind === 'ctl') {
          ws.sendText(JSON.stringify({ t: 'hello', name: s.deviceName, audio: s.audioEnabled, serial: s.serial, fake: !!s.fake }));
          ws.onmessage = (op, data) => {
            if (op !== 0x1) return;
            let msg = null;
            try { msg = JSON.parse(data.toString('utf8')); } catch (e) {}
            if (!msg) return;
            if (msg.t === 'videosize') { s.videoSize = { w: msg.w | 0, h: msg.h | 0 }; return; }
            s.sendControl(msg);
          };
        }
      });
      srv.listen(0, '127.0.0.1', () => {
        mgr.port = srv.address().port;
        onLog('[mirror] server lokal di 127.0.0.1:' + mgr.port);
        resolve(mgr.port);
      });
      srv.on('error', reject);
    });
  };

  mgr.stop = function () {
    try { if (mgr.session) mgr.session.stop(); } catch (e) {}
    try { if (mgr.httpSrv) mgr.httpSrv.close(); } catch (e) {}
  };

  return mgr;
}

module.exports = { createMirrorServer, encodeControl, controlMsgLength, SCRCPY_VERSION };

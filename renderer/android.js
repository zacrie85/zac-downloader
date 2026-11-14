/* android.js — v1.6.2 tab Android (scrcpy mirror) untuk Zac Downloader.
 * Menerima stream H.264/Opus mentah (protokol scrcpy v5) dari main process
 * lewat WebSocket lokal, mendekode pakai WebCodecs, menggambar ke canvas,
 * dan mengirim kontrol (sentuh/keyboard/tombol) balik ke device. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const qs = new URLSearchParams(location.search);
  const PORT = qs.get('port') || '';
  const API = 'http://127.0.0.1:' + PORT;
  const WSBASE = 'ws://127.0.0.1:' + PORT;
  let smokeMode = false; // server mirror dalam mode smoke → kirim laporan MIRROR_JS

  const canvas = $('screen');
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#060a16';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // canvas mengikuti ukuran elemen (ketajaman mengikuti jendela)
  const wrapEl = $('screenWrap');
  function fitCanvas() {
    const r = wrapEl.getBoundingClientRect();
    if (r.width > 10 && r.height > 10) {
      canvas.width = Math.round(r.width * (window.devicePixelRatio || 1) * 0.75);
      canvas.height = Math.round(r.height * (window.devicePixelRatio || 1) * 0.75);
    }
  }
  try { new ResizeObserver(fitCanvas).observe(wrapEl); } catch (e) {}
  fitCanvas();

  const state = {
    running: false,
    vw: 320, vh: 600,
    videoWs: null, audioWs: null, ctlWs: null,
    vbuf: Buffer_or_U8(), abuf: Buffer_or_U8(),
    decoder: null, audioDecoder: null,
    framesDecoded: 0, audioDecoded: 0, decodeErrors: 0,
    fpsCount: 0, fps: 0,
    name: '', audioOn: false, mute: false,
    screenOff: false,
    actx: null, gain: null, audioQueued: 0,
    deviceSerial: null,
    lastFrameAt: 0
  };
  function Buffer_or_U8() { return new Uint8Array(0); }

  /* ---------------- util ---------------- */
  function cat(a, b) {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0); out.set(b, a.length);
    return out;
  }
  function take(arr, n) { return arr.slice(0, n); }
  function show(el, on) { el.classList.toggle('hidden', !on); }
  function setStatus(txt, cls) {
    const el = $('stStatus');
    el.textContent = txt;
    el.className = 'st' + (cls ? ' ' + cls : '');
  }
  function log(line) { try { console.log('[android] ' + line); } catch (e) {} }

  /* ---------------- WS helpers ---------------- */
  function wsConnect(path, onBinary, onText, onClose) {
    const ws = new WebSocket(path);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => log('WS terbuka: ' + path);
    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) onBinary(new Uint8Array(ev.data));
      else onText(String(ev.data));
    };
    ws.onclose = () => { log('WS tertutup: ' + path); if (onClose) onClose(); };
    ws.onerror = () => log('WS error: ' + path);
    return ws;
  }
  function ctlSend(obj) {
    try {
      if (state.ctlWs && state.ctlWs.readyState === 1) state.ctlWs.send(JSON.stringify(obj));
    } catch (e) {}
  }

  /* ---------------- dekoder video (H.264 Annex-B via WebCodecs) ---------------- */
  function parseVideo() {
    const b = state.vbuf;
    if (b.length < 12) return;
    // sessionMeta: 4B flags (MSB set) + w + h — bisa muncul ulang saat resize
    if (b[0] & 0x80) {
      const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      const w = dv.getUint32(4), h = dv.getUint32(8);
      if (w > 0 && w < 8192 && h > 0 && h < 8192) {
        state.vw = w; state.vh = h;
        log('session meta: ' + w + 'x' + h);
        ctlSend({ t: 'videosize', w, h });
      }
      state.vbuf = b.slice(12);
      return;
    }
    if (b.length < 12) return;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const ptsFlags = dv.getBigUint64(0);
    const size = dv.getUint32(8);
    const FLAG_CONFIG = 1n << 62n;
    const FLAG_KEY = 1n << 61n;
    const isConfig = (ptsFlags & FLAG_CONFIG) !== 0n;
    const isKey = (ptsFlags & FLAG_KEY) !== 0n;
    if (b.length < 12 + size) return;
    const data = b.slice(12, 12 + size);
    state.vbuf = b.slice(12 + size);
    if (isConfig) {
      openDecoder(data);
      return;
    }
    if (!state.decoder) return;
    try {
      if (state.decoder.state === 'configured') {
        // setelah configure/error, decoder hanya bisa mulai dari keyframe
        if (state.waitingKey) {
          if (!isKey) return; // buang delta sampai keyframe tiba
          state.waitingKey = false;
        }
        // backpressure: kalau decoder tertinggal (tab background/CPU penuh),
        // buang frame — ambil keyframe berikutnya (jaga latensi tetap rendah)
        if (state.decoder.decodeQueueSize > 6) {
          if (!isKey) return;
          state.waitingKey = false;
        }
        state.decoder.decode(new EncodedVideoChunk({
          type: isKey ? 'key' : 'delta',
          timestamp: Number(ptsFlags & ~(FLAG_CONFIG | FLAG_KEY)), // pts scrcpy sudah µs
          data: annexbToAvcc(data) // Chromium butuh chunk length-prefixed (avc)
        }));
      }
    } catch (e) { state.decodeErrors++; log('decode err: ' + e.message); }
  }

  /* ---- konversi Annex-B → avc (length-prefixed) + pembuatan avcC ---- */
  function splitAnnexb(buf) {
    const nals = [];
    let i = 0, start = -1;
    while (i < buf.length - 3) {
      if (buf[i] === 0 && buf[i + 1] === 0 && (buf[i + 2] === 1 || (buf[i + 2] === 0 && buf[i + 3] === 1))) {
        const scLen = buf[i + 2] === 1 ? 3 : 4;
        if (start >= 0) nals.push(buf.slice(start, i));
        start = i + scLen;
        i += scLen;
      } else i++;
    }
    if (start >= 0) nals.push(buf.slice(start));
    return nals.filter((n) => n.length > 3);
  }
  function annexbToAvcc(buf) {
    const nals = splitAnnexb(buf);
    const parts = [];
    for (const n of nals) {
      const l = new Uint8Array(4);
      l[0] = (n.length >>> 24) & 0xff; l[1] = (n.length >>> 16) & 0xff;
      l[2] = (n.length >>> 8) & 0xff; l[3] = n.length & 0xff;
      parts.push(l, n);
    }
    let total = 0;
    for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  }
  function buildAvcc(sps, pps) {
    const out = [];
    out.push(0x01, sps[1], sps[2], sps[3], 0xff, 0xe1);
    out.push((sps.length >> 8) & 0xff, sps.length & 0xff);
    for (const b of sps) out.push(b);
    out.push(0x01);
    out.push((pps.length >> 8) & 0xff, pps.length & 0xff);
    for (const b of pps) out.push(b);
    return new Uint8Array(out);
  }

  function openDecoder(configAnnexB) {
    try {
      if (state.decoder) { try { state.decoder.close(); } catch (e) {} state.decoder = null; }
      const nals = splitAnnexb(configAnnexB);
      let sps = null, pps = null;
      for (const n of nals) {
        const t = n[0] & 0x1f;
        if (t === 7 && !sps) sps = n;
        if (t === 8 && !pps) pps = n;
      }
      if (!sps || !pps) { log('config tanpa SPS/PPS — dilewati'); return; }
      const hex2 = (n) => n.toString(16).padStart(2, '0');
      const codec = 'avc1.' + hex2(sps[1]) + hex2(sps[2]) + hex2(sps[3]);
      const desc = buildAvcc(sps, pps);
      log('buka VideoDecoder ' + codec + ' (avcC ' + desc.length + 'B)');
      const dec = new VideoDecoder({
        output: (frame) => {
          state.framesDecoded++; state.fpsCount++;
          drawFrame(frame);
          frame.close();
        },
        error: (e) => {
          state.decodeErrors++;
          log('decoder error: ' + e.message);
          // pemulihan: konfigurasi ulang dan tunggu keyframe berikutnya
          try { state.decoder = null; } catch (e2) {}
          state.waitingKey = true;
          setTimeout(() => {
            try {
              if (state.lastConfig) openDecoder(state.lastConfig);
            } catch (e3) {}
          }, 150);
        }
      });
      dec.configure({ codec, description: desc, optimizeForLatency: true });
      state.decoder = dec;
      state.lastConfig = configAnnexB;
      state.waitingKey = true;
    } catch (e) {
      state.decodeErrors++;
      log('gagal konfigurasi decoder: ' + e.message);
    }
  }

  function drawFrame(frame) {
    const cw = canvas.width, ch = canvas.height;
    const vw = frame.displayWidth || state.vw, vh = frame.displayHeight || state.vh;
    const scale = Math.min(cw / vw, ch / vh);
    const dw = Math.round(vw * scale), dh = Math.round(vh * scale);
    const dx = Math.round((cw - dw) / 2), dy = Math.round((ch - dh) / 2);
    ctx.fillStyle = '#060a16';
    ctx.fillRect(0, 0, cw, ch);
    try { ctx.drawImage(frame, dx, dy, dw, dh); } catch (e) {}
    state.lastFrameAt = Date.now();
  }

  /* ---------------- dekoder audio (Opus via WebCodecs) ---------------- */
  function parseAudio() {
    const b = state.abuf;
    if (b.length < 12) return;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const ptsFlags = dv.getBigUint64(0);
    const size = dv.getUint32(8);
    const FLAG_CONFIG = 1n << 62n;
    const isConfig = (ptsFlags & FLAG_CONFIG) !== 0n;
    if (b.length < 12 + size) return;
    const data = b.slice(12, 12 + size);
    state.abuf = b.slice(12 + size);
    if (isConfig) {
      try {
        if (state.audioDecoder) { try { state.audioDecoder.close(); } catch (e) {} }
        const dec = new AudioDecoder({
          output: (ad) => { state.audioDecoded++; playAudio(ad); },
          error: (e) => { log('audio decoder err: ' + e.message); }
        });
        dec.configure({
          codec: 'opus',
          sampleRate: 48000,
          numberOfChannels: 2,
          description: data
        });
        state.audioDecoder = dec;
        log('buka AudioDecoder opus (config ' + data.length + 'B)');
      } catch (e) { log('gagal config audio: ' + e.message); }
      return;
    }
    try {
      if (state.audioDecoder && state.audioDecoder.state === 'configured') {
        state.audioDecoder.decode(new EncodedAudioChunk({
          type: 'key',
          timestamp: Number(ptsFlags & ~(FLAG_CONFIG)), // pts scrcpy sudah µs
          data
        }));
      }
    } catch (e) { /* paket opus rusak kadang muncul — lanjut */ }
  }

  function ensureAudioCtx() {
    if (state.actx) return;
    try {
      state.actx = new AudioContext();
      state.gain = state.actx.createGain();
      state.gain.gain.value = 1;
      state.gain.connect(state.actx.destination);
    } catch (e) { log('audio context gagal: ' + e.message); }
  }
  let nextAudioAt = 0;
  function playAudio(ad) {
    ensureAudioCtx();
    if (!state.actx) { ad.close(); return; }
    try {
      const ch = Math.min(2, ad.numberOfChannels);
      const buf = state.actx.createBuffer(ch, ad.numberOfFrames, ad.sampleRate);
      for (let c = 0; c < ch; c++) {
        const f = new Float32Array(ad.numberOfFrames);
        ad.copyTo(f, { planeIndex: c, format: 'f32-planar' });
        buf.copyToChannel(f, c);
      }
      const src = state.actx.createBufferSource();
      src.buffer = buf;
      src.connect(state.gain);
      const when = Math.max(state.actx.currentTime + 0.06, nextAudioAt);
      src.start(when);
      nextAudioAt = when + buf.duration;
      state.audioQueued++;
    } catch (e) { log('play audio err: ' + e.message); }
    ad.close();
  }

  /* ---------------- kontrol (sentuh, keyboard, tombol) ---------------- */
  function canvasToVideo(px, py) {
    const rect = canvas.getBoundingClientRect();
    const cx = (px - rect.left) * (canvas.width / rect.width);
    const cy = (py - rect.top) * (canvas.height / rect.height);
    const scale = Math.min(canvas.width / state.vw, canvas.height / state.vh);
    const dx = (canvas.width - state.vw * scale) / 2;
    const dy = (canvas.height - state.vh * scale) / 2;
    const vx = Math.round((cx - dx) / scale);
    const vy = Math.round((cy - dy) / scale);
    return [Math.max(0, Math.min(state.vw - 1, vx)), Math.max(0, Math.min(state.vh - 1, vy))];
  }
  let pointerDown = false;
  canvas.addEventListener('pointerdown', (e) => {
    if (!state.running) return;
    pointerDown = true;
    canvas.setPointerCapture(e.pointerId);
    const [x, y] = canvasToVideo(e.clientX, e.clientY);
    ctlSend({ t: 'touch', action: 0, x, y, w: state.vw, h: state.vh });
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!state.running || !pointerDown) return;
    const [x, y] = canvasToVideo(e.clientX, e.clientY);
    ctlSend({ t: 'touch', action: 2, x, y, w: state.vw, h: state.vh });
  });
  const endTouch = (e) => {
    if (!state.running || !pointerDown) return;
    pointerDown = false;
    const [x, y] = canvasToVideo(e.clientX, e.clientY);
    ctlSend({ t: 'touch', action: 1, x, y, w: state.vw, h: state.vh });
  };
  canvas.addEventListener('pointerup', endTouch);
  canvas.addEventListener('pointercancel', endTouch);
  canvas.addEventListener('wheel', (e) => {
    if (!state.running) return;
    const [x, y] = canvasToVideo(e.clientX, e.clientY);
    const v = e.deltaY > 0 ? -1 : 1;
    ctlSend({ t: 'scroll', x, y, w: state.vw, h: state.vh, vy: v });
    e.preventDefault();
  }, { passive: false });

  // keyboard: teks → inject text; tombol khusus → keycode Android
  const KEY_MAP = {
    Enter: 66, Backspace: 67, Tab: 61, Escape: 111,
    ArrowUp: 19, ArrowDown: 20, ArrowLeft: 21, ArrowRight: 22,
    Home: 122, End: 123, PageUp: 92, PageDown: 93, Delete: 112,
    Insert: 124
  };
  document.addEventListener('keydown', (e) => {
    if (!state.running) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return; // biarkan pintasan app
    const mapped = KEY_MAP[e.key];
    if (mapped != null) {
      ctlSend({ t: 'tapkey', keycode: mapped });
      e.preventDefault();
      return;
    }
    if (e.key.length === 1) {
      ctlSend({ t: 'text', text: e.key });
      e.preventDefault();
    }
  });

  $('btnHome').onclick = () => ctlSend({ t: 'home' });
  $('btnBack').onclick = () => ctlSend({ t: 'back' });
  $('btnRecents').onclick = () => ctlSend({ t: 'recents' });
  $('btnVolUp').onclick = () => ctlSend({ t: 'volup' });
  $('btnVolDown').onclick = () => ctlSend({ t: 'voldown' });
  $('btnPower').onclick = () => ctlSend({ t: 'power' });
  $('btnRotate').onclick = () => ctlSend({ t: 'rotate' });
  $('btnScreen').onclick = () => {
    state.screenOff = !state.screenOff;
    ctlSend({ t: state.screenOff ? 'screenoff' : 'screenon' });
    $('btnScreen').classList.toggle('on', state.screenOff);
  };
  $('btnAudio').onclick = () => {
    state.mute = !state.mute;
    if (state.gain) state.gain.gain.value = state.mute ? 0 : 1;
    $('btnAudio').textContent = state.mute ? '🔇' : '🔈';
    $('btnAudio').classList.toggle('on', state.mute);
  };
  $('btnStop').onclick = () => {
    fetch(API + '/api/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  };

  /* ---------------- mulai/akhiri sesi ---------------- */
  function startStreams() {
    state.vbuf = Buffer_or_U8();
    state.abuf = Buffer_or_U8();
    state.framesDecoded = 0; state.audioDecoded = 0; state.decodeErrors = 0;
    state.fps = 0;
    state.videoWs = wsConnect(WSBASE + '/ws/video', (bin) => {
      if (!state._dbgBin) { state._dbgBin = true; log('bin pertama video: ' + bin.length + 'B, byte0=0x' + bin[0].toString(16)); }
      state.vbuf = cat(state.vbuf, bin);
      let guard = 0;
      while (state.vbuf.length >= 12 && guard++ < 200) parseVideo();
    }, (txt) => { if (!state._dbgTxt) { state._dbgTxt = true; log('text di video WS: ' + txt.slice(0, 80)); } }, () => {});
    state.audioWs = wsConnect(WSBASE + '/ws/audio', (bin) => {
      state.abuf = cat(state.abuf, bin);
      let guard = 0;
      while (state.abuf.length >= 12 && guard++ < 200) parseAudio();
    }, (txt) => {}, () => {});
    state.ctlWs = wsConnect(WSBASE + '/ws/ctl', (bin) => {}, (txt) => {
      try {
        const m = JSON.parse(txt);
        if (m.t === 'hello') {
          state.name = m.name || '';
          state.audioOn = !!m.audio;
          $('stAudio').textContent = m.audio ? '🔊 audio aktif' : '';
          setStatus('🟢 ' + (state.name || 'terhubung'), 'on');
          state.running = true;
          show($('picker'), false);
          show($('stopped'), false);
        } else if (m.t === 'session' && m.state === 'stopped') {
          sessionStopped(m.err || 'Sesi mirror berakhir.');
        } else if (m.t === 'session' && m.state === 'running') {
          state.running = true;
          setStatus('🟢 ' + (m.name || state.name || 'terhubung'), 'on');
        } else if (m.t === 'session' && m.state === 'stall') {
          // v1.6.7: server HP hidup tapi tidak mengirim gambar (watchdog)
          setStatus('⚠️ Server HP tidak mengirim gambar (' + (m.name || '?') + ') — tunggu ±10 detik; bila tetap kosong, tekan Pindai Ulang lalu Mulai Mirror lagi', 'err');
        }
      } catch (e) {}
    }, () => {
      if (state.running) sessionStopped('Koneksi ke server mirror terputus.');
    });
    startFpsTimer();
  }

  let fpsTimer = null;
  function startFpsTimer() {
    clearInterval(fpsTimer);
    fpsTimer = setInterval(() => {
      state.fps = state.fpsCount;
      state.fpsCount = 0;
      $('stFps').textContent = state.running ? (state.fps + ' fps · ' + state.framesDecoded + ' frame · ' + state.vw + '×' + state.vh) : '';
      if (smokeMode) fakeReport();
    }, 1000);
  }

  function sessionStopped(reason) {
    state.running = false;
    setStatus('🔴 terputus', 'err');
    $('stopReason').textContent = reason || 'Sesi mirror berakhir.';
    show($('stopped'), true);
    closeAll();
  }
  function closeAll() {
    for (const k of ['videoWs', 'audioWs', 'ctlWs']) {
      try { if (state[k]) state[k].close(); } catch (e) {}
      state[k] = null;
    }
    try { if (state.decoder) { state.decoder.close(); state.decoder = null; } } catch (e) {}
    try { if (state.audioDecoder) { state.audioDecoder.close(); state.audioDecoder = null; } } catch (e) {}
  }

  /* ---------------- device picker ---------------- */
  async function refreshDevices() {
    const list = $('devList');
    list.innerHTML = '<div class="sub">Memindai device…</div>';
    try {
      const r = await fetch(API + '/api/devices');
      const j = await r.json();
      if (j.error) { pickerError(j.error); list.innerHTML = ''; return; }
      if (!j.devices.length) {
        list.innerHTML = '<div class="sub">Tidak ada HP Android terdeteksi.<br>Sambungkan dengan USB → aktifkan <b>USB Debugging</b> → tekan "Pindai Ulang".<br>(Di HP: popup "Izinkan debugging USB" → OK)</div>';
        return;
      }
      list.innerHTML = '';
      j.devices.forEach((d, i) => {
        const el = document.createElement('div');
        el.className = 'dev' + (i === 0 ? ' sel' : '');
        // v1.6.4: badge state — device yang belum dikonfirmasi izinnya diberi tanda
        const badge = d.state && d.state !== 'device'
          ? '<span class="d-state">' + (d.state === 'unauthorized' ? '⚠️ Izinkan di HP' : '⚠️ ' + escapeHtml(d.state)) + '</span>'
          : '';
        el.innerHTML = '<span>📱</span><span class="d-name">' + escapeHtml(d.model || d.serial) +
          '</span>' + badge + '<span class="d-serial">' + escapeHtml(d.serial) + '</span>';
        el.onclick = () => {
          document.querySelectorAll('.dev').forEach((x) => x.classList.remove('sel'));
          el.classList.add('sel');
        };
        el.dataset.serial = d.serial;
        list.appendChild(el);
      });
      state.deviceSerial = j.devices[0].serial;
      pickerError('');
    } catch (e) {
      pickerError('Server mirror tidak terjangkau: ' + e.message);
    }
  }
  function pickerError(t) {
    const el = $('pickerErr');
    el.textContent = t || '';
    el.style.display = t ? 'block' : 'none';
  }
  function escapeHtml(s) { return String(s || '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }

  async function startMirror() {
    const sel = document.querySelector('.dev.sel');
    const serial = sel ? sel.dataset.serial : state.deviceSerial;
    if (!serial) { pickerError('Pilih device dulu ya.'); return; }
    $('btnStart').disabled = true;
    $('btnStart').textContent = 'Menyambungkan… (izinkan popup di HP)';
    try {
      const r = await fetch(API + '/api/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serial,
          maxSize: parseInt($('selMax').value, 10) || 1024,
          audio: $('chkAudio').checked,
          stayAwake: $('chkAwake').checked
        })
      });
      const j = await r.json();
      if (j.error) {
        pickerError('❌ ' + j.error);
      } else {
        // v1.6.4: pesan audio-otomatis-dimatikan (HP Android ≤10)
        if (j.note) log('ℹ️ ' + j.note);
        show($('picker'), false);
        startStreams();
      }
    } catch (e) {
      pickerError('Gagal memulai mirror: ' + e.message);
    }
    $('btnStart').disabled = false;
    $('btnStart').textContent = '▶ Mulai Mirror';
  }
  async function startNative() {
    const sel = document.querySelector('.dev.sel');
    const serial = sel ? sel.dataset.serial : state.deviceSerial;
    try {
      const r = await fetch(API + '/api/native', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serial, maxSize: parseInt($('selMax').value, 10) || 1024 })
      });
      const j = await r.json();
      if (j.error) pickerError('❌ ' + j.error);
      else pickerError('✅ Jendela scrcpy terbuka — mirror dengan audio jalan di jendela terpisah.');
    } catch (e) {
      pickerError('❌ ' + e.message);
    }
  }
  $('btnStart').onclick = startMirror;
  $('btnNative').onclick = startNative;
  $('btnRescan').onclick = refreshDevices;
  $('btnRestart').onclick = async () => {
    show($('stopped'), false);
    show($('picker'), true);
    await refreshDevices();
  };

  /* ---------------- smoke test hook (fake device) ---------------- */
  let fakeReportCount = 0;
  function fakeReport() {
    fakeReportCount++;
    if (fakeReportCount > 8) return;
    let pixelSum = 0;
    try {
      const d = ctx.getImageData(Math.floor(canvas.width / 2) - 4, Math.floor(canvas.height / 2) - 4, 8, 8).data;
      for (let i = 0; i < d.length; i += 4) pixelSum += d[i] + d[i + 1] + d[i + 2];
    } catch (e) {}
    log('MIRROR_JS ' + JSON.stringify({
      running: state.running, vw: state.vw, vh: state.vh,
      decoded: state.framesDecoded, fps: state.fps,
      audio: state.audioDecoded, decodeErrors: state.decodeErrors,
      name: state.name, pixelSum
    }));
    if (fakeReportCount === 1) {
      // kirim kontrol contoh → divalidasi server fake
      ctlSend({ t: 'touch', action: 0, x: 100, y: 200, w: state.vw, h: state.vh });
      setTimeout(() => ctlSend({ t: 'touch', action: 1, x: 100, y: 200, w: state.vw, h: state.vh }), 80);
      ctlSend({ t: 'scroll', x: 50, y: 300, w: state.vw, h: state.vh, vy: 1 });
      ctlSend({ t: 'home' });
      ctlSend({ t: 'text', text: 'hi' });
      ctlSend({ t: 'rotate' });
      ctlSend({ t: 'screenoff' });
      setTimeout(() => ctlSend({ t: 'screenon' }), 120);
    }
  }

  /* ---------------- init ---------------- */
  async function init() {
    try {
      const r = await fetch(API + '/api/info');
      const j = await r.json();
      smokeMode = !!j.smoke;
      if (j.running) {
        startStreams();
        return;
      }
      if (j.smoke) {
        // smoke test: nyalakan sesi fake (simulasi device) lalu sambungkan
        try {
          await fetch(API + '/api/start-fake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        } catch (e) {}
        const wait = async () => {
          for (let i = 0; i < 20; i++) {
            try {
              const r2 = await fetch(API + '/api/info');
              const j2 = await r2.json();
              if (j2.running) { startStreams(); return; }
            } catch (e) {}
            await new Promise((res) => setTimeout(res, 500));
          }
          log('MIRROR_JS ' + JSON.stringify({ running: false, err: 'fake session tidak jalan' }));
        };
        wait();
        return;
      }
    } catch (e) {
      setStatus('Server mirror tidak aktif', 'err');
    }
    setStatus('Belum terhubung');
    await refreshDevices();
  }
  window.addEventListener('unload', () => closeAll());
  init();
})();

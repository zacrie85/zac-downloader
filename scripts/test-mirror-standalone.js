/* Test standalone lib/mirror.js — sesi fake + WS client penerima, tanpa electron. */
process.env.KLIP_FAKE_MIRROR = '1';
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { createMirrorServer } = require('/home/z/my-project/klip-downloader/lib/mirror');

const mgr = createMirrorServer({
  resolveAdb: () => 'adb',
  resolveScrcpyBin: () => null,
  serverJar: '/tmp/scrcpy-server',
  isSmoke: true,
  onLog: (l) => console.log(l)
});

function wsGet(path, port) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.get({
      host: '127.0.0.1', port, path,
      headers: {
        Connection: 'Upgrade', Upgrade: 'websocket',
        'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13'
      }
    });
    req.on('upgrade', (res, socket, head) => {
      // parser frame server→client (unmasked); `head` = byte frame yang datang
      // bareng respons handshake (browser menangani ini otomatis)
      const ws = { socket, buf: Buffer.alloc(0), onmessage: null, closed: false, received: [] };
      const feed = (d) => {
        ws.buf = Buffer.concat([ws.buf, d]);
        while (ws.buf.length >= 2) {
          const b0 = ws.buf[0], b1 = ws.buf[1];
          const op = b0 & 0x0f;
          let len = b1 & 0x7f, off = 2;
          if (len === 126) { if (ws.buf.length < 4) return; len = ws.buf.readUInt16BE(2); off = 4; }
          else if (len === 127) { if (ws.buf.length < 10) return; len = ws.buf.readUInt32BE(6); off = 10; }
          if (ws.buf.length < off + len) return;
          const payload = ws.buf.slice(off, off + len);
          ws.buf = ws.buf.slice(off + len);
          if (op === 0x8) { ws.closed = true; socket.destroy(); return; }
          if (op === 0x1 || op === 0x2) {
            ws.received.push({ op, payload });
            if (ws.onmessage) ws.onmessage(op, payload);
          }
        }
      };
      socket.on('data', feed);
      if (head && head.length) feed(head);
      socket.on('close', () => { ws.closed = true; });
      resolve(ws);
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  const port = await mgr.start();
  console.log('port', port);
  const info0 = mgr.info();
  console.log('info awal:', JSON.stringify(info0));
  const st = await mgr.listDevices();
  console.log('devices:', JSON.stringify(st));
  const fake = await mgr.startFakeSession();
  console.log('fake start:', JSON.stringify(fake));
  await new Promise((r) => setTimeout(r, 2500));
  console.log('info sesudah fake:', JSON.stringify(mgr.info()));

  const video = await wsGet('/ws/video', port);
  const audio = await wsGet('/ws/audio', port);
  const ctl = await wsGet('/ws/ctl', port);
  let hello = null, videoBytes = 0, audioBytes = 0;
  ctl.onmessage = (op, p) => { if (op === 1) hello = JSON.parse(p.toString()); };
  video.onmessage = (op, p) => { videoBytes += p.length; };
  audio.onmessage = (op, p) => { audioBytes += p.length; };
  await new Promise((r) => setTimeout(r, 4000));
  const helloMsg = (ctl.received.find((m) => m.op === 1) || {}).payload;
  hello = helloMsg ? JSON.parse(helloMsg.toString()) : null;
  console.log('hello:', JSON.stringify(hello));
  console.log('videoBytes:', videoBytes, 'audioBytes:', audioBytes);
  console.log('fake-stats:', JSON.stringify(mgr.fakeStats()));

  // parser video: cek sessionMeta + config + frame
  const meta = videoBytes > 0 && audioBytes > 0;
  mgr.stopSession();
  process.exit(meta && hello && hello.name === 'Zac Fake Device' ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });

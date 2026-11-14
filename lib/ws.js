/**
 * lib/ws.js — v1.6.2
 * Server WebSocket (RFC 6455) minimal tanpa dependensi eksternal.
 * Dipakai oleh mirror Android (scrcpy) untuk mengalirkan video/audio ke
 * tab Android di browser built-in. Cukup untuk 1 server lokal (127.0.0.1)
 * dengan beberapa koneksi — bukan implementasi WebSocket umum.
 *
 * Pemakaian:
 *   const ws = new WsConnection(socket);
 *   ws.on('message', (opcode, payloadBuf) => {});
 *   ws.on('close', () => {});
 *   ws.sendText(str); ws.sendBinary(buf); ws.close();
 */
const crypto = require('crypto');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function acceptKey(key) {
  return crypto.createHash('sha1').update(key + WS_GUID, 'binary').digest('base64');
}

/** Buat frame server→client (tanpa mask — server tidak wajib mask). */
function buildFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeUInt32BE(Math.floor(len / 4294967296), 2);
    header.writeUInt32BE(len >>> 0, 6);
  }
  header[0] = 0x80 | opcode; // FIN + opcode
  return Buffer.concat([header, payload]);
}

class WsConnection {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.fragments = [];       // pesan terfragmentasi (continuation)
    this.fragOpcode = 0;
    this.closed = false;
    this.onmessage = null;     // (opcode, Buffer)
    this.onclose = null;
    socket.on('data', (d) => this._feed(d));
    socket.on('error', () => this._close());
    socket.on('close', () => this._close());
    socket.on('end', () => this._close());
  }

  /** Jabat tangan HTTP upgrade. return true bila sukses. */
  static handshake(req, socket) {
    const key = req.headers['sec-websocket-key'];
    if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') return false;
    const headers = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Accept: ' + acceptKey(key),
      '\r\n'
    ].join('\r\n');
    socket.write(headers);
    return true;
  }

  _feed(chunk) {
    if (this.closed) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    // proses semua frame utuh di buffer
    while (this.buf.length >= 2) {
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        const hi = this.buf.readUInt32BE(2);
        const lo = this.buf.readUInt32BE(6);
        if (hi > 0x1fffff) { this._close(); return; } // >2GB: tolak
        len = hi * 4294967296 + lo;
        off = 10;
      }
      let maskKey = null;
      if (masked) {
        if (this.buf.length < off + 4) return;
        maskKey = this.buf.slice(off, off + 4);
        off += 4;
      }
      if (this.buf.length < off + len) return;
      let payload = this.buf.slice(off, off + len);
      this.buf = this.buf.slice(off + len);
      if (masked) {
        const out = Buffer.allocUnsafe(len);
        for (let i = 0; i < len; i++) out[i] = payload[i] ^ maskKey[i & 3];
        payload = out;
      }
      this._frame(fin, opcode, payload);
    }
  }

  _frame(fin, opcode, payload) {
    if (opcode === 0x8) { this.close(); return; }            // close
    if (opcode === 0x9) {                                     // ping → pong
      try { this.socket.write(buildFrame(0xA, payload)); } catch (e) {}
      return;
    }
    if (opcode === 0xA) return;                               // pong: abaikan
    if (opcode >= 0x1 && opcode <= 0x2) {
      if (!fin) { this.fragOpcode = opcode; this.fragments.push(payload); return; }
      this._emit(opcode, payload);
      return;
    }
    if (opcode === 0x0) {                                     // continuation
      this.fragments.push(payload);
      if (fin) {
        const all = Buffer.concat(this.fragments);
        this.fragments = [];
        this._emit(this.fragOpcode || 0x2, all);
      }
    }
  }

  _emit(opcode, payload) {
    try { if (this.onmessage) this.onmessage(opcode, payload); } catch (e) {}
  }

  sendText(s) { this._send(0x1, Buffer.from(String(s), 'utf8')); }
  sendBinary(b) { this._send(0x2, b); }
  _send(opcode, payload) {
    if (this.closed) return;
    try { this.socket.write(buildFrame(opcode, payload)); } catch (e) { this._close(); }
  }
  close() {
    if (this.closed) return;
    try { this.socket.write(buildFrame(0x8, Buffer.alloc(0))); } catch (e) {}
    setTimeout(() => this._close(), 60);
  }
  _close() {
    if (this.closed) return;
    this.closed = true;
    try { this.socket.destroy(); } catch (e) {}
    try { if (this.onclose) this.onclose(); } catch (e) {}
  }
}

module.exports = { WsConnection };

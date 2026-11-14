/* Test WebCodecs H.264 decode — varian A (annexb tanpa description) vs
 * B (avcC description + chunk length-prefixed). Data: fake-streams.json. */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  const j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'lib', 'fake-streams.json'), 'utf8'));
  const sps = Buffer.from(j.sps, 'base64');
  const pps = Buffer.from(j.pps, 'base64');

  // avcC
  const avcC = Buffer.concat([
    Buffer.from([1, sps[1], sps[2], sps[3], 0xff, 0xe1]),
    Buffer.from([0, sps.length]), sps,
    Buffer.from([1]),
    Buffer.from([0, pps.length]), pps
  ]);
  const lenPref = (b) => { const l = Buffer.alloc(4); l.writeUInt32BE(b.length, 0); return Buffer.concat([l, b]); };
  // SPS+PPS format annexb (node-scope, untuk varian prepend di halaman)
  const SCb = Buffer.from([0, 0, 0, 1]);
  const spsPpsAnnexb = Buffer.concat([SCb, sps, SCb, pps]);

  const html = `<!DOCTYPE html><html><body><script>
  const RESULT = { done: false, logs: [] };
  function log(m) { RESULT.logs.push(String(m)); }
  async function tryDecode(name, config, chunkType, chunkData) {
    try {
      const frames = [];
      const dec = new VideoDecoder({
        output: (f) => { frames.push({ w: f.displayWidth, h: f.displayHeight }); f.close(); },
        error: (e) => log(name + ' ERROR: ' + e.message)
      });
      dec.configure(config);
      dec.decode(new EncodedVideoChunk({ type: chunkType, timestamp: 0, data: chunkData }));
      await dec.flush();
      log(name + ' => frames=' + frames.length + ' ' + JSON.stringify(frames[0] || null));
      return frames.length;
    } catch (e) {
      log(name + ' THROW: ' + e.message);
      return -1;
    }
  }
  window.runTest2 = async (cfgArray, chunksIn, spsPpsAnnexb) => {
    const cfg = new Uint8Array(cfgArray);
    const spsPps = new Uint8Array(spsPpsAnnexb); // [SC][SPS][SC][PPS]
    await tryDecodeChunks('Q-avc3-annexb', { codec: 'avc3.42c015', optimizeForLatency: true }, chunksIn, { annexb: true });
    await tryDecodeChunks('R-avc3-avc', { codec: 'avc3.42c015', optimizeForLatency: true, description: cfg }, chunksIn, {});
    await tryDecodeChunks('S-avcc-IDR-dgn-SPS', { codec: 'avc1.42c015', optimizeForLatency: true, description: cfg }, chunksIn, { spsPps });
    RESULT.done = true;
    return RESULT.logs;
  };
  async function tryDecodeChunks(name, config, chunksIn, opt) {
    try {
      const frames = [];
      const dec = new VideoDecoder({
        output: (f) => { frames.push({ w: f.displayWidth, h: f.displayHeight }); f.close(); },
        error: (e) => log(name + ' ERROR@' + (frames.length) + ': ' + e.message)
      });
      dec.configure(config);
      for (let i = 0; i < 100 && dec.state !== 'configured'; i++) await new Promise((r) => setTimeout(r, 30));
      if (dec.state !== 'configured') { log(name + ' config gagal'); return; }
      for (let i = 0; i < chunksIn.length; i++) {
        const c = chunksIn[i];
        let data = opt.annexb ? annexbOf(c.data) : Uint8Array.from(c.data);
        if (opt.spsPps && c.type === 'key') {
          // SPS+PPS + IDR dalam satu chunk (annexb → avc length-prefixed)
          const merged = new Uint8Array(opt.spsPps.length + data.length);
          merged.set(opt.spsPps, 0); merged.set(data, opt.spsPps.length);
          data = merged;
        }
        try {
          dec.decode(new EncodedVideoChunk({ type: c.type, timestamp: c.timestamp, data }));
        } catch (e) { log(name + ' decode throw@' + i + ': ' + e.message); break; }
        await new Promise((r) => setTimeout(r, 50));
        if (dec.state !== 'configured') { log(name + ' decoder mati setelah chunk ' + i); break; }
      }
      try { await dec.flush(); } catch (e) { log(name + ' flush err'); }
      log(name + ' => frames=' + frames.length + ' last=' + JSON.stringify(frames[frames.length - 1] || null));
    } catch (e) {
      log(name + ' THROW: ' + e.message);
    }
  }
  // data chunk di-json adalah length-prefixed (avc); utk annexb, ubah balik
  function annexbOf(lenPrefArr) {
    const buf = Uint8Array.from(lenPrefArr);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const parts = [];
    let off = 0;
    while (off < buf.length) {
      const l = dv.getUint32(off);
      parts.push(0, 0, 0, 1);
      for (const b of buf.slice(off + 4, off + 4 + l)) parts.push(b);
      off += 4 + l;
    }
    return new Uint8Array(parts);
  }
  </script></body></html>`;

  const win = new BrowserWindow({ show: false, width: 400, height: 300 });
  const htmlPath = path.join(require('os').tmpdir(), 'wctest.html');
  fs.writeFileSync(htmlPath, html);
  await win.loadFile(htmlPath);

  const toU8 = (b) => Uint8Array.from(b);
  const seq = (arr) => new Uint8Array(arr.reduce((acc, b) => { acc.push(...b); return acc; }, []));
  // varian I: GOP utuh (IDR → P1..P11) — chunk realistis (type & pts benar)
  const gopChunks = (j.gop || []).map((g, gi) => ({
    type: g.k ? 'key' : 'delta',
    timestamp: (gi + 1) * 100000,
    data: Array.from(lenPref(Buffer.from(g.d, 'base64')))
  }));
  const res = await win.webContents.executeJavaScript(`window.runTest2(
    ${JSON.stringify(Array.from(avcC))},
    ${JSON.stringify(gopChunks)},
    ${JSON.stringify(Array.from(spsPpsAnnexb))}
  )`, true);
  console.log('WC_TEST ' + JSON.stringify(res));
  app.exit(0);
}).catch((e) => { console.error('FATAL', e); process.exit(2); });

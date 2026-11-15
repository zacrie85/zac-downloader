#!/usr/bin/env node
// SPSTEST — uji spsDims() dari lib/mirror.js terhadap SPS nyata hasil encode
// ffmpeg pada beberapa resolusi; dimensi pembanding diambil dari ffprobe
// (ffmpeg membulatkan lebar ganjil untuk yuv420p). Exit 1 bila ada meleset.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// ekstrak sumber fungsi spsDims + splitAnnexbNals dari mirror.js
const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'mirror.js'), 'utf8');
function grab(name) {
  const start = src.indexOf('function ' + name);
  if (start < 0) throw new Error(name + ' tidak ditemukan');
  const end = src.indexOf('\n}', start);
  return src.slice(start, end + 2);
}
const srcCode = grab('splitAnnexbNals') + '\n' + grab('spsDims') + '\nmodule.exports = { splitAnnexbNals, spsDims };';
fs.writeFileSync('/tmp/spsmod.js', srcCode);
const { spsDims } = require('/tmp/spsmod.js');

const CASES = [
  [320, 600], [1080, 2400], [720, 1280], [864, 2400], [1920, 1080], [461, 1024]
];
let fail = 0;
for (const [w, h] of CASES) {
  const out = `/tmp/sps_${w}x${h}.h264`;
  try {
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${w}x${h}:rate=10`,
      '-t', '0.3', '-c:v', 'libx264', '-preset', 'ultrafast', '-x264-params', 'keyint=10:min-keyint=10',
      '-pix_fmt', 'yuv420p', '-an', '-f', 'h264', out], { stdio: 'pipe' });
    // dimensi EFEKTIF (ffmpeg membulatkan lebar ganjil utk yuv420p)
    const eff = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v',
      '-show_entries', 'stream=width,height', '-of', 'csv=p=0', out], { stdio: 'pipe' }).toString().trim();
    const [ew, eh] = eff.split(',').map((n) => parseInt(n, 10));
    const blob = fs.readFileSync(out);
    // ekstrak SPS (NAL type 7) — batas NAL = awal start code berikutnya
    const scPos = [];
    for (let k = 0; k < blob.length - 3; k++) {
      if (blob[k] === 0 && blob[k + 1] === 0 && (blob[k + 2] === 1 || (blob[k + 2] === 0 && blob[k + 3] === 1))) {
        scPos.push({ sc: k, payload: k + (blob[k + 2] === 1 ? 3 : 4) });
        k += 3;
      }
    }
    let sps = null;
    for (let s = 0; s < scPos.length; s++) {
      const e = s + 1 < scPos.length ? scPos[s + 1].sc : blob.length;
      const nal = blob.slice(scPos[s].payload, e);
      while (nal.length && nal[nal.length - 1] === 0) nal.length -= 1; // buang trailing zero
      if (nal.length > 4 && (nal[0] & 0x1f) === 7) { sps = nal; break; }
    }
    if (!sps) { console.log(`${w}x${h}: SPS tidak ditemukan`); fail++; continue; }
    const got = spsDims(sps);
    const ok = got && got.w === ew && got.h === eh;
    if (!ok) fail++;
    console.log(`${w}x${h}: efektif=${ew}x${eh} parser=${got ? got.w + 'x' + got.h : 'null'} ${ok ? 'OK' : 'MELESET'}`);
  } catch (e) {
    console.log(`${w}x${h}: ffmpeg/ffprobe gagal: ${String(e.message).slice(0, 80)}`);
    fail++;
  }
}
console.log(fail === 0 ? 'SPSTEST PASS' : 'SPSTEST GAGAL: ' + fail);
process.exit(fail === 0 ? 0 : 1);

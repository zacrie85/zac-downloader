#!/usr/bin/env bash
# Unduh semua binari Windows yang dibutuhkan folder bin/
# (dijalankan SEBELUM build karena bin/*.exe tidak di-commit ke git — ukuran >100MB)
# v1.6.6: idempoten — file yang sudah ada (ukuran > 1MB) dilewati, jadi aman
# dipanggil dari build:win setiap kali build.
set -e
cd "$(dirname "$0")/../bin"

have() { [ -s "$1" ] && [ "$(stat -c%s "$1" 2>/dev/null || echo 0)" -gt 1000000 ]; }

echo "1/4 yt-dlp.exe ..."
if have yt-dlp.exe; then echo "   sudah ada, lewati"; else curl -L -o yt-dlp.exe "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"; fi

echo "2/4 node.exe (JS runtime untuk yt-dlp) ..."
if have node.exe; then echo "   sudah ada, lewati"; else curl -L -o node.exe "https://nodejs.org/dist/v22.14.0/win-x64/node.exe"; fi

echo "3/4 ffmpeg (GyanD codexffmpeg RELEASE STABIL — bukan nightly) ..."
# v1.5.3: sebelumnya pakai BtbN ffmpeg-master-latest (nightly, bisa mengandung
# regresi — diduga penyebab "Error opening output files: Invalid argument" saat
# merge DASH BiliBili). Kini dipin ke rilis stabil resmi ffmpeg.
# v1.6.6: pin ke 7.1.1 — ffmpeg 9.x full build ffmpeg.exe/ffprobe.exe masing-
# masing ~227MB (bundle membengkak >600MB); 7.1.1 stabil & footprint pas.
if have ffmpeg.exe && have ffprobe.exe; then echo "   sudah ada, lewati"; else
FFMPEG_VER="7.1.1"
curl -L -o /tmp/ffmpeg-win64.zip "https://github.com/GyanD/codexffmpeg/releases/download/${FFMPEG_VER}/ffmpeg-${FFMPEG_VER}-full_build.zip"

echo "4/4 ekstrak ffmpeg.exe + ffprobe.exe ..."
unzip -o -j /tmp/ffmpeg-win64.zip "*/bin/ffmpeg.exe" "*/bin/ffprobe.exe" -d .
rm -f /tmp/ffmpeg-win64.zip
fi

echo "5/5 ChordKu.exe (terintegrasi: deteksi chord & kunci gitar) ..."
# v1.7.0: ChordKu ditempel sepenuhnya ke Zac Downloader — exe resmi dari
# rilis repo ChordKu, dipin ke versi tertentu (override: CHORDKU_VERSION).
if have chordku/ChordKu.exe; then echo "   sudah ada, lewati"; else
CK_VER="${CHORDKU_VERSION:-v1.0.8}"
mkdir -p chordku
curl -L --retry 3 -o chordku/ChordKu.exe \
  "https://github.com/zacrie85/CARI-KUNCI-GITAR/releases/download/${CK_VER}/ChordKu.exe"
fi

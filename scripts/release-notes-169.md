# 🔧 Zac Downloader v1.6.9 — Penguatan mirror + diagnostik layar

Lanjutan [v1.6.8](https://github.com/zacrie85/zac-downloader/releases/tag/v1.6.8). Bila di v1.6.8 mirror masih menampilkan layar hitam padahal terhubung, v1.6.9 menutup sisa variasi server scrcpy yang bisa menyebabkannya DAN membuat setiap kegagalan terlihat jelas.

## ✨ Yang baru
1. **Config avcC ditangani** — sebagian fork server mengirim config dalam format avcC (length-prefixed), bukan Annex-B; kini otomatis dikonversi.
2. **Server tanpa config frame pun jalan** — SPS/PPS yang ikut di frame data otomatis dijadikan config (config sintetis) di sisi aplikasi, plus rescue yang sama di sisi renderer.
3. **Garis diagnostik di status bar** — versi aplikasi, status decoder, error dekode, dan path file log tampil langsung di tab Android. Masalah cukup dilaporkan dengan screenshot.
4. **File log `mirror-debug.log`** — diagnosa hex aliran awal, detail 6 frame pertama, sessionMeta, dan counter tercatat di folder data aplikasi (`%APPDATA%\Zac Downloader\mirror-debug.log`).
5. **REAL-E2E test** — untuk pertama kalinya pipeline PENUH diuji otomatis: framing scrcpy asli berisi H.264/Opus nyata → start() asli → translator → renderer → WebCodecs → piksel tergambar di canvas.

## 📦 Instalasi
1. **Installer**: unduh **Zac-Downloader-Setup-1.6.9.exe** → jalankan (upgrade di atas v1.6.x).
2. **Portable**: unduh **Zac-Downloader-1.6.9-portable-win64.zip** → extract → jalankan `Zac Downloader.exe`.
3. SmartScreen: **More info → Run anyway**.

## 💡 Bila masih layar hitam (langkah laporan)
1. Lihat **garis diagnostik** di atas layar tab Android — foto/screenshot baris itu.
2. Buka file log: `%APPDATA%\Zac Downloader\mirror-debug.log` (path juga tampil di garis diagnostik).
3. Kirim screenshot garis diagnostik + isi file log — penyebab pasti bisa dilihat dari situ (framing janggal, config tak terbaca, decoder error, dsb.).

## ⚖️ Lisensi & Kredit
- Zac Downloader: MIT © 2026 zacrie85 — basis [Klip Downloader](https://github.com/zacrie85/klip-downloader)
- Bundel MDM + extension-nya: GPL-3.0 © [Ahmed Nefzaoui](https://github.com/anefzaoui/misterdownloadmanager) — paket gabungan untuk pemakaian pribadi; bila disebarluaskan, source wajib ikut dibuka
- scrcpy-server/scrcpy.exe/adb: Apache-2.0 © [Genymobile](https://github.com/Genymobile/scrcpy)
- yt-dlp: Unlicense · FFmpeg: build GyanD (dipin 7.1.1) · node.exe: MIT
- 100% lokal: tanpa server, tanpa akun, tanpa telemetri

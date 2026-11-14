# 🔧 Zac Downloader v1.6.8 — FIX layar hitam mirror

Pembaruan dari [v1.6.7](https://github.com/zacrie85/zac-downloader/releases/tag/v1.6.7): memperbaiki **layar hitam** saat mirror terhubung (🟢) tetapi tidak pernah menampilkan gambar (`0 fps · 0 frame`).

## 🔍 Penyebab (dua lapisan)
1. **Framing berbeda** — server scrcpy asli mengirim frame `[4B size][1B type][payload]`, renderer mengharapkan protokol internal `[12B sessionMeta][12B meta][Annex-B]`. Byte mentah dipipa langsung → tidak ada frame yang pernah terbaca.
2. **Chunk jatuh di celah listener** — kolektor socket memakai `once('data')`; chunk berikutnya (config SPS/PPS + frame awal) bisa hilang di celah antara resolve koneksi dan pemasangan handler baru → decoder tak pernah terkonfigurasi, semua frame berikutnya dibuang.

## ✨ Perbaikan
- **Translator framing**: aliran scrcpy asli dari HP dikonversi ke protokol renderer — video DAN audio (Opus) — lengkap dengan `sessionMeta` yang disintesis dari **dimensi SPS** (parser H.264 exp-golomb: high-profile, scaling list, crop, rotasi layar = meta dikirim ulang).
- **Kolektor persisten**: tidak ada byte yang bisa jatuh; dihentikan rapi setelah alur start selesai.
- Backlog untuk client yang bergabung belakangan kini berformat protokol renderer.
- Hasil: `0 fps · 0 frame` → video jalan; sentuhan lebih akurat karena koordinat memakai dimensi stream yang persis (dari SPS).

## 🧪 Pengujian
- **SPSTEST baru**: parser SPS diuji terhadap 6 resolusi nyata (hasil encode ffmpeg + ffprobe) — **6/6 persis**, termasuk lebar ganjil yang dibulatkan encoder.
- **STARTTEST**: emulator kini mengirim framing scrcpy **ASLI** berisi H.264/Opus nyata (dari `lib/fake-streams.json`) — translator diuji end-to-end di level app: sessionMeta dari SPS, backlog video diawali sessionMeta, backlog audio terkonversi.
- Semua regresi tetap hijau: STARTTEST 6 kasus, TABTEST, MDMBTN, MIRRORTEST.

## 📦 Instalasi
1. **Installer**: unduh **Zac-Downloader-Setup-1.6.8.exe** → jalankan (upgrade di atas v1.6.x).
2. **Portable**: unduh **Zac-Downloader-1.6.8-portable-win64.zip** → extract → jalankan `Zac Downloader.exe`.
3. SmartScreen: **More info → Run anyway**.

## 💡 Pengingat
- Xiaomi/Redmi/POCO: aktifkan **USB Debugging** + **USB debugging (Setelan pengaman)** untuk kendali sentuhan.
- Popup "Izinkan debugging USB?" → **Izinkan** (centang *Selalu izinkan*).
- Bila sesi "terhubung" tetapi gambar tak muncul ±10 detik, kini muncul peringatan jelas (watchdog v1.6.7) — ikuti petunjuknya.

## ⚖️ Lisensi & Kredit
- Zac Downloader: MIT © 2026 zacrie85 — basis [Klip Downloader](https://github.com/zacrie85/klip-downloader)
- Bundel MDM + extension-nya: GPL-3.0 © [Ahmed Nefzaoui](https://github.com/anefzaoui/misterdownloadmanager) — paket gabungan untuk pemakaian pribadi; bila disebarluaskan, source wajib ikut dibuka
- scrcpy-server/scrcpy.exe/adb: Apache-2.0 © [Genymobile](https://github.com/Genymobile/scrcpy)
- yt-dlp: Unlicense · FFmpeg: build GyanD (dipin 7.1.1) · node.exe: MIT
- 100% lokal: tanpa server, tanpa akun, tanpa telemetri

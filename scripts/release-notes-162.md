# 🤖 Zac Downloader v1.6.2 — Mirror Android di tab aplikasi + Session Restore

Pembaruan dari [v1.6.1](https://github.com/zacrie85/zac-downloader/releases/tag/v1.6.1): dua fitur besar yang paling diminta.

## ✨ Apa yang baru

### 1. Tab Android 🤖 — jalankan aplikasi HP di PC TANPA emulator
Tombol **[🤖 Android]** di sidebar membuka tab **Zac Mirror**: layar HP Android aslimu tampil di tab dan dikontrol dari PC — persis scrcpy, tapi **terintegrasi di dalam aplikasi**.

- **Untuk SnackVideo dkk.**: aplikasi berjalan di HP asli → login & OTP tetap di SIM/HP sendiri (bukan emulator → aman untuk program hadiah), layar dikontrol dari PC.
- Kontrol penuh: klik/sentuh, scroll, keyboard, tombol Home/Back/Recents/volume/power/rotate, **🌙 layar HP mati tapi mirror tetap jalan**.
- Video H.264 di-decode langsung di aplikasi (WebCodecs), audio Opus HP → PC (bisa dimute).
- **[⧉ Atau buka jendela scrcpy]** — jendela scrcpy asli terpisah bila ingin audio langsung + perekaman layar.
- Syarat: HP Android + kabel USB + USB Debugging ON. scrcpy-server v5.0.1 resmi (Apache-2.0) & adb dibundel — tanpa install tambahan.

### 2. Session Restore — tab tidak hilang lagi
Tutup aplikasi → buka lagi → **semua tab kembali persis** (alamat, judul, tab aktif — maksimal 15 tab, termasuk tab 🤖 Android).

## 🔧 Detail teknis (untuk yang penasaran)
- Mirror: adb (dibundel) push `scrcpy-server` → `app_process` → 3 socket (video/audio/control) via `adb forward` → di-broadcast ke tab lewat WebSocket lokal (127.0.0.1, port acak) → dekode H.264 via WebCodecs (SPS/PPS → avcC), audio Opus via AudioDecoder, kontrol di-encode ke protokol binari resmi scrcpy v5.0.1 (persis `ControlMessageReader.java`).
- Session restore: tab di-render disimpan (debounce) ke `session.json` di userData + flush sinkron saat window ditutup.

## ✅ Kualitas
- Smoke test otomatis lulus semua: `SESSTEST` (restore 2 fase), `MIRRORTEST` (device simulasi: handshake 3 socket, stream meta, decode video+audio, 8 pesan kontrol), `TABTEST`+`MDMBTN` (regresi multi-tab & tombol MDM v1.6.1).
- Catatan jujur: di lingkungan uji headless (tanpa GPU), decoder software Chromium hanya membuktikan keyframe; P-frame tervalidasi tidak langsung (ffmpeg membuktikan stream valid). Di Windows dengan GPU biasa, path decode-nya berbeda. Bila mirror terasa aneh di kombinasi HP/PC tertentu, pakai tombol **[⧉ jendela scrcpy]** (klien scrcpy resmi, selalu stabil).

## 📦 Instalasi
1. Unduh **Zac-Downloader-1.6.2-portable-win64.zip** (±372 MB) → extract → jalankan `Zac Downloader.exe` — tanpa install, bisa diletakkan di folder mana pun.
2. SmartScreen: **More info → Run anyway**.
3. Upgrade dari v1.6.x: pengaturan & data lama tetap terpakai (folder data `%APPDATA%\Zac Downloader` sama).

> **Catatan**: untuk v1.6.2 **setup installer (.exe) belum tersedia** — gunakan portable zip di atas. Installer disiapkan menyusul di rilis berikutnya.

## ⚖️ Lisensi & Kredit
- Zac Downloader: MIT © 2026 zacrie85 — basis [Klip Downloader](https://github.com/zacrie85/klip-downloader)
- Bundel MDM + extension-nya: GPL-3.0 © [Ahmed Nefzaoui](https://github.com/anefzaoui/misterdownloadmanager) — paket gabungan untuk pemakaian pribadi; bila disebarluaskan, source wajib ikut dibuka
- scrcpy-server/scrcpy.exe/adb: Apache-2.0 © [Genymobile](https://github.com/Genymobile/scrcpy)
- yt-dlp: Unlicense · FFmpeg: build GyanD · node.exe: MIT
- 100% lokal: tanpa server, tanpa akun, tanpa telemetri

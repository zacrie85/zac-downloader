# 🔧 Zac Downloader v1.6.3 — Tombol "Download video" MDM stabil di semua situs

Pembaruan dari [v1.6.2](https://github.com/zacrie85/zac-downloader/releases/tag/v1.6.2): perbaikan tombol MDM mengambang yang hilang lagi.

## ✨ Apa yang diperbaiki

### 1. Tombol "Download video" MDM kini hidup di situs ber-Trusted Types (YouTube, Google, dll.)
- **Penyebab tombol hilang**: video.js menulis HTML tombol lewat `shadow.innerHTML`, dan situs dengan kebijakan keamanan **Trusted Types CSP** (YouTube — halaman home aplikasi, Google, dll.) **memblokir** penulisan itu → script tombol mati total → tombol tidak pernah muncul di situs tersebut, padahal di situs lain normal.
- **Perbaikan**: struktur HTML tombol kini dibangun **eksplisit lewat `createElement` + `appendChild`** (builder DOM) — 100% bebas dari sink Trusted Types. Pendekatan perantara via `DOMParser` pun terbukti masih diblokir YouTube, jadi builder DOM murni adalah satu-satunya jalur yang aman di semua situs. Struktur node-nya identik dengan HTML asli (pill, tombol unduh + menu: unduh/sembunyikan/jangan di situs ini/pengaturan).
- Hasil uji: `video.js` kini selesai tanpa error di **www.youtube.com** (sebelumnya: `Failed to set the 'innerHTML' property on 'ShadowRoot'` lalu crash `Cannot set properties of null`), dan pelanggaran TrustedHTML turun dari 2 menjadi **0**.
- Patch diterapkan di **dua jalur** sekaligus: shim video.js yang di-inject ke setiap webview (tombol di browser built-in) dan extension MDM yang dimuat ke session browser.

### 2. Injeksi tombol kini diulang otomatis bila gagal
- Setiap tab kini memverifikasi 2,5 detik setelah halaman siap: bila shim belum hidup, injeksi diulang otomatis. Injeksi bersifat idempotent (video.js langsung berhenti bila tombol masih hidup), jadi pengulangan aman — tombol kini tahan banting di halaman berat/SPA.

## ✅ Kualitas
- Self-test `KLIP_TABTEST` + `TABTEST2` + `MDMBTN` lulus ({"shim":true,"ipc":true,"alive":true,"btn":true}) dan **tidak ada lagi error TrustedHTML di www.youtube.com**.
- Perubahan hanya menyentuh jalur tombol MDM (patch video.js di main.js + retry injeksi di app.js) — fitur lain tidak disentuh.

## 📦 Instalasi
1. **Installer**: unduh **Zac-Downloader-Setup-1.6.3.exe** → jalankan → ikuti wizard (upgrade langsung di atas v1.6.x; shortcut desktop & Start Menu dibuat otomatis).
2. **Portable** (tanpa install): unduh **Zac-Downloader-1.6.3-portable-win64.zip** → extract → jalankan `Zac Downloader.exe` — bisa diletakkan di folder mana pun.
3. SmartScreen: **More info → Run anyway**.

## ⚖️ Lisensi & Kredit
- Zac Downloader: MIT © 2026 zacrie85 — basis [Klip Downloader](https://github.com/zacrie85/klip-downloader)
- Bundel MDM + extension-nya: GPL-3.0 © [Ahmed Nefzaoui](https://github.com/anefzaoui/misterdownloadmanager) — paket gabungan untuk pemakaian pribadi; bila disebarluaskan, source wajib ikut dibuka
- scrcpy-server/scrcpy.exe/adb: Apache-2.0 © [Genymobile](https://github.com/Genymobile/scrcpy)
- yt-dlp: Unlicense · FFmpeg: build GyanD · node.exe: MIT
- 100% lokal: tanpa server, tanpa akun, tanpa telemetri

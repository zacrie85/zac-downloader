# 🔧 Zac Downloader v1.6.7 — Mirror tahan server "bisu" (socket kontrol)

Pembaruan dari [v1.6.6](https://github.com/zacrie85/zac-downloader/releases/tag/v1.6.6): perbaikan error **"device tidak merespons (control)"** — kemajuan besar karena **video & audio sudah sukses tersambung**; yang menggantung hanyalah handshake socket kontrol.

## ✨ Apa yang diperbaiki

### 1. FIX: "device tidak merespons (control)"
- **Gejala**: server scrcpy di HP menerima koneksi video dan audio, tetapi tidak pernah mengirim byte sambutan di socket kontrol — server HIDUP dan hening (tanpa error stderr). Akhirnya aplikasi timeout di tahap kontrol padahal layar sudah siap.
- **Perbaikan**: socket kontrol kini **cukup TCP-connect tanpa menunggu byte** — pesan kendali (sentuhan/keyboard) mengantre di kernel sampai server benar-benar accept. Mirror tidak lagi gagal di tahap ini, apa pun perilaku fork server-nya.

### 2. Watchdog: layar kosong kini ada penjelasannya
- Bila server hidup tapi **tidak mengirim satu byte gambar pun dalam 25 detik** (server menggantung saat init encoder/audio — sering di MIUI), tab Android menampilkan peringatan: *"Server HP tidak mengirim gambar — tunggu ±10 detik; bila tetap kosong, tekan Pindai Ulang lalu Mulai Mirror lagi"* — bukan lagi layar kosong tanpa petunjuk.

### 3. Diagnostik logcat di pesan error
- Saat start gagal, aplikasi mengambil jejak terakhir dari **logcat HP** (AndroidRuntime, Permission Denial, MediaCodec, AudioFlinger, dll.) dan menyertakan cuplikannya di pesan error. Server yang menggantung tidak menulis stderr apa pun — logcat adalah satu-satunya jejak.

### 4. Lain-lain
- Deadline audio 8→15 detik; pesan error kini memuat serial device.
- STARTTEST bertambah **3 kasus baru**: kontrol bisu (lanjut tanpa dummy), server 2-socket (self-heal via retry tanpa audio), watchdog stall — total **6/6 lulus**. TABTEST/MDMBTN + MIRRORTEST tetap hijau.

## 📦 Instalasi
1. **Installer**: unduh **Zac-Downloader-Setup-1.6.7.exe** → jalankan (upgrade di atas v1.6.x).
2. **Portable**: unduh **Zac-Downloader-1.6.7-portable-win64.zip** → extract → jalankan `Zac Downloader.exe`.
3. SmartScreen: **More info → Run anyway**.

## 💡 Pengingat untuk Xiaomi/Redmi/POCO
- Aktifkan **USB Debugging** ✅ dan (untuk kendali sentuhan) **USB debugging (Setelan pengaman)** ✅ di Opsi Pengembang.
- Popup "Izinkan debugging USB?" → **Izinkan** (centang *Selalu izinkan dari komputer ini*).
- Audio HP → PC butuh Android 11+; di Android ≤10 mirror jalan video saja (otomatis).

## ⚖️ Lisensi & Kredit
- Zac Downloader: MIT © 2026 zacrie85 — basis [Klip Downloader](https://github.com/zacrie85/klip-downloader)
- Bundel MDM + extension-nya: GPL-3.0 © [Ahmed Nefzaoui](https://github.com/anefzaoui/misterdownloadmanager) — paket gabungan untuk pemakaian pribadi; bila disebarluaskan, source wajib ikut dibuka
- scrcpy-server/scrcpy.exe/adb: Apache-2.0 © [Genymobile](https://github.com/Genymobile/scrcpy)
- yt-dlp: Unlicense · FFmpeg: build GyanD (dipin 7.1.1) · node.exe: MIT
- 100% lokal: tanpa server, tanpa akun, tanpa telemetri

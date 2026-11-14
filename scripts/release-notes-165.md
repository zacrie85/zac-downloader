# 🔧 Zac Downloader v1.6.5 — Mirror stabil di Xiaomi/MIUI & HP dengan ROM ketat

Pembaruan dari [v1.6.4](https://github.com/zacrie85/zac-downloader/releases/tag/v1.6.4): perbaikan error **"server di HP gagal (video): android.database.DatabaseUtils.readExceptionFromParcel → RemoteException: Remote stack trace"** saat Mulai Mirror di Xiaomi/Redmi/POCO.

## ✨ Apa yang diperbaiki

### 1. Akar masalah di Xiaomi/MIUI: server scrcpy menyentuh Settings.Global
- **Penyebab**: saat server scrcpy start di HP, jalur `cleanup`/`stay_awake` membaca-menulis **setting global `stay_on_while_plugged_in`** lewat content provider Settings. **MIUI memblokir akses provider Settings ini dari shell (adb)** → server langsung mati sebelum layar mirror terbentuk → pesan `DatabaseUtils.readExceptionFromParcel → RemoteException: Remote stack trace`.
- **Perbaikan**: aplikasi kini mengirim **`cleanup=false`** + **`stay_awake=false`** ke server scrcpy — server tidak menyentuh Settings sama sekali saat start.
- Fitur **"Layar HP tetap menyala"** tidak hilang: kini lewat **`svc power stayon true`** (PowerManagerService — bukan Settings provider, aman di semua ROM termasuk MIUI), dan otomatis dipulihkan (`svc power stayon false`) saat mirror dihentikan.

### 2. Gagal cepat + diagnosa penuh
- Bila server di HP mati saat start, aplikasi **tidak lagi menunggu timeout penuh** — gagal cepat dan menampilkan **6 baris terakhir stderr HP apa adanya** (termasuk stack trace-nya), supaya penyebab berikutnya (kalau ada) langsung terlihat.

### 3. Deteksi Xiaomi/Redmi/POCO
- Bila brand HP terdeteksi MIUI, aplikasi menampilkan saran di log: aktifkan juga **"USB debugging (Setelan pengaman)"** di Opsi Pengembang — di MIUI, **injeksi sentuhan** (kendali dari PC) dibatasi tanpa opsi itu. Mirror video tetap jalan tanpa opsi tersebut.

## ✅ Tetap berlaku dari v1.6.4
- `audio=auto` + fallback otomatis tanpa audio (HP Android ≤10).
- Cek state HP per-serial (unauthorized/offline) + badge ⚠️ **Izinkan di HP**.
- Timeout koneksi video 25 detik.

## 📦 Instalasi
1. **Installer**: unduh **Zac-Downloader-Setup-1.6.5.exe** → jalankan → ikuti wizard (upgrade di atas v1.6.x).
2. **Portable** (tanpa install): unduh **Zac-Downloader-1.6.5-portable-win64.zip** → extract → jalankan `Zac Downloader.exe`.
3. SmartScreen: **More info → Run anyway**.

## 💡 Tips khusus Xiaomi/Redmi/POCO
1. Opsi Pengembang → aktifkan **USB Debugging** ✅ dan **USB debugging (Setelan pengaman)** ✅ (yang kedua khusus untuk kendali sentuhan; butuh akun Mi aktif di HP).
2. Popup "Izinkan debugging USB?" → **Izinkan** (centang *Selalu izinkan dari komputer ini*).
3. Masih gagal? Salin isi pesan error baru di banner — sekarang berisi stack trace asli dari HP — dan laporkan; diagnosa jadi jauh lebih cepat.

## ⚖️ Lisensi & Kredit
- Zac Downloader: MIT © 2026 zacrie85 — basis [Klip Downloader](https://github.com/zacrie85/klip-downloader)
- Bundel MDM + extension-nya: GPL-3.0 © [Ahmed Nefzaoui](https://github.com/anefzaoui/misterdownloadmanager) — paket gabungan untuk pemakaian pribadi; bila disebarluaskan, source wajib ikut dibuka
- scrcpy-server/scrcpy.exe/adb: Apache-2.0 © [Genymobile](https://github.com/Genymobile/scrcpy)
- yt-dlp: Unlicense · FFmpeg: build GyanD · node.exe: MIT
- 100% lokal: tanpa server, tanpa akun, tanpa telemetri

# 🚑 Zac Downloader v1.6.6 — HOTFIX Mirror (TDZ crash dari v1.6.5)

**v1.6.5 gagal memulai mirror di SEMUA HP** dengan pesan `Cannot access 'o' before initialization` — bug deklarasi variabel (TDZ) di jalur mirror yang lolos dari tes lama. v1.6.6 memperbaikinya, dan menambah **STARTTEST** supaya kelas bug ini tidak bisa lolos lagi.

## ✨ Isi perbaikan

### 1. FIX: "Cannot access 'o' before initialization" saat Mulai Mirror
- Penyebab: di v1.6.5, blok deteksi brand + svc power memakai variabel `o` **sebelum** baris deklarasinya (`const o = this.opts`) → `ReferenceError` begitu tombol **Mulai Mirror** ditekan, untuk semua HP dan semua kondisi.
- Perbaikan: deklarasi dipindah ke awal `start()`. Perilaku v1.6.5 lainnya (cleanup=false, svc power stayon, audio=auto, fail-fast, stderr penuh) tidak berubah dan kini terverifikasi tes.

### 2. STARTTEST baru — tes start() yang sesungguhnya
- Tes lama memakai sesi simulasi yang **tidak pernah memanggil `start()`** — itulah kenapa bug v1.6.5 lolos. Tes baru (`scripts/test-start-real.js`) menjalankan start() penuh dengan **adb palsu + emulator server scrcpy** (handshake 3 socket: video → audio → control):
  - jalur sukses: nama device, audio aktif (opus), argumen server benar (`audio=auto`, `stay_awake=false`, `cleanup=false`, `max_size`), svc power jalan, deteksi brand jalan
  - jalur audio disable (HP Android ≤10) → mirror video saja
  - jalur server HP mati → **gagal cepat** (< 1 detik) dengan pesan yang memuat stderr HP
- Hasil: **STARTTEST PASS** (semua kasus), ditambah TABTEST/TABTEST2/MDMBTN dan MIRRORTEST fake device tetap lulus.

## 📦 Instalasi
1. **Installer**: unduh **Zac-Downloader-Setup-1.6.6.exe** → jalankan (upgrade di atas v1.6.x).
2. **Portable**: unduh **Zac-Downloader-1.6.6-portable-win64.zip** → extract → jalankan `Zac Downloader.exe`.
3. SmartScreen: **More info → Run anyway**.

## 💡 Pengingat untuk Xiaomi/Redmi/POCO
- Aktifkan **USB Debugging** ✅ dan (untuk kendali sentuhan) **USB debugging (Setelan pengaman)** ✅ di Opsi Pengembang.
- Popup "Izinkan debugging USB?" → **Izinkan** (centang *Selalu izinkan dari komputer ini*).
- Audio HP → PC butuh Android 11+; di Android ≤10 mirror jalan video saja (otomatis).

## ⚖️ Lisensi & Kredit
- Zac Downloader: MIT © 2026 zacrie85 — basis [Klip Downloader](https://github.com/zacrie85/klip-downloader)
- Bundel MDM + extension-nya: GPL-3.0 © [Ahmed Nefzaoui](https://github.com/anefzaoui/misterdownloadmanager) — paket gabungan untuk pemakaian pribadi; bila disebarluaskan, source wajib ikut dibuka
- scrcpy-server/scrcpy.exe/adb: Apache-2.0 © [Genymobile](https://github.com/Genymobile/scrcpy)
- yt-dlp: Unlicense · FFmpeg: build GyanD · node.exe: MIT
- 100% lokal: tanpa server, tanpa akun, tanpa telemetri

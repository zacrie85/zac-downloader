# 🔧 Zac Downloader v1.6.4 — Mirror Android stabil di HP lama (audio otomatis)

Pembaruan dari [v1.6.3](https://github.com/zacrie85/zac-downloader/releases/tag/v1.6.3): perbaikan **"device tidak merespons"** saat Mulai Mirror — padahal USB debugging & izin di HP sudah benar.

## ✨ Apa yang diperbaiki

### 1. Akar masalah "device tidak merespons": audio di HP Android ≤10
- **Penyebab**: saat **Mulai Mirror** ditekan dengan opsi **Audio HP → PC** aktif, aplikasi meminta server scrcpy di HP mengaktifkan audio. **Capture audio scrcpy hanya didukung Android 11+** — di HP Android 10 ke bawah (mis. **Oukitel K15 Plus**) server langsung mati saat inisialisasi audio → socket video tidak pernah dibuka → timeout 15 detik → pesan "device tidak merespons". USB debugging, izin, dan kabel semuanya tidak bermasalah — hanya audionya.
- **Perbaikan**: aplikasi kini memakai **`audio=auto`** — HP yang tidak mendukung mengirim kode "audio disabled" dan mirror langsung jalan **video saja**. Sebagai pengaman ekstra, bila percobaan pertama tetap gagal, aplikasi **otomatis mencoba sekali lagi tanpa audio** dan memberi tahu bahwa HP ini tidak mendukung audio scrcpy.
- Audio HP → PC tetap aktif otomatis di HP Android 11+.

### 2. Pesan error kini menjelaskan penyebab sebenarnya
- Pesan timeout kini menyertakan **error asli dari server di HP** (stderr), mis. masalah parameter atau izin — bukan sekadar "tidak merespons".
- Sebelum memulai, state HP dicek **per-serial**: **unauthorized** → "HP belum mengizinkan debugging USB — tap Izinkan di HP"; **offline** → "cabut & pasang kabel USB".

### 3. Daftar device state-aware
- HP yang belum dikonfirmasi izinnya kini **tetap muncul** di daftar dengan badge ⚠️ **Izinkan di HP**; device offline juga terlihat jelas.

### 4. Timeout lebih longgar
- Koneksi video 15 → **25 detik** — HP kelas entry yang lambat pun kejar.

## ✅ Kualitas
- MIRRORTEST (fake device: handshake 3 socket, stream meta, decode video+audio, 8 pesan kontrol) & TABTEST/MDMBTN tetap lulus.
- Perubahan hanya menyentuh jalur mirror (lib/mirror.js, renderer/android.js/html) — fitur lain tidak disentuh.

## 📦 Instalasi
1. **Installer**: unduh **Zac-Downloader-Setup-1.6.4.exe** → jalankan → ikuti wizard (upgrade langsung di atas v1.6.x).
2. **Portable** (tanpa install): unduh **Zac-Downloader-1.6.4-portable-win64.zip** → extract → jalankan `Zac Downloader.exe`.
3. SmartScreen: **More info → Run anyway**.

## 💡 Tips mirror
- **Audio HP → PC** butuh Android 11+. Di Android ≤10, v1.6.4 mengatur otomatis (video saja). Ingin audio juga? Gunakan tombol **"Atau buka jendela scrcpy (audio)"** di tab Android.
- Masih gagal? Coba: kabel USB lain / port USB lain, lepas-lpas kabel, lalu **Pindai Ulang Device**. Pastikan popup "Izinkan debugging USB" di HP dijawab **Izinkan** (centang *Selalu izinkan dari komputer ini*).

## ⚖️ Lisensi & Kredit
- Zac Downloader: MIT © 2026 zacrie85 — basis [Klip Downloader](https://github.com/zacrie85/klip-downloader)
- Bundel MDM + extension-nya: GPL-3.0 © [Ahmed Nefzaoui](https://github.com/anefzaoui/misterdownloadmanager) — paket gabungan untuk pemakaian pribadi; bila disebarluaskan, source wajib ikut dibuka
- scrcpy-server/scrcpy.exe/adb: Apache-2.0 © [Genymobile](https://github.com/Genymobile/scrcpy)
- yt-dlp: Unlicense · FFmpeg: build GyanD · node.exe: MIT
- 100% lokal: tanpa server, tanpa akun, tanpa telemetri

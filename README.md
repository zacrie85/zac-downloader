# 🎬 Zac Downloader

**Downloader video + browser built-in multi-tab + MDM dibundel — 100% lokal, gratis, tanpa batas.**

![Version](https://img.shields.io/badge/version-1.6.4-green) ![Platform](https://img.shields.io/badge/platform-Windows%20x64-blue)

> **Fork independen dari [Klip Downloader](https://github.com/zacrie85/klip-downloader) (MIT, © 2026 zacrie85)** — bisa dipasang berdampingan dengan Klip Downloader tanpa saling menimpa (appId, folder instalasi, shortcut, dan folder data semua berbeda).

Zac Downloader adalah aplikasi Windows untuk **mengunduh video** dari YouTube, TikTok, Instagram, Facebook, X/Twitter, Vimeo, Google Drive, Dailymotion, **BiliBili TV, Vidio, Dramaharian, FlickReels, Shortical, GoodShort**, dan **1000+ situs lain** — dilengkapi **browser built-in multi-tab** sehingga kamu bisa browsing, menonton, dan langsung mengunduh dalam satu aplikasi. Plus **Mister Download Manager (MDM) dibundel** untuk file umum, torrent & magnet link.

---

## ✨ Fitur

| Fitur | Keterangan |
|---|---|
| 🤖 **TAB ANDROID — MIRROR & KENDALI HP** | **v1.6.2** — sambungkan HP Android via **USB** → layar HP tampil & bisa dikendalikan langsung di tab **🤖 Android** aplikasi (teknologi **scrcpy v5.0.1 resmi**, **tanpa emulator**). Cocok untuk SnackVideo dari HP aslimu: login & OTP tetap di HP, layar & suara tampil di PC. Ada tombol layar-mati 🌙 (HP bisa "istirahat" sambil mirror tetap jalan), navigasi Android, audio HP→PC, clipboard, dan opsi jendela scrcpy asli. |
| 🔄 **SESSION RESTORE** | **v1.6.2** — semua tab (browser multi-tab dengan URL masing-masing, tab Android, sumber video, dll.) otomatis **dikembalikan persis** saat aplikasi dibuka lagi setelah ditutup — tidak ada tab yang hilang. |
| 🎯 **TOMBOL "DOWNLOAD VIDEO" MDM DI BROWSER** | **v1.6.1** — gerakkan kursor ke atas video di browser aplikasi → tombol **"Download video"** MDM muncul → klik → video masuk ke **Mister Download Manager** (cookies login & referer ikut dibawa). Menu tombol: unduh, buka di aplikasi, sembunyikan di situs ini, buka opsi MDM. UI tombol berbahasa Indonesia. |
| 🗂 **BROWSER MULTI-TAB** | **v1.6.0** — browser built-in kini punya **tab bar**: tombol **＋** / **Ctrl+T** tab baru, **Ctrl+W** tutup tab, klik tengah pada tab untuk menutup. Link `target=_blank`, **Ctrl+klik** atau **klik tengah** pada link → otomatis **tab baru**. Klik kanan di halaman → menu *Buka link di tab baru*, *Salin alamat link*, Kembali/Maju/Muat ulang. |
| ⚡ **MDM DIBUNDEL** | **v1.6.0** — **Mister Download Manager v0.5.2** (open-source GPL-3.0, Rust) ikut dipaketkan di folder `bin/mdm`. Klik **⚡ Buka MDM** di menu kiri → MDM terbuka di jendela terpisah untuk download file umum, **torrent & magnet link** (5× lebih cepat dari IDM menurut pengembangnya, tanpa iklan). |
| 🎯 **MEDIA CAPTURE — SITUS DRAMA** | **v1.3.0** — buka episode di **FlickReels / Shortical / GoodShort** di browser aplikasi, tekan **Play** → video terdeteksi otomatis (chip hijau 🎯) → klik → download. Bekerja juga untuk situs apa pun yang video-nya dinamis! |
| ✂️ **URL Episode Langsung** | **v1.3.0** — link episode FlickReels (dan kebanyakan situs) bisa langsung ditempel & diunduh tanpa buka browser. |
| 📺 **BILIBILI TV (SHORT DRAMA)** | **v1.4.0** — tempel URL episode `bilibili.tv/id/play/{drama}/{ep}` atau URL dramanya `bilibili.tv/id/play/{drama}` → **seluruh episode otomatis masuk antrean paralel** (contoh: 1 drama = 72 episode). Juga mendukung `bilibili.tv/id/video/{id}`. Deteksi otomatis saat browsing di browser aplikasi. |
| 🎭 **DRAMAHARIAN (SHORT DRAMA)** | **v1.5.0** — tempel URL drama `dramaharian.com/drama/{provider}/{id}` → **semua episode gratis otomatis masuk antrean paralel** dengan nama file rapi (`Judul Drama - EP 1.mp4`, dst). Mendukung semua provider (dramabite, dramawave, flextv, flickreels, freereels, dll). URL episode tunggal `/tonton/…` juga didukung. |
| 🎬 **GOODSHORT (SHORT DRAMA)** | **v1.5.1 · diperbaiki v1.5.2** — buka episode `goodshort.com/episode/…` di browser aplikasi → link video otomatis siap (chip 📺) → klik → unduh dengan nama file unik per episode (`Judul - EP 2.mp4`, dst). Halaman drama → semua episode gratis masuk antrean paralel. |
| 📺 **VIDIO.COM** | **v1.5.0 · diperbaiki v1.5.1** — buka videonya di browser aplikasi → link stream disiapkan otomatis (chip 📺) → klik → unduh. Series `premier/…` otomatis. Premium: login di browser aplikasi (non-DRM). |
| 🖥 **Layout Baru 30/70** | Kolom kiri 30% berisi semua menu (berurutan atas–bawah), kolom kanan 70% penuh untuk browser. |
| 🌐 **Browser Built-in** | Buka YouTube / situs mana pun langsung dari aplikasi. Tonton video di dalam aplikasi. |
| 🎯 **Deteksi Otomatis URL** | Saat membuka halaman video (YouTube, TikTok, dll.), URL otomatis terisi ke menu Sumber Video. |
| 📥 **Download Sekali Klik** | Tempel URL → klik Video atau MP3. Selesai. |
| ⚡ **DOWNLOAD PARALEL** | Hingga **5 video bersamaan** — download pertama jalan, video berikutnya tetap bisa langsung diunduh. |
| 🎵 **Mode MP3** | Audio saja, kualitas terbaik + cover art otomatis tertanam. Hemat kuota! |
| 📜 **Dukungan Playlist** | Tempel link playlist/channel YouTube → semua video otomatis masuk antrean. |
| 🖼 **Thumbnail** | Gambar cover video (JPG) ikut disimpan (bisa dimatikan). |
| 📁 **Pilih Folder Simpan** | Bebas tentukan lokasi hasil download — tersimpan permanen. |
| ⚙️ **Pilihan Kualitas** | Terbaik (otomatis), ≤1080p, ≤720p, ≤480p, ≤360p. |
| 📊 **Progress Real-time** | Bar progress per-download, kecepatan, ETA, tombol batal per-item. |
| 🛠 **Update Engine 1-Klik** | Update yt-dlp ke versi terbaru langsung dari aplikasi. |
| 🔒 **100% Lokal** | Tanpa server, tanpa akun, tanpa telemetri. Semua proses di komputarmu. |

## 📦 Instalasi

1. Unduh **installer** (`Zac-Downloader-Setup-*.exe`) atau **portable zip** (`Zac-Downloader-*-portable-win64.zip` — extract lalu jalankan `Zac Downloader.exe`) terbaru dari [halaman Releases](../../releases).
2. Jika Windows SmartScreen muncul (karena aplikasi belum ditandatangani), klik **More info → Run anyway**.
3. Ikuti wizard instalasi, selesai!

> **Coexist dengan Klip Downloader**: Zac Downloader dipasang ke `%LOCALAPPDATA%\Programs\Zac Downloader` dengan shortcut sendiri — aplikasi Klip Downloader yang sudah terpasang TIDAK tersentuh sama sekali.

## 🚀 Cara Pakai

### Tata Letak (v1.2.0)
- **Kiri (30%)** — semua menu berurutan dari atas ke bawah: Sumber Video (URL, Video/MP3, kualitas, paralel, thumbnail, folder), progress download, dan Hasil Download.
- **Kanan (70%)** — browser built-in layar penuh untuk browsing & menonton.

### Cara 1 — Lewat Browser Built-in
1. Di panel **browser (kanan)**, buka situs video (default: YouTube) atau ketik alamat di address bar.
2. Tonton / cari video yang kamu mau.
3. Saat membuka halaman video, URL **otomatis terisi** ke menu **📥 Sumber Video** (kiri) — tinggal klik **⬇ Video** atau **🎵 MP3**.
4. Bisa juga klik **⬇ Gunakan URL Halaman Ini untuk Download** kapan saja.

### Cara 2 — Tempel URL
1. Salin link video dari browser/apapun.
2. Klik **📋 Tempel** (atau tempel manual) di panel **📥 Sumber Video** (kiri).
3. Pilih mode: **⬇ Video** (MP4) atau **🎵 MP3** (audio saja) → klik.

### ⚡ Download Paralel
Di baris pengaturan pilih **Paralel: 1–5** — jumlah video yang diunduh bersamaan. Setiap download punya bar progress + tombol batal sendiri.

### 📜 Playlist
Tempel link playlist (`youtube.com/playlist?list=…`) atau channel (`youtube.com/@nama/videos`) → semua video otomatis masuk antrean dan diunduh paralel (maks 200 item).

### 📺 BiliBili TV (Short Drama) — v1.4.0
1. Buka `bilibili.tv/id/short-drama` di browser aplikasi atau salin URL dramanya.
2. Tempel **URL drama** (`bilibili.tv/id/play/2130147`) → semua episode (bisa puluhan) otomatis masuk antrean paralel; atau tempel **URL satu episode** (`bilibili.tv/id/play/2130147/13810256`) untuk download episode itu saja.
3. Klik **⬇ Video** — selesai! Konten VIP/berbayar tetap hanya bisa diakses sesuai akunmu.

### 🎭 Dramaharian (Short Drama) — v1.5.0
1. Buka `dramaharian.com` di browser aplikasi, pilih drama yang kamu mau.
2. Salin URL dramanya (`dramaharian.com/drama/dramabite/10297`) → tempel di Sumber Video → klik **⬇ Video**.
3. **Semua episode gratis** otomatis dibaca lewat API situs lalu masuk antrean paralel — episode berbayar/terkunci dilewati otomatis. Nama file: `Judul Drama - EP 1.mp4`, `Judul Drama - EP 2.mp4`, dst.
4. Mau 1 episode saja? Buka episode-nya, salin URL `/tonton/{provider}/{id}/{ep}` lalu tempel.

### 📺 Vidio.com — v1.5.0
1. Tempel URL video (`vidio.com/watch/{id}-{slug}` atau `embed/…`) → klik **⬇ Video**. Konten gratis langsung terunduh.
2. **Konten premium / berlangganan**: buka `vidio.com` di **browser aplikasi** → **login** ke akun Vidio-mu → salin URL videonya → download. Cookie login dipakai otomatis oleh engine (tersimpan lokal di komputarmu).
3. **Series (`vidio.com/premier/…`)** → seluruh episode otomatis masuk antrean paralel.
4. **Live TV**: tonton dulu di browser aplikasi → bila yt-dlp gagal, tekan Play lalu pakai chip 🎯 "Video terdeteksi" di menu kiri.

### 🤖 Tab Android (Mirror HP) — v1.6.2
1. Sambungkan HP Android ke PC via **USB**. Di HP: buka **Setelan → Tentang telepon** → tap 7× **Nomor build** hingga muncul "Anda sekarang pengembang", lalu di **Setelan → Opsi pengembang** aktifkan **USB Debugging**.
2. Di aplikasi, klik **🤖 Android** di menu kiri → **[▶ Mulai Mirror]** → centang **"Selalu izinkan dari komputer ini"** pada dialog *Izinkan debugging USB?* di HP → **Izinkan**.
3. Layar HP tampil di tab — kendalikan dengan mouse (sentuh/geser) & keyboard (ketik). Tombol: **layar mati 🌙**, navigasi Android (◀ ▶ ⭕), **audio HP→PC**, clipboard, dan **buka jendela scrcpy asli**.
4. Akhiri dengan tombol **■ Berhenti** sebelum mencabut kabel USB.

### 💡 Tips YouTube
Bila YouTube menampilkan *"Sign in to confirm you're not a bot"* saat download: **login dulu ke YouTube lewat browser built-in** di aplikasi, lalu coba download lagi. Cookie login dipakai otomatis oleh engine dan tersimpan hanya di komputarmu.

## 📁 Lokasi Hasil Download

Default: `C:\Users\<nama>\Videos\Klip Downloader`. Ingin ganti? Klik **Pilih Folder** — pilihan tersimpan permanen. Buka cepat lewat tombol **Buka Folder**.

## 🛠 Update Engine

Situs video sering berubah — jika download tiba-tiba gagal, klik **🛠 Update Engine** untuk memperbarui yt-dlp ke versi terbaru, lalu restart aplikasi.

## 🧑‍💻 Build dari Source

```bash
npm install
# butuh file binari di folder bin/: yt-dlp.exe, ffmpeg.exe, ffprobe.exe, node.exe
bash scripts/download-binaries.sh   # unduh otomatis semua binari
npm run build:win                   # NODE_OPTIONS patch otomatis dipakai
```

Build Windows di Linux butuh: `NODE_OPTIONS="--require ./scripts/patch-macos-check.js" npx electron-builder --win` (script `build:win` sudah mengaturnya).

## ⚖️ Catatan

- Gunakan hanya untuk konten yang kamu punya izin untuk mengunduh.
- Aplikasi ini tidak berafiliasi dengan YouTube, TikTok, Instagram, Facebook, BiliBili, Vidio, Dramaharian, atau platform lainnya.

## 📄 Lisensi

MIT © 2026 [zacrie85](https://github.com/zacrie85)

Bundel **Mister Download Manager v0.5.2** di `bin/mdm/` berlisensi **GPL-3.0** © Ahmed Nefzaoui — [source code resmi](https://github.com/anefzaoui/misterdownloadmanager).

## 🗒 Changelog

### v1.6.4 — Mirror Android stabil di HP lama (audio otomatis)
- **FIX "device tidak merespons" saat Mulai Mirror di HP Android ≤10**: akar masalahnya opsi **Audio HP → PC** — capture audio scrcpy hanya didukung **Android 11+**; di Android 10 ke bawah (mis. Oukitel K15 Plus) server scrcpy mati saat init audio → socket video tak pernah dibuka → timeout, padahal USB debugging & izin sudah benar. Kini aplikasi memakai **`audio=auto`** (HP tak mendukung → server kirim kode disable, mirror jalan video saja) + **fallback otomatis tanpa audio** bila percobaan pertama gagal.
- **Pesan error kini menjelaskan penyebab asli**: error dari server di HP (stderr) disertakan dalam pesan; sebelum mulai, state HP dicek per-serial — **unauthorized** → "tap Izinkan di HP", **offline** → "cabut-pasang kabel".
- **Daftar device state-aware**: HP yang belum dikonfirmasi izinnya diberi badge ⚠️ **Izinkan di HP**; device offline juga terlihat.
- Timeout koneksi video 15 → **25 detik** (HP lambat pun kejar).

### v1.6.3 — Tombol "Download video" MDM stabil di semua situs
- **FIX tombol MDM hilang di situs ber-Trusted Types (YouTube, Google, dll.)**: penulisan HTML tombol lewat `shadow.innerHTML` diblokir kebijakan Trusted Types CSP (bahkan `DOMParser` ikut diblokir di YouTube) → script tombol mati total → tombol tidak pernah muncul. Kini struktur HTML tombol dibangun **eksplisit via `createElement`/`appendChild`** (builder DOM, 100% bebas sink Trusted Types) — tombol kini hidup juga di **www.youtube.com** (halaman home aplikasi), pelanggaran TrustedHTML 2 → **0**.
- **Injeksi ulang otomatis**: tiap tab memverifikasi 2,5 detik setelah halaman siap — bila shim belum hidup, injeksi diulang. Injeksi idempotent (video.js early-return saat tombol masih alive), jadi aman dijalankan berulang.
- Patch diterapkan di **dua jalur** sekaligus: shim video.js per-webview (browser built-in) dan extension MDM di session browser.
- Test: `KLIP_TABTEST`/`TABTEST2`/`MDMBTN` lulus + **tanpa error TrustedHTML** di www.youtube.com.

### v1.6.2 — Tab Android (Mirror HP) + Session Restore
- **🤖 TAB ANDROID — MIRROR & KENDALI HP TANPA EMULATOR**: teknologi **scrcpy v5.0.1 resmi** diimplementasikan langsung di dalam aplikasi (server + protokol kontrol asli, decode video H.264 & audio Opus lewat WebCodecs):
  - Sambungkan HP Android via **USB** → klik **🤖 Android** di menu kiri → **[▶ Mulai Mirror]** → layar HP tampil & dikendalikan langsung di tab aplikasi (server HTTP+WebSocket lokal di main process, renderer menggambar frame ke canvas).
  - **Tanpa emulator** — SnackVideo & aplikasi lain berjalan di **HP aslimu**: login, OTP, dan device tetap asli.
  - **Layar mati 🌙** — layar HP dimatikan sementara mirror & input tetap berjalan.
  - **Audio HP → PC**, **clipboard** dua arah, tombol navigasi Android, dan opsi **jendela scrcpy asli** (`--window-*` lengkap).
- **🔄 SESSION RESTORE**: posisi semua tab (browser multi-tab + URL per-tab, tab Android, URL sumber video, dst.) otomatis disimpan dan **dikembalikan persis** saat aplikasi dibuka lagi.
- **Binari scrcpy dibundel & ter-track di repo** (`bin/scrcpy/`: scrcpy v5.0.1, adb, scrcpy-server, SDL3 + codec DLL).
- Test: `SESSTEST` (restore 2 fase), `MIRRORTEST` (protokol scrcpy end-to-end: handshake → video frame → audio → 8 pesan kontrol), `TABTEST`/`MDMBTN` regresi v1.6.1 — semua lulus.

### v1.6.1 — Tombol "Download video" MDM di dalam browser
- **Extension resmi MDM kini aktif di browser built-in**: extension Chromium MDM v0.5.2 dimuat ke session browser, dan **video.js** (penanda tombol "Download video" MDM) di-inject ke setiap tab — gerakkan kursor ke atas video → tombol muncul → klik → download masuk ke **MDM** (video, torrent & magnet).
- **Jembatan native messaging**: Electron tidak mendukung `chrome.runtime.sendNativeMessage`. Solusi: background extension dipatch saat startup — pesan diteruskan lewat **IPC bebas CSP** (fallback: HTTP lokal) ke main process, lalu main mengoper ke **misterdownloadmanager-nmhost.exe** memakai protokol native messaging resmi (framing 4-byte + JSON). nmhost **otomatis menjalankan MDM** bila belum jalan.
- **Cookies & referer dibawa**: session browser aplikasi dikirim ke MDM bersama URL video (login/consent ikut) — perilaku sama seperti di Chrome.
- Tombol tetap berfungsi walau window di-throttle (hybrid rAF), UI tombol memakai locale **Indonesia**, dan situs yang disembunyikan user dihormati.
- Test: self-test end-to-end `KLIP_TABTEST` — tombol ter-mount di halaman uji (`MDMBTN {"btn":true}`), panel request terkirim, regresi multi-tab v1.6.0 tetap lulus.

### v1.6.0 (rilis perdana Zac Downloader — fork dari Klip Downloader v1.5.3)
- **BROWSER MULTI-TAB**: browser built-in dilengkapi tab bar.
  - Tab baru: tombol **＋** atau **Ctrl+T**; tutup tab: tombol ✕, **Ctrl+W**, atau klik tengah pada tab.
  - Link `target=_blank`, **Ctrl+klik**, dan **klik tengah** pada link kini membuka **tab baru** di dalam aplikasi (dulu: halaman dimuat menimpa tab aktif).
  - **Menu klik-kanan** di halaman: *Buka link di tab baru*, *Salin alamat link*, *Buka gambar di tab baru*, Kembali, Maju, Muat ulang.
  - Halaman start tab baru (`newtab.html`) berisi petunjuk pintasan; address bar & deteksi video otomatis mengikuti tab aktif.
- **MDM (Mister Download Manager) DIBUNDEL**: MDM portable **v0.5.2** ikut dipaketkan di `bin/mdm/` (SHA256 diverifikasi terhadap `SHA256SUMS.txt` resmi rilis v0.5.2).
  - Tombol **⚡ Buka MDM** di menu kiri menjalankan MDM sebagai aplikasi terpisah (tetap hidup walau Zac Downloader ditutup).
  - MDM menambah kemampuan download file umum + **torrent & magnet link** yang tidak ada di yt-dlp.
- **REBRANDING INDEPENDEN**: appId `io.github.zacrie85.zacdownloader`, folder instalasi `Programs\Zac Downloader`, shortcut "Zac Downloader", folder data `%APPDATA%\Zac Downloader`, folder hasil download default `Videos\Zac Downloader` — semuanya terpisah dari Klip Downloader.

### v1.5.3
- **FIX BiliBili TV — "ERROR: Postprocessing: Error opening output files: Invalid argument"** (video terunduh tapi gagal saat digabung):
  - **ffmpeg dipindah ke rilis STABIL 9.0.2** (GyanD codexffmpeg) — sebelumnya memakai build *master nightly* BtbN yang bisa mengandung regresi; binary sempat tertukar saat refresh v1.5.1. Merge DASH BiliBili (audio+video terpisah) kini memakai ffmpeg stabil.
  - **Retry otomatis**: bila postprocessing gagal, unduhan otomatis dicoba ulang SEKALI dalam mode *slim* (tanpa metadata & thumbnail) agar langkah ffmpeg opsional tidak mengganggu merge wajib.
  - Toast panduan khusus kegagalan postprocessing (saran folder simpan sederhana, tutup player, coba 480P).
- Test: `scripts/test_v153.js` (4 pass, fake engine end-to-end) + regresi penuh lulus (v152: 16, v151: 17, v15: 31, v14, v13: 31, downloader).

### v1.5.2
- **FIX GoodShort — nama file saling menimpa**: sebelumnya SEMUA episode tunggal dinamai `Judul - EP 1` (nomor episode di-hardcode), sehingga mengunduh episode ke-2 menimpa file episode pertama.
  - Nomor episode kini diambil dari slug URL situs: `…/episode/judul-drama-123/002-69606229` → **EP 2**, `013-…` → **EP 13** (pola `NNN-chapterId` resmi situs).
  - Fallback ke field nomor episode API bila slug tidak numerik; terakhir → EP 1.
  - Chip 📺 kini menampilkan **nama file persis** yang akan dihasilkan (mis. `Judul - EP 2`).
- **Anti-timpa ekstra**: dalam satu batch, bila dua entri menghasilkan nama sama, otomatis diberi suffix `(2)`, `(3)`, dst. Download tetap memakai `--no-overwrites`.
- Test: `scripts/test_v152.js` (16 pass) — slug EP 1/2/13 nyata, fallback, dedupe; seluruh suite lama tetap lulus (v151: 17, v15: 31, v14, v13: 31, downloader).

### v1.5.1
- **FIX Vidio (vidio.com)** — video modern tidak lagi punya playlist publik (yt-dlp → `HTTP 404`) dan konten premium butuh session:
  - Baru: buka videonya di **browser aplikasi** → link stream disiapkan **otomatis** (±7 detik, lewat endpoint token resmi player Vidio dari konteks halaman) → chip 📺 **"Link video siap"** muncul → klik → langsung unduh.
  - URL `watch/{id}` tanpa slug kini juga terdeteksi.
  - Konten premium: **login vidio.com di browser aplikasi** → link premium non-DRM ikut ter-resolve otomatis. Konten DRM tetap tidak bisa diunduh.
- **FIX GoodShort (goodshort.com)** — URL episode langsung gagal (`Unsupported URL` — yt-dlp tidak mendukung & API situs dilindungi WAF):
  - Baru: buka episode di **browser aplikasi** → link video diambil otomatis dari API resmi situs (dari konteks halaman) → chip 📺 → klik → unduh.
  - Baru: buka halaman **drama** `goodshort.com/drama/…` → **semua episode gratis** otomatis masuk antrean paralel dengan nama file `Judul - EP 1.mp4`, dst.
- Nama file otomatis dari judul halaman (suffix situs dibuang otomatis).
- Link stream selalu divalidasi sebelum diunduh (playlist mati/kedaluwarsa terdeteksi).
- Test: `scripts/test_v151.js` (17 pass) — inject JS ketiga situs, deteksi URL, nama file, validasi live.

### v1.5.0
- **Dramaharian (dramaharian.com)** — download short drama lewat API resmi situs:
  - URL drama `…/drama/{provider}/{id}` → semua episode gratis otomatis masuk antrean paralel (maks 200).
  - URL episode `…/tonton/{provider}/{id}/{ep}` → download episode tunggal.
  - Nama file rapi otomatis: `Judul Drama - EP {n}.mp4`.
  - Semua provider didukung (dramabite, dramawave, flextv, flickreels, freereels, dll).
  - Episode berbayar/terkunci dilewati otomatis + info progres di log.
- **Vidio (vidio.com)** — download VOD, series, dan live TV:
  - VOD `…/watch/{id}-{slug}` & `…/embed/{id}-{slug}` via extractor Vidio yt-dlp.
  - Series `…/premier/{id}/{slug}` → seluruh episode otomatis (playlist paralel).
  - Live TV `…/live/{id}` + fallback media capture.
  - Konten premium: login vidio.com di browser built-in → cookie otomatis dipakai engine.
- Deteksi otomatis URL untuk kedua situs saat browsing di browser aplikasi.
- Panduan error khusus Vidio (login premium/live) di toast.
- Test: `scripts/test_v15.js` (31 pass) + `scripts/test_v15_e2e.js` (API live + download nyata).

### v1.4.0
- **BiliBili TV (bilibili.tv)** — download video & short drama dari bilibili.tv (semua bahasa: /id/, /en/, dll.):
  - URL drama `…/play/{drama}` → seluruh episode otomatis masuk antrean paralel (playlist).
  - URL episode `…/play/{drama}/{ep}` & video `…/video/{id}` → download tunggal.
  - Deteksi otomatis saat membuka halaman episode di browser built-in.
  - Panduan khusus di toast bila download gagal (konten VIP/region).

### v1.3.0
- Media capture dari browser built-in untuk FlickReels / Shortical / GoodShort (chip 🎯 "Video terdeteksi").
- Header Referer otomatis untuk URL media hasil capture.
- Chip deteksi otomatis diperluas ke situs short drama.

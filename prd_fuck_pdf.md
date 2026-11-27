# Product Requirements Document (PRD): fuck_PDF

**Status:** Draft (Mode 1 — Planning without UI design direction)

**Target Platform:** Web Browser (Desktop & Mobile Responsive)

**Core Value Proposition:** **fuck_PDF** adalah utilitas web *local-first* untuk membuka arsip dan PDF berpassword, mengonversi format media/dokumen, serta mengedit PDF secara langsung di browser tanpa mengunggah file sensitif ke server eksternal (100% pemrosesan lokal berbasis WebAssembly).

## 1. Latar Belakang & Masalah Pengguna

Pengguna sering berhadapan dengan tiga hambatan utama saat mengelola file:

1. **Privasi & Keamanan:** Mengunggah file PDF rahasia (slip gaji, kontrak, dokumen identitas) atau arsip berpassword ke layanan web pihak ketiga berisiko kebocoran data.

2. **Fragmentasi Alat:** Pengguna harus berpindah-pindah situs berbeda hanya untuk mengekstrak RAR berpassword, mengonversi video ke MP4, lalu menggabungkan halaman PDF.

3. **Batas Ukuran & Antrean Server:** Situs konversi berbasis cloud membatasi ukuran file gratis (misalnya maksimal 50 MB) dan memaksa pengguna menunggu antrean unggah/unduh.

**Solusi:** Aplikasi web **fuck_PDF** berbasis pemrosesan sisi klien (*client-side* menggunakan WebAssembly dan Web Workers) sehingga file tidak pernah meninggalkan perangkat pengguna.

## 2. Target Pengguna

* **Pekerja Kantoran & Administrasi:** Membuka lampiran PDF/ZIP berpassword (rekening koran, slip gaji), menyusun ulang halaman PDF, dan membubuhkan tanda tangan.

* **Kreator & Mahasiswa:** Mengonversi format foto, audio, video, dan dokumen secara cepat tanpa terkena kuota harian atau watermark.

* **Pengguna Sadar Privasi:** Membutuhkan utilitas file yang bekerja secara offline setelah halaman dimuat (PWA-ready).

## 3. Cakupan Fitur Fungsional (Functional Requirements)

### Modul A: Pembuka Arsip & PDF Berpassword (Password Unlocker & Extractor)

* **Format yang Didukung:** `.pdf`, `.zip`, `.rar` (termasuk RAR5), `.7z`.

* **Alur Kerja:**

  * Sistem mendeteksi otomatis apakah file yang dimasukkan memiliki enkripsi/password.

  * Menampilkan kolom input password yang fokus otomatis (*auto-focus*) beserta tombol tampilkan/sembunyikan karakter.

  * **Untuk Arsip (ZIP/RAR/7z):** Menampilkan daftar struktur folder dan ukuran tiap file di dalam arsip setelah password benar. Pengguna bisa memilih untuk mengekstrak satu file tertentu (*selective extract*) atau mengunduh seluruh isi sebagai satu bundel ZIP.

  * **Untuk PDF:** Membuka dokumen di penampil internal dan menyediakan opsi menyimpan salinan PDF baru tanpa proteksi password (*decrypt & save*).

* **Penanganan Eror:** Pesan kesalahan spesifik jika password salah, file korup, atau metode enkripsi tidak didukung (bukan pesan "Terjadi kesalahan sistem" yang umum).

### Modul B: Konverter Multi-Format (Universal Media & Document Converter)

Seluruh konversi berjalan di *background thread* (Web Worker) agar antarmuka tidak membeku.

| Kategori | Format Input | Format Output | Opsi Konfigurasi Pengguna | 
| ----- | ----- | ----- | ----- | 
| **Foto / Gambar** | JPG, PNG, WebP, AVIF, HEIC, SVG, BMP | JPG, PNG, WebP, AVIF, ICO | Kualitas kompresi (10–100%), ubah dimensi (lebar/tinggi), hapus metadata EXIF | 
| **Video** | MP4, MKV, WebM, MOV, AVI | MP4 (H.264), WebM (VP9), GIF | Resolusi (Asli, 1080p, 720p, 480p), FPS, potong durasi (*trim*), bisukan audio | 
| **Musik / Audio** | MP3, WAV, OGG, FLAC, M4A, AAC | MP3, WAV, OGG, M4A | Bitrate (128kbps, 192kbps, 320kbps), potong durasi (*trim*) | 
| **Dokumen** | DOCX, TXT, Markdown (`.md`), HTML, CSV, XLSX | PDF, TXT, HTML, Markdown, CSV | Ukuran kertas (A4, Letter) dan orientasi untuk output PDF | 

* **Batch Processing:** Mendukung antrean hingga 20 file sekaligus dengan indikator progres individual (persentase dan estimasi waktu) serta tombol "Unduh Semua (ZIP)".

### Modul C: Editor PDF (Client-Side PDF Editor)

* **Manajemen Halaman:**

  * Tampilan *thumbnail* seluruh halaman dalam grid responsif.

  * Seret dan lepas (*drag-and-drop*) untuk mengubah urutan halaman.

  * Putar halaman (90° searah/berlawanan jarum jam), hapus halaman, atau sisipkan halaman dari file PDF lain (*merge*).

  * Pisahkan rentang halaman tertentu menjadi file PDF baru (*split*).

* **Anotasi & Pengisian:**

  * Tambah teks baru (pilihan font standar, ukuran, warna).

  * Tambah gambar atau tanda tangan (unggah gambar PNG transparan atau gambar langsung via kanvas sentuh/mouse).

  * Alat coret (*highlight*), garis bawah, dan kotak penutup (*whiteout/redaction* permanen yang merasterisasi area tertutup agar teks di bawahnya tidak bisa disalin ulang).

* **Kompresi PDF:** Optimasi ukuran file dengan menurunkan DPI gambar tertanam (opsi: Rendah, Sedang, Tinggi).

## 4. Arsitektur Teknis & Batasan Sistem

* **Mesin Pemrosesan (Client-Side WASM):**

  * **Arsip (ZIP/RAR/7z):** `libarchive.js` atau kombinasi `fflate` + `node-unrar-js` (WASM) + `7z-wasm`.

  * **Audio & Video:** `@ffmpeg/ffmpeg` (WebAssembly single-thread & multi-thread jika header `Cross-Origin-Opener-Policy` dan `Cross-Origin-Embedder-Policy` aktif).

  * **Gambar:** Canvas API / OffscreenCanvas + `libheif-js` (untuk HEIC) + `pica` (resizing presisi tinggi).

  * **PDF View & Edit:** `pdf.js` untuk rendering tampilan, `pdf-lib` untuk manipulasi struktur, penulisan teks, penggabungan, dan dekripsi.

  * **Dokumen:** `mammoth.js` (DOCX ke HTML), `SheetJS` (CSV/XLSX), dikombinasikan dengan renderer PDF sisi klien.

* **Batasan Memori Browser:**

  * WebAssembly memiliki batas memori per tab (umumnya 2 GB–4 GB tergantung perangkat).

  * Sistem wajib menampilkan peringatan batas ukuran file berdasarkan deteksi RAM perangkat (misalnya: peringatan untuk file video lebih dari 500 MB di perangkat mobile) agar tab tidak mengalami *crash* (*Out of Memory*).

## 5. Persyaratan Non-Fungsional & Standar Kualitas (Anti-Slop)

* **Zero-Upload Guarantee:** Tidak ada endpoint backend untuk menerima file pengguna. Aplikasi harus tetap dapat membuka arsip dan mengedit PDF saat koneksi internet dimatikan (Service Worker caching).

* **Aksesibilitas & Navigasi:**

  * Seluruh tombol aksi, daftar halaman PDF, dan antrean konversi dapat dioperasikan via keyboard (`Tab`, `Enter`, tombol panah untuk urutan halaman).

  * Kontras warna memenuhi standar WCAG AA; indikator status tidak hanya mengandalkan warna (gunakan ikon dan label teks).

* **Kejujuran Antarmuka:**

  * Dilarang menampilkan lencana keamanan palsu (seperti "ISO Certified" atau "Military Grade Encryption" tanpa audit resmi). Tampilkan indikator teknis yang dapat diverifikasi pengguna, misalnya status: *"Pemrosesan Lokal — 0 KB data dikirim ke jaringan"*.

  * Hindari dekorasi latar belakang yang mengganggu area kerja dokumen (tidak ada animasi mengambang atau gradien mencolok di sekitar kanvas PDF).

## 6. Alur Pengguna Utama (Core User Flows)

1. **Drop-zone Tunggal di Halaman Utama:** Pengguna menyeret file apa saja ke area utama. Aplikasi otomatis mengarahkan pengguna ke ruang kerja yang sesuai (misalnya: menjatuhkan `.7z` berpassword langsung membuka dialog password dan ekstraktor; menjatuhkan `.pdf` membuka tampilan pratinjau dengan tab *Buka Kunci*, *Edit Halaman*, atau *Konversi*).

2. **Pemrosesan & Pratinjau:** Pengguna mengatur opsi atau memasukkan password, memantau progres di bar status, dan melihat hasil pratinjau sebelum menyimpan.

3. **Ekspor & Pembersihan Memori:** Setelah file diunduh, pengguna dapat menekan tombol "Tutup & Hapus Memori" untuk membersihkan *Object URL* dan buffer RAM browser seketika.

## 7. Metrik Keberhasilan (Success Metrics)

* **Tingkat Keberhasilan Pemrosesan Lokal:** Minimal 95% file di bawah 200 MB berhasil dibuka/dikonversi tanpa *tab crash*.

* **Time-to-First-Action:** Pengguna dapat mulai memasukkan password atau memilih format tujuan dalam waktu kurang dari 1,5 detik setelah menjatuhkan file.

* **Retensi Tanpa Akun:** Persentase pengguna yang kembali menggunakan alat dalam 30 hari tanpa kewajiban registrasi.
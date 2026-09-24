# Panduan Berkontribusi (Contributing Guide)

Terima kasih sudah tertarik untuk ikut mengembangkan atau berkontribusi pada **Sistem Register Agenda Surat Keluar**! Proyek ini terbuka bagi siapa saja—baik staf pemerintahan (ASN, PPPK, tenaga teknis/administrasi kelurahan/desa/kecamatan), mahasiswa, maupun pengembang software independen.

---

## 💡 Cara Berpartisipasi

Anda dapat berkontribusi melalui berbagai cara:
1. **Melaporkan Bug / Kendala:** Buka [GitHub Issues](https://github.com/dandsay/nosurat-keluar/issues) jika Anda menemukan eror atau kendala saat instalasi/penggunaan.
2. **Mengusulkan Fitur Baru:** Punya ide fitur yang cocok untuk kebutuhan tata naskah dinas di daerah Anda? Sampaikan idenya di Issue.
3. **Mengirimkan Pull Request (PR):**
   - Fork repositori ini.
   - Buat branch baru untuk fitur Anda: `git checkout -b fitur/nama-fitur`.
   - Lakukan commit dengan pesan yang jelas.
   - Buka Pull Request ke branch `main`.

---

## 🛠️ Standar Pengembangan

- **Zero Spreadsheet / Standalone:** Pastikan sistem tetap mandiri berjalan di Cloudflare Workers & Cloudflare D1.
- **Zero-Knowledge Encryption:** Data sensitif isi surat (perihal, nama pejabat/petugas, instansi, klasifikasi) **wajib selalu terenkripsi** di sisi browser (klien) sebelum dikirim ke API/database.
- **Zero Server Cost Friendly:** Utamakan kode yang ringan dan hemat resource agar tetap berada di batas Free Tier Cloudflare Workers.

---

## 🇮🇩 Semangat Komunitas
Mari bersama-sama memajukan tata kelola persuratan digital di kantor pelayanan publik seluruh Indonesia!

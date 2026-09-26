# ARSITEKTUR BEKU — Register Agenda Surat Keluar

Dokumen ini adalah kontrak. Perubahan apa pun di bawah ini **wajib**
disertai pembaruan `tests/arch.test.mjs` + alasan eksplisit di commit.
Pola dipelajari dari `brankas-esp32` (byte-freeze + gate sebelum deploy).

## Lapisan (tetap)

| Lapisan | Isi | Aturan |
|---|---|---|
| `public/js/*.js` | 8 modul tanpa build (crypto, cipher portal, auth, agenda, mundur, table, stats, export) | Daftar file beku; kosmetik (`index.html`/`css`/`img`) tidak dibekukan |
| `src/*.js` | Router + Bearer gatekeeper + ASSETS fallthrough | Endpoint inti stabil (lihat bawah) |
| `src/routes/*.js` | 4 route: auth, agenda, mundur, stats | Handler inti tidak boleh hilang/rename diam-diam |
| `src/utils/*.js` | auth-crypto, holidays (WIB/weekend), response | Parameter kripto + kalender dinas dipin |
| D1 | `agenda_surat` + `agenda_nomor_mundur` | 6 kolom `*_encrypted` + indeks unik first-class |
| `tests/` | Gerbang pengaman (node bawaan) | Hijau = syarat deploy |
| `scripts/freeze.mjs` + `freeze.manifest.json` | SHA-256 per file (19 file) | 1 byte berubah → gate merah → deploy batal |

## Invarian keamanan (diuji)

1. Klien: AES-GCM 256 + PBKDF2-SHA256 **50.000 iterasi**, salt `kelurahan-aac-salt-2026`,
   IV acak 12-byte via `crypto.getRandomValues` — angka/format ini dipin di tes.
2. Server: verifikasi PIN PBKDF2-SHA256 **100.000 iterasi** (`APP_PIN_HASH` format
   `pbkdf2$iter$salt$hash`) + `timingSafeEqual` + session HMAC-SHA256 **12 jam** Bearer.
3. Acak hanya `crypto.getRandomValues` — `Math.random(` dilarang di seluruh area beku.
4. Server tidak pernah melihat plaintext (hanya ciphertext + kolom non-sensitif
   `tahun/no_urut/tgl_surat/tgl_kirim/bentuk_surat/nomor_induk/sub_nomor/no_urut_lengkap`).
5. Semua `/api/*` (kecuali `/api/auth/verify`) wajib lewat `verifySessionToken`, gagal → 401.

## Invarian administrasi (diuji — jangan dilonggarkan diam-diam)

1. Weekend block: `isWeekend(tgl_surat)` menolak Sabtu/Minggu di create/update agenda,
   create mundur, dan smart-detect.
2. Batas kirim: `tgl_kirim` tidak boleh < `tgl_surat` dan maksimal `addDays(tgl,14)`.
3. Anti-mundur reguler: update menolak `tgl_surat < existing.tgl_surat`.
4. Nomor mundur terkunci: `tgl_surat !== existing.tgl_surat` → 400; hanya untuk
   tanggal lewat (`tgl < getTodayWIB()`), bukan hari ini/masa depan.
5. Smart-detect: cari induk tepat tanggal dulu, fallback ke reguler terakhir sebelumnya,
   balas `exact_match` + `existing_subs` + `no_urut_lengkap = induk.sub`.
6. Penomoran atomic: `MAX(no_urut)+1` / `MAX(sub_nomor)+1`, retry 3x saat
   `UNIQUE constraint failed`, format mundur `induk.sub`.

## Beku byte-level (ditegakkan kode, bukan tulisan)

`scripts/freeze.mjs` + `freeze.manifest.json`: SHA-256 per file untuk
`public/js/*.js` (7), `src/**/*.js` (8), `schema.sql`, `wrangler.jsonc`,
dan skrip freeze itu sendiri (19 file).

- 1 byte berubah di area beku (termasuk 1 angka) → `--check` exit 1 →
  `npm run gate` merah → `npm run deploy` **batal sebelum wrangler jalan**.
- Perubahan sah: review `git diff` → `npm run freeze` → commit manifest
  + kode **bersamaan** (manifest basi = gate merah juga).

## Jalur pengaman (gate)

```
npm run deploy  =  npm run gate  &&  wrangler deploy
                       |                    |
              npm test + freeze --check   wrangler deploy
              (13 uji + 19 hash)          (hanya bila gate hijau)
```

- Lokal: `npm run gate` sebelum commit apa pun yang menyentuh kripto/nomor/validasi.
- Wrangler **tidak dijalankan manual** — selalu lewat `npm run deploy`
  agar deploy tanpa bukti gate hijau tidak mungkin terjadi.
- `git push` hanya setelah gate hijau. Sync publik (`scripts/sync-publik.sh`)
  tetap jalan setelahnya; ia menyalin `freeze.manifest.json` apa adanya.

## Yang boleh berubah tanpa mencairkan bekunya

Isi pesan error, label UI, gaya, ikon, teks toast, daftar petugas/pengelola di
`index.html` — selama invarian di atas tetap hijau. Menambah endpoint/tabel/kolom
baru = mencairkan bekunya (perlu uji + dokumen baru).

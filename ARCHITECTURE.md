# ARSITEKTUR BEKU — Register Agenda Surat Keluar

Dokumen ini adalah kontrak. Perubahan apa pun di bawah ini **wajib**
disertai pembaruan `tests/arch.test.mjs` + alasan eksplisit di commit.
Pola dipelajari dari `brankas-esp32` (byte-freeze + gate sebelum deploy).

## Lapisan (tetap)

| Lapisan | Isi | Aturan |
|---|---|---|
| `public/js/*.js` | 9 modul tanpa build (crypto, cipher portal, auth, agenda, mundur, table, stats, export, chain) | Daftar file beku; kosmetik (`index.html`/`css`/`img`) tidak dibekukan |
| `src/*.js` | Router + Bearer gatekeeper + ASSETS fallthrough | Endpoint inti stabil (lihat bawah) |
| `src/routes/*.js` | 5 route: auth, agenda, mundur, stats, chain | Handler inti tidak boleh hilang/rename diam-diam |
| `src/utils/*.js` | auth-crypto, chain (hash ledger), holidays (WIB/weekend), response | Parameter kripto + kalender dinas + kanonikal rantai dipin |
| D1 | `agenda_surat` + `agenda_nomor_mundur` + `agenda_chain` (ledger append-only) | 6 kolom `*_encrypted` + indeks unik first-class |
| `tests/` | Gerbang pengaman (node bawaan) | Hijau = syarat deploy |
| `scripts/freeze.mjs` + `freeze.manifest.json` | SHA-256 per file (22 file) | 1 byte berubah → gate merah → deploy batal |

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
7. Hapus KETAT: hanya nomor terakhir per tahun (`MAX(no_urut)`)
   dan sub terakhir per induk (`MAX(sub_nomor)`) yang boleh `DELETE` (OPSI A).
   Non-max → `409 NOMOR_TERKUNCI` + pesan hubungi admin + arah Edit/daur ulang
   (pra-cek UI + cek ulang server tiap percobaan anti-balapan). Induk beranak
   mundur tidak boleh hapus (anti-yatim).

## Invarian rantai berantai (diuji — append-only, bukan blockchain penuh)

1. Satu rantai gabungan reguler + mundur di `agenda_chain`. Tiap mutasi
   menambah tepat 1 blok: terbit saat create, koreksi saat update,
   hapus (tombstone berisi snapshot terakhir) saat delete fisik.
2. `payload_hash = SHA256(kanonikal snapshot ciphertext + metadata)`,
   `block_hash = SHA256(prev_hash|kind|ref|payload_hash)`, blok pertama
   `prev_hash = 'GENESIS'`. Kanonikal di `src/utils/chain.js` dipin.
3. Linearitas: `UNIQUE(prev_hash)` + retry fork — dua penulis di head yang
   sama tidak bisa bercabang diam-diam; yang kalah mengulang dari head baru.
4. Koreksi/hapus atomic via `DB.batch([operasional, rantai])`. Terbit
   dua-tahap (insert lalu rangkai); yang tertinggal disembuhkan idempoten
   via `POST /api/chain/backfill` (sekali pasca-deploy / pasca-insiden).
5. Verifikasi 2 lapis di `GET /api/chain/verify`: (1) link+hash dari
   GENESIS, (2) jangkar state (baris hidup cocok snapshot terakhir,
   hapus wajib hilang, tanpa blok yatim). Zero-knowledge utuh: server
   hanya me-hash ciphertext, tidak pernah melihat plaintext.
6. UI mikro-kosmetik: cuplikan hash 7-char gaya git + badge versi `vN`
   hanya bila dikoreksi; detail penuh tersembunyi di balik klik.
7. List reguler/mundur menempelkan `_rantai {pendek, versi}` per baris
   (2 query terindeks; tanpa blok = tampil bersih seperti dulu).
8. Diagnosis masa depan berkode (bukan tebak-tebakan):
   `BUTUH_BERTAHAP` (rantai > `CHAIN_VERIFY_MAX`, default 10.000 blok —
   verify menolak sebelum kena Error 1102 CPU), `KUOTA_HABIS`
   (kuota D1 harian jebol → 429 + pesan reset 07:00 WIB),
   `GALAT_VERIFY` (lainnya → 500). Badge toolbar menampilkan label +
   arti tiap kode.

## Beku byte-level (ditegakkan kode, bukan tulisan)

`scripts/freeze.mjs` + `freeze.manifest.json`: SHA-256 per file untuk
`public/js/*.js` (9), `src/**/*.js` (10), `schema.sql`, `wrangler.jsonc`,
dan skrip freeze itu sendiri (22 file).

- 1 byte berubah di area beku (termasuk 1 angka) → `--check` exit 1 →
  `npm run gate` merah → `npm run deploy` **batal sebelum wrangler jalan**.
- Perubahan sah: review `git diff` → `npm run freeze` → commit manifest
  + kode **bersamaan** (manifest basi = gate merah juga).

## Jalur pengaman (gate)

```
npm run deploy  =  npm run gate  &&  wrangler deploy
                       |                    |
              npm test + freeze --check   wrangler deploy
              (31 uji + 22 hash)          (hanya bila gate hijau)
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

-- ==============================================================================
-- Skema Database: Register Agenda Surat Keluar (Zero-Knowledge Architecture)
-- Engine: Cloudflare D1 (Serverless SQLite at Edge)
--
-- Seluruh field sensitif (klasifikasi, format nomor, pengelola, perihal,
-- instansi tujuan, petugas) disimpan dalam bentuk ciphertext terenkripsi
-- di sisi klien dengan Web Crypto API (AES-GCM 256-bit + PBKDF2).
-- ==============================================================================

-- 1. TABEL UTAMA: Agenda Surat Keluar Reguler
CREATE TABLE IF NOT EXISTS agenda_surat (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tahun INTEGER NOT NULL,                   -- Contoh: 2026
    no_urut INTEGER NOT NULL,                 -- 1, 2, 3...
    tgl_surat TEXT NOT NULL,                   -- YYYY-MM-DD (Plaintext untuk indexing tanggal & pencarian)
    tgl_kirim TEXT,                           -- YYYY-MM-DD
    bentuk_surat TEXT NOT NULL,               -- 'eSurat (Elektronik)' | 'Surat Manual (Fisik)'
    
    -- Field Terenkripsi Client-Side (Zero-Knowledge AES-GCM 256-bit)
    kode_klasifikasi_encrypted TEXT NOT NULL, -- Ciphertext Klasifikasi Surat
    nomor_lengkap_encrypted TEXT NOT NULL,    -- Ciphertext Format Nomor Surat Lengkap
    penanggung_jawab_encrypted TEXT NOT NULL, -- Ciphertext Seksi / Pejabat Pengelola
    perihal_encrypted TEXT NOT NULL,          -- Ciphertext Isi Perihal Surat
    instansi_encrypted TEXT NOT NULL,         -- Ciphertext Nama Instansi Yang Dituju
    petugas_encrypted TEXT NOT NULL,          -- Ciphertext Nama Staf Penginput
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agenda_tahun_no ON agenda_surat(tahun, no_urut);
CREATE INDEX IF NOT EXISTS idx_agenda_tgl_surat ON agenda_surat(tgl_surat);
CREATE INDEX IF NOT EXISTS idx_agenda_bentuk ON agenda_surat(bentuk_surat);
CREATE INDEX IF NOT EXISTS idx_agenda_tahun ON agenda_surat(tahun);
CREATE INDEX IF NOT EXISTS idx_agenda_tahun_bentuk ON agenda_surat(tahun, bentuk_surat);


-- 2. TABEL KHUSUS: Agenda Nomor Mundur (Format Sub-Nomor: 400.1, 400.2...)
CREATE TABLE IF NOT EXISTS agenda_nomor_mundur (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tahun INTEGER NOT NULL,                   -- Contoh: 2026
    tgl_surat TEXT NOT NULL,                   -- YYYY-MM-DD
    nomor_induk INTEGER NOT NULL,              -- Nomor urut surat induk yang disusul (misal 400)
    sub_nomor INTEGER NOT NULL,                -- 1, 2, 3...
    no_urut_lengkap TEXT NOT NULL,             -- "400.1", "400.2"
    tgl_kirim TEXT,
    bentuk_surat TEXT NOT NULL,
    
    -- Field Terenkripsi Client-Side (Zero-Knowledge AES-GCM 256-bit)
    kode_klasifikasi_encrypted TEXT NOT NULL, -- Ciphertext Klasifikasi Surat
    nomor_lengkap_encrypted TEXT NOT NULL,    -- Ciphertext Format Nomor Surat Lengkap
    penanggung_jawab_encrypted TEXT NOT NULL, -- Ciphertext Seksi / Pejabat Pengelola
    perihal_encrypted TEXT NOT NULL,          -- Ciphertext Isi Perihal Surat
    instansi_encrypted TEXT NOT NULL,         -- Ciphertext Nama Instansi Yang Dituju
    petugas_encrypted TEXT NOT NULL,          -- Ciphertext Nama Staf Penginput
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mundur_unik ON agenda_nomor_mundur(tahun, nomor_induk, sub_nomor);
CREATE INDEX IF NOT EXISTS idx_mundur_tgl ON agenda_nomor_mundur(tgl_surat);
CREATE INDEX IF NOT EXISTS idx_mundur_tahun ON agenda_nomor_mundur(tahun);
CREATE INDEX IF NOT EXISTS idx_mundur_tahun_bentuk ON agenda_nomor_mundur(tahun, bentuk_surat);


-- 3. LEDGER RANTAI: Jejak Berantai (Hash-Chain) Seluruh Mutasi Nomor
-- Append-only: setiap terbit/koreksi/hapus di kedua tabel di atas menambah
-- SATU blok di sini. Blok lama tidak pernah diubah/dihapus.
-- Zero-knowledge tetap: snapshot berisi ciphertext + metadata non-sensitif saja.
CREATE TABLE IF NOT EXISTS agenda_chain (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tahun INTEGER NOT NULL,                   -- Tahun terbit nomor yang dirujuk
    kind TEXT NOT NULL,                       -- 'terbit' | 'koreksi' | 'hapus'
    ref_kind TEXT NOT NULL,                   -- 'reguler' | 'mundur'
    ref_id INTEGER NOT NULL,                  -- id baris di tabel asal
    ref_no TEXT NOT NULL,                     -- '123' (reguler) atau '400.1' (mundur)
    tgl_surat TEXT NOT NULL,
    tgl_kirim TEXT,
    bentuk_surat TEXT NOT NULL,

    -- Salinan snapshot saat blok dibuat (ciphertext, sama seperti tabel asal)
    kode_klasifikasi_encrypted TEXT NOT NULL,
    nomor_lengkap_encrypted TEXT NOT NULL,
    penanggung_jawab_encrypted TEXT NOT NULL,
    perihal_encrypted TEXT NOT NULL,
    instansi_encrypted TEXT NOT NULL,
    petugas_encrypted TEXT NOT NULL,

    payload_hash TEXT NOT NULL,               -- SHA-256 hex kanonikal snapshot
    prev_hash TEXT NOT NULL,                  -- block_hash blok sebelumnya ('GENESIS' untuk pertama)
    block_hash TEXT NOT NULL,                 -- SHA-256 hex(prev_hash|kind|ref|payload_hash)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Linearitas rantai: tiap prev_hash hanya dipakai satu blok (cegah fork diam-diam).
CREATE UNIQUE INDEX IF NOT EXISTS idx_chain_block ON agenda_chain(block_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chain_prev ON agenda_chain(prev_hash);
CREATE INDEX IF NOT EXISTS idx_chain_ref ON agenda_chain(ref_kind, ref_id);
CREATE INDEX IF NOT EXISTS idx_chain_tahun ON agenda_chain(tahun);

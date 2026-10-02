/**
 * Util Rantai Berantai (Hash-Chain Ledger) — Register Agenda Surat Keluar.
 *
 * Satu rantai gabungan untuk reguler + mundur. Append-only: tiap mutasi
 * (terbit/koreksi/hapus) menambah 1 blok berisi snapshot penuh + hash.
 * Zero-knowledge terjaga: yang di-hash hanya ciphertext + metadata
 * non-sensitif (tahun/tgl/bentuk/nomor). Server tidak melihat plaintext.
 *
 *   payload_hash = SHA256(kanonikal snapshot)
 *   block_hash   = SHA256(prev_hash|kind|ref_key|payload_hash)
 *   blok pertama: prev_hash = 'GENESIS'
 */

export const GENESIS_HASH = 'GENESIS';
const APPEND_MAX_ATTEMPTS = 5;

export async function sha256Hex(str) {
    const data = new TextEncoder().encode(str);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Kanonikal snapshot operasional (urutan field dipin — jangan ubah diam-diam).
export function canonicalPayload(s) {
    return [
        s.ref_kind, String(s.tahun), String(s.ref_no),
        s.tgl_surat || '', s.tgl_kirim || '', s.bentuk_surat || '',
        s.kode_klasifikasi_encrypted || '', s.nomor_lengkap_encrypted || '',
        s.penanggung_jawab_encrypted || '', s.perihal_encrypted || '',
        s.instansi_encrypted || '', s.petugas_encrypted || '',
    ].join('|');
}

export function refKeyOf(refKind, tahun, refNo) {
    return `${refKind}:${tahun}:${refNo}`;
}

export async function payloadHashOf(snapshot) {
    return sha256Hex(canonicalPayload(snapshot));
}

export async function blockHashOf(prevHash, kind, refKey, payloadHash) {
    return sha256Hex([prevHash, kind, refKey, payloadHash].join('|'));
}

export async function getChainHead(env) {
    return env.DB.prepare(
        'SELECT id, block_hash FROM agenda_chain ORDER BY id DESC LIMIT 1'
    ).first();
}

// Tulis 1 blok ke ujung rantai. Idempoten terhadap fork: bila dua penulis
// membaca head yang sama, hanya satu yang menang (UNIQUE prev_hash);
// yang kalah mengulang dari head baru.
export async function appendChainBlock(env, { kind, refKind, refId, refNo, tahun, tglSurat, tglKirim, bentukSurat, enc }) {
    const refKey = refKeyOf(refKind, tahun, refNo);
    let attempts = 0;
    while (attempts < APPEND_MAX_ATTEMPTS) {
        attempts++;
        const head = await getChainHead(env);
        const prevHash = head?.block_hash || GENESIS_HASH;
        const snapshot = {
            ref_kind: refKind, tahun, ref_no: String(refNo),
            tgl_surat: tglSurat, tgl_kirim: tglKirim || null, bentuk_surat: bentukSurat,
            kode_klasifikasi_encrypted: enc.kode_klasifikasi_encrypted,
            nomor_lengkap_encrypted: enc.nomor_lengkap_encrypted,
            penanggung_jawab_encrypted: enc.penanggung_jawab_encrypted,
            perihal_encrypted: enc.perihal_encrypted,
            instansi_encrypted: enc.instansi_encrypted,
            petugas_encrypted: enc.petugas_encrypted,
        };
        const payloadHash = await payloadHashOf(snapshot);
        const blockHash = await blockHashOf(prevHash, kind, refKey, payloadHash);
        const stmt = env.DB.prepare(`
            INSERT INTO agenda_chain (
                tahun, kind, ref_kind, ref_id, ref_no,
                tgl_surat, tgl_kirim, bentuk_surat,
                kode_klasifikasi_encrypted, nomor_lengkap_encrypted, penanggung_jawab_encrypted,
                perihal_encrypted, instansi_encrypted, petugas_encrypted,
                payload_hash, prev_hash, block_hash
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            tahun, kind, refKind, refId, String(refNo),
            tglSurat, tglKirim || null, bentukSurat,
            enc.kode_klasifikasi_encrypted, enc.nomor_lengkap_encrypted, enc.penanggung_jawab_encrypted,
            enc.perihal_encrypted, enc.instansi_encrypted, enc.petugas_encrypted,
            payloadHash, prevHash, blockHash
        );
        try {
            const res = await stmt.run();
            return { id: res.meta?.last_row_id || null, blockHash, payloadHash, prevHash };
        } catch (err) {
            if (err && err.message && err.message.includes('UNIQUE constraint failed')) continue;
            throw err;
        }
    }
    throw new Error('Rantai sibuk, silakan coba kembali.');
}

// Bangun statement INSERT rantai dari snapshot yang SUDAH dihitung hashnya
// (dipakai agar insert operasional + insert rantai bisa 1x batch atomic).
export async function buildChainInsert(env, { kind, refKind, refId, refNo, tahun, tglSurat, tglKirim, bentukSurat, enc, prevHash }) {
    const refKey = refKeyOf(refKind, tahun, refNo);
    const snapshot = {
        ref_kind: refKind, tahun, ref_no: String(refNo),
        tgl_surat: tglSurat, tgl_kirim: tglKirim || null, bentuk_surat: bentukSurat,
        kode_klasifikasi_encrypted: enc.kode_klasifikasi_encrypted,
        nomor_lengkap_encrypted: enc.nomor_lengkap_encrypted,
        penanggung_jawab_encrypted: enc.penanggung_jawab_encrypted,
        perihal_encrypted: enc.perihal_encrypted,
        instansi_encrypted: enc.instansi_encrypted,
        petugas_encrypted: enc.petugas_encrypted,
    };
    const payloadHash = await payloadHashOf(snapshot);
    const blockHash = await blockHashOf(prevHash, kind, refKey, payloadHash);
    const stmt = env.DB.prepare(`
        INSERT INTO agenda_chain (
            tahun, kind, ref_kind, ref_id, ref_no,
            tgl_surat, tgl_kirim, bentuk_surat,
            kode_klasifikasi_encrypted, nomor_lengkap_encrypted, penanggung_jawab_encrypted,
            perihal_encrypted, instansi_encrypted, petugas_encrypted,
            payload_hash, prev_hash, block_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
        tahun, kind, refKind, refId, String(refNo),
        tglSurat, tglKirim || null, bentukSurat,
        enc.kode_klasifikasi_encrypted, enc.nomor_lengkap_encrypted, enc.penanggung_jawab_encrypted,
        enc.perihal_encrypted, enc.instansi_encrypted, enc.petugas_encrypted,
        payloadHash, prevHash, blockHash
    );
    return { stmt, blockHash, payloadHash };
}

// Batas verifikasi penuh per request. Di atas ini verify menolak dengan
// kode BUTUH_BERTAHAP (bukanзависимо sampai kena Error 1102 CPU) —
// angka konservatif: 10rb blok ~= 20rb+ SHA-256, aman di bawah 10ms CPU free.
export function maxVerifyBlocks(env) {
    const n = parseInt((env && env.CHAIN_VERIFY_MAX) || '10000', 10);
    return Number.isFinite(n) && n > 0 ? n : 10000;
}

// Kode galat mesin-terbaca untuk diagnosis masa depan (lihat ARCHITECTURE.md).
// D1 free (sejak Sep 2026) menggagalkan query yang melewati kuota harian.
export function kodeGalatVerify(err) {
    const msg = String((err && err.message) || err || '');
    if (/limit|quota|exceed|1027|too many/i.test(msg)) return 'KUOTA_HABIS';
    return 'GALAT_VERIFY';
}
// baris operasional terkini wajib cocok dengan snapshot blok terakhirnya,
// ref ber-kind terakhir 'hapus' wajib sudah tidak ada di tabel operasional.
// Filter tahun hanya membatasi lapis (2); lapis (1) selalu seluruh rantai.
export async function verifyChain(env, tahunFilter) {
    const { results: blocks } = await env.DB.prepare(
        'SELECT * FROM agenda_chain ORDER BY id ASC'
    ).all();
    const rows = blocks || [];

    // Lapis 1: link + hash
    let prev = GENESIS_HASH;
    let brokenAt = null;
    for (const b of rows) {
        const refKey = refKeyOf(b.ref_kind, b.tahun, b.ref_no);
        const expectPayload = await payloadHashOf({
            ref_kind: b.ref_kind, tahun: b.tahun, ref_no: b.ref_no,
            tgl_surat: b.tgl_surat, tgl_kirim: b.tgl_kirim, bentuk_surat: b.bentuk_surat,
            kode_klasifikasi_encrypted: b.kode_klasifikasi_encrypted,
            nomor_lengkap_encrypted: b.nomor_lengkap_encrypted,
            penanggung_jawab_encrypted: b.penanggung_jawab_encrypted,
            perihal_encrypted: b.perihal_encrypted,
            instansi_encrypted: b.instansi_encrypted,
            petugas_encrypted: b.petugas_encrypted,
        });
        const expectBlock = await blockHashOf(b.prev_hash, b.kind, refKey, expectPayload);
        if (b.prev_hash !== prev || b.payload_hash !== expectPayload || b.block_hash !== expectBlock) {
            brokenAt = b.id;
            break;
        }
        prev = b.block_hash;
    }

    // Peta ref -> blok terakhir (untuk badge versi + lapis 2)
    const lastByRef = new Map();
    const revisions = {};
    for (const b of rows) {
        const key = `${b.ref_kind}:${b.ref_id}`;
        lastByRef.set(key, b);
        revisions[key] = (revisions[key] || 0) + 1;
    }

    // Lapis 2: jangkar state operasional
    const mismatches = [];
    const wantTahun = (t) => tahunFilter == null || Number(t) === Number(tahunFilter);
    if (brokenAt == null) {
        const { results: regRows } = await env.DB.prepare('SELECT * FROM agenda_surat').all();
        const { results: munRows } = await env.DB.prepare('SELECT * FROM agenda_nomor_mundur').all();
        const liveByRef = new Map();
        for (const r of (regRows || [])) {
            if (!wantTahun(r.tahun)) continue;
            liveByRef.set(`reguler:${r.id}`, { row: r, refKind: 'reguler', tahun: r.tahun, refNo: String(r.no_urut) });
        }
        for (const r of (munRows || [])) {
            if (!wantTahun(r.tahun)) continue;
            liveByRef.set(`mundur:${r.id}`, { row: r, refKind: 'mundur', tahun: r.tahun, refNo: r.no_urut_lengkap });
        }
        // (a) baris hidup wajib punya blok terakhir non-hapus dengan payload cocok
        for (const [key, live] of liveByRef) {
            const last = lastByRef.get(key);
            if (!last || !wantTahun(last.tahun)) {
                mismatches.push({ ref: key, no: live.refNo, sebab: 'tanpa-blok' });
                continue;
            }
            if (last.kind === 'hapus') {
                mismatches.push({ ref: key, no: live.refNo, sebab: 'hapus-tapi-masih-ada' });
                continue;
            }
            const curHash = await payloadHashOf({
                ref_kind: live.refKind, tahun: live.row.tahun, ref_no: live.refNo,
                tgl_surat: live.row.tgl_surat, tgl_kirim: live.row.tgl_kirim, bentuk_surat: live.row.bentuk_surat,
                kode_klasifikasi_encrypted: live.row.kode_klasifikasi_encrypted,
                nomor_lengkap_encrypted: live.row.nomor_lengkap_encrypted,
                penanggung_jawab_encrypted: live.row.penanggung_jawab_encrypted,
                perihal_encrypted: live.row.perihal_encrypted,
                instansi_encrypted: live.row.instansi_encrypted,
                petugas_encrypted: live.row.petugas_encrypted,
            });
            if (curHash !== last.payload_hash) {
                mismatches.push({ ref: key, no: live.refNo, sebab: 'isi-berubah-tanpa-blok' });
            }
        }
        // (b) ref yang berakhir 'hapus' wajib tidak ada di operasional
        for (const [key, last] of lastByRef) {
            if (last.kind !== 'hapus' || !wantTahun(last.tahun)) continue;
            if (liveByRef.has(key)) {
                if (!mismatches.some((m) => m.ref === key)) {
                    mismatches.push({ ref: key, no: last.ref_no, sebab: 'hapus-tapi-masih-ada' });
                }
            }
        }
        // (c) blok terakhir non-hapus wajib punya baris hidup (cegah blok yatim)
        for (const [key, last] of lastByRef) {
            if (last.kind === 'hapus' || !wantTahun(last.tahun)) continue;
            if (!liveByRef.has(key)) {
                mismatches.push({ ref: key, no: last.ref_no, sebab: 'blok-yatim' });
            }
        }
    }

    const head = rows.length > 0 ? rows[rows.length - 1] : null;
    return {
        valid: brokenAt == null && mismatches.length === 0,
        blocks: rows.length,
        head: head ? { id: head.id, hash: head.block_hash, pendek: head.block_hash.slice(0, 7) } : null,
        brokenAt,
        mismatches,
        revisions,
    };
}

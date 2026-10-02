// Uji rantai berantai (hash-chain ledger): primitif hash + siklus hidup
// terbit -> koreksi -> hapus + deteksi manipulasi + backfill pra-rantai.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    GENESIS_HASH, sha256Hex, canonicalPayload, refKeyOf,
    payloadHashOf, blockHashOf, appendChainBlock, verifyChain,
} from '../src/utils/chain.js';
import { handleCreateAgenda, handleUpdateAgenda, handleDeleteAgenda } from '../src/routes/agenda.js';
import { handleCreateNomorMundur, handleDeleteNomorMundur } from '../src/routes/mundur.js';
import { handleChainVerify, handleChainHistory, handleChainBackfill } from '../src/routes/chain.js';
import { getTodayWIB, addDays } from '../src/utils/holidays.js';

// --- D1 palsu secukupnya untuk SQL yang dipakai rantai + agenda/mundur ---
function makeFakeDB() {
    const tables = { agenda_surat: [], agenda_nomor_mundur: [], agenda_chain: [] };
    const seq = { agenda_surat: 0, agenda_nomor_mundur: 0, agenda_chain: 0 };
    const uniqOf = {
        agenda_surat: [(r) => `t:${r.tahun}#n:${r.no_urut}`],
        agenda_nomor_mundur: [(r) => `t:${r.tahun}#i:${r.nomor_induk}#s:${r.sub_nomor}`],
        agenda_chain: [(r) => `b:${r.block_hash}`, (r) => `p:${r.prev_hash}`],
    };

    function insertRow(table, cols, params) {
        const row = {};
        cols.forEach((c, i) => { row[c] = params[i]; });
        if (row.id == null) row.id = ++seq[table];
        else if (row.id > seq[table]) seq[table] = row.id;
        for (const key of uniqOf[table]) {
            const k = key(row);
            if (tables[table].some((r) => key(r) === k)) {
                throw new Error(`UNIQUE constraint failed: ${table}.${k}`);
            }
        }
        tables[table].push(row);
        return { meta: { last_row_id: row.id } };
    }

    function execRun(sql, params) {
        let m = sql.match(/INSERT INTO (\w+)\s*\(([^)]+)\)/i);
        if (m) {
            const cols = m[2].split(',').map((s) => s.trim());
            return insertRow(m[1], cols, params);
        }
        m = sql.match(/UPDATE (\w+)\s+SET\s+([\s\S]+?)\s+WHERE id = \?/i);
        if (m) {
            const cols = m[1] === 'agenda_chain' ? [] : m[2].split(',').map((s) => s.split('=')[0].trim());
            const id = params[params.length - 1];
            const row = tables[m[1]].find((r) => r.id == id);
            if (row) cols.forEach((c, i) => { row[c] = params[i]; });
            return { meta: {} };
        }
        m = sql.match(/DELETE FROM (\w+)\s+WHERE id = \?/i);
        if (m) {
            const i = tables[m[1]].findIndex((r) => r.id == params[0]);
            if (i >= 0) tables[m[1]].splice(i, 1);
            return { meta: {} };
        }
        throw new Error('SQL run tak dikenal: ' + sql.slice(0, 80));
    }

    function execSelect(sql, params) {
        const table = (sql.match(/(?:FROM|UPDATE|INTO)\s+(\w+)/i) || [])[1];
        let rows = [...(tables[table] || [])];
        // Filter tahun dulu (param pertama bila ada)
        let extra = params.slice();
        if (/WHERE tahun = \?/i.test(sql)) {
            rows = rows.filter((r) => r.tahun === params[0]);
            extra = params.slice(1);
        }
        // Filter induk untuk mundur (param kedua)
        if (/AND nomor_induk = \?/i.test(sql)) {
            const induk = extra[0];
            rows = rows.filter((r) => r.nomor_induk === induk);
        }
        // MAX+1 gaya lama (next_no / next_sub)
        const maxM = sql.match(/COALESCE\(MAX\((\w+)\), 0\) \+ 1 AS next_no/i);
        if (maxM) {
            const mx = rows.reduce((a, r) => Math.max(a, r[maxM[1]] || 0), 0);
            return [{ next_no: mx + 1 }];
        }
        const maxSubNext = sql.match(/COALESCE\(MAX\((\w+)\), 0\) \+ 1 AS next_sub/i);
        if (maxSubNext) {
            const mx = rows.reduce((a, r) => Math.max(a, r[maxSubNext[1]] || 0), 0);
            return [{ next_sub: mx + 1 }];
        }
        // MAX pengunci hapus (max_no / max_sub)
        const maxAlias = sql.match(/COALESCE\(MAX\((\w+)\), 0\) AS (\w+)/i);
        if (maxAlias) {
            const mx = rows.reduce((a, r) => Math.max(a, r[maxAlias[1]] || 0), 0);
            return [{ [maxAlias[2]]: mx }];
        }
        if (/WHERE id = \?/i.test(sql)) rows = rows.filter((r) => r.id == params[0]);
        if (/SELECT COUNT\(\*\) AS (\w+)/i.test(sql)) {
            const alias = sql.match(/SELECT COUNT\(\*\) AS (\w+)/i)[1];
            return [{ [alias]: rows.length }];
        }
        if (/WHERE ref_kind = \? AND ref_id = \?/i.test(sql)) {
            rows = rows.filter((r) => r.ref_kind === params[0] && r.ref_id === params[1]);
        }
        if (/WHERE ref_kind = \?/i.test(sql) && !/AND ref_id/i.test(sql)) {
            rows = rows.filter((r) => r.ref_kind === params[0]);
        }
        if (/SELECT DISTINCT ref_kind, ref_id/i.test(sql)) {
            const seen = new Set();
            rows = rows.filter((r) => {
                const k = `${r.ref_kind}:${r.ref_id}`;
                if (seen.has(k)) return false;
                seen.add(k);
                return true;
            }).map((r) => ({ ref_kind: r.ref_kind, ref_id: r.ref_id }));
        }
        if (/ORDER BY id DESC/i.test(sql)) rows.sort((a, b) => b.id - a.id);
        else if (/ORDER BY id ASC/i.test(sql)) rows.sort((a, b) => a.id - b.id);
        return rows;
    }

    const db = {
        __tables: tables,
        prepare(sql) {
            const stmt = {
                _sql: sql, _params: [],
                bind(...p) { stmt._params = p; return stmt; },
                async first() {
                    const rows = execSelect(stmt._sql, stmt._params);
                    if (/LIMIT 1/i.test(stmt._sql)) return rows[0] || null;
                    return rows[0] || null;
                },
                async all() { return { results: execSelect(stmt._sql, stmt._params) }; },
                async run() { return execRun(stmt._sql, stmt._params); },
            };
            return stmt;
        },
        async batch(stmts) {
            const backup = JSON.parse(JSON.stringify(tables));
            const seqBak = { ...seq };
            try {
                return stmts.map((s) => execRun(s._sql, s._params));
            } catch (err) {
                for (const k of Object.keys(tables)) tables[k] = backup[k];
                Object.assign(seq, seqBak);
                throw err;
            }
        },
    };
    return db;
}

const req = (body, params = '') => ({
    json: async () => body,
    headers: { get: () => null },
    url: 'http://x/' + params,
});
const urlOf = (s) => new URL(s, 'http://x');

// Hari kerja yang telah lewat (aman untuk weekend-block + aturan mundur)
function hariKerjaLewat(mundurHari) {
    const [y, m, d] = getTodayWIB().split('-').map(Number);
    const t = new Date(y, m - 1, d);
    let sisa = mundurHari;
    while (sisa > 0) {
        t.setDate(t.getDate() - 1);
        const dow = t.getDay();
        if (dow === 0 || dow === 6) continue;
        sisa--;
    }
    const p = (n) => String(n).padStart(2, '0');
    return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}
const ENC = (s) => `ENC(${s})`;
function bodyReguler(tgl, perihal = 'Perihal A') {
    return {
        tgl_surat: tgl, tgl_kirim: tgl, bentuk_surat: 'eSurat (Elektronik)',
        kode_klasifikasi_encrypted: ENC('K.1'), nomor_lengkap_encrypted: ENC('N.1'),
        penanggung_jawab_encrypted: ENC('P.1'), perihal_encrypted: ENC(perihal),
        instansi_encrypted: ENC('I.1'), petugas_encrypted: ENC('S.1'),
    };
}

test('primitif rantai: deterministik, format hex, genesis, kanonikal dipin', async () => {
    assert.equal(GENESIS_HASH, 'GENESIS');
    const a = await sha256Hex('abc');
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.equal(a, await sha256Hex('abc'));
    assert.notEqual(a, await sha256Hex('abd'));
    const snap = {
        ref_kind: 'reguler', tahun: 2026, ref_no: '1', tgl_surat: '2026-09-28',
        tgl_kirim: null, bentuk_surat: 'eSurat (Elektronik)',
        kode_klasifikasi_encrypted: 'A', nomor_lengkap_encrypted: 'B',
        penanggung_jawab_encrypted: 'C', perihal_encrypted: 'D',
        instansi_encrypted: 'E', petugas_encrypted: 'F',
    };
    assert.equal(
        canonicalPayload(snap),
        'reguler|2026|1|2026-09-28||eSurat (Elektronik)|A|B|C|D|E|F'
    );
    assert.equal(refKeyOf('reguler', 2026, '1'), 'reguler:2026:1');
    const p = await payloadHashOf(snap);
    const b = await blockHashOf('GENESIS', 'terbit', refKeyOf('reguler', 2026, '1'), p);
    assert.match(b, /^[0-9a-f]{64}$/);
});

test('siklus reguler: terbit -> koreksi -> hapus, verify selalu valid', async () => {
    const env = { DB: makeFakeDB() };
    const tgl = hariKerjaLewat(2);

    const c = await (await handleCreateAgenda(req(bodyReguler(tgl)), env)).json();
    assert.equal(c.success, true);
    assert.match(c.rantai || '', /^[0-9a-f]{7}$/);

    let v = await verifyChain(env, null);
    assert.equal(v.valid, true);
    assert.equal(v.blocks, 1);
    assert.equal(v.head.pendek.length, 7);

    const u = await (await handleUpdateAgenda(req({ ...bodyReguler(tgl, 'Perihal B') }), env, String(c.id))).json();
    assert.equal(u.success, true);
    v = await verifyChain(env, null);
    assert.equal(v.valid, true);
    assert.equal(v.blocks, 2);
    assert.equal(v.revisions[`reguler:${c.id}`], 2);

    const h = await handleChainHistory(req({}, ''), env, urlOf(`http://x/api/chain/history?ref_kind=reguler&ref_id=${c.id}`));
    const hj = await h.json();
    assert.equal(hj.versi, 2);
    assert.deepEqual(hj.data.map((b) => b.kind), ['terbit', 'koreksi']);

    const d = await (await handleDeleteAgenda(req({}, ''), env, String(c.id))).json();
    assert.equal(d.success, true);
    v = await verifyChain(env, null);
    assert.equal(v.valid, true);
    assert.equal(v.blocks, 3);
    assert.equal(env.DB.__tables.agenda_surat.length, 0, 'baris operasional terhapus fisik');
    assert.equal(env.DB.__tables.agenda_chain.length, 3, 'jejak rantai tetap kaya');
});

test('manipulasi terdeteksi: ubah snapshot rantai -> brokenAt', async () => {
    const env = { DB: makeFakeDB() };
    const tgl = hariKerjaLewat(2);
    await handleCreateAgenda(req(bodyReguler(tgl)), env);
    env.DB.__tables.agenda_chain[0].perihal_encrypted = 'ENC(PALSU)';
    const v = await verifyChain(env, null);
    assert.equal(v.valid, false);
    assert.equal(v.brokenAt, 1);
});

test('manipulasi terdeteksi: ubah operasional tanpa blok -> mismatch', async () => {
    const env = { DB: makeFakeDB() };
    const tgl = hariKerjaLewat(2);
    const c = await (await handleCreateAgenda(req(bodyReguler(tgl)), env)).json();
    env.DB.__tables.agenda_surat[0].perihal_encrypted = 'ENC(PALSU)';
    const v = await verifyChain(env, null);
    assert.equal(v.valid, false);
    assert.equal(v.mismatches[0].sebab, 'isi-berubah-tanpa-blok');
    assert.equal(v.mismatches[0].ref, `reguler:${c.id}`);
});

test('data pra-rantai: tanpa-blok lalu sembuh via backfill', async () => {
    const env = { DB: makeFakeDB() };
    const tgl = hariKerjaLewat(3);
    // Simulasi baris lama yang terbit sebelum rantai ada (insert langsung)
    const tahun = parseInt(tgl.split('-')[0], 10);
    await env.DB.prepare(`INSERT INTO agenda_surat (tahun, no_urut, tgl_surat, tgl_kirim, bentuk_surat,
        kode_klasifikasi_encrypted, nomor_lengkap_encrypted, penanggung_jawab_encrypted,
        perihal_encrypted, instansi_encrypted, petugas_encrypted, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(tahun, 1, tgl, tgl, 'Surat Manual (Fisik)', ENC('K'), ENC('N'), ENC('PJ'), ENC('PR'), ENC('IN'), ENC('PT'), '2026-01-05 01:00:00').run();

    let v = await verifyChain(env, null);
    assert.equal(v.valid, false);
    assert.equal(v.mismatches[0].sebab, 'tanpa-blok');

    const b = await (await handleChainBackfill(req({}, ''), env)).json();
    assert.equal(b.success, true);
    assert.equal(b.dirangkai, 1);

    v = await verifyChain(env, null);
    assert.equal(v.valid, true);
    assert.equal(v.blocks, 1);

    const b2 = await (await handleChainBackfill(req({}, ''), env)).json();
    assert.equal(b2.dirangkai, 0, 'backfill idempoten');
});

test('nomor mundur ikut satu rantai gabungan yang sama', async () => {
    const env = { DB: makeFakeDB() };
    const tglReg = hariKerjaLewat(5);
    const c = await (await handleCreateAgenda(req(bodyReguler(tglReg)), env)).json();
    const tahun = parseInt(tglReg.split('-')[0], 10);
    const tglMun = hariKerjaLewat(4);
    const m = await (await handleCreateNomorMundur(req({
        tgl_surat: tglMun, tgl_kirim: tglMun, nomor_induk: c.nomorUrut,
        bentuk_surat: 'Surat Manual (Fisik)',
        kode_klasifikasi_encrypted: ENC('K'), nomor_lengkap_encrypted: ENC('N'),
        penanggung_jawab_encrypted: ENC('PJ'), perihal_encrypted: ENC('PR'),
        instansi_encrypted: ENC('IN'), petugas_encrypted: ENC('PT'),
    }), env)).json();
    assert.equal(m.success, true, JSON.stringify(m));
    const v = await verifyChain(env, tahun);
    assert.equal(v.valid, true);
    assert.equal(v.blocks, 2);
    const kinds = env.DB.__tables.agenda_chain.map((b) => b.ref_kind).sort();
    assert.deepEqual(kinds, ['mundur', 'reguler']);
});

test('endpoint verify/history menolak parameter ngawur', async () => {
    const env = { DB: makeFakeDB() };
    const bad = await (await handleChainHistory(req({}, ''), env, urlOf('http://x/api/chain/history?ref_kind=liar'))).json();
    assert.equal(bad.success, false);
    const ok = await (await handleChainVerify(req({}, ''), env, urlOf('http://x/api/chain/verify?tahun=ALL'))).json();
    assert.equal(ok.success, true);
    assert.equal(ok.valid, true);
    assert.equal(ok.blocks, 0);
    assert.equal(ok.head, null);
});

test('data lama aman: mutasi baris lain tak menyentuh legacy; update/hapus legacy jalan', async () => {
    const env = { DB: makeFakeDB() };
    const tglA = hariKerjaLewat(6);
    const tglB = hariKerjaLewat(5);
    const tahun = parseInt(tglA.split('-')[0], 10);
    const ins = (no, tgl, perihal) => env.DB.prepare(`INSERT INTO agenda_surat (tahun, no_urut, tgl_surat, tgl_kirim, bentuk_surat,
        kode_klasifikasi_encrypted, nomor_lengkap_encrypted, penanggung_jawab_encrypted,
        perihal_encrypted, instansi_encrypted, petugas_encrypted, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(tahun, no, tgl, tgl, 'eSurat (Elektronik)', ENC('K'), ENC('N'), ENC('PJ'), ENC(perihal), ENC('IN'), ENC('PT'), `${tgl} 01:00:00`).run();
    await ins(1, tglA, 'Legacy Satu');
    await ins(2, tglB, 'Legacy Dua');
    const fotoLegacy = JSON.parse(JSON.stringify(env.DB.__tables.agenda_surat));

    // 1. Terbitkan nomor BARU via handler baru -> kedua legacy wajib identik
    const tglC = hariKerjaLewat(2);
    const c = await (await handleCreateAgenda(req(bodyReguler(tglC, 'Baru')), env)).json();
    assert.equal(c.success, true);
    assert.deepEqual(env.DB.__tables.agenda_surat.slice(0, 2), fotoLegacy);

    // 2. Koreksi legacy no.1 -> hanya baris itu berubah + blok koreksi
    const u = await (await handleUpdateAgenda(req({ ...bodyReguler(tglA, 'Legacy Satu Ralat') }), env, '1')).json();
    assert.equal(u.success, true);
    const setelah = env.DB.__tables.agenda_surat;
    assert.equal(setelah.length, 3);
    assert.deepEqual(setelah[1], fotoLegacy[1], 'legacy no.2 tak tersentuh');
    assert.equal(setelah[0].perihal_encrypted, ENC('Legacy Satu Ralat'));
    for (const kol of ['tahun', 'no_urut', 'tgl_surat', 'bentuk_surat']) {
        assert.equal(setelah[0][kol], fotoLegacy[0][kol], `kolom ${kol} legacy lestari`);
    }

    // 3. Hapus legacy no.2 yang bukan terakhir -> DITOLAK (hanya max boleh hapus)
    const tolak = await handleDeleteAgenda(req({}, ''), env, '2');
    assert.equal(tolak.status, 409);
    const tolakJson = await tolak.json();
    assert.equal(tolakJson.success, false);
    assert.equal(tolakJson.kode, 'NOMOR_TERKUNCI');
    assert.match(tolakJson.error, /tidak dapat dihapus/i);
    assert.match(tolakJson.error, /administrator/i);
    assert.ok(env.DB.__tables.agenda_surat.find((r) => r.no_urut === 2), 'baris terkunci tidak terhapus');
    assert.equal(env.DB.__tables.agenda_chain.find((b) => b.kind === 'hapus'), undefined, 'tanpa tombstone untuk penolakan');

    // 3b. Hapus nomor terakhir (Baru) -> sah + tombstone kaya di rantai
    const dRes = await handleDeleteAgenda(req({}, ''), env, String(c.id));
    assert.equal(dRes.status, 200);
    const d = await dRes.json();
    assert.equal(d.success, true);
    assert.equal(env.DB.__tables.agenda_surat.find((r) => r.no_urut === c.nomorUrut), undefined);
    const tomb = env.DB.__tables.agenda_chain.find((b) => b.kind === 'hapus');
    assert.ok(tomb, 'tombstone tercatat');
    assert.equal(tomb.perihal_encrypted, ENC('Baru'), 'snapshot hapus = isi terakhir');

    // 4. Backfill menutup yang belum berantai -> seluruh rantai valid
    const b = await (await handleChainBackfill(req({}, ''), env)).json();
    assert.equal(b.success, true);
    const v = await verifyChain(env, null);
    assert.equal(v.valid, true, JSON.stringify(v.mismatches));
});

test('list menempelkan rantai mikro per baris (_rantai: cuplikan + versi)', async () => {
    const { handleGetAgenda } = await import('../src/routes/agenda.js');
    const { handleGetNomorMundur } = await import('../src/routes/mundur.js');
    const env = { DB: makeFakeDB() };
    const tgl = hariKerjaLewat(2);
    const tahun = parseInt(tgl.split('-')[0], 10);
    const c1 = await (await handleCreateAgenda(req(bodyReguler(tgl, 'Satu')), env)).json();
    const c2 = await (await handleCreateAgenda(req(bodyReguler(tgl, 'Dua')), env)).json();
    await handleUpdateAgenda(req({ ...bodyReguler(tgl, 'Satu Ralat') }), env, String(c1.id));

    const list = await (await handleGetAgenda(req({}, ''), env, urlOf(`http://x/api/agenda?tahun=${tahun}`))).json();
    assert.equal(list.success, true);
    assert.equal(list.data.length, 2);
    const r1 = list.data.find((r) => r.no_urut === 1);
    const r2 = list.data.find((r) => r.no_urut === 2);
    assert.match(r1._rantai.pendek, /^[0-9a-f]{7}$/);
    assert.equal(r1._rantai.versi, 2);
    assert.match(r2._rantai.pendek, /^[0-9a-f]{7}$/);
    assert.equal(r2._rantai.versi, 1);
    // Cuplikan = 7 char pertama blok terakhir ref tersebut
    const last1 = env.DB.__tables.agenda_chain.filter((b) => b.ref_kind === 'reguler' && b.ref_id === c1.id).pop();
    assert.equal(r1._rantai.pendek, last1.block_hash.slice(0, 7));

    const tglMun = hariKerjaLewat(4);
    await handleCreateNomorMundur(req({
        tgl_surat: tglMun, tgl_kirim: tglMun, nomor_induk: c1.nomorUrut,
        bentuk_surat: 'Surat Manual (Fisik)',
        kode_klasifikasi_encrypted: ENC('K'), nomor_lengkap_encrypted: ENC('N'),
        penanggung_jawab_encrypted: ENC('PJ'), perihal_encrypted: ENC('PR'),
        instansi_encrypted: ENC('IN'), petugas_encrypted: ENC('PT'),
    }), env);
    const lm = await (await handleGetNomorMundur(req({}, ''), env, urlOf(`http://x/api/nomor-mundur?tahun=${tahun}`))).json();
    assert.equal(lm.data.length, 1);
    assert.match(lm.data[0]._rantai.pendek, /^[0-9a-f]{7}$/);
    assert.equal(lm.data[0]._rantai.versi, 1);
});

test('verify menolak dengan kode BUTUH_BERTAHAP saat rantai melebihi batas', async () => {
    const env = { DB: makeFakeDB(), CHAIN_VERIFY_MAX: '2' };
    const tgl = hariKerjaLewat(2);
    await handleCreateAgenda(req(bodyReguler(tgl, 'A')), env);
    await handleCreateAgenda(req(bodyReguler(tgl, 'B')), env);
    await handleCreateAgenda(req(bodyReguler(tgl, 'C')), env);
    const r = await (await handleChainVerify(req({}, ''), env, urlOf('http://x/api/chain/verify?tahun=ALL'))).json();
    assert.equal(r.success, false);
    assert.equal(r.kode, 'BUTUH_BERTAHAP');
    assert.equal(r.blocks, 3);
    assert.equal(r.batas, 2);
});

test('verify memetakan galat kuota D1 ke kode KUOTA_HABIS (429)', async () => {
    const env = { DB: { prepare() { throw new Error('D1_ERROR: daily rows read limit exceeded'); } } };
    const res = await handleChainVerify(req({}, ''), env, urlOf('http://x/api/chain/verify?tahun=ALL'));
    assert.equal(res.status, 429);
    const r = await res.json();
    assert.equal(r.success, false);
    assert.equal(r.kode, 'KUOTA_HABIS');
});

test('append tahan fork: dua penulis head sama, rantai tetap linear', async () => {
    const env = { DB: makeFakeDB() };
    const mk = (i) => ({
        kind: 'terbit', refKind: 'reguler', refId: i, refNo: String(i), tahun: 2026,
        tglSurat: '2026-09-28', tglKirim: null, bentukSurat: 'eSurat (Elektronik)',
        enc: {
            kode_klasifikasi_encrypted: ENC('K' + i), nomor_lengkap_encrypted: ENC('N'),
            penanggung_jawab_encrypted: ENC('PJ'), perihal_encrypted: ENC('PR'),
            instansi_encrypted: ENC('IN'), petugas_encrypted: ENC('PT'),
        },
    });
    // Simulasi: penulis B membaca head lama lalu menulis lebih dulu via insert mentah
    const { buildChainInsert, getChainHead } = await import('../src/utils/chain.js');
    const head0 = await getChainHead(env);
    assert.equal(head0, null);
    // Penulis A menulis normal (GENESIS), penulis B dipaksa mengulang via append
    const a = await appendChainBlock(env, mk(1));
    assert.ok(a.blockHash);
    const b = await appendChainBlock(env, mk(2));
    assert.ok(b.blockHash);
    assert.notEqual(a.blockHash, b.blockHash);
    const v = await verifyChain(env, null);
    assert.equal(v.valid, false, 'blok tanpa baris operasional = yatim');
    assert.equal(v.brokenAt, null, 'link rantai utuh, hanya jangkar state yang kurang');
    assert.equal(v.mismatches[0].sebab, 'blok-yatim');
    // Bangun insert dengan prev basi wajib gagal UNIQUE (bukti anti-fork)
    const stale = await buildChainInsert(env, { ...mk(3), prevHash: GENESIS_HASH });
    await assert.rejects(stale.stmt.run(), /UNIQUE constraint failed/);
});

test('hapus KETAT: 44 terkunci saat 45 hidup, 45 boleh hapus (OPSI A)', async () => {
    const env = { DB: makeFakeDB() };
    const tgl = hariKerjaLewat(2);
    const c44 = await (await handleCreateAgenda(req(bodyReguler(tgl, 'Empat-empat')), env)).json();
    const c45 = await (await handleCreateAgenda(req(bodyReguler(tgl, 'Empat-lima')), env)).json();
    assert.equal(c44.nomorUrut + 1, c45.nomorUrut);

    const tolak = await handleDeleteAgenda(req({}, ''), env, String(c44.id));
    assert.equal(tolak.status, 409);
    const tj = await tolak.json();
    assert.equal(tj.success, false);
    assert.equal(tj.kode, 'NOMOR_TERKUNCI');
    assert.match(tj.error, /tidak dapat dihapus/i);
    assert.match(tj.error, /administrator/i);

    const boleh = await handleDeleteAgenda(req({}, ''), env, String(c45.id));
    assert.equal(boleh.status, 200);
    assert.equal((await boleh.json()).success, true);
    const v = await verifyChain(env, null);
    assert.equal(v.valid, true);
});

test('anti-yatim: induk dengan anak mundur tidak boleh hapus walau max', async () => {
    const env = { DB: makeFakeDB() };
    const tglReg = hariKerjaLewat(5);
    const c = await (await handleCreateAgenda(req(bodyReguler(tglReg, 'Induk')), env)).json();
    const tglMun = hariKerjaLewat(4);
    const m = await (await handleCreateNomorMundur(req({
        tgl_surat: tglMun, tgl_kirim: tglMun, nomor_induk: c.nomorUrut,
        bentuk_surat: 'Surat Manual (Fisik)',
        kode_klasifikasi_encrypted: ENC('K'), nomor_lengkap_encrypted: ENC('N'),
        penanggung_jawab_encrypted: ENC('PJ'), perihal_encrypted: ENC('PR'),
        instansi_encrypted: ENC('IN'), petugas_encrypted: ENC('PT'),
    }), env)).json();
    assert.equal(m.success, true);

    const tolak = await handleDeleteAgenda(req({}, ''), env, String(c.id));
    assert.equal(tolak.status, 409);
    assert.equal((await tolak.json()).kode, 'NOMOR_TERKUNCI');
});

test('hapus KETAT mundur: 400.1 terkunci saat 400.2 hidup, 400.2 boleh hapus', async () => {
    const env = { DB: makeFakeDB() };
    const tglReg = hariKerjaLewat(6);
    const c = await (await handleCreateAgenda(req(bodyReguler(tglReg, 'Induk')), env)).json();
    const tglA = hariKerjaLewat(5);
    const tglB = hariKerjaLewat(4);
    const mkMun = (tgl) => ({
        tgl_surat: tgl, tgl_kirim: tgl, nomor_induk: c.nomorUrut,
        bentuk_surat: 'Surat Manual (Fisik)',
        kode_klasifikasi_encrypted: ENC('K'), nomor_lengkap_encrypted: ENC('N'),
        penanggung_jawab_encrypted: ENC('PJ'), perihal_encrypted: ENC('PR'),
        instansi_encrypted: ENC('IN'), petugas_encrypted: ENC('PT'),
    });
    const m1 = await (await handleCreateNomorMundur(req(mkMun(tglA)), env)).json();
    const m2 = await (await handleCreateNomorMundur(req(mkMun(tglB)), env)).json();
    assert.equal(m1.success, true);
    assert.equal(m2.success, true);

    const tolak = await handleDeleteNomorMundur(req({}, ''), env, String(m1.id));
    assert.equal(tolak.status, 409);
    assert.equal((await tolak.json()).kode, 'NOMOR_TERKUNCI');

    const boleh = await handleDeleteNomorMundur(req({}, ''), env, String(m2.id));
    assert.equal(boleh.status, 200);
    assert.equal((await boleh.json()).success, true);
});

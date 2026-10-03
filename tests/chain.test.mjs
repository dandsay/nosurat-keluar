// Uji rantai berantai Hono (hash-chain ledger): primitif hash + siklus hidup
// terbit -> koreksi -> hapus + deteksi manipulasi + backfill pra-rantai.
// Port dari register_agenda_surat/tests/chain.test.mjs — handler Hono (c)
// diuji end-to-end via app.request() dengan D1 palsu + token Bearer asli.
import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/index.ts';
import {
  GENESIS_HASH, sha256Hex, canonicalPayload, refKeyOf,
  payloadHashOf, blockHashOf, appendChainBlock, verifyChain,
} from '../src/utils/chain.ts';
import { createSessionToken } from '../src/utils/auth-crypto.ts';
import { getTodayWIB } from '../src/utils/holidays.ts';

// --- D1 palsu: cukup untuk pola SQL yang dipakai router Hono ---
function makeFakeDB() {
  const tables = { agenda_surat: [], agenda_nomor_mundur: [], agenda_chain: [] };
  const seq = { agenda_surat: 0, agenda_nomor_mundur: 0, agenda_chain: 0 };

  function dupKey(table, row) {
    if (table === 'agenda_surat') return `t:${row.tahun}#n:${row.no_urut}`;
    if (table === 'agenda_nomor_mundur') return `t:${row.tahun}#i:${row.nomor_induk}#s:${row.sub_nomor}`;
    return null;
  }

  function insertRow(table, cols, params) {
    const row = {};
    cols.forEach((c, i) => { row[c] = params[i]; });
    if (row.id == null) row.id = ++seq[table];
    else if (row.id > seq[table]) seq[table] = row.id;
    if (table === 'agenda_chain') {
      if (tables.agenda_chain.some((r) => r.block_hash === row.block_hash || r.prev_hash === row.prev_hash)) {
        throw new Error(`UNIQUE constraint failed: agenda_chain.block_hash/prev_hash`);
      }
    } else {
      const k = dupKey(table, row);
      const seen = tables[table].some((r) => dupKey(table, r) === k);
      if (seen) throw new Error(`UNIQUE constraint failed: ${table}.${k}`);
    }
    tables[table].push(row);
    return { meta: { last_row_id: row.id } };
  }

  function maxOf(table, col, pred) {
    return tables[table].filter(pred).reduce((a, r) => Math.max(a, r[col] || 0), 0);
  }

  function statsOf(table, params, withTahun) {
    const [startBulan, endBulan, tahunInt] = params;
    let rows = [...tables[table]];
    if (withTahun) rows = rows.filter((r) => r.tahun === tahunInt);
    const inBulan = (r) => r.tgl_surat >= startBulan && r.tgl_surat <= endBulan;
    return [{
      total_tahun: rows.length,
      total_bulan: rows.filter(inBulan).length,
      esurat: rows.filter((r) => r.bentuk_surat === 'eSurat (Elektronik)').length,
      manual: rows.filter((r) => r.bentuk_surat === 'Surat Manual (Fisik)').length,
    }];
  }

  function execSelect(sql, params) {
    // 0. UNION tahun (stats): daftar tahun gabungan
    if (/UNION/i.test(sql) && /SELECT DISTINCT tahun/i.test(sql)) {
      const set = new Set([
        ...tables.agenda_surat.map((r) => r.tahun),
        ...tables.agenda_nomor_mundur.map((r) => r.tahun),
      ]);
      return [...set].sort((a, b) => b - a).map((tahun) => ({ tahun }));
    }
    // 1. Stats COUNT CASE
    if (/total_tahun/i.test(sql)) {
      const table = /FROM agenda_nomor_mundur/i.test(sql) ? 'agenda_nomor_mundur' : 'agenda_surat';
      return statsOf(table, params, /WHERE tahun = \?/i.test(sql));
    }
    // 2. COUNT(*) chain (guard BUTUH_BERTAHAP)
    if (/SELECT COUNT\(\*\) AS n/i.test(sql)) return [{ n: tables.agenda_chain.length }];
    // 3. MAX+1 agregat
    if (/AS next_no/i.test(sql)) {
      const mx = maxOf('agenda_surat', 'no_urut', (r) => r.tahun === params[0]);
      return [{ next_no: mx + 1 }];
    }
    if (/AS next_sub/i.test(sql)) {
      const mx = maxOf('agenda_nomor_mundur', 'sub_nomor', (r) => r.tahun === params[0] && r.nomor_induk === params[1]);
      return [{ next_sub: mx + 1 }];
    }
    if (/AS max_no/i.test(sql)) {
      return [{ max_no: maxOf('agenda_surat', 'no_urut', (r) => r.tahun === params[0]) }];
    }
    if (/AS max_sub/i.test(sql)) {
      return [{ max_sub: maxOf('agenda_nomor_mundur', 'sub_nomor', (r) => r.tahun === params[0] && r.nomor_induk === params[1]) }];
    }
    // 4. DISTINCT ref (backfill)
    if (/SELECT DISTINCT ref_kind, ref_id/i.test(sql)) {
      const seen = new Set();
      const out = [];
      for (const r of tables.agenda_chain) {
        const k = `${r.ref_kind}:${r.ref_id}`;
        if (!seen.has(k)) { seen.add(k); out.push({ ref_kind: r.ref_kind, ref_id: r.ref_id }); }
      }
      return out;
    }
    // 5. History per ref (ref_kind + ref_id) — sebelum pola ref_kind saja
    if (/WHERE ref_kind = \? AND ref_id = \?/i.test(sql)) {
      return tables.agenda_chain
        .filter((r) => r.ref_kind === params[0] && r.ref_id === params[1])
        .sort((a, b) => a.id - b.id);
    }
    // 6. Mikro rantai per list (ref_kind saja)
    if (/SELECT ref_id, block_hash FROM agenda_chain WHERE ref_kind = \?/i.test(sql)) {
      return tables.agenda_chain.filter((r) => r.ref_kind === params[0]).sort((a, b) => a.id - b.id);
    }
    // 7. Smart-detect fallback (tgl < ?) — sebelum pola (= ?) karena '<' vs '='
    if (/AND tgl_surat < \?/i.test(sql)) {
      const [tahun, tgl] = params;
      return tables.agenda_surat
        .filter((r) => r.tahun === tahun && r.tgl_surat < tgl)
        .sort((a, b) => (b.tgl_surat.localeCompare(a.tgl_surat)) || (b.no_urut - a.no_urut))
        .slice(0, 1);
    }
    // 8. Smart-detect tepat tanggal
    if (/AND tgl_surat = \?/i.test(sql) && /FROM agenda_surat/i.test(sql) && !/WHERE 1=1/i.test(sql)) {
      const [tahun, tgl] = params;
      return tables.agenda_surat
        .filter((r) => r.tahun === tahun && r.tgl_surat === tgl)
        .sort((a, b) => b.no_urut - a.no_urut)
        .slice(0, 1);
    }
    // 9. Cek anak mundur (anti-yatim)
    if (/SELECT id FROM agenda_nomor_mundur WHERE tahun = \? AND nomor_induk = \?/i.test(sql)) {
      return tables.agenda_nomor_mundur
        .filter((r) => r.tahun === params[0] && r.nomor_induk === params[1])
        .slice(0, 1);
    }
    // 10. Sub-list mundur per induk
    if (/WHERE tahun = \? AND nomor_induk = \? ORDER BY sub_nomor ASC/i.test(sql)) {
      return tables.agenda_nomor_mundur
        .filter((r) => r.tahun === params[0] && r.nomor_induk === params[1])
        .sort((a, b) => a.sub_nomor - b.sub_nomor);
    }
    // 11. List dinamis WHERE 1=1
    if (/FROM agenda_surat/i.test(sql) && /WHERE 1=1/i.test(sql)) {
      let rows = [...tables.agenda_surat];
      const p = [...params];
      if (/AND tahun = \?/i.test(sql)) { const t = p.shift(); rows = rows.filter((r) => r.tahun === t); }
      if (/AND bentuk_surat = \?/i.test(sql)) { const b = p.shift(); rows = rows.filter((r) => r.bentuk_surat === b); }
      return rows.sort((a, b) => (b.no_urut - a.no_urut) || (b.id - a.id));
    }
    if (/FROM agenda_nomor_mundur/i.test(sql) && /WHERE 1=1/i.test(sql)) {
      let rows = [...tables.agenda_nomor_mundur];
      const p = [...params];
      if (/AND tahun = \?/i.test(sql)) { const t = p.shift(); rows = rows.filter((r) => r.tahun === t); }
      if (/AND bentuk_surat = \?/i.test(sql)) { const b = p.shift(); rows = rows.filter((r) => r.bentuk_surat === b); }
      return rows.sort((a, b) => (b.nomor_induk - a.nomor_induk) || (b.sub_nomor - a.sub_nomor) || (b.id - a.id));
    }
    // 12. Cari by id
    if (/WHERE id = \?/i.test(sql)) {
      const table = (sql.match(/FROM\s+(\w+)/i) || [])[1];
      const row = (tables[table] || []).find((r) => r.id == params[0]);
      return row ? [row] : [];
    }
    // 13. Head rantai
    if (/FROM agenda_chain ORDER BY id DESC/i.test(sql)) {
      const rows = [...tables.agenda_chain].sort((a, b) => b.id - a.id);
      return /LIMIT 1/i.test(sql) ? rows.slice(0, 1) : rows;
    }
    // 14. Seluruh tabel (verify/backfill): SELECT * FROM <tabel> [+ ORDER BY id ASC]
    if (/SELECT \* FROM agenda_chain/i.test(sql)) {
      return [...tables.agenda_chain].sort((a, b) => a.id - b.id);
    }
    if (/SELECT \* FROM agenda_surat/i.test(sql)) return [...tables.agenda_surat];
    if (/SELECT \* FROM agenda_nomor_mundur/i.test(sql)) return [...tables.agenda_nomor_mundur];
    throw new Error('SQL select tak dikenal: ' + sql.slice(0, 100));
  }

  function execRun(sql, params) {
    let m = sql.match(/INSERT INTO (\w+)\s*\(([^)]+)\)/i);
    if (m) {
      const cols = m[2].split(',').map((s) => s.trim());
      return insertRow(m[1], cols, params);
    }
    m = sql.match(/UPDATE (\w+)\s+SET\s+([\s\S]+?)\s+WHERE id = \?/i);
    if (m) {
      const assigns = m[2].split(',').map((s) => s.trim());
      const id = params[params.length - 1];
      const row = tables[m[1]].find((r) => r.id == id);
      if (row) {
        let pi = 0;
        for (const a of assigns) {
          const col = a.split('=')[0].trim();
          if (/\?$/.test(a)) row[col] = params[pi++];
          else if (/CURRENT_TIMESTAMP/i.test(a)) row[col] = new Date().toISOString().slice(0, 19).replace('T', ' ');
        }
      }
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

  const db = {
    __tables: tables,
    prepare(sql) {
      const stmt = {
        _sql: sql, _params: [],
        bind(...p) { stmt._params = p; return stmt; },
        async first() {
          const rows = execSelect(stmt._sql, stmt._params);
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
        return stmts.map((s) => {
          if (/^\s*SELECT/i.test(s._sql)) return { results: execSelect(s._sql, s._params) };
          return execRun(s._sql, s._params);
        });
      } catch (err) {
        for (const k of Object.keys(tables)) tables[k] = backup[k];
        Object.assign(seq, seqBak);
        throw err;
      }
    },
  };
  return db;
}

// --- Helper HTTP: app.request() dengan Bearer asli ---
const BASE_ENV = {
  SESSION_SECRET: 'kunci-uji-hono-2026',
  ASSETS: { fetch: async () => new Response('not found', { status: 404 }) },
};
const testEnv = (db, extra = {}) => ({ ...BASE_ENV, DB: db, ...extra });

async function api(db, method, path, body, extraEnv = {}) {
  const env = testEnv(db, extraEnv);
  const token = await createSessionToken(env);
  const init = {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await app.request(path, init, env, {});
  let json = null;
  try { json = await res.json(); } catch { /* bukan JSON */ }
  return { res, json };
}

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
function bodyMundur(tgl, induk) {
  return {
    tgl_surat: tgl, tgl_kirim: tgl, nomor_induk: induk,
    bentuk_surat: 'Surat Manual (Fisik)',
    kode_klasifikasi_encrypted: ENC('K'), nomor_lengkap_encrypted: ENC('N'),
    penanggung_jawab_encrypted: ENC('PJ'), perihal_encrypted: ENC('PR'),
    instansi_encrypted: ENC('IN'), petugas_encrypted: ENC('PT'),
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

test('gatekeeper Hono: /health publik, /api tanpa token 401, auth PIN jalan', async () => {
  const db = makeFakeDB();
  const env = testEnv(db);
  // /health tanpa token
  let r = await app.request('/health', {}, env, {});
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
  // /api tanpa token -> 401
  r = await app.request('/api/agenda?tahun=2026', {}, env, {});
  assert.equal(r.status, 401);
  // verify tanpa PIN -> 400
  r = await app.request('/api/auth/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
  }, env, {});
  assert.equal(r.status, 400);
  // PIN salah -> 401 (ada delay 500ms anti-bruteforce)
  r = await app.request('/api/auth/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: 'salah' }),
  }, { ...env, APP_PIN: '123456' }, {});
  assert.equal(r.status, 401);
  // PIN benar -> 200 + token yang lolos gate
  r = await app.request('/api/auth/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '123456' }),
  }, { ...env, APP_PIN: '123456' }, {});
  assert.equal(r.status, 200);
  const { token } = await r.json();
  assert.ok(token && token.includes('.'));
  const authed = await app.request('/api/stats?tahun=ALL', {
    headers: { Authorization: `Bearer ${token}` },
  }, { ...env, APP_PIN: '123456' }, {});
  assert.equal(authed.status, 200);
  assert.equal((await authed.json()).success, true);
});

test('siklus reguler via HTTP: terbit -> koreksi -> hapus, verify selalu valid', async () => {
  const db = makeFakeDB();
  const tgl = hariKerjaLewat(2);
  const tahun = parseInt(tgl.split('-')[0], 10);

  const c = await api(db, 'POST', '/api/agenda', bodyReguler(tgl));
  assert.equal(c.res.status, 200);
  assert.equal(c.json.success, true);
  assert.match(c.json.rantai || '', /^[0-9a-f]{7}$/);

  let v = await verifyChain(testEnv(db), null);
  assert.equal(v.valid, true);
  assert.equal(v.blocks, 1);
  assert.equal(v.head.pendek.length, 7);

  const u = await api(db, 'PUT', `/api/agenda/${c.json.id}`, { ...bodyReguler(tgl, 'Perihal B') });
  assert.equal(u.json.success, true);
  v = await verifyChain(testEnv(db), null);
  assert.equal(v.valid, true);
  assert.equal(v.blocks, 2);
  assert.equal(v.revisions[`reguler:${c.json.id}`], 2);

  const h = await api(db, 'GET', `/api/chain/history?ref_kind=reguler&ref_id=${c.json.id}`);
  assert.equal(h.json.versi, 2);
  assert.deepEqual(h.json.data.map((b) => b.kind), ['terbit', 'koreksi']);

  const l = await api(db, 'GET', `/api/agenda?tahun=${tahun}`);
  assert.equal(l.json.success, true);
  const baris = l.json.data.find((x) => x.no_urut === c.json.nomorUrut);
  assert.match(baris._rantai.pendek, /^[0-9a-f]{7}$/);
  assert.equal(baris._rantai.versi, 2);

  const d = await api(db, 'DELETE', `/api/agenda/${c.json.id}`);
  assert.equal(d.json.success, true);
  v = await verifyChain(testEnv(db), null);
  assert.equal(v.valid, true);
  assert.equal(v.blocks, 3);
  assert.equal(db.__tables.agenda_surat.length, 0, 'baris operasional terhapus fisik');
  assert.equal(db.__tables.agenda_chain.length, 3, 'jejak rantai tetap kaya');
});

test('manipulasi terdeteksi: ubah snapshot rantai -> brokenAt', async () => {
  const db = makeFakeDB();
  const tgl = hariKerjaLewat(2);
  await api(db, 'POST', '/api/agenda', bodyReguler(tgl));
  db.__tables.agenda_chain[0].perihal_encrypted = 'ENC(PALSU)';
  const v = await verifyChain(testEnv(db), null);
  assert.equal(v.valid, false);
  assert.equal(v.brokenAt, 1);
});

test('manipulasi terdeteksi: ubah operasional tanpa blok -> mismatch', async () => {
  const db = makeFakeDB();
  const tgl = hariKerjaLewat(2);
  const c = await api(db, 'POST', '/api/agenda', bodyReguler(tgl));
  db.__tables.agenda_surat[0].perihal_encrypted = 'ENC(PALSU)';
  const v = await verifyChain(testEnv(db), null);
  assert.equal(v.valid, false);
  assert.equal(v.mismatches[0].sebab, 'isi-berubah-tanpa-blok');
  assert.equal(v.mismatches[0].ref, `reguler:${c.json.id}`);
});

test('data pra-rantai: tanpa-blok lalu sembuh via backfill HTTP', async () => {
  const db = makeFakeDB();
  const tgl = hariKerjaLewat(3);
  // Simulasi baris lama yang terbit sebelum rantai ada (insert langsung)
  const tahun = parseInt(tgl.split('-')[0], 10);
  await db.prepare(`INSERT INTO agenda_surat (tahun, no_urut, tgl_surat, tgl_kirim, bentuk_surat,
      kode_klasifikasi_encrypted, nomor_lengkap_encrypted, penanggung_jawab_encrypted,
      perihal_encrypted, instansi_encrypted, petugas_encrypted, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(tahun, 1, tgl, tgl, 'Surat Manual (Fisik)', ENC('K'), ENC('N'), ENC('PJ'), ENC('PR'), ENC('IN'), ENC('PT'), '2026-01-05 01:00:00').run();

  let v = await verifyChain(testEnv(db), null);
  assert.equal(v.valid, false);
  assert.equal(v.mismatches[0].sebab, 'tanpa-blok');

  const b = await api(db, 'POST', '/api/chain/backfill');
  assert.equal(b.json.success, true);
  assert.equal(b.json.dirangkai, 1);

  v = await verifyChain(testEnv(db), null);
  assert.equal(v.valid, true);
  assert.equal(v.blocks, 1);

  const b2 = await api(db, 'POST', '/api/chain/backfill');
  assert.equal(b2.json.dirangkai, 0, 'backfill idempoten');
});

test('nomor mundur ikut satu rantai gabungan yang sama', async () => {
  const db = makeFakeDB();
  const tglReg = hariKerjaLewat(5);
  const c = await api(db, 'POST', '/api/agenda', bodyReguler(tglReg));
  const tahun = parseInt(tglReg.split('-')[0], 10);
  const tglMun = hariKerjaLewat(4);
  const m = await api(db, 'POST', '/api/nomor-mundur', bodyMundur(tglMun, c.json.nomorUrut));
  assert.equal(m.json.success, true, JSON.stringify(m.json));
  const v = await verifyChain(testEnv(db), tahun);
  assert.equal(v.valid, true);
  assert.equal(v.blocks, 2);
  const kinds = db.__tables.agenda_chain.map((b) => b.ref_kind).sort();
  assert.deepEqual(kinds, ['mundur', 'reguler']);

  // smart-detect menautkan ke induk yang benar
  const s = await api(db, 'GET', `/api/nomor-mundur/smart-detect?tgl_surat=${tglMun}`);
  assert.equal(s.json.success, true);
  assert.ok('exact_match' in s.json);
  assert.ok('no_urut_lengkap' in s.json);

  // list mundur menempelkan mikro rantai
  const lm = await api(db, 'GET', `/api/nomor-mundur?tahun=${tahun}`);
  assert.equal(lm.json.data.length, 1);
  assert.match(lm.json.data[0]._rantai.pendek, /^[0-9a-f]{7}$/);
  assert.equal(lm.json.data[0]._rantai.versi, 1);
});

test('endpoint verify/history/stats menolak parameter ngawur', async () => {
  const db = makeFakeDB();
  const bad = await api(db, 'GET', '/api/chain/history?ref_kind=liar');
  assert.equal(bad.res.status, 400);
  assert.equal(bad.json.success, false);
  const ok = await api(db, 'GET', '/api/chain/verify?tahun=ALL');
  assert.equal(ok.json.success, true);
  assert.equal(ok.json.valid, true);
  assert.equal(ok.json.blocks, 0);
  assert.equal(ok.json.head, null);
  const st = await api(db, 'GET', '/api/stats?tahun=ALL');
  assert.equal(st.json.success, true);
  assert.ok('totalTahunIni' in st.json.stats);
  assert.ok(Array.isArray(st.json.stats.availableYears));
});

test('data lama aman: mutasi baris lain tak menyentuh legacy; update/hapus legacy jalan', async () => {
  const db = makeFakeDB();
  const tglA = hariKerjaLewat(6);
  const tglB = hariKerjaLewat(5);
  const tahun = parseInt(tglA.split('-')[0], 10);
  const ins = (no, tgl, perihal) => db.prepare(`INSERT INTO agenda_surat (tahun, no_urut, tgl_surat, tgl_kirim, bentuk_surat,
      kode_klasifikasi_encrypted, nomor_lengkap_encrypted, penanggung_jawab_encrypted,
      perihal_encrypted, instansi_encrypted, petugas_encrypted, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(tahun, no, tgl, tgl, 'eSurat (Elektronik)', ENC('K'), ENC('N'), ENC('PJ'), ENC(perihal), ENC('IN'), ENC('PT'), `${tgl} 01:00:00`).run();
  await ins(1, tglA, 'Legacy Satu');
  await ins(2, tglB, 'Legacy Dua');
  const fotoLegacy = JSON.parse(JSON.stringify(db.__tables.agenda_surat));

  // 1. Terbitkan nomor BARU via HTTP -> kedua legacy wajib identik
  const tglC = hariKerjaLewat(2);
  const c = await api(db, 'POST', '/api/agenda', bodyReguler(tglC, 'Baru'));
  assert.equal(c.json.success, true);
  assert.deepEqual(db.__tables.agenda_surat.slice(0, 2), fotoLegacy);

  // 2. Koreksi legacy no.1 -> hanya baris itu berubah + blok koreksi
  const u = await api(db, 'PUT', '/api/agenda/1', { ...bodyReguler(tglA, 'Legacy Satu Ralat') });
  assert.equal(u.json.success, true);
  const setelah = db.__tables.agenda_surat;
  assert.equal(setelah.length, 3);
  assert.deepEqual(setelah[1], fotoLegacy[1], 'legacy no.2 tak tersentuh');
  assert.equal(setelah[0].perihal_encrypted, ENC('Legacy Satu Ralat'));
  for (const kol of ['tahun', 'no_urut', 'tgl_surat', 'bentuk_surat']) {
    assert.equal(setelah[0][kol], fotoLegacy[0][kol], `kolom ${kol} legacy lestari`);
  }

  // 3. Hapus legacy no.2 yang bukan terakhir -> DITOLAK (hanya max boleh hapus)
  const tolak = await api(db, 'DELETE', '/api/agenda/2');
  assert.equal(tolak.res.status, 409);
  assert.equal(tolak.json.success, false);
  assert.equal(tolak.json.kode, 'NOMOR_TERKUNCI');
  assert.match(tolak.json.error, /tidak dapat dihapus/i);
  assert.match(tolak.json.error, /administrator/i);
  assert.ok(db.__tables.agenda_surat.find((r) => r.no_urut === 2), 'baris terkunci tidak terhapus');
  assert.equal(db.__tables.agenda_chain.find((b) => b.kind === 'hapus'), undefined, 'tanpa tombstone untuk penolakan');

  // 3b. Hapus nomor terakhir (Baru) -> sah + tombstone kaya di rantai
  const d = await api(db, 'DELETE', `/api/agenda/${c.json.id}`);
  assert.equal(d.res.status, 200);
  assert.equal(d.json.success, true);
  assert.equal(db.__tables.agenda_surat.find((r) => r.no_urut === c.json.nomorUrut), undefined);
  const tomb = db.__tables.agenda_chain.find((b) => b.kind === 'hapus');
  assert.ok(tomb, 'tombstone tercatat');
  assert.equal(tomb.perihal_encrypted, ENC('Baru'), 'snapshot hapus = isi terakhir');

  // 4. Backfill menutup yang belum berantai -> seluruh rantai valid
  const b = await api(db, 'POST', '/api/chain/backfill');
  assert.equal(b.json.success, true);
  const v = await verifyChain(testEnv(db), null);
  assert.equal(v.valid, true, JSON.stringify(v.mismatches));
});

test('verify menolak dengan kode BUTUH_BERTAHAP saat rantai melebihi batas', async () => {
  const db = makeFakeDB();
  const tgl = hariKerjaLewat(2);
  await api(db, 'POST', '/api/agenda', bodyReguler(tgl, 'A'));
  await api(db, 'POST', '/api/agenda', bodyReguler(tgl, 'B'));
  await api(db, 'POST', '/api/agenda', bodyReguler(tgl, 'C'));
  const r = await api(db, 'GET', '/api/chain/verify?tahun=ALL', undefined, { CHAIN_VERIFY_MAX: '2' });
  assert.equal(r.json.success, false);
  assert.equal(r.json.kode, 'BUTUH_BERTAHAP');
  assert.equal(r.json.blocks, 3);
  assert.equal(r.json.batas, 2);
});

test('verify memetakan galat kuota D1 ke kode KUOTA_HABIS (429)', async () => {
  const env = testEnv({ prepare() { throw new Error('D1_ERROR: daily rows read limit exceeded'); } });
  const token = await createSessionToken(env);
  const res = await app.request('/api/chain/verify?tahun=ALL', {
    headers: { Authorization: `Bearer ${token}` },
  }, env, {});
  assert.equal(res.status, 429);
  const r = await res.json();
  assert.equal(r.success, false);
  assert.equal(r.kode, 'KUOTA_HABIS');
});

test('append tahan fork: dua penulis head sama, rantai tetap linear', async () => {
  const { buildChainInsert, getChainHead } = await import('../src/utils/chain.ts');
  const db = makeFakeDB();
  const env = testEnv(db);
  const mk = (i) => ({
    kind: 'terbit', refKind: 'reguler', refId: i, refNo: String(i), tahun: 2026,
    tglSurat: '2026-09-28', tglKirim: null, bentukSurat: 'eSurat (Elektronik)',
    enc: {
      kode_klasifikasi_encrypted: ENC('K' + i), nomor_lengkap_encrypted: ENC('N'),
      penanggung_jawab_encrypted: ENC('PJ'), perihal_encrypted: ENC('PR'),
      instansi_encrypted: ENC('IN'), petugas_encrypted: ENC('PT'),
    },
  });
  const head0 = await getChainHead(env);
  assert.equal(head0, null);
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
  const db = makeFakeDB();
  const tgl = hariKerjaLewat(2);
  const c44 = await api(db, 'POST', '/api/agenda', bodyReguler(tgl, 'Empat-empat'));
  const c45 = await api(db, 'POST', '/api/agenda', bodyReguler(tgl, 'Empat-lima'));
  assert.equal(c44.json.nomorUrut + 1, c45.json.nomorUrut);

  const tolak = await api(db, 'DELETE', `/api/agenda/${c44.json.id}`);
  assert.equal(tolak.res.status, 409);
  assert.equal(tolak.json.success, false);
  assert.equal(tolak.json.kode, 'NOMOR_TERKUNCI');
  assert.match(tolak.json.error, /tidak dapat dihapus/i);
  assert.match(tolak.json.error, /administrator/i);

  const boleh = await api(db, 'DELETE', `/api/agenda/${c45.json.id}`);
  assert.equal(boleh.res.status, 200);
  assert.equal(boleh.json.success, true);
  const v = await verifyChain(testEnv(db), null);
  assert.equal(v.valid, true);
});

test('anti-yatim: induk dengan anak mundur tidak boleh hapus walau max', async () => {
  const db = makeFakeDB();
  const tglReg = hariKerjaLewat(5);
  const c = await api(db, 'POST', '/api/agenda', bodyReguler(tglReg, 'Induk'));
  const tglMun = hariKerjaLewat(4);
  const m = await api(db, 'POST', '/api/nomor-mundur', bodyMundur(tglMun, c.json.nomorUrut));
  assert.equal(m.json.success, true);

  const tolak = await api(db, 'DELETE', `/api/agenda/${c.json.id}`);
  assert.equal(tolak.res.status, 409);
  assert.equal(tolak.json.kode, 'NOMOR_TERKUNCI');
});

test('hapus KETAT mundur: 400.1 terkunci saat 400.2 hidup, 400.2 boleh hapus', async () => {
  const db = makeFakeDB();
  const tglReg = hariKerjaLewat(6);
  const c = await api(db, 'POST', '/api/agenda', bodyReguler(tglReg, 'Induk'));
  const tglA = hariKerjaLewat(5);
  const tglB = hariKerjaLewat(4);
  const m1 = await api(db, 'POST', '/api/nomor-mundur', bodyMundur(tglA, c.json.nomorUrut));
  const m2 = await api(db, 'POST', '/api/nomor-mundur', bodyMundur(tglB, c.json.nomorUrut));
  assert.equal(m1.json.success, true);
  assert.equal(m2.json.success, true);

  const tolak = await api(db, 'DELETE', `/api/nomor-mundur/${m1.json.id}`);
  assert.equal(tolak.res.status, 409);
  assert.equal(tolak.json.kode, 'NOMOR_TERKUNCI');

  const boleh = await api(db, 'DELETE', `/api/nomor-mundur/${m2.json.id}`);
  assert.equal(boleh.res.status, 200);
  assert.equal(boleh.json.success, true);
});

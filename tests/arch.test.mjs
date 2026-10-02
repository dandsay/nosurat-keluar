// Uji BEKU arsitektur register_agenda_surat: gagal bila struktur/keamanan inti berubah.
// Gerbang pengaman: `npm run gate` (== npm test + freeze --check) harus hijau sebelum deploy.
// Pola dipelajari dari brankas-esp32: byte-freeze + invarian logika, bukan sekadar tulisan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { isWeekend, getTodayWIB, addDays } from '../src/utils/holidays.js';

const jsDir = new URL('../public/js/', import.meta.url);
const readJS = (f) => readFileSync(new URL(f, jsDir), 'utf8');
const readRoot = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const readSrc = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('daftar modul frontend beku: tepat 9 file, tanpa file baru/liar', () => {
  const files = readdirSync(jsDir).filter((f) => f.endsWith('.js')).sort();
  assert.deepEqual(files, [
    'agenda.js', 'auth.js', 'chain.js', 'cipher.js', 'crypto.js', 'export.js', 'mundur.js', 'stats.js', 'table.js',
  ]);
});

test('daftar modul backend beku: router + 5 routes + 4 utils', () => {
  const routes = readdirSync(new URL('../src/routes/', import.meta.url)).filter((f) => f.endsWith('.js')).sort();
  assert.deepEqual(routes, ['agenda.js', 'auth.js', 'chain.js', 'mundur.js', 'stats.js']);
  const utils = readdirSync(new URL('../src/utils/', import.meta.url)).filter((f) => f.endsWith('.js')).sort();
  assert.deepEqual(utils, ['auth-crypto.js', 'chain.js', 'holidays.js', 'response.js']);
  const index = readSrc('index.js');
  assert.match(index, /handleAuthVerify/);
  assert.match(index, /handleGetAgenda/);
  assert.match(index, /handleSmartDetectNomorMundur/);
  assert.match(index, /handleStats/);
  assert.match(index, /handleChainVerify/);
});

test('parameter kripto klien beku: AES-GCM-256 + PBKDF2-SHA256 50.000 iterasi + salt dinas', () => {
  const crypto = readJS('crypto.js');
  assert.match(crypto, /AES-GCM/);
  assert.match(crypto, /length: 256/);
  assert.match(crypto, /PBKDF2/);
  assert.match(crypto, /SHA-256/);
  assert.match(crypto, /iterations: 50000/);
  assert.match(crypto, /kelurahan-aac-salt-2026/);
  assert.match(crypto, /getRandomValues\(new Uint8Array\(12\)\)/);
  // IV 12-byte + ciphertext digabung (format beku, jangan ubah diam-diam)
  assert.match(crypto, /combined\.set\(iv, 0\)/);
});

test('parameter kripto server beku: PBKDF2 100.000 + HMAC session 12 jam + timing-safe', () => {
  const auth = readSrc('utils/auth-crypto.js');
  assert.match(auth, /computePbkdf2Hash/);
  assert.match(auth, /iterations = 100000/);
  assert.match(auth, /timingSafeEqual/);
  assert.match(auth, /HMAC/);
  assert.match(auth, /SHA-256/);
  assert.match(auth, /12 \* 3600/);
  assert.match(auth, /verifySessionToken/);
  assert.match(auth, /createSessionToken/);
  const gen = readRoot('scripts/generate-pin-hash.js');
  assert.match(gen, /100000/);
  assert.match(gen, /pbkdf2\$/);
});

test('tanpa PRNG lemah di area beku', () => {
  for (const f of ['agenda', 'auth', 'chain', 'cipher', 'crypto', 'export', 'mundur', 'stats', 'table']) {
    const src = readJS(`${f}.js`);
    assert.ok(!/Math\.random\s*\(/.test(src), `${f}.js: tanpa Math.random()`);
  }
  for (const f of ['index', 'routes/agenda', 'routes/mundur', 'routes/auth', 'routes/stats', 'routes/chain', 'utils/auth-crypto', 'utils/chain', 'utils/holidays', 'utils/response']) {
    const src = readSrc(`${f}.js`);
    assert.ok(!/Math\.random\s*\(/.test(src), `src/${f}.js: tanpa Math.random()`);
  }
});

test('skema zero-knowledge beku: 6 kolom *_encrypted + indeks unik', () => {
  const schema = readRoot('schema.sql');
  for (const col of [
    'kode_klasifikasi_encrypted', 'nomor_lengkap_encrypted', 'penanggung_jawab_encrypted',
    'perihal_encrypted', 'instansi_encrypted', 'petugas_encrypted',
  ]) {
    assert.ok(schema.includes(col), `kolom ${col} wajib ada`);
  }
  // Tidak ada kolom plaintext sensitif yang bocor ke skema
  assert.ok(!/perihal TEXT/i.test(schema) || schema.includes('perihal_encrypted'), 'tanpa kolom perihal plaintext');
  assert.match(schema, /idx_agenda_tahun_no/);
  assert.match(schema, /UNIQUE.*tahun.*no_urut/si);
  assert.match(schema, /idx_mundur_unik/);
  assert.match(schema, /nomor_induk/);
  assert.match(schema, /sub_nomor/);
  assert.match(schema, /no_urut_lengkap/);
  // Ledger rantai: tabel append-only + hash link + linearitas
  assert.match(schema, /CREATE TABLE IF NOT EXISTS agenda_chain/);
  assert.match(schema, /prev_hash TEXT NOT NULL/);
  assert.match(schema, /block_hash TEXT NOT NULL/);
  assert.match(schema, /idx_chain_block/);
  assert.match(schema, /idx_chain_prev/);
  assert.match(schema, /UNIQUE INDEX IF NOT EXISTS idx_chain_prev/);
  assert.match(schema, /idx_chain_ref/);
});

test('permukaan API stabil: endpoint inti ada di router', () => {
  const index = readSrc('index.js');
  for (const ep of [
    '/api/auth/verify', '/api/stats', '/api/agenda/next-number', '/api/agenda',
    '/api/nomor-mundur/smart-detect', '/api/nomor-mundur/check', '/api/nomor-mundur',
    '/api/chain/verify', '/api/chain/history', '/api/chain/backfill',
  ]) {
    assert.ok(index.includes(ep), `endpoint ${ep} wajib ada`);
  }
  assert.match(index, /startsWith\("\/api\/agenda\/"\)/);
  assert.match(index, /startsWith\("\/api\/nomor-mundur\/"\)/);
  // Gatekeeper Bearer wajib: tanpa token -> 401
  assert.match(index, /Authorization/);
  assert.match(index, /Bearer /);
  assert.match(index, /verifySessionToken/);
  assert.match(index, /401/);
  // Static assets fallthrough tetap ada
  assert.match(index, /env\.ASSETS/);
  // CORS preflight tetap ada
  assert.match(index, /OPTIONS/);
});

test('jaring pengaman administrasi beku: weekend + 14 hari + anti-mundur', () => {
  const agenda = readSrc('routes/agenda.js');
  const mundur = readSrc('routes/mundur.js');
  // Weekend block di create agenda, update agenda, create mundur, smart-detect
  assert.match(agenda, /isWeekend\(tgl_surat\)/);
  assert.match(mundur, /isWeekend\(tglSurat\)/);
  assert.match(mundur, /isWeekend\(tgl_surat\)/);
  // Batas kirim 14 hari
  assert.match(agenda, /addDays\(tgl_surat, 14\)/);
  assert.match(mundur, /addDays\(tgl_surat, 14\)/);
  assert.ok(agenda.includes('maksimal 14 hari') || agenda.includes('Maksimal 14 hari'), 'pesan 14 hari wajib ada');
  // Anti-mundur: update agenda menolak tgl < existing, mundur mengunci tgl
  assert.match(agenda, /tgl_surat < existing\.tgl_surat/);
  assert.match(mundur, /tgl_surat !== existing\.tgl_surat/);
  assert.ok(mundur.includes('terkunci dan tidak boleh diubah'), 'kunci tgl mundur wajib ada');
  // Nomor mundur hanya untuk tanggal lewat (bukan hari ini/masa depan)
  assert.match(mundur, /getTodayWIB\(\)/);
  assert.match(mundur, /tglSurat >= todayWIB/);
  assert.match(mundur, /tgl_surat >= todayWIB/);
  // Smart-detect fallback pintar + exact_match
  assert.match(mundur, /exactMatch/);
  assert.match(mundur, /exact_match/);
  assert.match(mundur, /ORDER BY tgl_surat DESC, no_urut DESC/);
});

test('penomoran atomic beku: MAX+1 + retry 3x + UNIQUE guard', () => {
  const agenda = readSrc('routes/agenda.js');
  const mundur = readSrc('routes/mundur.js');
  assert.match(agenda, /COALESCE\(MAX\(no_urut\), 0\) \+ 1/);
  assert.match(mundur, /COALESCE\(MAX\(sub_nomor\), 0\) \+ 1/);
  assert.match(agenda, /maxAttempts = 3/);
  assert.match(mundur, /maxAttempts = 3/);
  assert.match(agenda, /UNIQUE constraint failed/);
  assert.match(mundur, /UNIQUE constraint failed/);
  // Format sub-nomor induk.sub
  assert.match(mundur, /\$\{induk\}\.\$\{subNomor\}/);
  assert.match(mundur, /\$\{nomorInduk\}\.\$\{nextSub\}/);
});

test('util kalender kedinasan murni: weekend + tambah hari + WIB', () => {
  // 2026-09-26 = Sabtu, 2026-09-27 = Minggu, 2026-09-28 = Senin
  assert.equal(isWeekend('2026-09-26'), true);
  assert.equal(isWeekend('2026-09-27'), true);
  assert.equal(isWeekend('2026-09-28'), false);
  assert.equal(isWeekend(''), false);
  assert.equal(addDays('2026-01-01', 14), '2026-01-15');
  assert.equal(addDays('2026-12-20', 14), '2027-01-03');
  assert.match(getTodayWIB(), /^\d{4}-\d{2}-\d{2}$/);
});

test('portal cipher beku: scramble deterministik ala brankas + terpasang di portal', async () => {
  // Logika murni deterministik (diport dari brankas-esp32 cipher.js)
  globalThis.window = globalThis.window || {};
  await import('../public/js/cipher.js');
  const PC = globalThis.window.PortalCipher;
  assert.equal(typeof PC, 'object');
  assert.deepEqual(
    [PC.PHASE.TYPE, PC.PHASE.SPIN0, PC.PHASE.DECRYPT, PC.PHASE.HOLD, PC.PHASE.ENCRYPT, PC.PHASE.SPIN],
    [24, 14, 24, 22, 24, 19]
  );
  const base = 'Terenkripsi End-to-End';
  assert.equal(PC.renderCipherTick(base, -1), '');
  assert.equal(PC.renderCipherTick(base, 0), '', 'intro buka dari kosong');
  const tengah = PC.renderCipherTick(base, 11);
  assert.ok(tengah.length > 0 && tengah.length < base.length, 'intro tumbuh bertahap');
  assert.equal(PC.renderCipherTick(base, PC.PHASE.INTRO + PC.PHASE.DECRYPT - 1), base);
  assert.match(PC.rotorTick(0, 0), /^[A-Z]$/);
  // Paritas engine brankas: QWERTY-Caesar +2, digit utuh, rotor PIN/KEY, slowScramble
  assert.equal(PC.qwertyShift2('qwerty'), 'ertyui');
  assert.equal(PC.qwertyShift2('p'), 's');
  assert.equal(PC.encChar('q', 0, 0, 7), 'E');
  assert.equal(PC.encChar('5', 0, 3, 7), '5');
  assert.match(PC.encChar(' ', 0, 5, 7), /^[A-Z]$/);
  assert.match(PC.slowScramble('Buka', 0), /^[A-Z]+$/);
  assert.equal(PC.rotorTick(48, 0) + PC.rotorTick(48, 1) + PC.rotorTick(48, 2), 'PIN');
  assert.equal(PC.rotorTick(120, 0) + PC.rotorTick(120, 1) + PC.rotorTick(120, 2), 'KEY');
  assert.equal(typeof globalThis.window.initPortalCipher, 'function');
  // Intro langsung acak penuh (bukan dari nol): start tick = INTRO - 1
  const cipherSrc = readJS('cipher.js');
  assert.ok(cipherSrc.includes('PHASE.INTRO - 1'), 'intro wajib mulai dari acak penuh');
  // Terpasang hanya pada frasa kunci portal login (selebihnya statis)
  const html = readRoot('public/index.html');
  assert.match(html, /<span data-scramble[^>]*>Terenkripsi End-to-End<\/span> dengan kunci lokal\./);
  assert.match(html, /js\/cipher\.js\?v=/);
  assert.match(html, /prefers-reduced-motion/);
  assert.match(html, /portal-cipher-desc/);
  assert.match(html, /shadow-orbit/);
});

test('auth backend beku: PIN verify + bruteforce delay + response JSON', () => {
  const authRoute = readSrc('routes/auth.js');
  assert.match(authRoute, /verifyPin/);
  assert.match(authRoute, /createSessionToken/);
  assert.match(authRoute, /setTimeout.*500/);
  assert.match(authRoute, /401/);
  const resp = readSrc('utils/response.js');
  assert.match(resp, /jsonResponse/);
  assert.match(resp, /application\/json/);
  assert.match(resp, /Access-Control-Allow-Origin/);
});

test('ekspor CSV memetakan field dekripsi yang benar (NOMOR + PENGELOLA)', () => {
  const exp = readJS('export.js');
  // Header kolom wajib ada
  assert.ok(exp.includes('NOMOR AGENDA'), 'header NOMOR AGENDA wajib ada');
  assert.ok(exp.includes('PENANGGUNG JAWAB PENGELOLA'), 'header PENGELOLA wajib ada');
  // Isi wajib dari field *_decrypted (bukan nama field mentah yang kosong)
  assert.match(exp, /item\.nomor_lengkap_decrypted/);
  assert.match(exp, /item\.penanggung_jawab_decrypted/);
  assert.ok(!/item\.nomor_lengkap[^_]/.test(exp), 'tanpa field nomor_lengkap mentah');
  assert.ok(!/item\.penanggung_jawab[^_]/.test(exp), 'tanpa field penanggung_jawab mentah');
});

test('konfigurasi wrangler beku: binding DB + assets ./public', () => {
  const w = readRoot('wrangler.jsonc');
  assert.match(w, /"binding": "DB"/);
  assert.match(w, /agenda-surat-db/);
  assert.match(w, /"directory": "\.\/public"/);
  assert.match(w, /"binding": "ASSETS"/);
  assert.match(w, /"main": "src\/index\.js"/);
});

test('rantai berantai beku: util hash + append di semua mutasi + UI mikro', () => {
  const chain = readSrc('utils/chain.js');
  // Primitif hash dipin: SHA-256 hex, genesis, kanonikal, retry fork
  assert.match(chain, /GENESIS_HASH = 'GENESIS'/);
  assert.match(chain, /crypto\.subtle\.digest\('SHA-256'/);
  assert.match(chain, /canonicalPayload/);
  assert.match(chain, /blockHashOf/);
  assert.match(chain, /APPEND_MAX_ATTEMPTS = 5/);
  assert.match(chain, /UNIQUE constraint failed/);
  assert.match(chain, /verifyChain/);
  // Semua 6 mutasi merangkai blok (terbit/koreksi/hapus x reguler/mundur)
  const agenda = readSrc('routes/agenda.js');
  const mundur = readSrc('routes/mundur.js');
  assert.match(agenda, /appendChainBlock/);
  assert.match(mundur, /appendChainBlock/);
  assert.match(agenda, /kind: "terbit"/);
  assert.match(agenda, /kind: "koreksi"/);
  assert.match(agenda, /kind: "hapus"/);
  assert.match(mundur, /kind: "terbit"/);
  assert.match(mundur, /kind: "koreksi"/);
  assert.match(mundur, /kind: "hapus"/);
  // Koreksi/hapus atomic via batch (operasional + rantai)
  assert.match(agenda, /env\.DB\.batch\(\[updateStmt, probe\.stmt\]\)/);
  assert.match(agenda, /env\.DB\.batch\(\[delStmt, probe\.stmt\]\)/);
  assert.match(mundur, /env\.DB\.batch\(\[updateStmt, probe\.stmt\]\)/);
  assert.match(mundur, /env\.DB\.batch\(\[delStmt, probe\.stmt\]\)/);
  // UI mikro: modul chain + kait tabel + cuplikan hash gaya git
  const ui = readJS('chain.js');
  assert.match(ui, /ChainUI/);
  assert.match(ui, /\/api\/chain\/verify/);
  assert.match(ui, /\/api\/chain\/history/);
  assert.match(ui, /slice\(0, 7\)/);
  assert.match(ui, /micro\(item\)/);
  const table = readJS('table.js');
  assert.match(table, /ChainUI/);
  assert.match(table, /ChainUI\.micro\(item\)/);
  // Cuil = pajangan (tak bisa diklik); riwayat dibuka via tombol Aksi
  const microFn = ui.match(/micro\(item\) \{[\s\S]*?\n    \},/);
  assert.ok(microFn, 'ChainUI.micro wajib ada');
  assert.ok(!/onclick/.test(microFn[0]), 'cuil hash tidak boleh diklik');
  assert.match(table, /title="Riwayat catatan"/);
  assert.match(table, /ChainUI\.openHistory\(\$\{item\.id\}, \$\{item\.is_mundur\}\)/);
  assert.match(table, /data-lucide="history"/);
  // Kontrak list: tiap baris membawa _rantai {pendek, versi}
  assert.match(agenda, /_rantai/);
  assert.match(mundur, /_rantai/);
  assert.match(agenda, /pendek: String\(last\[r\.id\]\)\.slice\(0, 7\)/);
  // Kontrak diagnosis masa depan: kode galat mesin-terbaca + batas verify
  const chainRoute = readSrc('routes/chain.js');
  assert.match(chainRoute, /BUTUH_BERTAHAP/);
  assert.match(chainRoute, /KUOTA_HABIS/);
  assert.match(chain, /CHAIN_VERIFY_MAX/);
  assert.match(chain, /kodeGalatVerify/);
  const html = readRoot('public/index.html');
  assert.match(html, /id="chainInfo"/);
  assert.match(html, /id="chainHistoryModal"/);
  assert.match(html, /js\/chain\.js\?v=/);
});

test('hapus KETAT: hanya terakhir per tahun + anti-yatim + peringatan dulu baru Edit', () => {
  const agenda = readSrc('routes/agenda.js');
  const mundur = readSrc('routes/mundur.js');
  const table = readJS('table.js');
  // Backend: guard MAX per tahun + kode 409 + pesan formal administrator
  assert.match(agenda, /COALESCE\(MAX\(no_urut\), 0\) AS max_no/);
  assert.match(agenda, /NOMOR_TERKUNCI/);
  assert.match(agenda, /409/);
  assert.match(agenda, /tidak dapat dihapus/i);
  assert.match(agenda, /administrator/i);
  assert.match(agenda, /kunciHapusReguler/);
  // Backend: anti-yatim induk beranak mundur
  assert.match(agenda, /FROM agenda_nomor_mundur WHERE tahun = \? AND nomor_induk = \? LIMIT 1/);
  // Backend mundur: guard MAX sub per induk
  assert.match(mundur, /COALESCE\(MAX\(sub_nomor\), 0\) AS max_sub/);
  assert.match(mundur, /NOMOR_TERKUNCI/);
  assert.match(mundur, /409/);
  assert.match(mundur, /kunciHapusMundur/);
  // Frontend: pra-cek + peringatan bertahap (Saya Mengerti) baru Edit + tangani 409 server
  assert.match(table, /alasanKunciHapus/);
  assert.match(table, /tampilkanPeringatanKunciHapus/);
  assert.match(table, /pendingEditSetelahPaham/);
  assert.match(table, /Saya Mengerti/);
  assert.match(table, /Nomor Tidak Dapat Dihapus/);
  assert.match(table, /result\.kode === "NOMOR_TERKUNCI"/);
});

// scripts/freeze.mjs — BEKU byte-level arsitektur (SHA-256 per file).
//
//   npm run freeze                # re-baseline manifest setelah perubahan DISETUJUI
//   node scripts/freeze.mjs --check   # verifikasi (dipakai `npm run gate`)
//
// Aturan: file dalam FROZEN yang berubah 1 byte pun (termasuk 1 angka)
// menggagalkan gate -> deploy batal. Perubahan sah: review diff,
// `npm run freeze`, commit manifest + kode bersamaan.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { globSync } from 'node:fs';

const MANIFEST = new URL('../freeze.manifest.json', import.meta.url);

// Lingkup beku: logika + kripto + infra. BUKAN kosmetik (index.html/css/img).
// - public/js/*.js      : seluruh modul frontend (kripto, auth, agenda, tabel, ekspor)
// - src/**/*.js         : seluruh backend Worker (router, routes, utils kripto)
// - schema.sql          : skema D1 (kolom *_encrypted + indeks unik)
// - wrangler.jsonc      : binding DB + assets
// - scripts/freeze.mjs  : skrip ini sendiri (anti-tamper)
const FROZEN = [
  ...globSync('public/js/*.js'),
  ...globSync('src/**/*.js'),
  'schema.sql',
  'wrangler.jsonc',
  'scripts/freeze.mjs',
].sort();

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function build() {
  const files = {};
  for (const f of FROZEN) files[f] = sha256(f);
  return { version: 1, algo: 'sha256', files };
}

if (process.argv.includes('--check')) {
  let expected;
  try {
    expected = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  } catch {
    console.error('FREEZE GAGAL: freeze.manifest.json hilang. Jalankan `npm run freeze`.');
    process.exit(1);
  }
  const actual = build();
  const problems = [];
  for (const [f, h] of Object.entries(expected.files)) {
    if (!(f in actual.files)) problems.push(`HILANG: ${f}`);
    else if (actual.files[f] !== h) problems.push(`BERUBAH: ${f}`);
  }
  for (const f of Object.keys(actual.files)) {
    if (!(f in expected.files)) problems.push(`BARU (belum dibekukan): ${f}`);
  }
  if (problems.length > 0) {
    console.error('FREEZE GAGAL — area beku berubah, proses dibatalkan:');
    for (const p of problems) console.error('  - ' + p);
    console.error('Jika perubahan disengaja: review diff, `npm run freeze`, commit bersamaan.');
    process.exit(1);
  }
  console.log(`FREEZE OK — ${Object.keys(actual.files).length} file beku identik (SHA-256).`);
} else {
  const m = build();
  writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + '\n');
  console.log(`Manifest ditulis: ${Object.keys(m.files).length} file dibekukan.`);
}

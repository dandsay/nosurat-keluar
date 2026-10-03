/**
 * Util Rantai Berantai / Hash-Chain Ledger (TS).
 * Port 1:1 dari src/utils/chain.js — kanonikal + hash dipin, jangan ubah diam-diam.
 */
import type { Env, EncryptedFields } from "../types";

export const GENESIS_HASH = "GENESIS";
const APPEND_MAX_ATTEMPTS = 5;

export interface ChainSnapshot {
  ref_kind: string;
  tahun: number;
  ref_no: string;
  tgl_surat: string | null;
  tgl_kirim: string | null;
  bentuk_surat: string | null;
  kode_klasifikasi_encrypted: string;
  nomor_lengkap_encrypted: string;
  penanggung_jawab_encrypted: string;
  perihal_encrypted: string;
  instansi_encrypted: string;
  petugas_encrypted: string;
}

export interface AppendChainInput {
  kind: "terbit" | "koreksi" | "hapus";
  refKind: "reguler" | "mundur";
  refId: number;
  refNo: string;
  tahun: number;
  tglSurat: string | null;
  tglKirim: string | null;
  bentukSurat: string | null;
  enc: EncryptedFields;
}

export async function sha256Hex(str: string): Promise<string> {
  const data = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function canonicalPayload(s: ChainSnapshot): string {
  return [
    s.ref_kind,
    String(s.tahun),
    String(s.ref_no),
    s.tgl_surat || "",
    s.tgl_kirim || "",
    s.bentuk_surat || "",
    s.kode_klasifikasi_encrypted || "",
    s.nomor_lengkap_encrypted || "",
    s.penanggung_jawab_encrypted || "",
    s.perihal_encrypted || "",
    s.instansi_encrypted || "",
    s.petugas_encrypted || "",
  ].join("|");
}

export function refKeyOf(refKind: string, tahun: number, refNo: string): string {
  return `${refKind}:${tahun}:${refNo}`;
}

export async function payloadHashOf(snapshot: ChainSnapshot): Promise<string> {
  return sha256Hex(canonicalPayload(snapshot));
}

export async function blockHashOf(
  prevHash: string,
  kind: string,
  refKey: string,
  payloadHash: string,
): Promise<string> {
  return sha256Hex([prevHash, kind, refKey, payloadHash].join("|"));
}

export async function getChainHead(env: Env): Promise<{ id: number; block_hash: string } | null> {
  return env.DB.prepare(
    "SELECT id, block_hash FROM agenda_chain ORDER BY id DESC LIMIT 1",
  ).first<{ id: number; block_hash: string }>();
}

export async function appendChainBlock(
  env: Env,
  input: AppendChainInput,
): Promise<{ id: number | null; blockHash: string; payloadHash: string; prevHash: string }> {
  const { kind, refKind, refId, refNo, tahun, tglSurat, tglKirim, bentukSurat, enc } = input;
  const refKey = refKeyOf(refKind, tahun, refNo);
  let attempts = 0;
  while (attempts < APPEND_MAX_ATTEMPTS) {
    attempts++;
    const head = await getChainHead(env);
    const prevHash = head?.block_hash || GENESIS_HASH;
    const snapshot: ChainSnapshot = {
      ref_kind: refKind,
      tahun,
      ref_no: String(refNo),
      tgl_surat: tglSurat,
      tgl_kirim: tglKirim || null,
      bentuk_surat: bentukSurat,
      kode_klasifikasi_encrypted: enc.kode_klasifikasi_encrypted,
      nomor_lengkap_encrypted: enc.nomor_lengkap_encrypted,
      penanggung_jawab_encrypted: enc.penanggung_jawab_encrypted,
      perihal_encrypted: enc.perihal_encrypted,
      instansi_encrypted: enc.instansi_encrypted,
      petugas_encrypted: enc.petugas_encrypted,
    };
    const payloadHash = await payloadHashOf(snapshot);
    const blockHash = await blockHashOf(prevHash, kind, refKey, payloadHash);
    const stmt = env.DB.prepare(
      `INSERT INTO agenda_chain (
        tahun, kind, ref_kind, ref_id, ref_no,
        tgl_surat, tgl_kirim, bentuk_surat,
        kode_klasifikasi_encrypted, nomor_lengkap_encrypted, penanggung_jawab_encrypted,
        perihal_encrypted, instansi_encrypted, petugas_encrypted,
        payload_hash, prev_hash, block_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      tahun, kind, refKind, refId, String(refNo),
      tglSurat, tglKirim || null, bentukSurat,
      enc.kode_klasifikasi_encrypted, enc.nomor_lengkap_encrypted, enc.penanggung_jawab_encrypted,
      enc.perihal_encrypted, enc.instansi_encrypted, enc.petugas_encrypted,
      payloadHash, prevHash, blockHash,
    );
    try {
      const res = await stmt.run();
      const id = (res.meta?.last_row_id as number | null) ?? null;
      return { id, blockHash, payloadHash, prevHash };
    } catch (err) {
      if (err && (err as Error).message?.includes("UNIQUE constraint failed")) continue;
      throw err;
    }
  }
  throw new Error("Rantai sibuk, silakan coba kembali.");
}

export async function buildChainInsert(
  _env: Env,
  input: AppendChainInput & { prevHash: string },
): Promise<{ stmt: D1PreparedStatement; blockHash: string; payloadHash: string }> {
  // _env tidak dipakai langsung — statement dibangun agar bisa di-batch atomic.
  void _env;
  const { kind, refKind, refId, refNo, tahun, tglSurat, tglKirim, bentukSurat, enc, prevHash } = input;
  const refKey = refKeyOf(refKind, tahun, refNo);
  const snapshot: ChainSnapshot = {
    ref_kind: refKind,
    tahun,
    ref_no: String(refNo),
    tgl_surat: tglSurat,
    tgl_kirim: tglKirim || null,
    bentuk_surat: bentukSurat,
    kode_klasifikasi_encrypted: enc.kode_klasifikasi_encrypted,
    nomor_lengkap_encrypted: enc.nomor_lengkap_encrypted,
    penanggung_jawab_encrypted: enc.penanggung_jawab_encrypted,
    perihal_encrypted: enc.perihal_encrypted,
    instansi_encrypted: enc.instansi_encrypted,
    petugas_encrypted: enc.petugas_encrypted,
  };
  const payloadHash = await payloadHashOf(snapshot);
  const blockHash = await blockHashOf(prevHash, kind, refKey, payloadHash);
  // NOTE: butuh akses DB untuk prepare — pemanggil mengoper env.DB via closure di route.
  // Untuk menjaga signature murni, gunakan global yang di-inject? Sederhananya:
  // route memanggil buildChainInsert dengan env, di sini kita butuh DB.
  // Karena _env di-void di atas agar linter diam, ambil DB dari argumen asli:
  const db = (_env as Env).DB;
  const stmt = db.prepare(
    `INSERT INTO agenda_chain (
      tahun, kind, ref_kind, ref_id, ref_no,
      tgl_surat, tgl_kirim, bentuk_surat,
      kode_klasifikasi_encrypted, nomor_lengkap_encrypted, penanggung_jawab_encrypted,
      perihal_encrypted, instansi_encrypted, petugas_encrypted,
      payload_hash, prev_hash, block_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    tahun, kind, refKind, refId, String(refNo),
    tglSurat, tglKirim || null, bentukSurat,
    enc.kode_klasifikasi_encrypted, enc.nomor_lengkap_encrypted, enc.penanggung_jawab_encrypted,
    enc.perihal_encrypted, enc.instansi_encrypted, enc.petugas_encrypted,
    payloadHash, prevHash, blockHash,
  );
  return { stmt, blockHash, payloadHash };
}

export function maxVerifyBlocks(env: Env): number {
  const n = parseInt(env?.CHAIN_VERIFY_MAX || "10000", 10);
  return Number.isFinite(n) && n > 0 ? n : 10000;
}

export function kodeGalatVerify(err: unknown): "KUOTA_HABIS" | "GALAT_VERIFY" {
  const msg = String((err as Error)?.message || err || "");
  if (/limit|quota|exceed|1027|too many/i.test(msg)) return "KUOTA_HABIS";
  return "GALAT_VERIFY";
}

export interface VerifyResult {
  valid: boolean;
  blocks: number;
  head: { id: number; hash: string; pendek: string } | null;
  brokenAt: number | null;
  mismatches: Array<{ ref: string; no: string; sebab: string }>;
  revisions: Record<string, number>;
}

export async function verifyChain(env: Env, tahunFilter: number | null): Promise<VerifyResult> {
  const { results: blocks } = await env.DB.prepare(
    "SELECT * FROM agenda_chain ORDER BY id ASC",
  ).all<Record<string, unknown>>();
  const rows = (blocks || []) as unknown as Array<Record<string, string & number> & Record<string, string>>;
  const typed = rows as unknown as Array<{
    id: number; tahun: number; kind: string; ref_kind: string; ref_id: number;
    ref_no: string; tgl_surat: string | null; tgl_kirim: string | null; bentuk_surat: string | null;
    kode_klasifikasi_encrypted: string; nomor_lengkap_encrypted: string;
    penanggung_jawab_encrypted: string; perihal_encrypted: string;
    instansi_encrypted: string; petugas_encrypted: string;
    payload_hash: string; prev_hash: string; block_hash: string;
  }>;

  let prev = GENESIS_HASH;
  let brokenAt: number | null = null;
  for (const b of typed) {
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

  const lastByRef = new Map<string, (typeof typed)[number]>();
  const revisions: Record<string, number> = {};
  for (const b of typed) {
    const key = `${b.ref_kind}:${b.ref_id}`;
    lastByRef.set(key, b);
    revisions[key] = (revisions[key] || 0) + 1;
  }

  const mismatches: VerifyResult["mismatches"] = [];
  const wantTahun = (t: number) => tahunFilter == null || Number(t) === Number(tahunFilter);
  if (brokenAt == null) {
    const { results: regRows } = await env.DB.prepare("SELECT * FROM agenda_surat").all<Record<string, unknown>>();
    const { results: munRows } = await env.DB.prepare("SELECT * FROM agenda_nomor_mundur").all<Record<string, unknown>>();
    const liveByRef = new Map<string, { row: Record<string, string & number> & Record<string, string>; refKind: string; tahun: number; refNo: string }>();
    for (const r of (regRows || []) as Array<Record<string, never>>) {
      const row = r as unknown as { id: number; tahun: number; no_urut: number; tgl_surat: string; tgl_kirim: string | null; bentuk_surat: string } & Record<string, string>;
      if (!wantTahun(row.tahun)) continue;
      liveByRef.set(`reguler:${row.id}`, { row: row as never, refKind: "reguler", tahun: row.tahun, refNo: String(row.no_urut) });
    }
    for (const r of (munRows || []) as Array<Record<string, never>>) {
      const row = r as unknown as { id: number; tahun: number; no_urut_lengkap: string; tgl_surat: string; tgl_kirim: string | null; bentuk_surat: string } & Record<string, string>;
      if (!wantTahun(row.tahun)) continue;
      liveByRef.set(`mundur:${row.id}`, { row: row as never, refKind: "mundur", tahun: row.tahun, refNo: row.no_urut_lengkap });
    }
    for (const [key, live] of liveByRef) {
      const last = lastByRef.get(key);
      if (!last || !wantTahun(last.tahun)) {
        mismatches.push({ ref: key, no: live.refNo, sebab: "tanpa-blok" });
        continue;
      }
      if (last.kind === "hapus") {
        mismatches.push({ ref: key, no: live.refNo, sebab: "hapus-tapi-masih-ada" });
        continue;
      }
      const row = live.row as unknown as Record<string, string> & { tahun: number; tgl_surat: string; tgl_kirim: string | null; bentuk_surat: string };
      const curHash = await payloadHashOf({
        ref_kind: live.refKind, tahun: row.tahun, ref_no: live.refNo,
        tgl_surat: row.tgl_surat, tgl_kirim: row.tgl_kirim, bentuk_surat: row.bentuk_surat,
        kode_klasifikasi_encrypted: row.kode_klasifikasi_encrypted,
        nomor_lengkap_encrypted: row.nomor_lengkap_encrypted,
        penanggung_jawab_encrypted: row.penanggung_jawab_encrypted,
        perihal_encrypted: row.perihal_encrypted,
        instansi_encrypted: row.instansi_encrypted,
        petugas_encrypted: row.petugas_encrypted,
      });
      if (curHash !== last.payload_hash) {
        mismatches.push({ ref: key, no: live.refNo, sebab: "isi-berubah-tanpa-blok" });
      }
    }
    for (const [key, last] of lastByRef) {
      if (last.kind !== "hapus" || !wantTahun(last.tahun)) continue;
      if (liveByRef.has(key) && !mismatches.some((m) => m.ref === key)) {
        mismatches.push({ ref: key, no: last.ref_no, sebab: "hapus-tapi-masih-ada" });
      }
    }
    for (const [key, last] of lastByRef) {
      if (last.kind === "hapus" || !wantTahun(last.tahun)) continue;
      if (!liveByRef.has(key)) {
        mismatches.push({ ref: key, no: last.ref_no, sebab: "blok-yatim" });
      }
    }
  }

  const head = typed.length > 0 ? typed[typed.length - 1] : null;
  return {
    valid: brokenAt == null && mismatches.length === 0,
    blocks: typed.length,
    head: head ? { id: head.id, hash: head.block_hash, pendek: head.block_hash.slice(0, 7) } : null,
    brokenAt,
    mismatches,
    revisions,
  };
}

/**
 * Tipe global backend Hono — Register Agenda Surat (clone belajar).
 * 1:1 dengan binding asli: DB (D1) + ASSETS + secrets PIN/session.
 */

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_PIN?: string;
  APP_PIN_HASH?: string;
  SESSION_SECRET?: string;
  CHAIN_VERIFY_MAX?: string;
}

export interface SessionPayload {
  sub: string;
  iat: number;
  exp: number;
}

export interface EncryptedFields {
  kode_klasifikasi_encrypted: string;
  nomor_lengkap_encrypted: string;
  penanggung_jawab_encrypted: string;
  perihal_encrypted: string;
  instansi_encrypted: string;
  petugas_encrypted: string;
}

/**
 * Router Stats + Chain — Hono + TS.
 * Stats mount di /api/stats, Chain mount di /api/chain.
 */
import { Hono } from "hono";
import type { Env } from "../types";
import { verifyChain, appendChainBlock, maxVerifyBlocks, kodeGalatVerify } from "../utils/chain";

export const stats = new Hono<{ Bindings: Env }>({ strict: false });

stats.get("/", async (c) => {
  try {
    const tahun = c.req.query("tahun") || new Date().getFullYear().toString();
    const isAllYear = tahun === "ALL";
    const tahunInt = parseInt(tahun, 10);
    const bulanSekarang = new Date().toISOString().substring(0, 7);
    const startBulan = `${bulanSekarang}-01`;
    const endBulan = `${bulanSekarang}-31`;

    let qSurat: D1PreparedStatement;
    let qMundur: D1PreparedStatement;
    if (isAllYear) {
      qSurat = c.env.DB.prepare(
        `SELECT COUNT(*) as total_tahun,
          COUNT(CASE WHEN tgl_surat >= ? AND tgl_surat <= ? THEN 1 END) as total_bulan,
          COUNT(CASE WHEN bentuk_surat = 'eSurat (Elektronik)' THEN 1 END) as esurat,
          COUNT(CASE WHEN bentuk_surat = 'Surat Manual (Fisik)' THEN 1 END) as manual
        FROM agenda_surat`,
      ).bind(startBulan, endBulan);
      qMundur = c.env.DB.prepare(
        `SELECT COUNT(*) as total_tahun,
          COUNT(CASE WHEN tgl_surat >= ? AND tgl_surat <= ? THEN 1 END) as total_bulan,
          COUNT(CASE WHEN bentuk_surat = 'eSurat (Elektronik)' THEN 1 END) as esurat,
          COUNT(CASE WHEN bentuk_surat = 'Surat Manual (Fisik)' THEN 1 END) as manual
        FROM agenda_nomor_mundur`,
      ).bind(startBulan, endBulan);
    } else {
      qSurat = c.env.DB.prepare(
        `SELECT COUNT(*) as total_tahun,
          COUNT(CASE WHEN tgl_surat >= ? AND tgl_surat <= ? THEN 1 END) as total_bulan,
          COUNT(CASE WHEN bentuk_surat = 'eSurat (Elektronik)' THEN 1 END) as esurat,
          COUNT(CASE WHEN bentuk_surat = 'Surat Manual (Fisik)' THEN 1 END) as manual
        FROM agenda_surat WHERE tahun = ?`,
      ).bind(startBulan, endBulan, tahunInt);
      qMundur = c.env.DB.prepare(
        `SELECT COUNT(*) as total_tahun,
          COUNT(CASE WHEN tgl_surat >= ? AND tgl_surat <= ? THEN 1 END) as total_bulan,
          COUNT(CASE WHEN bentuk_surat = 'eSurat (Elektronik)' THEN 1 END) as esurat,
          COUNT(CASE WHEN bentuk_surat = 'Surat Manual (Fisik)' THEN 1 END) as manual
        FROM agenda_nomor_mundur WHERE tahun = ?`,
      ).bind(startBulan, endBulan, tahunInt);
    }

    const qTahunList = c.env.DB.prepare(
      `SELECT DISTINCT tahun FROM (
        SELECT DISTINCT tahun FROM agenda_surat
        UNION
        SELECT DISTINCT tahun FROM agenda_nomor_mundur
      ) ORDER BY tahun DESC`,
    );

    const [resSurat, resMundur, resTahunList] = await c.env.DB.batch([qSurat, qMundur, qTahunList]);
    const suratRow = (resSurat?.results?.[0] || {}) as Record<string, number>;
    const mundurRow = (resMundur?.results?.[0] || {}) as Record<string, number>;
    const availableYears = ((resTahunList?.results || []) as Array<{ tahun: number }>).map((r) => r.tahun);
    if (!isAllYear && !isNaN(tahunInt) && !availableYears.includes(tahunInt)) {
      availableYears.unshift(tahunInt);
    }
    return c.json({
      success: true,
      stats: {
        totalTahunIni: (suratRow.total_tahun || 0) + (mundurRow.total_tahun || 0),
        totalBulanIni: (suratRow.total_bulan || 0) + (mundurRow.total_bulan || 0),
        totalESurat: (suratRow.esurat || 0) + (mundurRow.esurat || 0),
        totalManual: (suratRow.manual || 0) + (mundurRow.manual || 0),
        availableYears,
      },
    });
  } catch (err) {
    console.error("Error get stats:", err);
    return c.json({ success: false, error: "Gagal menghitung statistik." }, 500);
  }
});

export const chain = new Hono<{ Bindings: Env }>({ strict: false });

chain.get("/verify", async (c) => {
  try {
    const batas = maxVerifyBlocks(c.env);
    const hitung = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM agenda_chain").first<{ n: number }>();
    if ((hitung?.n || 0) > batas) {
      return c.json({
        success: false, kode: "BUTUH_BERTAHAP", blocks: hitung?.n, batas,
        error: `Rantai (${hitung?.n} blok) melebihi batas verifikasi penuh (${batas}). Diperlukan verifikasi bertahap.`,
      });
    }
    const tahunParam = c.req.query("tahun");
    const tahun = !tahunParam || tahunParam === "ALL" ? null : parseInt(tahunParam, 10);
    const hasil = await verifyChain(c.env, tahun);
    return c.json({ success: true, ...hasil });
  } catch (err) {
    console.error("Error verify chain:", err);
    const kode = kodeGalatVerify(err);
    const pesan = kode === "KUOTA_HABIS"
      ? "Kuota baris database harian habis (reset 00:00 UTC / 07:00 WIB). Coba lagi nanti."
      : "Gagal memverifikasi rantai.";
    return c.json({ success: false, kode, error: pesan }, kode === "KUOTA_HABIS" ? 429 : 500);
  }
});

chain.get("/history", async (c) => {
  try {
    const refKind = c.req.query("ref_kind");
    const refId = parseInt(c.req.query("ref_id") || "0", 10);
    if ((refKind !== "reguler" && refKind !== "mundur") || !refId) {
      return c.json({ success: false, error: "Parameter ref_kind (reguler|mundur) dan ref_id diperlukan." }, 400);
    }
    const { results } = await c.env.DB.prepare(
      "SELECT * FROM agenda_chain WHERE ref_kind = ? AND ref_id = ? ORDER BY id ASC",
    ).bind(refKind, refId).all();
    return c.json({ success: true, ref_kind: refKind, ref_id: refId, versi: (results || []).length, data: results || [] });
  } catch (err) {
    console.error("Error chain history:", err);
    return c.json({ success: false, error: "Gagal memuat riwayat nomor." }, 500);
  }
});

chain.post("/backfill", async (c) => {
  try {
    const { results: chained } = await c.env.DB.prepare(
      "SELECT DISTINCT ref_kind, ref_id FROM agenda_chain",
    ).all<{ ref_kind: string; ref_id: number }>();
    const sudah = new Set((chained || []).map((r) => `${r.ref_kind}:${r.ref_id}`));
    const { results: regRows } = await c.env.DB.prepare("SELECT * FROM agenda_surat").all<Record<string, string & number>>();
    const { results: munRows } = await c.env.DB.prepare("SELECT * FROM agenda_nomor_mundur").all<Record<string, string & number>>();
    const antre: Array<{ refKind: "reguler" | "mundur"; row: Record<string, string>; refNo: string }> = [];
    for (const r of (regRows || []) as Array<Record<string, string>>) {
      if (sudah.has(`reguler:${r.id}`)) continue;
      antre.push({ refKind: "reguler", row: r, refNo: String(r.no_urut) });
    }
    for (const r of (munRows || []) as Array<Record<string, string>>) {
      if (sudah.has(`mundur:${r.id}`)) continue;
      antre.push({ refKind: "mundur", row: r, refNo: r.no_urut_lengkap });
    }
    antre.sort((a, b) => String(a.row.created_at || "").localeCompare(String(b.row.created_at || "")) || Number(a.row.id) - Number(b.row.id));

    let dirangkai = 0;
    for (const item of antre) {
      const r = item.row as Record<string, string> & { id: number; tahun: number; tgl_surat: string; tgl_kirim: string | null; bentuk_surat: string };
      await appendChainBlock(c.env, {
        kind: "terbit", refKind: item.refKind, refId: Number(r.id), refNo: item.refNo,
        tahun: Number(r.tahun), tglSurat: r.tgl_surat, tglKirim: r.tgl_kirim, bentukSurat: r.bentuk_surat,
        enc: {
          kode_klasifikasi_encrypted: r.kode_klasifikasi_encrypted,
          nomor_lengkap_encrypted: r.nomor_lengkap_encrypted,
          penanggung_jawab_encrypted: r.penanggung_jawab_encrypted,
          perihal_encrypted: r.perihal_encrypted,
          instansi_encrypted: r.instansi_encrypted,
          petugas_encrypted: r.petugas_encrypted,
        },
      });
      dirangkai++;
    }
    return c.json({ success: true, dirangkai, message: `Backfill selesai: ${dirangkai} blok terbit dirangkai.` });
  } catch (err) {
    console.error("Error chain backfill:", err);
    return c.json({ success: false, error: "Gagal menjalankan backfill rantai." }, 500);
  }
});

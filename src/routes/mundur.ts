/**
 * Router Nomor Mundur — Hono + TS.
 * Mount di /api/nomor-mundur. Port 1:1 dari src/routes/mundur.js
 */
import { Hono } from "hono";
import type { Env, EncryptedFields } from "../types";
import { isWeekend, getTodayWIB, addDays } from "../utils/holidays";
import { GENESIS_HASH, appendChainBlock, buildChainInsert, getChainHead } from "../utils/chain";

const mundur = new Hono<{ Bindings: Env }>({ strict: false });

// GET /api/nomor-mundur/smart-detect?tgl_surat=YYYY-MM-DD
mundur.get("/smart-detect", async (c) => {
  try {
    const tglSurat = c.req.query("tgl_surat");
    if (!tglSurat || !/^\d{4}-\d{2}-\d{2}$/.test(tglSurat)) {
      return c.json({ success: false, error: "Parameter tgl_surat diperlukan dengan format YYYY-MM-DD." }, 400);
    }
    const todayWIB = getTodayWIB();
    if (tglSurat >= todayWIB) {
      return c.json({ success: false, error: "Tertib Administrasi: Nomor mundur hanya diperuntukkan untuk tanggal yang telah lewat (kemarin dan sebelumnya), bukan hari ini atau masa depan." }, 400);
    }
    if (isWeekend(tglSurat)) {
      return c.json({ success: false, error: "Tertib Administrasi: Tanggal yang dipilih jatuh pada hari Sabtu atau Minggu (hari libur kedinasan)." }, 400);
    }
    const tahun = parseInt(tglSurat.split("-")[0], 10);
    let suratInduk = await c.env.DB.prepare(
      "SELECT id, no_urut, tgl_surat, bentuk_surat FROM agenda_surat WHERE tahun = ? AND tgl_surat = ? ORDER BY no_urut DESC LIMIT 1",
    ).bind(tahun, tglSurat).first<{ id: number; no_urut: number; tgl_surat: string; bentuk_surat: string }>();
    let exactMatch = true;
    if (!suratInduk) {
      suratInduk = await c.env.DB.prepare(
        "SELECT id, no_urut, tgl_surat, bentuk_surat FROM agenda_surat WHERE tahun = ? AND tgl_surat < ? ORDER BY tgl_surat DESC, no_urut DESC LIMIT 1",
      ).bind(tahun, tglSurat).first<{ id: number; no_urut: number; tgl_surat: string; bentuk_surat: string }>();
      exactMatch = false;
    }
    if (!suratInduk) {
      return c.json({ success: false, error: `Belum ada surat reguler yang terbit sebelum atau pada tanggal ${tglSurat} di tahun ${tahun}.` }, 404);
    }
    const nomorInduk = suratInduk.no_urut;
    const tglInduk = suratInduk.tgl_surat;
    const rowSub = await c.env.DB.prepare(
      "SELECT COALESCE(MAX(sub_nomor), 0) + 1 AS next_sub FROM agenda_nomor_mundur WHERE tahun = ? AND nomor_induk = ?",
    ).bind(tahun, nomorInduk).first<{ next_sub: number }>();
    const nextSub = rowSub?.next_sub || 1;
    const noUrutLengkap = `${nomorInduk}.${nextSub}`;
    const { results: existingSubs } = await c.env.DB.prepare(
      "SELECT sub_nomor, no_urut_lengkap, tgl_surat FROM agenda_nomor_mundur WHERE tahun = ? AND nomor_induk = ? ORDER BY sub_nomor ASC",
    ).bind(tahun, nomorInduk).all();
    return c.json({
      success: true, tahun, tgl_surat: tglSurat, nomor_induk: nomorInduk, tgl_induk: tglInduk,
      exact_match: exactMatch, sub_nomor: nextSub, no_urut_lengkap: noUrutLengkap,
      existing_subs: existingSubs || [],
      message: exactMatch
        ? `Ditemukan surat reguler terakhir pada tanggal ${tglSurat}: No. #${nomorInduk}`
        : `Tidak ada surat keluar pada tanggal ${tglSurat}. Ditautkan ke nomor reguler terakhir sebelumnya: No. #${nomorInduk} (${tglInduk})`,
    });
  } catch (err) {
    console.error("Error smart detect nomor mundur:", err);
    return c.json({ success: false, error: "Gagal mendeteksi nomor mundur." }, 500);
  }
});

// GET /api/nomor-mundur/check?tahun=&nomor_induk=
mundur.get("/check", async (c) => {
  try {
    const tahun = parseInt(c.req.query("tahun") || new Date().getFullYear().toString(), 10);
    const nomorInduk = parseInt(c.req.query("nomor_induk") || "0", 10);
    if (!nomorInduk || isNaN(nomorInduk)) {
      return c.json({ success: false, error: "Parameter nomor_induk diperlukan" }, 400);
    }
    const rowSub = await c.env.DB.prepare(
      "SELECT COALESCE(MAX(sub_nomor), 0) + 1 AS next_sub FROM agenda_nomor_mundur WHERE tahun = ? AND nomor_induk = ?",
    ).bind(tahun, nomorInduk).first<{ next_sub: number }>();
    const nextSub = rowSub?.next_sub || 1;
    return c.json({ success: true, tahun, nomor_induk: nomorInduk, sub_nomor: nextSub, no_urut_lengkap: `${nomorInduk}.${nextSub}` });
  } catch (err) {
    console.error("Error check nomor mundur:", err);
    return c.json({ success: false, error: "Gagal mendeteksi sub-nomor." }, 500);
  }
});

// GET /api/nomor-mundur?tahun=&bentuk=
mundur.get("/", async (c) => {
  try {
    const tahun = c.req.query("tahun") || new Date().getFullYear().toString();
    const bentuk = c.req.query("bentuk");
    let query = "SELECT * FROM agenda_nomor_mundur WHERE 1=1";
    const params: Array<string | number> = [];
    if (tahun && tahun !== "ALL") {
      query += " AND tahun = ?";
      params.push(parseInt(tahun, 10));
    }
    if (bentuk && bentuk !== "ALL") {
      query += " AND bentuk_surat = ?";
      params.push(bentuk);
    }
    query += " ORDER BY nomor_induk DESC, sub_nomor DESC, id DESC";
    const stmt = c.env.DB.prepare(query);
    const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
    const rows = (results || []) as Array<Record<string, unknown> & { id: number; _rantai?: unknown }>;
    try {
      const { results: chainRows } = await c.env.DB.prepare(
        "SELECT ref_id, block_hash FROM agenda_chain WHERE ref_kind = ? ORDER BY id ASC",
      ).bind("mundur").all<{ ref_id: number; block_hash: string }>();
      const last: Record<number, string> = {};
      const cnt: Record<number, number> = {};
      for (const b of chainRows || []) {
        last[b.ref_id] = b.block_hash;
        cnt[b.ref_id] = (cnt[b.ref_id] || 0) + 1;
      }
      for (const r of rows) {
        r._rantai = last[r.id]
          ? { pendek: String(last[r.id]).slice(0, 7), versi: cnt[r.id] }
          : null;
      }
    } catch (chainErr) {
      console.error("Gagal menempel rantai mikro mundur:", chainErr);
    }
    return c.json({ success: true, data: rows });
  } catch (err) {
    console.error("Error get nomor mundur:", err);
    return c.json({ success: false, error: "Gagal memuat agenda nomor mundur." }, 500);
  }
});

interface CreateMundurBody extends EncryptedFields {
  tgl_surat: string;
  tgl_kirim?: string | null;
  nomor_induk: string | number;
  bentuk_surat: string;
}

// POST /api/nomor-mundur
mundur.post("/", async (c) => {
  try {
    const body = await c.req.json<CreateMundurBody>();
    const {
      tgl_surat, tgl_kirim, nomor_induk, bentuk_surat,
      kode_klasifikasi_encrypted, nomor_lengkap_encrypted, penanggung_jawab_encrypted,
      perihal_encrypted, instansi_encrypted, petugas_encrypted,
    } = body;
    if (!tgl_surat || !bentuk_surat || !nomor_induk) {
      return c.json({ success: false, error: "Data administrasi nomor mundur belum lengkap." }, 400);
    }
    if (isWeekend(tgl_surat)) {
      return c.json({ success: false, error: "Tertib Administrasi: Tanggal surat nomor mundur tidak boleh jatuh pada hari Sabtu atau Minggu (hari libur kedinasan)." }, 400);
    }
    const todayWIB = getTodayWIB();
    if (tgl_surat >= todayWIB) {
      return c.json({ success: false, error: "Tertib Administrasi: Nomor mundur hanya diperuntukkan untuk tanggal yang telah lewat (kemarin dan sebelumnya), bukan hari ini." }, 400);
    }
    if (tgl_kirim) {
      if (tgl_kirim < tgl_surat) {
        return c.json({ success: false, error: "Jaring Pengaman: Tanggal kirim tidak boleh lebih awal dari tanggal surat." }, 400);
      }
      const batasMaxKirim = addDays(tgl_surat, 14);
      if (batasMaxKirim && tgl_kirim > batasMaxKirim) {
        return c.json({ success: false, error: `Jaring Pengaman: Tanggal kirim maksimal 14 hari sejak tanggal surat (${batasMaxKirim}).` }, 400);
      }
    }
    if (!kode_klasifikasi_encrypted || !nomor_lengkap_encrypted || !penanggung_jawab_encrypted ||
      !perihal_encrypted || !instansi_encrypted || !petugas_encrypted) {
      return c.json({ success: false, error: "Data formulir belum lengkap. Pastikan seluruh kolom (Petugas, Kode Klasifikasi, Perihal, Instansi/Tujuan, Pengelola) telah terisi." }, 400);
    }
    const tahun = parseInt(tgl_surat.split("-")[0], 10) || new Date().getFullYear();
    const induk = parseInt(String(nomor_induk), 10);
    const enc: EncryptedFields = {
      kode_klasifikasi_encrypted, nomor_lengkap_encrypted, penanggung_jawab_encrypted,
      perihal_encrypted, instansi_encrypted, petugas_encrypted,
    };

    let attempts = 0;
    const maxAttempts = 3;
    while (attempts < maxAttempts) {
      attempts++;
      try {
        const rowSub = await c.env.DB.prepare(
          "SELECT COALESCE(MAX(sub_nomor), 0) + 1 AS next_sub FROM agenda_nomor_mundur WHERE tahun = ? AND nomor_induk = ?",
        ).bind(tahun, induk).first<{ next_sub: number }>();
        const subNomor = rowSub?.next_sub || 1;
        const noUrutLengkap = `${induk}.${subNomor}`;
        const result = await c.env.DB.prepare(
          `INSERT INTO agenda_nomor_mundur (
            tahun, tgl_surat, nomor_induk, sub_nomor, no_urut_lengkap,
            tgl_kirim, bentuk_surat,
            kode_klasifikasi_encrypted, nomor_lengkap_encrypted, penanggung_jawab_encrypted,
            perihal_encrypted, instansi_encrypted, petugas_encrypted
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          tahun, tgl_surat, induk, subNomor, noUrutLengkap, tgl_kirim || null, bentuk_surat,
          kode_klasifikasi_encrypted, nomor_lengkap_encrypted, penanggung_jawab_encrypted,
          perihal_encrypted, instansi_encrypted, petugas_encrypted,
        ).run();
        const newId = (result.meta?.last_row_id as number | null) ?? null;
        let rantai: string | null = null;
        if (newId) {
          try {
            const blok = await appendChainBlock(c.env, {
              kind: "terbit", refKind: "mundur", refId: newId,
              refNo: noUrutLengkap, tahun,
              tglSurat: tgl_surat, tglKirim: tgl_kirim ?? null, bentukSurat: bentuk_surat, enc,
            });
            rantai = blok.blockHash.slice(0, 7);
          } catch (chainErr) {
            console.error("Gagal merangkai blok terbit mundur (dipulihkan via backfill):", chainErr);
          }
        }
        return c.json({ success: true, message: "Nomor Mundur Berhasil Diterbitkan!", noUrutLengkap, sub_nomor: subNomor, id: newId, rantai });
      } catch (err) {
        if ((err as Error).message?.includes("UNIQUE constraint failed")) continue;
        throw err;
      }
    }
    return c.json({ success: false, error: "Gagal mendapatkan antrean sub-nomor karena kepadatan sistem. Silakan coba kembali." }, 500);
  } catch (err) {
    console.error("Error create nomor mundur:", err);
    return c.json({ success: false, error: "Gagal menerbitkan nomor mundur. Silakan coba kembali." }, 500);
  }
});

interface UpdateMundurBody extends EncryptedFields {
  tgl_surat: string;
  tgl_kirim?: string | null;
  bentuk_surat: string;
}

// PUT /api/nomor-mundur/:id
mundur.put("/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json<UpdateMundurBody>();
    const {
      tgl_surat, tgl_kirim, bentuk_surat,
      kode_klasifikasi_encrypted, nomor_lengkap_encrypted, penanggung_jawab_encrypted,
      perihal_encrypted, instansi_encrypted, petugas_encrypted,
    } = body;
    const existing = await c.env.DB.prepare(
      "SELECT id, tahun, no_urut_lengkap, tgl_surat FROM agenda_nomor_mundur WHERE id = ?",
    ).bind(id).first<{ id: number; tahun: number; no_urut_lengkap: string; tgl_surat: string }>();
    if (!existing) return c.json({ success: false, error: "Data nomor mundur tidak ditemukan." }, 404);
    if (tgl_surat !== existing.tgl_surat) {
      return c.json({ success: false, error: "Jaring Pengaman Administrasi: Tanggal surat pada nomor mundur terkunci dan tidak boleh diubah." }, 400);
    }
    if (tgl_kirim && tgl_surat && tgl_kirim < tgl_surat) {
      return c.json({ success: false, error: "Jaring Pengaman: Tanggal kirim tidak boleh lebih awal dari tanggal surat." }, 400);
    }
    const encBaru: EncryptedFields = {
      kode_klasifikasi_encrypted, nomor_lengkap_encrypted, penanggung_jawab_encrypted,
      perihal_encrypted, instansi_encrypted, petugas_encrypted,
    };
    let rantai: string | null = null;
    let percobaan = 0;
    while (percobaan < 3) {
      percobaan++;
      try {
        const updateStmt = c.env.DB.prepare(
          `UPDATE agenda_nomor_mundur SET
            tgl_surat = ?, tgl_kirim = ?, bentuk_surat = ?,
            kode_klasifikasi_encrypted = ?, nomor_lengkap_encrypted = ?, penanggung_jawab_encrypted = ?,
            perihal_encrypted = ?, instansi_encrypted = ?, petugas_encrypted = ?,
            updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        ).bind(
          tgl_surat, tgl_kirim || null, bentuk_surat,
          kode_klasifikasi_encrypted, nomor_lengkap_encrypted, penanggung_jawab_encrypted,
          perihal_encrypted, instansi_encrypted, petugas_encrypted, id,
        );
        const head = await getChainHead(c.env);
        const probe = await buildChainInsert(c.env, {
          kind: "koreksi", refKind: "mundur", refId: existing.id,
          refNo: existing.no_urut_lengkap, tahun: existing.tahun,
          tglSurat: tgl_surat, tglKirim: tgl_kirim ?? null, bentukSurat: bentuk_surat,
          enc: encBaru, prevHash: head?.block_hash || GENESIS_HASH,
        });
        await c.env.DB.batch([updateStmt, probe.stmt]);
        rantai = probe.blockHash.slice(0, 7);
        break;
      } catch (err) {
        if ((err as Error).message?.includes("UNIQUE constraint failed")) continue;
        throw err;
      }
    }
    if (!rantai) return c.json({ success: false, error: "Rantai sibuk, perubahan dibatalkan. Silakan coba kembali." }, 500);
    return c.json({ success: true, message: "Data nomor mundur berhasil diperbarui!", rantai });
  } catch (err) {
    console.error("Error update nomor mundur:", err);
    return c.json({ success: false, error: "Gagal memperbarui nomor mundur." }, 500);
  }
});

// DELETE /api/nomor-mundur/:id
mundur.delete("/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const row = await c.env.DB.prepare("SELECT * FROM agenda_nomor_mundur WHERE id = ?").bind(id)
      .first<Record<string, string & number> & { id: number; tahun: number; nomor_induk: number; sub_nomor: number; no_urut_lengkap: string; tgl_surat: string; tgl_kirim: string | null; bentuk_surat: string } & EncryptedFields>();
    if (!row) return c.json({ success: true, message: "Nomor mundur berhasil dihapus." });
    const kunciHapusMundur = async (target: { tahun: number; nomor_induk: number; sub_nomor: number; no_urut_lengkap: string }): Promise<string | null> => {
      const maxRow = await c.env.DB.prepare(
        "SELECT COALESCE(MAX(sub_nomor), 0) AS max_sub FROM agenda_nomor_mundur WHERE tahun = ? AND nomor_induk = ?",
      ).bind(target.tahun, target.nomor_induk).first<{ max_sub: number }>();
      const maxSub = maxRow?.max_sub || 0;
      if (target.sub_nomor < maxSub) {
        return `Nomor ${target.no_urut_lengkap} tidak dapat dihapus karena Nomor ${target.nomor_induk}.${maxSub} telah terbit setelahnya. Penghapusan akan menimbulkan celah pada urutan dan memutus kesinambungan riwayat pencatatan. Untuk memperbaiki isi surat, silakan gunakan menu Edit. Hubungi administrator apabila diperlukan tindakan khusus.`;
      }
      return null;
    };
    const alasanAwal = await kunciHapusMundur(row);
    if (alasanAwal) return c.json({ success: false, kode: "NOMOR_TERKUNCI", error: alasanAwal }, 409);
    let percobaan = 0;
    let ok = false;
    let terkunci: string | null = null;
    while (percobaan < 3 && !ok) {
      percobaan++;
      try {
        terkunci = await kunciHapusMundur(row);
        if (terkunci) break;
        const delStmt = c.env.DB.prepare("DELETE FROM agenda_nomor_mundur WHERE id = ?").bind(id);
        const head = await getChainHead(c.env);
        const probe = await buildChainInsert(c.env, {
          kind: "hapus", refKind: "mundur", refId: row.id,
          refNo: row.no_urut_lengkap, tahun: row.tahun,
          tglSurat: row.tgl_surat, tglKirim: row.tgl_kirim, bentukSurat: row.bentuk_surat,
          enc: {
            kode_klasifikasi_encrypted: row.kode_klasifikasi_encrypted,
            nomor_lengkap_encrypted: row.nomor_lengkap_encrypted,
            penanggung_jawab_encrypted: row.penanggung_jawab_encrypted,
            perihal_encrypted: row.perihal_encrypted,
            instansi_encrypted: row.instansi_encrypted,
            petugas_encrypted: row.petugas_encrypted,
          },
          prevHash: head?.block_hash || GENESIS_HASH,
        });
        await c.env.DB.batch([delStmt, probe.stmt]);
        ok = true;
      } catch (err) {
        if ((err as Error).message?.includes("UNIQUE constraint failed")) continue;
        throw err;
      }
    }
    if (terkunci) return c.json({ success: false, kode: "NOMOR_TERKUNCI", error: terkunci }, 409);
    if (!ok) return c.json({ success: false, error: "Rantai sibuk, penghapusan dibatalkan. Silakan coba kembali." }, 500);
    return c.json({ success: true, message: "Nomor mundur berhasil dihapus." });
  } catch (err) {
    console.error("Error delete nomor mundur:", err);
    return c.json({ success: false, error: "Gagal menghapus nomor mundur." }, 500);
  }
});

export default mundur;

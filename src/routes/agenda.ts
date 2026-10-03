/**
 * Router Agenda Reguler — Hono + TS.
 * Mount di /api/agenda. Port 1:1 dari src/routes/agenda.js
 */
import { Hono } from "hono";
import type { Env, EncryptedFields } from "../types";
import { isWeekend, addDays } from "../utils/holidays";
import { GENESIS_HASH, appendChainBlock, buildChainInsert, getChainHead } from "../utils/chain";

const agenda = new Hono<{ Bindings: Env }>({ strict: false });

// GET /api/agenda/next-number?tahun=2026
agenda.get("/next-number", async (c) => {
  try {
    const tahun = parseInt(c.req.query("tahun") || new Date().getFullYear().toString(), 10);
    const rowMax = await c.env.DB.prepare(
      "SELECT COALESCE(MAX(no_urut), 0) + 1 AS next_no FROM agenda_surat WHERE tahun = ?",
    ).bind(tahun).first<{ next_no: number }>();
    return c.json({ success: true, tahun, next_no: rowMax?.next_no || 1 });
  } catch (err) {
    console.error("Error get next number:", err);
    return c.json({ success: false, error: "Gagal memuat nomor urut berikutnya." }, 500);
  }
});

// GET /api/agenda?tahun=&bentuk=
agenda.get("/", async (c) => {
  try {
    const tahun = c.req.query("tahun") || new Date().getFullYear().toString();
    const bentuk = c.req.query("bentuk");
    let query = "SELECT * FROM agenda_surat WHERE 1=1";
    const params: Array<string | number> = [];
    if (tahun && tahun !== "ALL") {
      query += " AND tahun = ?";
      params.push(parseInt(tahun, 10));
    }
    if (bentuk && bentuk !== "ALL") {
      query += " AND bentuk_surat = ?";
      params.push(bentuk);
    }
    query += " ORDER BY no_urut DESC, id DESC";
    const stmt = c.env.DB.prepare(query);
    const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
    const rows = (results || []) as Array<Record<string, unknown> & { id: number; _rantai?: unknown }>;

    try {
      const { results: chainRows } = await c.env.DB.prepare(
        "SELECT ref_id, block_hash FROM agenda_chain WHERE ref_kind = ? ORDER BY id ASC",
      ).bind("reguler").all<{ ref_id: number; block_hash: string }>();
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
      console.error("Gagal menempel rantai mikro:", chainErr);
    }

    return c.json({ success: true, data: rows });
  } catch (err) {
    console.error("Error get agenda:", err);
    return c.json({ success: false, error: "Gagal memuat daftar agenda." }, 500);
  }
});

interface CreateAgendaBody extends EncryptedFields {
  tgl_surat: string;
  tgl_kirim?: string | null;
  bentuk_surat: string;
  custom_no_urut?: number;
}

// POST /api/agenda
agenda.post("/", async (c) => {
  try {
    const body = await c.req.json<CreateAgendaBody>();
    const {
      tgl_surat, tgl_kirim, bentuk_surat,
      kode_klasifikasi_encrypted, nomor_lengkap_encrypted, penanggung_jawab_encrypted,
      perihal_encrypted, instansi_encrypted, petugas_encrypted, custom_no_urut,
    } = body;

    if (!tgl_surat || !bentuk_surat) {
      return c.json({ success: false, error: "Data administrasi belum lengkap (Tanggal Surat dan Bentuk Surat wajib diisi)." }, 400);
    }
    if (isWeekend(tgl_surat)) {
      return c.json({ success: false, error: "Tertib Administrasi: Tanggal surat tidak boleh jatuh pada hari Sabtu atau Minggu (hari libur kedinasan)." }, 400);
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
    const enc: EncryptedFields = {
      kode_klasifikasi_encrypted, nomor_lengkap_encrypted, penanggung_jawab_encrypted,
      perihal_encrypted, instansi_encrypted, petugas_encrypted,
    };

    let attempts = 0;
    const maxAttempts = 3;
    while (attempts < maxAttempts) {
      attempts++;
      try {
        let nomorUrut = custom_no_urut;
        if (!nomorUrut) {
          const rowMax = await c.env.DB.prepare(
            "SELECT COALESCE(MAX(no_urut), 0) + 1 AS next_no FROM agenda_surat WHERE tahun = ?",
          ).bind(tahun).first<{ next_no: number }>();
          nomorUrut = rowMax?.next_no || 1;
        }
        const result = await c.env.DB.prepare(
          `INSERT INTO agenda_surat (
            tahun, no_urut, tgl_surat, tgl_kirim, bentuk_surat,
            kode_klasifikasi_encrypted, nomor_lengkap_encrypted, penanggung_jawab_encrypted,
            perihal_encrypted, instansi_encrypted, petugas_encrypted
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          tahun, nomorUrut, tgl_surat, tgl_kirim || null, bentuk_surat,
          kode_klasifikasi_encrypted, nomor_lengkap_encrypted, penanggung_jawab_encrypted,
          perihal_encrypted, instansi_encrypted, petugas_encrypted,
        ).run();
        const newId = (result.meta?.last_row_id as number | null) ?? null;

        let rantai: string | null = null;
        if (newId) {
          try {
            const blok = await appendChainBlock(c.env, {
              kind: "terbit", refKind: "reguler", refId: newId,
              refNo: String(nomorUrut), tahun,
              tglSurat: tgl_surat, tglKirim: tgl_kirim ?? null, bentukSurat: bentuk_surat, enc,
            });
            rantai = blok.blockHash.slice(0, 7);
          } catch (chainErr) {
            console.error("Gagal merangkai blok terbit (dipulihkan via backfill):", chainErr);
          }
        }
        return c.json({ success: true, message: "Nomor Agenda Berhasil Diterbitkan!", nomorUrut, id: newId, rantai });
      } catch (err) {
        if ((err as Error).message?.includes("UNIQUE constraint failed")) continue;
        throw err;
      }
    }
    return c.json({ success: false, error: "Gagal mendapatkan antrean nomor urut karena kepadatan sistem. Silakan coba kembali." }, 500);
  } catch (err) {
    console.error("Error create agenda:", err);
    return c.json({ success: false, error: "Gagal menerbitkan nomor agenda. Silakan coba kembali." }, 500);
  }
});

interface UpdateAgendaBody extends EncryptedFields {
  tgl_surat: string;
  tgl_kirim?: string | null;
  bentuk_surat: string;
}

// PUT /api/agenda/:id
agenda.put("/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json<UpdateAgendaBody>();
    const {
      tgl_surat, tgl_kirim, bentuk_surat,
      kode_klasifikasi_encrypted, nomor_lengkap_encrypted, penanggung_jawab_encrypted,
      perihal_encrypted, instansi_encrypted, petugas_encrypted,
    } = body;

    if (isWeekend(tgl_surat)) {
      return c.json({ success: false, error: "Tertib Administrasi: Tanggal surat tidak boleh jatuh pada hari Sabtu atau Minggu (hari libur kedinasan)." }, 400);
    }
    const existing = await c.env.DB.prepare(
      "SELECT id, tahun, no_urut, tgl_surat FROM agenda_surat WHERE id = ?",
    ).bind(id).first<{ id: number; tahun: number; no_urut: number; tgl_surat: string }>();
    if (!existing) return c.json({ success: false, error: "Data agenda tidak ditemukan." }, 404);
    if (tgl_surat < existing.tgl_surat) {
      return c.json({ success: false, error: `Jaring Pengaman Administrasi: Tanggal surat tidak boleh dimundurkan dari tanggal yang sudah ada (${existing.tgl_surat}).` }, 400);
    }
    if (tgl_kirim && tgl_surat) {
      if (tgl_kirim < tgl_surat) {
        return c.json({ success: false, error: "Jaring Pengaman: Tanggal kirim tidak boleh lebih awal dari tanggal surat." }, 400);
      }
      const batasMaxKirim = addDays(tgl_surat, 14);
      if (batasMaxKirim && tgl_kirim > batasMaxKirim) {
        return c.json({ success: false, error: `Jaring Pengaman: Tanggal kirim maksimal 14 hari sejak tanggal surat (${batasMaxKirim}).` }, 400);
      }
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
          `UPDATE agenda_surat SET
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
          kind: "koreksi", refKind: "reguler", refId: existing.id,
          refNo: String(existing.no_urut), tahun: existing.tahun,
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
    return c.json({ success: true, message: "Data agenda berhasil diperbarui!", rantai });
  } catch (err) {
    console.error("Error update agenda:", err);
    return c.json({ success: false, error: "Gagal memperbarui agenda." }, 500);
  }
});

// DELETE /api/agenda/:id
agenda.delete("/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const row = await c.env.DB.prepare("SELECT * FROM agenda_surat WHERE id = ?").bind(id)
      .first<Record<string, string & number> & { id: number; tahun: number; no_urut: number; tgl_surat: string; tgl_kirim: string | null; bentuk_surat: string } & EncryptedFields>();
    if (!row) return c.json({ success: true, message: "Agenda berhasil dihapus." });

    const kunciHapusReguler = async (target: { tahun: number; no_urut: number }): Promise<string | null> => {
      const maxRow = await c.env.DB.prepare(
        "SELECT COALESCE(MAX(no_urut), 0) AS max_no FROM agenda_surat WHERE tahun = ?",
      ).bind(target.tahun).first<{ max_no: number }>();
      const maxNo = maxRow?.max_no || 0;
      if (target.no_urut < maxNo) {
        return `Nomor #${target.no_urut} tidak dapat dihapus karena Nomor #${maxNo} telah terbit setelahnya. Penghapusan akan menimbulkan celah pada urutan agenda dan memutus kesinambungan riwayat pencatatan. Untuk memperbaiki isi surat, silakan gunakan menu Edit. Hubungi administrator apabila diperlukan tindakan khusus.`;
      }
      const anak = await c.env.DB.prepare(
        "SELECT id FROM agenda_nomor_mundur WHERE tahun = ? AND nomor_induk = ? LIMIT 1",
      ).bind(target.tahun, target.no_urut).first();
      if (anak) {
        return `Nomor #${target.no_urut} tidak dapat dihapus karena masih memiliki nomor susulan (nomor mundur) yang tercatat di bawahnya. Penghapusan akan menyebabkan nomor susulan kehilangan rujukan induknya. Selesaikan terlebih dahulu nomor susulan tersebut atau hubungi administrator. Untuk memperbaiki isi surat, silakan gunakan menu Edit.`;
      }
      return null;
    };

    const alasanAwal = await kunciHapusReguler(row);
    if (alasanAwal) return c.json({ success: false, kode: "NOMOR_TERKUNCI", error: alasanAwal }, 409);

    let percobaan = 0;
    let ok = false;
    let terkunci: string | null = null;
    while (percobaan < 3 && !ok) {
      percobaan++;
      try {
        terkunci = await kunciHapusReguler(row);
        if (terkunci) break;
        const delStmt = c.env.DB.prepare("DELETE FROM agenda_surat WHERE id = ?").bind(id);
        const head = await getChainHead(c.env);
        const probe = await buildChainInsert(c.env, {
          kind: "hapus", refKind: "reguler", refId: row.id,
          refNo: String(row.no_urut), tahun: row.tahun,
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
    return c.json({ success: true, message: "Agenda berhasil dihapus." });
  } catch (err) {
    console.error("Error delete agenda:", err);
    return c.json({ success: false, error: "Gagal menghapus agenda." }, 500);
  }
});

export default agenda;

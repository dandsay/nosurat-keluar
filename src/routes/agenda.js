/**
 * Route Handler: Manajemen Register Agenda Surat Keluar
 * Zero-Knowledge: Seluruh kolom sensitif (Klasifikasi, Nomor Lengkap, Pengelola, Perihal, Instansi, Petugas)
 * terenkripsi AES-GCM 256-bit di peramban klien.
 */
import { jsonResponse } from "../utils/response.js";
import { isWeekend, addDays } from "../utils/holidays.js";
import { GENESIS_HASH, appendChainBlock, buildChainInsert, getChainHead } from "../utils/chain.js";

// 1. GET /api/agenda/next-number - Ambil Nomor Urut Berikutnya untuk Enkripsi Klien
export async function handleGetNextNumber(request, env, url) {
    try {
        const tahun = parseInt(url.searchParams.get("tahun") || new Date().getFullYear().toString(), 10);
        const rowMax = await env.DB.prepare(
            "SELECT COALESCE(MAX(no_urut), 0) + 1 AS next_no FROM agenda_surat WHERE tahun = ?"
        ).bind(tahun).first();

        return jsonResponse({
            success: true,
            tahun,
            next_no: rowMax?.next_no || 1
        });
    } catch (err) {
        console.error("Error get next number:", err);
        return jsonResponse({ success: false, error: "Gagal memuat nomor urut berikutnya." }, 500);
    }
}

// 2. GET /api/agenda - Daftar Agenda Surat
export async function handleGetAgenda(request, env, url) {
    try {
        const tahun = url.searchParams.get("tahun") || new Date().getFullYear().toString();
        const bentuk = url.searchParams.get("bentuk");

        let query = "SELECT * FROM agenda_surat WHERE 1=1";
        const params = [];

        if (tahun && tahun !== "ALL") {
            query += " AND tahun = ?";
            params.push(parseInt(tahun, 10));
        }

        if (bentuk && bentuk !== "ALL") {
            query += " AND bentuk_surat = ?";
            params.push(bentuk);
        }

        query += " ORDER BY no_urut DESC, id DESC";

        const stmt = env.DB.prepare(query);
        const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
        const rows = results || [];

        // Rantai mikro per baris: blok terakhir + hitung versi per ref
        // (2 query ringan terindeks; tanpa _rantai = tampil bersih seperti dulu).
        try {
            const { results: chainRows } = await env.DB.prepare(
                "SELECT ref_id, block_hash FROM agenda_chain WHERE ref_kind = ? ORDER BY id ASC"
            ).bind("reguler").all();
            const last = {}, cnt = {};
            for (const b of (chainRows || [])) {
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

        return jsonResponse({
            success: true,
            data: rows
        });
    } catch (err) {
        console.error("Error get agenda:", err);
        return jsonResponse({ success: false, error: "Gagal memuat daftar agenda." }, 500);
    }
}

// 3. POST /api/agenda - Terbitkan Nomor Agenda Baru (Atomic & Zero-Knowledge)
export async function handleCreateAgenda(request, env) {
    try {
        const body = await request.json();
        const {
            tgl_surat,
            tgl_kirim,
            bentuk_surat,
            kode_klasifikasi_encrypted,
            nomor_lengkap_encrypted,
            penanggung_jawab_encrypted,
            perihal_encrypted,
            instansi_encrypted,
            petugas_encrypted,
            custom_no_urut
        } = body;

        if (!tgl_surat || !bentuk_surat) {
            return jsonResponse({
                success: false,
                error: "Data administrasi belum lengkap (Tanggal Surat dan Bentuk Surat wajib diisi)."
            }, 400);
        }

        // Tertib Administrasi: Tidak boleh menerbitkan surat hari Sabtu / Minggu
        if (isWeekend(tgl_surat)) {
            return jsonResponse({
                success: false,
                error: "Tertib Administrasi: Tanggal surat tidak boleh jatuh pada hari Sabtu atau Minggu (hari libur kedinasan)."
            }, 400);
        }

        // Jaring Pengaman: Tanggal kirim tidak boleh lebih awal dari tanggal surat dan maksimal 14 hari
        if (tgl_kirim) {
            if (tgl_kirim < tgl_surat) {
                return jsonResponse({
                    success: false,
                    error: "Jaring Pengaman: Tanggal kirim tidak boleh lebih awal dari tanggal surat."
                }, 400);
            }
            const batasMaxKirim = addDays(tgl_surat, 14);
            if (tgl_kirim > batasMaxKirim) {
                return jsonResponse({
                    success: false,
                    error: `Jaring Pengaman: Tanggal kirim maksimal 14 hari sejak tanggal surat (${batasMaxKirim}).`
                }, 400);
            }
        }

        if (!kode_klasifikasi_encrypted || !nomor_lengkap_encrypted || !penanggung_jawab_encrypted || 
            !perihal_encrypted || !instansi_encrypted || !petugas_encrypted) {
            return jsonResponse({
                success: false,
                error: "Data formulir belum lengkap. Pastikan seluruh kolom (Petugas, Kode Klasifikasi, Perihal, Instansi/Tujuan, Pengelola) telah terisi."
            }, 400);
        }

        const tahun = parseInt(tgl_surat.split("-")[0], 10) || new Date().getFullYear();

        let attempts = 0;
        const maxAttempts = 3;
        let lastError = null;

        const enc = {
            kode_klasifikasi_encrypted,
            nomor_lengkap_encrypted,
            penanggung_jawab_encrypted,
            perihal_encrypted,
            instansi_encrypted,
            petugas_encrypted
        };

        while (attempts < maxAttempts) {
            attempts++;
            try {
                let nomorUrut = custom_no_urut;
                if (!nomorUrut) {
                    const rowMax = await env.DB.prepare(
                        "SELECT COALESCE(MAX(no_urut), 0) + 1 AS next_no FROM agenda_surat WHERE tahun = ?"
                    ).bind(tahun).first();
                    nomorUrut = rowMax?.next_no || 1;
                }

                const insertStmt = env.DB.prepare(`
                    INSERT INTO agenda_surat (
                        tahun, no_urut, tgl_surat, tgl_kirim, bentuk_surat,
                        kode_klasifikasi_encrypted, nomor_lengkap_encrypted, penanggung_jawab_encrypted,
                        perihal_encrypted, instansi_encrypted, petugas_encrypted
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).bind(
                    tahun,
                    nomorUrut,
                    tgl_surat,
                    tgl_kirim || null,
                    bentuk_surat,
                    kode_klasifikasi_encrypted,
                    nomor_lengkap_encrypted,
                    penanggung_jawab_encrypted,
                    perihal_encrypted,
                    instansi_encrypted,
                    petugas_encrypted
                );

                const result = await insertStmt.run();
                const newId = result.meta?.last_row_id || null;

                // Rantai: rangkai blok 'terbit' untuk nomor baru. Id sudah
                // diketahui di titik ini; bila crash di antara keduanya,
                // POST /api/chain/backfill merangkai yang tertinggal.
                let rantai = null;
                if (newId) {
                    try {
                        const blok = await appendChainBlock(env, {
                            kind: "terbit", refKind: "reguler", refId: newId,
                            refNo: String(nomorUrut), tahun,
                            tglSurat: tgl_surat, tglKirim: tgl_kirim, bentukSurat: bentuk_surat,
                            enc
                        });
                        rantai = blok.blockHash.slice(0, 7);
                    } catch (chainErr) {
                        console.error("Gagal merangkai blok terbit (dipulihkan via backfill):", chainErr);
                    }
                }

                return jsonResponse({
                    success: true,
                    message: "Nomor Agenda Berhasil Diterbitkan!",
                    nomorUrut: nomorUrut,
                    id: newId,
                    rantai
                });
            } catch (err) {
                lastError = err;
                if (err.message && err.message.includes("UNIQUE constraint failed")) {
                    continue;
                }
                throw err;
            }
        }

        return jsonResponse({
            success: false,
            error: "Gagal mendapatkan antrean nomor urut karena kepadatan sistem. Silakan coba kembali."
        }, 500);

    } catch (err) {
        console.error("Error create agenda:", err);
        return jsonResponse({ success: false, error: "Gagal menerbitkan nomor agenda. Silakan coba kembali." }, 500);
    }
}

// 4. PUT /api/agenda/:id - Update Data Agenda
export async function handleUpdateAgenda(request, env, id) {
    try {
        const body = await request.json();
        const {
            tgl_surat,
            tgl_kirim,
            bentuk_surat,
            kode_klasifikasi_encrypted,
            nomor_lengkap_encrypted,
            penanggung_jawab_encrypted,
            perihal_encrypted,
            instansi_encrypted,
            petugas_encrypted
        } = body;

        // Tertib Administrasi: Tidak boleh mengubah tanggal surat ke hari Sabtu / Minggu
        if (isWeekend(tgl_surat)) {
            return jsonResponse({
                success: false,
                error: "Tertib Administrasi: Tanggal surat tidak boleh jatuh pada hari Sabtu atau Minggu (hari libur kedinasan)."
            }, 400);
        }

        // Jaring Pengaman EDIT: Tanggal surat tidak boleh mundur dari tanggal yang sudah ada saat ini
        const existing = await env.DB.prepare("SELECT id, tahun, no_urut, tgl_surat FROM agenda_surat WHERE id = ?").bind(id).first();
        if (!existing) {
            return jsonResponse({ success: false, error: "Data agenda tidak ditemukan." }, 404);
        }
        if (tgl_surat < existing.tgl_surat) {
            return jsonResponse({
                success: false,
                error: `Jaring Pengaman Administrasi: Tanggal surat tidak boleh dimundurkan dari tanggal yang sudah ada (${existing.tgl_surat}).`
            }, 400);
        }

        // Jaring Pengaman: Tanggal kirim tidak boleh lebih awal dari tanggal surat dan maksimal 14 hari
        if (tgl_kirim && tgl_surat) {
            if (tgl_kirim < tgl_surat) {
                return jsonResponse({
                    success: false,
                    error: "Jaring Pengaman: Tanggal kirim tidak boleh lebih awal dari tanggal surat."
                }, 400);
            }
            const batasMaxKirim = addDays(tgl_surat, 14);
            if (tgl_kirim > batasMaxKirim) {
                return jsonResponse({
                    success: false,
                    error: `Jaring Pengaman: Tanggal kirim maksimal 14 hari sejak tanggal surat (${batasMaxKirim}).`
                }, 400);
            }
        }

        // Rantai: update operasional + blok 'koreksi' dalam 1 batch atomic
        // (riwayat lama awet di blok-blok sebelumnya).
        const encBaru = {
            kode_klasifikasi_encrypted,
            nomor_lengkap_encrypted,
            penanggung_jawab_encrypted,
            perihal_encrypted,
            instansi_encrypted,
            petugas_encrypted
        };
        let rantai = null;
        let percobaan = 0;
        while (percobaan < 3) {
            percobaan++;
            try {
                const updateStmt = env.DB.prepare(`
                    UPDATE agenda_surat SET
                        tgl_surat = ?,
                        tgl_kirim = ?,
                        bentuk_surat = ?,
                        kode_klasifikasi_encrypted = ?,
                        nomor_lengkap_encrypted = ?,
                        penanggung_jawab_encrypted = ?,
                        perihal_encrypted = ?,
                        instansi_encrypted = ?,
                        petugas_encrypted = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).bind(
                    tgl_surat,
                    tgl_kirim || null,
                    bentuk_surat,
                    kode_klasifikasi_encrypted,
                    nomor_lengkap_encrypted,
                    penanggung_jawab_encrypted,
                    perihal_encrypted,
                    instansi_encrypted,
                    petugas_encrypted,
                    id
                );
                const head = await getChainHead(env);
                const probe = await buildChainInsert(env, {
                    kind: "koreksi", refKind: "reguler", refId: existing.id,
                    refNo: String(existing.no_urut), tahun: existing.tahun,
                    tglSurat: tgl_surat, tglKirim: tgl_kirim, bentukSurat: bentuk_surat,
                    enc: encBaru, prevHash: head?.block_hash || GENESIS_HASH
                });
                await env.DB.batch([updateStmt, probe.stmt]);
                rantai = probe.blockHash.slice(0, 7);
                break;
            } catch (err) {
                if (err && err.message && err.message.includes("UNIQUE constraint failed")) continue;
                throw err;
            }
        }
        if (!rantai) {
            return jsonResponse({ success: false, error: "Rantai sibuk, perubahan dibatalkan. Silakan coba kembali." }, 500);
        }

        return jsonResponse({
            success: true,
            message: "Data agenda berhasil diperbarui!",
            rantai
        });
    } catch (err) {
        console.error("Error update agenda:", err);
        return jsonResponse({ success: false, error: "Gagal memperbarui agenda." }, 500);
    }
}

// 5. DELETE /api/agenda/:id - Hapus Agenda (fisik) + blok 'hapus' sebagai jejak
// KETAT: hanya nomor terakhir per tahun yang boleh hapus.
// Nomor lama yang bukan terakhir -> 409 NOMOR_TERKUNCI (hubungi administrator, gunakan Edit).
// Anti-yatim: induk yang masih punya anak mundur -> 409.
export async function handleDeleteAgenda(request, env, id) {
    try {
        const row = await env.DB.prepare("SELECT * FROM agenda_surat WHERE id = ?").bind(id).first();
        if (!row) {
            return jsonResponse({
                success: true,
                message: "Agenda berhasil dihapus."
            });
        }
        const kunciHapusReguler = async (target) => {
            const maxRow = await env.DB.prepare(
                "SELECT COALESCE(MAX(no_urut), 0) AS max_no FROM agenda_surat WHERE tahun = ?"
            ).bind(target.tahun).first();
            const maxNo = maxRow?.max_no || 0;
            if (target.no_urut < maxNo) {
                return `Nomor #${target.no_urut} tidak dapat dihapus karena Nomor #${maxNo} telah terbit setelahnya. Penghapusan akan menimbulkan celah pada urutan agenda dan memutus kesinambungan riwayat pencatatan. Untuk memperbaiki isi surat, silakan gunakan menu Edit. Hubungi administrator apabila diperlukan tindakan khusus.`;
            }
            const anak = await env.DB.prepare(
                "SELECT id FROM agenda_nomor_mundur WHERE tahun = ? AND nomor_induk = ? LIMIT 1"
            ).bind(target.tahun, target.no_urut).first();
            if (anak) {
                return `Nomor #${target.no_urut} tidak dapat dihapus karena masih memiliki nomor susulan (nomor mundur) yang tercatat di bawahnya. Penghapusan akan menyebabkan nomor susulan kehilangan rujukan induknya. Selesaikan terlebih dahulu nomor susulan tersebut atau hubungi administrator. Untuk memperbaiki isi surat, silakan gunakan menu Edit.`;
            }
            return null;
        };
        const alasanAwal = await kunciHapusReguler(row);
        if (alasanAwal) {
            return jsonResponse({ success: false, kode: "NOMOR_TERKUNCI", error: alasanAwal }, 409);
        }
        let percobaan = 0;
        let ok = false;
        let terkunci = null;
        while (percobaan < 3 && !ok) {
            percobaan++;
            try {
                // Cek ulang tiap percobaan untuk menutup balapan antar-penulis.
                terkunci = await kunciHapusReguler(row);
                if (terkunci) break;
                const delStmt = env.DB.prepare("DELETE FROM agenda_surat WHERE id = ?").bind(id);
                const head = await getChainHead(env);
                const probe = await buildChainInsert(env, {
                    kind: "hapus", refKind: "reguler", refId: row.id,
                    refNo: String(row.no_urut), tahun: row.tahun,
                    tglSurat: row.tgl_surat, tglKirim: row.tgl_kirim, bentukSurat: row.bentuk_surat,
                    enc: {
                        kode_klasifikasi_encrypted: row.kode_klasifikasi_encrypted,
                        nomor_lengkap_encrypted: row.nomor_lengkap_encrypted,
                        penanggung_jawab_encrypted: row.penanggung_jawab_encrypted,
                        perihal_encrypted: row.perihal_encrypted,
                        instansi_encrypted: row.instansi_encrypted,
                        petugas_encrypted: row.petugas_encrypted
                    },
                    prevHash: head?.block_hash || GENESIS_HASH
                });
                await env.DB.batch([delStmt, probe.stmt]);
                ok = true;
            } catch (err) {
                if (err && err.message && err.message.includes("UNIQUE constraint failed")) continue;
                throw err;
            }
        }
        if (terkunci) {
            return jsonResponse({ success: false, kode: "NOMOR_TERKUNCI", error: terkunci }, 409);
        }
        if (!ok) {
            return jsonResponse({ success: false, error: "Rantai sibuk, penghapusan dibatalkan. Silakan coba kembali." }, 500);
        }
        return jsonResponse({
            success: true,
            message: "Agenda berhasil dihapus."
        });
    } catch (err) {
        console.error("Error delete agenda:", err);
        return jsonResponse({ success: false, error: "Gagal menghapus agenda." }, 500);
    }
}

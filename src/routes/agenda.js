/**
 * Route Handler: Manajemen Register Agenda Surat Keluar
 * Zero-Knowledge: Seluruh kolom sensitif (Klasifikasi, Nomor Lengkap, Pengelola, Perihal, Instansi, Petugas)
 * terenkripsi AES-GCM 256-bit di peramban klien.
 */
import { jsonResponse } from "../utils/response.js";
import { isWeekend, addDays } from "../utils/holidays.js";

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

        return jsonResponse({
            success: true,
            data: results || []
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

                return jsonResponse({
                    success: true,
                    message: "Nomor Agenda Berhasil Diterbitkan!",
                    nomorUrut: nomorUrut,
                    id: result.meta?.last_row_id || null
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
        const existing = await env.DB.prepare("SELECT tgl_surat FROM agenda_surat WHERE id = ?").bind(id).first();
        if (existing && tgl_surat < existing.tgl_surat) {
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

        await env.DB.prepare(`
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
        ).run();

        return jsonResponse({
            success: true,
            message: "Data agenda berhasil diperbarui!"
        });
    } catch (err) {
        console.error("Error update agenda:", err);
        return jsonResponse({ success: false, error: "Gagal memperbarui agenda." }, 500);
    }
}

// 5. DELETE /api/agenda/:id - Hapus Agenda
export async function handleDeleteAgenda(request, env, id) {
    try {
        await env.DB.prepare("DELETE FROM agenda_surat WHERE id = ?").bind(id).run();
        return jsonResponse({
            success: true,
            message: "Agenda berhasil dihapus."
        });
    } catch (err) {
        console.error("Error delete agenda:", err);
        return jsonResponse({ success: false, error: "Gagal menghapus agenda." }, 500);
    }
}

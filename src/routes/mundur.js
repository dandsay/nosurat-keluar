/**
 * Route Handler: Manajemen Agenda Nomor Mundur (Zero-Knowledge Enkripsi Penuh)
 * Seluruh klasifikasi, nomor, pengelola, perihal, instansi, dan petugas terenkripsi.
 */
import { jsonResponse } from "../utils/response.js";
import { isWeekend, getTodayWIB, addDays } from "../utils/holidays.js";

// 1. GET /api/nomor-mundur/smart-detect - Deteksi Cerdas Nomor Induk & Sub-Nomor dari Tanggal
export async function handleSmartDetectNomorMundur(request, env, url) {
    try {
        const tglSurat = url.searchParams.get("tgl_surat");
        if (!tglSurat || !/^\d{4}-\d{2}-\d{2}$/.test(tglSurat)) {
            return jsonResponse({
                success: false,
                error: "Parameter tgl_surat diperlukan dengan format YYYY-MM-DD."
            }, 400);
        }

        const todayWIB = getTodayWIB();

        // 1. Validasi: Tidak boleh hari ini atau masa depan (hanya tanggal yang telah lewat)
        if (tglSurat >= todayWIB) {
            return jsonResponse({
                success: false,
                error: "Tertib Administrasi: Nomor mundur hanya diperuntukkan untuk tanggal yang telah lewat (kemarin dan sebelumnya), bukan hari ini atau masa depan."
            }, 400);
        }

        // 2. Validasi: Tidak boleh hari Sabtu atau Minggu (Libur Kedinasan)
        if (isWeekend(tglSurat)) {
            return jsonResponse({
                success: false,
                error: "Tertib Administrasi: Tanggal yang dipilih jatuh pada hari Sabtu atau Minggu (hari libur kedinasan)."
            }, 400);
        }

        const tahun = parseInt(tglSurat.split("-")[0], 10);

        // 4. Cari Surat Reguler Terakhir
        // Prioritas A: Surat reguler tepat pada tanggal tersebut
        let suratInduk = await env.DB.prepare(
            "SELECT id, no_urut, tgl_surat, bentuk_surat FROM agenda_surat WHERE tahun = ? AND tgl_surat = ? ORDER BY no_urut DESC LIMIT 1"
        ).bind(tahun, tglSurat).first();

        let exactMatch = true;

        // Prioritas B (Fallback Pintar): Jika pada tanggal tersebut tidak ada surat sama sekali,
        // cari surat reguler terakhir SEBELUM tanggal tersebut di tahun yang sama
        if (!suratInduk) {
            suratInduk = await env.DB.prepare(
                "SELECT id, no_urut, tgl_surat, bentuk_surat FROM agenda_surat WHERE tahun = ? AND tgl_surat < ? ORDER BY tgl_surat DESC, no_urut DESC LIMIT 1"
            ).bind(tahun, tglSurat).first();
            exactMatch = false;
        }

        if (!suratInduk) {
            return jsonResponse({
                success: false,
                error: `Belum ada surat reguler yang terbit sebelum atau pada tanggal ${tglSurat} di tahun ${tahun}.`
            }, 404);
        }

        const nomorInduk = suratInduk.no_urut;
        const tglInduk = suratInduk.tgl_surat;

        // 5. Hitung Sub-Nomor Berikutnya untuk Nomor Induk Terpilih
        const rowSub = await env.DB.prepare(
            "SELECT COALESCE(MAX(sub_nomor), 0) + 1 AS next_sub FROM agenda_nomor_mundur WHERE tahun = ? AND nomor_induk = ?"
        ).bind(tahun, nomorInduk).first();

        const nextSub = rowSub?.next_sub || 1;
        const noUrutLengkap = `${nomorInduk}.${nextSub}`;

        // 6. Ambil riwayat sub-nomor yang sudah ada untuk nomor induk ini (jika ada)
        const { results: existingSubs } = await env.DB.prepare(
            "SELECT sub_nomor, no_urut_lengkap, tgl_surat FROM agenda_nomor_mundur WHERE tahun = ? AND nomor_induk = ? ORDER BY sub_nomor ASC"
        ).bind(tahun, nomorInduk).all();

        return jsonResponse({
            success: true,
            tahun,
            tgl_surat: tglSurat,
            nomor_induk: nomorInduk,
            tgl_induk: tglInduk,
            exact_match: exactMatch,
            sub_nomor: nextSub,
            no_urut_lengkap: noUrutLengkap,
            existing_subs: existingSubs || [],
            message: exactMatch
                ? `Ditemukan surat reguler terakhir pada tanggal ${tglSurat}: No. #${nomorInduk}`
                : `Tidak ada surat keluar pada tanggal ${tglSurat}. Ditautkan ke nomor reguler terakhir sebelumnya: No. #${nomorInduk} (${tglInduk})`
        });

    } catch (err) {
        console.error("Error smart detect nomor mundur:", err);
        return jsonResponse({
            success: false,
            error: "Gagal mendeteksi nomor mundur."
        }, 500);
    }
}

// 2. GET /api/nomor-mundur/check - Hitung Sub-Nomor Berikutnya untuk Nomor Induk Terpilih (Legacy/Fallback)
export async function handleCheckNomorMundur(request, env, url) {
    try {
        const tahun = parseInt(url.searchParams.get("tahun") || new Date().getFullYear().toString(), 10);
        const nomorInduk = parseInt(url.searchParams.get("nomor_induk") || "0", 10);

        if (!nomorInduk || isNaN(nomorInduk)) {
            return jsonResponse({ success: false, error: "Parameter nomor_induk diperlukan" }, 400);
        }

        const rowSub = await env.DB.prepare(
            "SELECT COALESCE(MAX(sub_nomor), 0) + 1 AS next_sub FROM agenda_nomor_mundur WHERE tahun = ? AND nomor_induk = ?"
        ).bind(tahun, nomorInduk).first();

        const nextSub = rowSub?.next_sub || 1;
        const noUrutLengkap = `${nomorInduk}.${nextSub}`;

        return jsonResponse({
            success: true,
            tahun,
            nomor_induk: nomorInduk,
            sub_nomor: nextSub,
            no_urut_lengkap: noUrutLengkap
        });

    } catch (err) {
        console.error("Error check nomor mundur:", err);
        return jsonResponse({ success: false, error: "Gagal mendeteksi sub-nomor." }, 500);
    }
}

// 3. GET /api/nomor-mundur - Ambil Daftar Nomor Mundur
export async function handleGetNomorMundur(request, env, url) {
    try {
        const tahun = url.searchParams.get("tahun") || new Date().getFullYear().toString();
        const bentuk = url.searchParams.get("bentuk");

        let query = "SELECT * FROM agenda_nomor_mundur WHERE 1=1";
        const params = [];

        if (tahun && tahun !== "ALL") {
            query += " AND tahun = ?";
            params.push(parseInt(tahun, 10));
        }

        if (bentuk && bentuk !== "ALL") {
            query += " AND bentuk_surat = ?";
            params.push(bentuk);
        }

        query += " ORDER BY nomor_induk DESC, sub_nomor DESC, id DESC";

        const stmt = env.DB.prepare(query);
        const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();

        return jsonResponse({
            success: true,
            data: results || []
        });
    } catch (err) {
        console.error("Error get nomor mundur:", err);
        return jsonResponse({ success: false, error: "Gagal memuat agenda nomor mundur." }, 500);
    }
}

// 4. POST /api/nomor-mundur - Terbitkan Nomor Mundur Baru (Zero-Knowledge)
export async function handleCreateNomorMundur(request, env) {
    try {
        const body = await request.json();
        const {
            tgl_surat,
            tgl_kirim,
            nomor_induk,
            bentuk_surat,
            kode_klasifikasi_encrypted,
            nomor_lengkap_encrypted,
            penanggung_jawab_encrypted,
            perihal_encrypted,
            instansi_encrypted,
            petugas_encrypted
        } = body;

        if (!tgl_surat || !bentuk_surat || !nomor_induk) {
            return jsonResponse({
                success: false,
                error: "Data administrasi nomor mundur belum lengkap."
            }, 400);
        }

        // Tertib Administrasi: Tidak boleh hari Sabtu / Minggu
        if (isWeekend(tgl_surat)) {
            return jsonResponse({
                success: false,
                error: "Tertib Administrasi: Tanggal surat nomor mundur tidak boleh jatuh pada hari Sabtu atau Minggu (hari libur kedinasan)."
            }, 400);
        }

        // Tertib Administrasi: Nomor mundur tidak boleh untuk hari ini (hanya untuk tanggal yang telah lewat)
        const todayWIB = getTodayWIB();
        if (tgl_surat >= todayWIB) {
            return jsonResponse({
                success: false,
                error: "Tertib Administrasi: Nomor mundur hanya diperuntukkan untuk tanggal yang telah lewat (kemarin dan sebelumnya), bukan hari ini."
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
        const induk = parseInt(nomor_induk, 10);

        let attempts = 0;
        const maxAttempts = 3;
        let lastError = null;

        while (attempts < maxAttempts) {
            attempts++;
            try {
                const rowSub = await env.DB.prepare(
                    "SELECT COALESCE(MAX(sub_nomor), 0) + 1 AS next_sub FROM agenda_nomor_mundur WHERE tahun = ? AND nomor_induk = ?"
                ).bind(tahun, induk).first();

                const subNomor = rowSub?.next_sub || 1;
                const noUrutLengkap = `${induk}.${subNomor}`;

                const insertStmt = env.DB.prepare(`
                    INSERT INTO agenda_nomor_mundur (
                        tahun, tgl_surat, nomor_induk, sub_nomor, no_urut_lengkap,
                        tgl_kirim, bentuk_surat,
                        kode_klasifikasi_encrypted, nomor_lengkap_encrypted, penanggung_jawab_encrypted,
                        perihal_encrypted, instansi_encrypted, petugas_encrypted
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).bind(
                    tahun,
                    tgl_surat,
                    induk,
                    subNomor,
                    noUrutLengkap,
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
                    message: "Nomor Mundur Berhasil Diterbitkan!",
                    noUrutLengkap: noUrutLengkap,
                    sub_nomor: subNomor,
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
            error: "Gagal mendapatkan antrean sub-nomor karena kepadatan sistem. Silakan coba kembali."
        }, 500);

    } catch (err) {
        console.error("Error create nomor mundur:", err);
        return jsonResponse({ success: false, error: "Gagal menerbitkan nomor mundur. Silakan coba kembali." }, 500);
    }
}

// 5. PUT /api/nomor-mundur/:id - Update Nomor Mundur
export async function handleUpdateNomorMundur(request, env, id) {
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

        // Jaring Pengaman: Tanggal surat nomor mundur terkunci dan tidak boleh diubah
        const existing = await env.DB.prepare("SELECT tgl_surat FROM agenda_nomor_mundur WHERE id = ?").bind(id).first();
        if (existing && tgl_surat !== existing.tgl_surat) {
            return jsonResponse({
                success: false,
                error: "Jaring Pengaman Administrasi: Tanggal surat pada nomor mundur terkunci dan tidak boleh diubah."
            }, 400);
        }

        // Jaring Pengaman: Tanggal kirim tidak boleh lebih awal dari tanggal surat
        if (tgl_kirim && tgl_surat && tgl_kirim < tgl_surat) {
            return jsonResponse({
                success: false,
                error: "Jaring Pengaman: Tanggal kirim tidak boleh lebih awal dari tanggal surat."
            }, 400);
        }

        await env.DB.prepare(`
            UPDATE agenda_nomor_mundur SET
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
            message: "Data nomor mundur berhasil diperbarui!"
        });
    } catch (err) {
        console.error("Error update nomor mundur:", err);
        return jsonResponse({ success: false, error: "Gagal memperbarui nomor mundur." }, 500);
    }
}

// 6. DELETE /api/nomor-mundur/:id - Hapus Nomor Mundur
export async function handleDeleteNomorMundur(request, env, id) {
    try {
        await env.DB.prepare("DELETE FROM agenda_nomor_mundur WHERE id = ?").bind(id).run();
        return jsonResponse({
            success: true,
            message: "Nomor mundur berhasil dihapus."
        });
    } catch (err) {
        console.error("Error delete nomor mundur:", err);
        return jsonResponse({ success: false, error: "Gagal menghapus nomor mundur." }, 500);
    }
}

/**
 * Route Handler: Statistik & Agregasi Register Agenda Surat
 */
import { jsonResponse } from "../utils/response.js";

export async function handleStats(request, env, url) {
    try {
        const tahun = url.searchParams.get("tahun") || new Date().getFullYear().toString();
        const isAllYear = tahun === "ALL";
        const tahunInt = parseInt(tahun, 10);
        const bulanSekarang = new Date().toISOString().substring(0, 7); // "YYYY-MM"
        const startBulan = `${bulanSekarang}-01`;
        const endBulan = `${bulanSekarang}-31`;

        let qSurat;
        let qMundur;

        if (isAllYear) {
            qSurat = env.DB.prepare(`
                SELECT 
                    COUNT(*) as total_tahun,
                    COUNT(CASE WHEN tgl_surat >= ? AND tgl_surat <= ? THEN 1 END) as total_bulan,
                    COUNT(CASE WHEN bentuk_surat = 'eSurat (Elektronik)' THEN 1 END) as esurat,
                    COUNT(CASE WHEN bentuk_surat = 'Surat Manual (Fisik)' THEN 1 END) as manual
                FROM agenda_surat
            `).bind(startBulan, endBulan);

            qMundur = env.DB.prepare(`
                SELECT 
                    COUNT(*) as total_tahun,
                    COUNT(CASE WHEN tgl_surat >= ? AND tgl_surat <= ? THEN 1 END) as total_bulan,
                    COUNT(CASE WHEN bentuk_surat = 'eSurat (Elektronik)' THEN 1 END) as esurat,
                    COUNT(CASE WHEN bentuk_surat = 'Surat Manual (Fisik)' THEN 1 END) as manual
                FROM agenda_nomor_mundur
            `).bind(startBulan, endBulan);
        } else {
            qSurat = env.DB.prepare(`
                SELECT 
                    COUNT(*) as total_tahun,
                    COUNT(CASE WHEN tgl_surat >= ? AND tgl_surat <= ? THEN 1 END) as total_bulan,
                    COUNT(CASE WHEN bentuk_surat = 'eSurat (Elektronik)' THEN 1 END) as esurat,
                    COUNT(CASE WHEN bentuk_surat = 'Surat Manual (Fisik)' THEN 1 END) as manual
                FROM agenda_surat
                WHERE tahun = ?
            `).bind(startBulan, endBulan, tahunInt);

            qMundur = env.DB.prepare(`
                SELECT 
                    COUNT(*) as total_tahun,
                    COUNT(CASE WHEN tgl_surat >= ? AND tgl_surat <= ? THEN 1 END) as total_bulan,
                    COUNT(CASE WHEN bentuk_surat = 'eSurat (Elektronik)' THEN 1 END) as esurat,
                    COUNT(CASE WHEN bentuk_surat = 'Surat Manual (Fisik)' THEN 1 END) as manual
                FROM agenda_nomor_mundur
                WHERE tahun = ?
            `).bind(startBulan, endBulan, tahunInt);
        }

        // Daftar tahun yang tersedia
        const qTahunList = env.DB.prepare(`
            SELECT DISTINCT tahun FROM (
                SELECT DISTINCT tahun FROM agenda_surat
                UNION
                SELECT DISTINCT tahun FROM agenda_nomor_mundur
            ) ORDER BY tahun DESC
        `);

        const [resSurat, resMundur, resTahunList] = await env.DB.batch([
            qSurat,
            qMundur,
            qTahunList
        ]);

        const suratRow = resSurat?.results?.[0] || {};
        const mundurRow = resMundur?.results?.[0] || {};

        const totalTahunIni = (suratRow.total_tahun || 0) + (mundurRow.total_tahun || 0);
        const totalBulanIni = (suratRow.total_bulan || 0) + (mundurRow.total_bulan || 0);
        const totalESurat = (suratRow.esurat || 0) + (mundurRow.esurat || 0);
        const totalManual = (suratRow.manual || 0) + (mundurRow.manual || 0);

        const availableYears = (resTahunList?.results || []).map(r => r.tahun);
        if (!isAllYear && !isNaN(tahunInt) && !availableYears.includes(tahunInt)) {
            availableYears.unshift(tahunInt);
        }

        return jsonResponse({
            success: true,
            stats: {
                totalTahunIni,
                totalBulanIni,
                totalESurat,
                totalManual,
                availableYears
            }
        });
    } catch (err) {
        console.error("Error get stats:", err);
        return jsonResponse({ success: false, error: "Gagal menghitung statistik." }, 500);
    }
}

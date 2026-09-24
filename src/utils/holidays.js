/**
 * Utility Kalender Kedinasan & Zona Waktu WIB
 * Pengaturan umum kedinasan: Hari kerja efektif (Senin - Jumat) & WIB (UTC+7).
 */

// Cek apakah tanggal jatuh pada hari Sabtu atau Minggu
export function isWeekend(tglStr) {
    if (!tglStr) return false;
    const parts = tglStr.split("-");
    if (parts.length < 3) return false;
    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    const day = d.getDay();
    return day === 0 || day === 6; // 0: Minggu, 6: Sabtu
}

// Ambil tanggal hari ini dalam zona waktu WIB (UTC+7)
export function getTodayWIB() {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const wib = new Date(utc + (7 * 3600000));
    const yyyy = wib.getFullYear();
    const mm = String(wib.getMonth() + 1).padStart(2, '0');
    const dd = String(wib.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// Tambah jumlah hari ke tanggal ISO (YYYY-MM-DD)
export function addDays(tglStr, days = 14) {
    if (!tglStr) return null;
    const parts = tglStr.split("-");
    if (parts.length < 3) return null;
    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    d.setDate(d.getDate() + days);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

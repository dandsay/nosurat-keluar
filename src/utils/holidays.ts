/**
 * Util Kalender Kedinasan & Zona Waktu WIB (TS).
 * Port 1:1 dari register_agenda_surat/src/utils/holidays.js
 */

export function isWeekend(tglStr: string | null | undefined): boolean {
  if (!tglStr) return false;
  const parts = tglStr.split("-");
  if (parts.length < 3) return false;
  const d = new Date(
    parseInt(parts[0], 10),
    parseInt(parts[1], 10) - 1,
    parseInt(parts[2], 10),
  );
  const day = d.getDay();
  return day === 0 || day === 6; // 0: Minggu, 6: Sabtu
}

export function getTodayWIB(): string {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const wib = new Date(utc + 7 * 3600000);
  const yyyy = wib.getFullYear();
  const mm = String(wib.getMonth() + 1).padStart(2, "0");
  const dd = String(wib.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function addDays(tglStr: string | null | undefined, days = 14): string | null {
  if (!tglStr) return null;
  const parts = tglStr.split("-");
  if (parts.length < 3) return null;
  const d = new Date(
    parseInt(parts[0], 10),
    parseInt(parts[1], 10) - 1,
    parseInt(parts[2], 10),
  );
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

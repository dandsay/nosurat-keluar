/**
 * Modul Statistik Dashboard Register Agenda Surat (Zero-Knowledge Client-Side Aggregation)
 * Statistik dihitung langsung di sisi peramban klien setelah seluruh record didekripsi.
 * Pendekatan ini menjamin card counter 100% sinkron, real-time, dan tidak pernah 0 0 0 0
 * jika ada data (baik reguler maupun nomor mundur).
 */

function updateStatsFromClient(data = allAgenda) {
    const yr = parseInt(activeYear, 10) || new Date().getFullYear();
    const bulanSekarang = new Date().toISOString().substring(0, 7); // "YYYY-MM"

    // 1. Filter record sesuai tahun aktif
    const dataTahunIni = (data || []).filter(item => {
        const itemTahun = item.tahun || (item.tgl_surat ? parseInt(item.tgl_surat.substring(0, 4), 10) : yr);
        return itemTahun === yr;
    });

    // 2. Hitung statistik agregat
    const totalTahunIni = dataTahunIni.length;
    let totalBulanIni = 0;
    let totalESurat = 0;
    let totalManual = 0;

    dataTahunIni.forEach(item => {
        // Cek apakah tanggal surat di bulan berjalan
        if (item.tgl_surat && item.tgl_surat.startsWith(bulanSekarang)) {
            totalBulanIni++;
        }

        // Cek bentuk surat
        if (item.bentuk_surat === "eSurat (Elektronik)") {
            totalESurat++;
        } else if (item.bentuk_surat === "Surat Manual (Fisik)") {
            totalManual++;
        }
    });

    // 3. Perbarui Angka Counter di Dashboard Card
    const elTotalTahun = document.getElementById("statTotalTahun");
    const elTotalBulan = document.getElementById("statTotalBulan");
    const elTotalESurat = document.getElementById("statTotalESurat");
    const elTotalManual = document.getElementById("statTotalManual");

    if (elTotalTahun) elTotalTahun.innerText = totalTahunIni.toLocaleString("id-ID");
    if (elTotalBulan) elTotalBulan.innerText = totalBulanIni.toLocaleString("id-ID");
    if (elTotalESurat) elTotalESurat.innerText = totalESurat.toLocaleString("id-ID");
    if (elTotalManual) elTotalManual.innerText = totalManual.toLocaleString("id-ID");

    // 4. Perbarui Opsi Dropdown Tahun dari Daftar Tahun yang Tersedia
    const selectTahun = document.getElementById("selectTahun");
    if (selectTahun) {
        const tahunSet = new Set();
        tahunSet.add(new Date().getFullYear());
        
        (data || []).forEach(item => {
            const y = item.tahun || (item.tgl_surat ? parseInt(item.tgl_surat.substring(0, 4), 10) : null);
            if (y && !isNaN(y)) tahunSet.add(y);
        });

        const sortedYears = Array.from(tahunSet).sort((a, b) => b - a);
        const currentSelected = selectTahun.value || activeYear;
        let optionsHTML = "";
        sortedYears.forEach(y => {
            optionsHTML += `<option value="${y}" ${String(y) === String(currentSelected) ? 'selected' : ''}>${y}</option>`;
        });
        selectTahun.innerHTML = optionsHTML;
    }
}

// Fungsi loadStats yang dipanggil saat refresh atau inisialisasi
async function loadStats() {
    updateStatsFromClient(allAgenda);
}

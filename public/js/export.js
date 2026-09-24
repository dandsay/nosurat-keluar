/**
 * Modul Ekspor CSV & Cetak Buku Agenda
 */

function eksporKeCSV() {
    if (!filteredAgenda || filteredAgenda.length === 0) {
        showAppAlert("Tidak ada data buku agenda untuk diekspor pada filter ini.", "info", "Ekspor Buku Agenda");
        return;
    }

    const headers = [
        "NO.",
        "NOMOR AGENDA",
        "TANGGAL SURAT",
        "PERIHAL",
        "NAMA INSTANSI YANG DITUJU",
        "PENANGGUNG JAWAB PENGELOLA",
        "TANGGAL PENGIRIMAN",
        "BENTUK SURAT (KETERANGAN)",
        "PETUGAS"
    ];

    const rows = filteredAgenda.map(item => [
        item.display_no || item.no_urut,
        `"${(item.nomor_lengkap || "").replace(/"/g, '""')}"`,
        `"${formatTanggalIndo(item.tgl_surat)}"`,
        `"${(item.perihal_decrypted || "").replace(/"/g, '""')}"`,
        `"${(item.instansi_decrypted || "").replace(/"/g, '""')}"`,
        `"${(item.penanggung_jawab || "").replace(/"/g, '""')}"`,
        `"${item.tgl_kirim ? formatTanggalIndo(item.tgl_kirim) : '-'}"`,
        `"${(item.bentuk_surat || "").replace(/"/g, '""')}"`,
        `"${(item.petugas_decrypted || "").replace(/"/g, '""')}"`
    ]);

    const csvContent = "\uFEFF" + [
        headers.join(","),
        ...rows.map(e => e.join(","))
    ].join("\r\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Buku_Agenda_Surat_Keluar_Kelurahan_AAC_${activeYear}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast("File CSV berhasil diunduh!");
}

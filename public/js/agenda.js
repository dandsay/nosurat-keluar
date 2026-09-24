/**
 * Modul Form Penerbitan Nomor Agenda Surat Reguler
 * Zero-Knowledge: Mengenkripsi kode_klasifikasi (kritis), nomor_lengkap, penanggung_jawab,
 * perihal, instansi, dan petugas di sisi klien sebelum dikirim.
 */

// Helper Pembersih Spasi Berlebih & Whitespace
function bersihkanTeks(str) {
    if (!str) return "";
    return str.trim().replace(/\s+/g, ' ');
}

// Helper Hari Kerja Efektif: Jika Sabtu/Minggu langsung lompat ke Senin
function getTanggalKerjaEfektif(d = new Date()) {
    const target = new Date(d);
    const day = target.getDay();
    if (day === 6) { // Sabtu -> lompat 2 hari ke Senin
        target.setDate(target.getDate() + 2);
    } else if (day === 0) { // Minggu -> lompat 1 hari ke Senin
        target.setDate(target.getDate() + 1);
    }
    const yyyy = target.getFullYear();
    const mm = String(target.getMonth() + 1).padStart(2, '0');
    const dd = String(target.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// Cek apakah tanggal jatuh pada Sabtu atau Minggu
function isWeekend(tglStr) {
    if (!tglStr) return false;
    const parts = tglStr.split("-");
    if (parts.length < 3) return false;
    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    const day = d.getDay();
    return day === 0 || day === 6; // 0: Minggu, 6: Sabtu
}

// Tambah jumlah hari ke tanggal ISO (YYYY-MM-DD)
function addDays(tglStr, days = 14) {
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

let fpRegulerTglSurat = null;
let fpRegulerTglKirim = null;

function initFormDates() {
    const tglSurat = document.getElementById("tglSurat");
    const tglKirim = document.getElementById("tglKirim");
    
    // Tertib Administrasi: Jika hari ini Sabtu atau Minggu, otomatis lompat ke hari Senin berikutnya
    const formatHariKerja = getTanggalKerjaEfektif();
    const maxKirim = addDays(formatHariKerja, 14);

    if (tglSurat) {
        tglSurat.value = formatHariKerja;
        if (window.flatpickr) {
            if (fpRegulerTglSurat) fpRegulerTglSurat.destroy();
            fpRegulerTglSurat = flatpickr(tglSurat, {
                locale: "id",
                dateFormat: "Y-m-d",
                altInput: true,
                altFormat: "j F Y",
                minDate: formatHariKerja,
                maxDate: formatHariKerja,
                defaultDate: formatHariKerja,
                disableMobile: true
            });
        }
    }

    if (tglKirim) {
        tglKirim.value = formatHariKerja;
        if (window.flatpickr) {
            if (fpRegulerTglKirim) fpRegulerTglKirim.destroy();
            fpRegulerTglKirim = flatpickr(tglKirim, {
                locale: "id",
                dateFormat: "Y-m-d",
                altInput: true,
                altFormat: "j F Y",
                minDate: formatHariKerja,
                maxDate: maxKirim,
                defaultDate: formatHariKerja,
                disableMobile: true,
                onChange: function(selectedDates, dateStr) {
                    if (dateStr) {
                        const currentTglSurat = tglSurat ? tglSurat.value : formatHariKerja;
                        const batasMax = addDays(currentTglSurat, 14);
                        if (dateStr < currentTglSurat) {
                            showAppAlert(`Tanggal pengiriman (${formatTanggalIndo(dateStr)}) tidak boleh lebih awal dari tanggal surat (${formatTanggalIndo(currentTglSurat)})!`, "warning", "Jaring Pengaman Administrasi");
                            if (fpRegulerTglKirim) fpRegulerTglKirim.setDate(currentTglSurat, false);
                        } else if (dateStr > batasMax) {
                            showAppAlert(`Tanggal pengiriman maksimal 14 hari sejak tanggal surat (${formatTanggalIndo(batasMax)})!`, "warning", "Jaring Pengaman Administrasi");
                            if (fpRegulerTglKirim) fpRegulerTglKirim.setDate(batasMax, false);
                        }
                    }
                }
            });
        }
    }
}

// Handler Submit Form Penerbitan Nomor Reguler
async function handleTerbitkanNomor(e) {
    if (e) e.preventDefault();
    const form = document.getElementById("formAgenda");
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    const tglSurat = document.getElementById("tglSurat").value;
    const tglKirim = document.getElementById("tglKirim").value;

    // Tertib Administrasi: Larangan surat hari Sabtu / Minggu
    if (isWeekend(tglSurat)) {
        showAppAlert("Tidak boleh membuat surat pada hari Sabtu atau Minggu (hari libur kedinasan)!", "warning", "Tertib Administrasi");
        return;
    }

    // Jaring Pengaman: Tanggal kirim tidak boleh lebih awal dari tanggal surat dan maksimal 14 hari
    if (tglKirim && tglSurat) {
        if (tglKirim < tglSurat) {
            showAppAlert(`Tanggal pengiriman (${formatTanggalIndo(tglKirim)}) tidak boleh lebih awal dari tanggal surat (${formatTanggalIndo(tglSurat)})!`, "warning", "Jaring Pengaman Administrasi");
            return;
        }
        const maxKirim = addDays(tglSurat, 14);
        if (tglKirim > maxKirim) {
            showAppAlert(`Tanggal pengiriman maksimal 14 hari sejak tanggal surat (${formatTanggalIndo(maxKirim)})!`, "warning", "Jaring Pengaman Administrasi");
            return;
        }
    }

    const btn = document.getElementById("btnSimpan");
    btn.disabled = true;
    btn.innerHTML = `<span class="inline-block animate-spin mr-2">⏳</span> Menerbitkan Nomor...`;

    try {
        const petugas = bersihkanTeks(document.getElementById("petugas").value);
        const kodeKlasifikasi = bersihkanTeks(document.getElementById("kodeSurat").value);
        const perihal = bersihkanTeks(document.getElementById("perihal").value);
        const instansi = bersihkanTeks(document.getElementById("instansi").value);
        const penanggungJawab = document.getElementById("penanggungJawab").value;
        const bentukSurat = document.getElementById("bentukSurat").value;

        const tahun = parseInt(tglSurat.split("-")[0], 10) || new Date().getFullYear();

        // 1. Ambil Nomor Urut Berikutnya dari Server
        const resNext = await fetch(`/api/agenda/next-number?tahun=${tahun}`, {
            headers: getAuthHeaders()
        });
        const jsonNext = await resNext.json();
        if (!jsonNext.success) throw new Error(jsonNext.error || "Gagal memperoleh nomor urut");

        const nomorUrut = jsonNext.next_no;
        const nomorLengkap = `${kodeKlasifikasi} / ${nomorUrut} / 436.9.3.1 / ${tahun}`;

        // 2. Enkripsi Seluruh Data Sensitif di Sisi Browser (Zero-Knowledge)
        const [
            kode_klasifikasi_encrypted,
            nomor_lengkap_encrypted,
            penanggung_jawab_encrypted,
            perihal_encrypted,
            instansi_encrypted,
            petugas_encrypted
        ] = await Promise.all([
            AppCrypto.encrypt(kodeKlasifikasi, appKey),
            AppCrypto.encrypt(nomorLengkap, appKey),
            AppCrypto.encrypt(penanggungJawab, appKey),
            AppCrypto.encrypt(perihal, appKey),
            AppCrypto.encrypt(instansi, appKey),
            AppCrypto.encrypt(petugas, appKey)
        ]);

        // 3. Kirim Payload ke Worker Backend
        const payload = {
            custom_no_urut: nomorUrut,
            tgl_surat: tglSurat,
            tgl_kirim: tglKirim || null,
            bentuk_surat: bentukSurat,
            kode_klasifikasi_encrypted,
            nomor_lengkap_encrypted,
            penanggung_jawab_encrypted,
            perihal_encrypted,
            instansi_encrypted,
            petugas_encrypted
        };

        const res = await fetch("/api/agenda", {
            method: "POST",
            headers: getAuthHeaders({
                "Content-Type": "application/json"
            }),
            body: JSON.stringify(payload)
        });

        const result = await res.json();
        if (result.success) {
            // Tampilkan Modal Hasil Resmi Terbit
            tampilkanHasilTerbit(nomorUrut, nomorLengkap, perihal, instansi);

            // Otomatis Segarkan Data & Statistik dari Server untuk Menjamin Semua Nomor Kerender Sempurna
            await loadAgendaData();
            await loadStats();

            // Reset Form dan set tanggal ulang
            form.reset();
            initFormDates();
        } else {
            showAppAlert(result.error || "Gagal menerbitkan nomor agenda.", "error", "Peringatan");
        }
    } catch (err) {
        console.error("Gagal menerbitkan nomor:", err);
        showAppAlert("Terjadi kesalahan sistem: " + (err.message || err), "error", "Kesalahan Sistem");
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="send" class="w-4 h-4 mr-1.5 inline"></i> Simpan & Terbitkan Nomor Agenda`;
        if (window.lucide) lucide.createIcons();
    }
}

// Tampilkan Pop-Up Hasil Terbitan Nomor
function tampilkanHasilTerbit(noUrut, nomorLengkap, perihal, instansi) {
    const modal = document.getElementById("hasilModal");
    if (!modal) return;

    document.getElementById("hasilNoUrut").innerText = noUrut;
    document.getElementById("hasilNomorLengkap").innerText = nomorLengkap;
    document.getElementById("hasilPerihal").innerText = perihal;
    document.getElementById("hasilInstansi").innerText = instansi;

    modal.classList.remove("hidden");
    if (window.lucide) lucide.createIcons();
}

function tutupHasilModal() {
    const modal = document.getElementById("hasilModal");
    if (modal) modal.classList.add("hidden");
}

// Salin Nomor Lengkap ke Clipboard
function salinNomorLengkap(teksKustom) {
    const teks = teksKustom || document.getElementById("hasilNomorLengkap").innerText;
    navigator.clipboard.writeText(teks).then(() => {
        const btn = document.getElementById("btnSalinNomor");
        if (btn) {
            const originalHTML = btn.innerHTML;
            btn.innerHTML = `✓ Tersalin!`;
            btn.classList.remove("bg-emerald-600", "hover:bg-emerald-700");
            btn.classList.add("bg-emerald-800");
            setTimeout(() => {
                btn.innerHTML = originalHTML;
                btn.classList.remove("bg-emerald-800");
                btn.classList.add("bg-emerald-600", "hover:bg-emerald-700");
            }, 2000);
        }
        showToast("Nomor agenda berhasil disalin ke clipboard!");
    }).catch(err => {
        console.error("Gagal salin:", err);
        showAppAlert(teks, "info", "Salin Nomor Agenda");
    });
}

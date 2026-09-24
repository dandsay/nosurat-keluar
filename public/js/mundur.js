/**
 * Modul Agenda Nomor Mundur (Zero-Knowledge Enkripsi Penuh)
 * Tampilan & Alur Identik dengan Form Register Agenda Reguler,
 * Berjalan otomatis di latar belakang dengan tombol aksi pintar interaktif.
 */

// Ambil tanggal hari ini dalam zona waktu WIB (UTC+7)
function getTodayWIBString() {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const wib = new Date(utc + (7 * 3600000));
    const yyyy = wib.getFullYear();
    const mm = String(wib.getMonth() + 1).padStart(2, '0');
    const dd = String(wib.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// Ambil batas maksimal tanggal nomor mundur: H-1 (Kemarin)
function getYesterdayWIBString() {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const yesterday = new Date(utc + (7 * 3600000) - (24 * 3600000));
    const yyyy = yesterday.getFullYear();
    const mm = String(yesterday.getMonth() + 1).padStart(2, '0');
    const dd = String(yesterday.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// Cari hari kerja efektif lampau terakhir sebelum hari ini (melewati akhir pekan)
function getLastWorkingDayBeforeToday() {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const d = new Date(utc + (7 * 3600000) - (24 * 3600000)); // Kemarin

    while (true) {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const str = `${yyyy}-${mm}-${dd}`;

        const day = d.getDay();
        const isWeekend = (day === 0 || day === 6);

        if (!isWeekend) {
            return str;
        }
        d.setDate(d.getDate() - 1);
    }
}

// Cek apakah tanggal jatuh pada Sabtu atau Minggu
function checkIsWeekend(tglStr) {
    if (!tglStr) return false;
    const parts = tglStr.split("-");
    if (parts.length < 3) return false;
    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    const day = d.getDay();
    return day === 0 || day === 6; // 0: Minggu, 6: Sabtu
}

// Otomatis sesuaikan tanggal jika akhir pekan ke hari Jumat sebelumnya
function snapToPrecedingWorkingDay(tglStr) {
    if (!tglStr) return tglStr;
    const parts = tglStr.split("-");
    if (parts.length < 3) return tglStr;
    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    const day = d.getDay();
    if (day === 0) { // Minggu -> geser ke Jumat (-2 hari)
        d.setDate(d.getDate() - 2);
    } else if (day === 6) { // Sabtu -> geser ke Jumat (-1 hari)
        d.setDate(d.getDate() - 1);
    } else {
        return tglStr;
    }
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
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

// State deteksi nomor mundur saat ini & instance flatpickr
let currentSmartDetection = null;
let fpSmartMundurTgl = null;
let fpSmartMundurKirim = null;

// Sinkronkan batas range tanggal pengiriman (minimal tanggal surat, maksimal +14 hari)
function updateTanggalKirimRange(tglSurat) {
    if (!tglSurat) return;
    const maxKirim = addDays(tglSurat, 14);
    if (fpSmartMundurKirim) {
        fpSmartMundurKirim.set("minDate", tglSurat);
        fpSmartMundurKirim.set("maxDate", maxKirim);
        fpSmartMundurKirim.setDate(tglSurat, false);
    } else {
        const inputKirim = document.getElementById("smartMundurTglKirim");
        if (inputKirim) {
            inputKirim.min = tglSurat;
            inputKirim.max = maxKirim;
            inputKirim.value = tglSurat;
        }
    }
}

// Inisialisasi Form Smart Nomor Mundur
function initSmartNomorMundur() {
    const inputTgl = document.getElementById("smartMundurTglSurat");
    const inputKirim = document.getElementById("smartMundurTglKirim");

    if (!inputTgl) return;

    const batasMaksimal = getYesterdayWIBString();
    const defaultTgl = getLastWorkingDayBeforeToday();

    if (!inputTgl.value || checkIsWeekend(inputTgl.value)) {
        inputTgl.value = defaultTgl;
    }

    const maxKirimAwal = addDays(inputTgl.value, 14);

    // Inisialisasi Flatpickr Tanggal Kirim
    if (inputKirim && window.flatpickr) {
        if (fpSmartMundurKirim) {
            fpSmartMundurKirim.destroy();
        }
        fpSmartMundurKirim = flatpickr(inputKirim, {
            locale: "id",
            dateFormat: "Y-m-d",
            altInput: true,
            altFormat: "j F Y",
            minDate: inputTgl.value,
            maxDate: maxKirimAwal,
            defaultDate: inputTgl.value,
            disableMobile: true,
            onChange: function(selectedDates, dateStr) {
                if (dateStr) {
                    const currentTglSurat = inputTgl.value;
                    const batasMax = addDays(currentTglSurat, 14);
                    if (dateStr < currentTglSurat) {
                        showAppAlert(`Tanggal kirim (${formatTanggalIndo(dateStr)}) tidak boleh lebih awal dari tanggal surat (${formatTanggalIndo(currentTglSurat)})!`, "warning", "Jaring Pengaman Administrasi");
                        if (fpSmartMundurKirim) fpSmartMundurKirim.setDate(currentTglSurat, false);
                    } else if (dateStr > batasMax) {
                        showAppAlert(`Tanggal kirim maksimal 14 hari sejak tanggal surat (${formatTanggalIndo(batasMax)})!`, "warning", "Jaring Pengaman Administrasi");
                        if (fpSmartMundurKirim) fpSmartMundurKirim.setDate(batasMax, false);
                    }
                }
            }
        });
    }

    // Inisialisasi Flatpickr Tanggal Surat: Matikan Sabtu, Minggu & masa depan; format manusia (j F Y)
    if (window.flatpickr) {
        if (fpSmartMundurTgl) {
            fpSmartMundurTgl.destroy();
        }
        fpSmartMundurTgl = flatpickr(inputTgl, {
            locale: "id",
            dateFormat: "Y-m-d",
            altInput: true,
            altFormat: "j F Y",
            maxDate: batasMaksimal,
            defaultDate: inputTgl.value,
            disable: [
                function(date) {
                    // 0: Minggu, 6: Sabtu dinonaktifkan di kalender
                    return (date.getDay() === 0 || date.getDay() === 6);
                }
            ],
            disableMobile: true,
            onChange: function(selectedDates, dateStr) {
                if (dateStr) {
                    updateTanggalKirimRange(dateStr);
                    handleDateChangeSmartMundur(dateStr);
                }
            }
        });
    }

    const syncTanggalKirim = () => {
        let val = inputTgl.value;
        if (checkIsWeekend(val)) {
            val = snapToPrecedingWorkingDay(val);
            inputTgl.value = val;
            if (fpSmartMundurTgl) fpSmartMundurTgl.setDate(val, false);
        }
        updateTanggalKirimRange(val);
        handleDateChangeSmartMundur(val);
    };

    inputTgl.onchange = syncTanggalKirim;
    inputTgl.oninput = syncTanggalKirim;

    // Jalankan pengecekan otomatis untuk nilai awal tanggal
    handleDateChangeSmartMundur(inputTgl.value);
}

// Render Tampilan Tombol / Informasi Status Terpadu
function renderSmartActionButton(state, info = {}) {
    const area = document.getElementById("smartMundurActionArea");
    if (!area) return;

    if (state === "normal") {
        area.innerHTML = `
            <button type="submit" id="btnSimpanSmartMundur" 
                class="w-full py-2.5 sm:py-3 px-6 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-98 text-white font-bold text-xs sm:text-sm shadow-md shadow-blue-600/20 transition flex items-center justify-center gap-2 mt-3 sm:mt-4">
                <i data-lucide="send" class="w-4 h-4"></i> Simpan & Terbitkan Nomor Agenda
            </button>
        `;
    } else if (state === "loading") {
        area.innerHTML = `
            <div class="w-full py-2.5 sm:py-3 px-6 rounded-xl bg-slate-100 border border-slate-200 text-slate-500 font-bold text-xs sm:text-sm flex items-center justify-center gap-2 mt-3 sm:mt-4 cursor-wait">
                <span class="inline-block animate-spin">⏳</span> Memeriksa Buku Agenda...
            </div>
        `;
    } else if (state === "error") {
        const icon = info.icon || "alert-circle";
        const title = info.title || "Peringatan";
        const desc = info.desc || "";
        const bg = info.bg || "bg-rose-50 border-rose-200 text-rose-900";
        const iconColor = info.iconColor || "text-rose-600";

        area.innerHTML = `
            <div class="w-full p-3 sm:p-3.5 rounded-xl ${bg} border text-xs sm:text-sm font-semibold flex items-center gap-3 shadow-2xs mt-3 sm:mt-4">
                <i data-lucide="${icon}" class="w-5 h-5 ${iconColor} shrink-0"></i>
                <div class="text-left flex-1 min-w-0">
                    <span class="font-bold block leading-tight">${escapeHtml(title)}</span>
                    <span class="text-[11px] sm:text-xs block mt-0.5 opacity-90 leading-relaxed">${escapeHtml(desc)}</span>
                </div>
            </div>
        `;
    }

    if (window.lucide) lucide.createIcons();
}

// Handler saat tanggal dipilih atau berubah
async function handleDateChangeSmartMundur(tglSurat) {
    const inputKirim = document.getElementById("smartMundurTglKirim");
    const inputTgl = document.getElementById("smartMundurTglSurat");

    if (!tglSurat) {
        currentSmartDetection = null;
        renderSmartActionButton("error", {
            icon: "calendar",
            title: "Pilih Tanggal Surat",
            desc: "Silakan pilih tanggal surat lampau untuk melanjutkan.",
            bg: "bg-slate-50 border-slate-200 text-slate-700",
            iconColor: "text-slate-500"
        });
        return;
    }

    // Jika akhir pekan, otomatis alihkan ke hari kerja (Jumat) tanpa menampilkan peringatan error yang mengganggu
    if (checkIsWeekend(tglSurat)) {
        tglSurat = snapToPrecedingWorkingDay(tglSurat);
        if (inputTgl) inputTgl.value = tglSurat;
        if (fpSmartMundurTgl) fpSmartMundurTgl.setDate(tglSurat, false);
    }

    // Otomatis sinkronisasi tanggal kirim mengikuti tanggal surat dan batas 14 hari
    updateTanggalKirimRange(tglSurat);

    const todayWIB = getTodayWIBString();

    // 1. Validasi Hari Ini / Masa Depan
    if (tglSurat >= todayWIB) {
        currentSmartDetection = null;
        renderSmartActionButton("error", {
            icon: "alert-circle",
            title: "Bukan Tanggal Lampau",
            desc: "Nomor mundur hanya diperuntukkan untuk tanggal yang telah lewat (kemarin dan sebelumnya), bukan hari ini atau masa depan.",
            bg: "bg-rose-50 border-rose-200 text-rose-900",
            iconColor: "text-rose-600"
        });
        return;
    }

    // Tampilkan indikator loading di area tombol
    renderSmartActionButton("loading");

    try {
        const res = await fetch(`/api/nomor-mundur/smart-detect?tgl_surat=${encodeURIComponent(tglSurat)}`, {
            headers: getAuthHeaders()
        });
        const result = await res.json();

        if (!result.success) {
            currentSmartDetection = null;
            renderSmartActionButton("error", {
                icon: "alert-triangle",
                title: "Agenda Tidak Ditemukan",
                desc: result.error || "Gagal mendeteksi surat induk pada tanggal tersebut.",
                bg: "bg-rose-50 border-rose-200 text-rose-900",
                iconColor: "text-rose-600"
            });
            return;
        }

        // Sukses: simpan data deteksi dan aktifkan tombol normal
        currentSmartDetection = result;
        renderSmartActionButton("normal");

    } catch (err) {
        console.error("Gagal smart detect nomor mundur:", err);
        currentSmartDetection = null;
        renderSmartActionButton("error", {
            icon: "wifi-off",
            title: "Gangguan Jaringan",
            desc: "Terjadi kesalahan saat memeriksa agenda. Silakan periksa koneksi Anda.",
            bg: "bg-rose-50 border-rose-200 text-rose-900",
            iconColor: "text-rose-600"
        });
    }
}

// Handler Submit Penerbitan Nomor Mundur
async function handleTerbitkanSmartNomorMundur(e) {
    if (e) e.preventDefault();

    const form = document.getElementById("formSmartNomorMundur");
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    const tglSurat = document.getElementById("smartMundurTglSurat").value;
    const tglKirim = document.getElementById("smartMundurTglKirim")?.value || null;
    const todayWIB = getTodayWIBString();

    // Validasi Tanggal
    if (tglSurat >= todayWIB) {
        showAppAlert("Nomor mundur hanya diperuntukkan untuk tanggal yang telah lewat, bukan hari ini!", "warning", "Tertib Administrasi");
        return;
    }
    if (checkIsWeekend(tglSurat)) {
        showAppAlert("Tanggal surat tidak boleh jatuh pada hari Sabtu atau Minggu (hari libur kedinasan)!", "warning", "Tertib Administrasi");
        return;
    }
    if (tglKirim && tglSurat) {
        if (tglKirim < tglSurat) {
            showAppAlert(`Tanggal kirim (${formatTanggalIndo(tglKirim)}) tidak boleh lebih awal dari tanggal surat (${formatTanggalIndo(tglSurat)})!`, "warning", "Jaring Pengaman Administrasi");
            return;
        }
        const maxKirim = addDays(tglSurat, 14);
        if (tglKirim > maxKirim) {
            showAppAlert(`Tanggal kirim maksimal 14 hari sejak tanggal surat (${formatTanggalIndo(maxKirim)})!`, "warning", "Jaring Pengaman Administrasi");
            return;
        }
    }

    if (!currentSmartDetection) {
        showAppAlert("Sistem sedang memeriksa ketersediaan nomor. Mohon tunggu sesaat atau pilih tanggal lain.", "info", "Pemeriksaan Agenda");
        return;
    }

    const btn = document.getElementById("btnSimpanSmartMundur");
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span class="inline-block animate-spin mr-2">⏳</span> Menerbitkan Nomor Agenda...`;
    }

    try {
        const kodeKlasifikasi = bersihkanTeks(document.getElementById("smartMundurKodeSurat").value);
        const perihal = bersihkanTeks(document.getElementById("smartMundurPerihal").value);
        const instansi = bersihkanTeks(document.getElementById("smartMundurInstansi").value);
        const penanggungJawab = document.getElementById("smartMundurPenanggungJawab").value;
        const bentukSurat = document.getElementById("smartMundurBentukSurat").value;
        const petugas = bersihkanTeks(document.getElementById("smartMundurPetugas").value);

        const tahun = currentSmartDetection.tahun;
        const noInduk = currentSmartDetection.nomor_induk;
        const noUrutLengkap = currentSmartDetection.no_urut_lengkap;
        const nomorLengkap = `${kodeKlasifikasi} / ${noUrutLengkap} / 436.9.3.1 / ${tahun}`;

        // 1. Enkripsi Seluruh Data Sensitif di Sisi Browser (Zero-Knowledge AES-GCM 256-bit)
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

        // 2. Kirim Payload ke Worker Backend
        const payload = {
            tgl_surat: tglSurat,
            tgl_kirim: tglKirim,
            nomor_induk: noInduk,
            bentuk_surat: bentukSurat,
            kode_klasifikasi_encrypted,
            nomor_lengkap_encrypted,
            penanggung_jawab_encrypted,
            perihal_encrypted,
            instansi_encrypted,
            petugas_encrypted
        };

        const res = await fetch("/api/nomor-mundur", {
            method: "POST",
            headers: getAuthHeaders({
                "Content-Type": "application/json"
            }),
            body: JSON.stringify(payload)
        });

        const result = await res.json();
        if (result.success) {
            // Tampilkan Modal Pop-up Hasil Resmi Terbit
            const finalNoLengkap = `${kodeKlasifikasi} / ${result.noUrutLengkap || noUrutLengkap} / 436.9.3.1 / ${tahun}`;
            tampilkanHasilTerbit(result.noUrutLengkap || noUrutLengkap, finalNoLengkap, perihal, instansi);

            // Segarkan data buku agenda & statistik dari server
            await loadAgendaData();
            await loadStats();

            // Reset form dan setel ulang tanggal
            form.reset();
            initSmartNomorMundur();
        } else {
            showAppAlert(result.error || "Gagal menerbitkan nomor mundur.", "error", "Peringatan");
        }

    } catch (err) {
        console.error("Gagal menerbitkan nomor mundur:", err);
        showAppAlert("Terjadi kesalahan sistem: " + (err.message || err), "error", "Kesalahan Sistem");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i data-lucide="send" class="w-4 h-4 mr-1.5 inline"></i> Simpan & Terbitkan Nomor Agenda`;
            if (window.lucide) lucide.createIcons();
        }
    }
}

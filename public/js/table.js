/**
 * Modul Buku Agenda Surat Keluar (Tabel Terpadu Reguler + Nomor Mundur)
 * Zero-Knowledge: Mendekripsi kode_klasifikasi (kritis), nomor_lengkap, penanggung_jawab,
 * perihal, instansi, dan petugas di memori peramban.
 * 
 * Fitur Spesial:
 * - Tombol "+ Nomor Mundur" HANYA AKTIF pada nomor terakhir di hari yang bersangkutan.
 * - Format tampilan rapi, bersih, tanpa emotikon, dan tanpa label teks berlebih.
 */

// Helper Pembersih Spasi Berlebih & Whitespace
function bersihkanTeks(str) {
    if (!str) return "";
    return str.trim().replace(/\s+/g, ' ');
}

// Helper Tanggal Indonesia
function formatTanggalIndo(tanggalISO) {
    if (!tanggalISO || tanggalISO.indexOf("-") === -1) return tanggalISO || "-";
    const bulanIndo = [
        "Januari", "Februari", "Maret", "April", "Mei", "Juni",
        "Juli", "Agustus", "September", "Oktober", "November", "Desember"
    ];
    try {
        const [tahun, bulan, hari] = tanggalISO.split("-");
        return `${parseInt(hari, 10)} ${bulanIndo[parseInt(bulan, 10) - 1]} ${tahun}`;
    } catch (e) {
        return tanggalISO;
    }
}

// Helper Hari Kerja Efektif: Jika hari ini Sabtu/Minggu, otomatis lompat ke Senin
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

// Cek apakah tanggal jatuh pada Sabtu atau Minggu (hari libur kedinasan)
function isWeekend(tglStr) {
    if (!tglStr) return false;
    const parts = tglStr.split("-");
    if (parts.length < 3) return false;
    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    const day = d.getDay();
    return day === 0 || day === 6; // 0: Minggu, 6: Sabtu
}

// Helper Format Waktu Realtime Indonesia (WIB / GMT+7)
function formatWaktuIndo(rawDate) {
    if (!rawDate) return "-";
    try {
        let dStr = String(rawDate).trim();
        // SQLite CURRENT_TIMESTAMP format: "YYYY-MM-DD HH:MM:SS" (UTC)
        if (dStr.length === 19 && dStr.charAt(10) === ' ') {
            dStr = dStr.replace(' ', 'T') + 'Z';
        } else if (!dStr.endsWith('Z') && !dStr.includes('+')) {
            dStr = dStr + 'Z';
        }
        const d = new Date(dStr);
        if (isNaN(d.getTime())) return rawDate;

        const tgl = d.toLocaleDateString("id-ID", {
            timeZone: "Asia/Jakarta",
            day: "numeric",
            month: "short",
            year: "numeric"
        });
        const jam = d.toLocaleTimeString("id-ID", {
            timeZone: "Asia/Jakarta",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
        }).replace(".", ":");

        return `${tgl}, ${jam} WIB`;
    } catch (e) {
        return rawDate;
    }
}

// Helper Pemetaan Tanggal untuk Pencarian Fleksibel (Bulan Lengkap, Singkatan, Angka, Alias)
function dapatkanSearchableTanggal(tglISO) {
    if (!tglISO || typeof tglISO !== "string" || !tglISO.includes("-")) return "";
    const parts = tglISO.split("-");
    if (parts.length < 3) return tglISO;
    const yyyy = parts[0];
    const mm = parseInt(parts[1], 10);
    const dd = parseInt(parts[2], 10);

    const daftarBulan = [
        { id: "januari", abbr: "jan", en: "january" },
        { id: "februari", abbr: "feb", en: "february" },
        { id: "maret", abbr: "mar", en: "march" },
        { id: "april", abbr: "apr", en: "april" },
        { id: "mei", abbr: "mei", en: "may" },
        { id: "juni", abbr: "jun", en: "june" },
        { id: "juli", abbr: "jul", en: "july" },
        { id: "agustus", abbr: "agu", en: "august", alt: "agust aug" },
        { id: "september", abbr: "sep", en: "september", alt: "sept" },
        { id: "oktober", abbr: "okt", en: "october", alt: "oct" },
        { id: "november", abbr: "nov", en: "november" },
        { id: "desember", abbr: "des", en: "december", alt: "dec" }
    ];

    const info = daftarBulan[mm - 1];
    if (!info) return tglISO;

    return `${dd} ${info.id} ${yyyy} ${info.abbr} ${info.en} ${info.alt || ""} ${tglISO} ${dd}/${parts[1]}/${yyyy}`.toLowerCase();
}

// Muat dan Dekripsi Data Agenda Reguler & Nomor Mundur dari Cloudflare D1
async function loadAgendaData() {
    const loadingEl = document.getElementById("tableLoading");
    if (loadingEl) loadingEl.classList.remove("hidden");

    try {
        const [resReguler, resMundur] = await Promise.all([
            fetch(`/api/agenda?tahun=${activeYear}`, { headers: getAuthHeaders() }),
            fetch(`/api/nomor-mundur?tahun=${activeYear}`, { headers: getAuthHeaders() })
        ]);

        const [jsonReguler, jsonMundur] = await Promise.all([
            resReguler.json(),
            resMundur.json()
        ]);

        if (!jsonReguler.success) {
            showAppAlert(jsonReguler.error || "Gagal memuat data agenda reguler.", "error", "Gagal Memuat Data");
            return;
        }

        // 1. Dekripsi Seluruh Data Sensitif Surat Reguler
        const decryptedReguler = await Promise.all((jsonReguler.data || []).map(async (row) => {
            const [kode, nomor, pengelola, perihal, instansi, petugas] = await Promise.all([
                AppCrypto.decrypt(row.kode_klasifikasi_encrypted, appKey),
                AppCrypto.decrypt(row.nomor_lengkap_encrypted, appKey),
                AppCrypto.decrypt(row.penanggung_jawab_encrypted, appKey),
                AppCrypto.decrypt(row.perihal_encrypted, appKey),
                AppCrypto.decrypt(row.instansi_encrypted, appKey),
                AppCrypto.decrypt(row.petugas_encrypted, appKey)
            ]);

            return {
                ...row,
                is_mundur: false,
                induk_sort: row.no_urut,
                sub_sort: 0,
                display_no: String(row.no_urut),
                kode_klasifikasi_decrypted: kode,
                nomor_lengkap_decrypted: nomor,
                penanggung_jawab_decrypted: pengelola,
                perihal_decrypted: perihal,
                instansi_decrypted: instansi,
                petugas_decrypted: petugas
            };
        }));

        // 2. Dekripsi Seluruh Data Sensitif Nomor Mundur
        const decryptedMundur = await Promise.all((jsonMundur.data || []).map(async (row) => {
            const [kode, nomor, pengelola, perihal, instansi, petugas] = await Promise.all([
                AppCrypto.decrypt(row.kode_klasifikasi_encrypted, appKey),
                AppCrypto.decrypt(row.nomor_lengkap_encrypted, appKey),
                AppCrypto.decrypt(row.penanggung_jawab_encrypted, appKey),
                AppCrypto.decrypt(row.perihal_encrypted, appKey),
                AppCrypto.decrypt(row.instansi_encrypted, appKey),
                AppCrypto.decrypt(row.petugas_encrypted, appKey)
            ]);

            return {
                ...row,
                is_mundur: true,
                induk_sort: row.nomor_induk,
                sub_sort: row.sub_nomor,
                display_no: row.no_urut_lengkap,
                kode_klasifikasi_decrypted: kode,
                nomor_lengkap_decrypted: nomor,
                penanggung_jawab_decrypted: pengelola,
                perihal_decrypted: perihal,
                instansi_decrypted: instansi,
                petugas_decrypted: petugas
            };
        }));

        // 3. Deteksi Surat Terakhir pada Masing-Masing Hari (Khusus Reguler)
        // Kunci: Tombol "+ Nomor Mundur" hanya aktif pada surat dengan nomor terbesar di tanggal tersebut!
        const maxNoPerTgl = {};
        decryptedReguler.forEach(item => {
            const tgl = item.tgl_surat;
            if (!maxNoPerTgl[tgl] || item.no_urut > maxNoPerTgl[tgl]) {
                maxNoPerTgl[tgl] = item.no_urut;
            }
        });

        decryptedReguler.forEach(item => {
            item.is_last_of_day = (item.no_urut === maxNoPerTgl[item.tgl_surat]);
        });

        // 4. Gabungkan dan Urutkan Sesuai Induk
        allAgenda = [...decryptedReguler, ...decryptedMundur];

        allAgenda.sort((a, b) => {
            if (b.induk_sort !== a.induk_sort) {
                return b.induk_sort - a.induk_sort; // 402, 401, 400...
            }
            return b.sub_sort - a.sub_sort; // 400.2, 400.1, 400
        });

        currentPage = 1;
        applyClientFilters();
        updateStatsFromClient(allAgenda);
    } catch (err) {
        console.error("Gagal load data agenda:", err);
        showAppAlert("Terjadi kesalahan memuat buku agenda: " + (err.message || err), "error", "Gagal Memuat Data");
    } finally {
        if (loadingEl) loadingEl.classList.add("hidden");
    }
}



// Filter Tab: Semua, eSurat, Surat Manual, Surat Mundur (Chip Tab Tanpa Scroll)
function setFilterBentuk(bentuk) {
    activeBentuk = bentuk;
    currentPage = 1;

    // Desktop Buttons
    const btnAll = document.getElementById("btnTabAll");
    const btnESurat = document.getElementById("btnTabESurat");
    const btnManual = document.getElementById("btnTabManual");
    const btnMundur = document.getElementById("btnTabMundurFilter");

    const baseClassDesktop = "py-1.5 px-3 rounded-lg text-xs font-bold transition text-center flex items-center justify-center ";
    const inactiveClassDesktop = baseClassDesktop + "text-slate-600 hover:text-slate-900 hover:bg-slate-200/70";
    const activeClassDesktop = baseClassDesktop + "bg-blue-600 text-white shadow-xs";

    if (btnAll) btnAll.className = (bentuk === "ALL") ? activeClassDesktop : inactiveClassDesktop;
    if (btnESurat) btnESurat.className = (bentuk === "eSurat (Elektronik)") ? activeClassDesktop : inactiveClassDesktop;
    if (btnManual) btnManual.className = (bentuk === "Surat Manual (Fisik)") ? activeClassDesktop : inactiveClassDesktop;
    if (btnMundur) btnMundur.className = (bentuk === "MUNDUR") ? activeClassDesktop : inactiveClassDesktop;

    // Mobile Buttons
    const btnAllMobile = document.getElementById("btnTabAllMobile");
    const btnESuratMobile = document.getElementById("btnTabESuratMobile");
    const btnManualMobile = document.getElementById("btnTabManualMobile");
    const btnMundurFilterMobile = document.getElementById("btnTabMundurFilterMobile");

    const baseClassMobile = "py-1.5 px-1 rounded-lg text-[11px] font-bold transition text-center flex items-center justify-center ";
    const inactiveClassMobile = baseClassMobile + "text-slate-600 hover:text-slate-900 hover:bg-slate-200/70";
    const activeClassMobile = baseClassMobile + "bg-blue-600 text-white shadow-xs";

    if (btnAllMobile) btnAllMobile.className = (bentuk === "ALL") ? activeClassMobile : inactiveClassMobile;
    if (btnESuratMobile) btnESuratMobile.className = (bentuk === "eSurat (Elektronik)") ? activeClassMobile : inactiveClassMobile;
    if (btnManualMobile) btnManualMobile.className = (bentuk === "Surat Manual (Fisik)") ? activeClassMobile : inactiveClassMobile;
    if (btnMundurFilterMobile) btnMundurFilterMobile.className = (bentuk === "MUNDUR") ? activeClassMobile : inactiveClassMobile;

    applyClientFilters();
}

// Filter Berdasarkan Seksi Pengelola
function handleFilterPengelola(val) {
    activePengelola = val;
    currentPage = 1;

    // Sinkronkan Select Desktop
    const selectDesk = document.getElementById("selectPengelola");
    if (selectDesk && selectDesk.value !== val) {
        selectDesk.value = val;
    }

    // Indikator Titik Filter Mobile & Badge
    const dot = document.getElementById("dotFilterActive");
    const badge = document.getElementById("badgePengelolaActive");

    if (val !== "ALL") {
        if (dot) dot.classList.remove("hidden");
        if (badge) {
            let labelSingkat = val;
            if (val === "Kepala Seksi Pemerintahan dan Pelayanan Publik") labelSingkat = "Kasi Pemerintahan";
            else if (val === "Kepala Seksi Kesejahteraan Rakyat dan Perekonomian") labelSingkat = "Kasi Kesra";
            else if (val === "Kepala Seksi Ketentraman, Ketertiban dan Pembangunan") labelSingkat = "Kasi Trantib";
            badge.innerText = labelSingkat;
            badge.classList.remove("hidden");
        }
    } else {
        if (dot) dot.classList.add("hidden");
        if (badge) badge.classList.add("hidden");
    }

    // Update UI opsi di Bottom Sheet Mobile
    updateMobilePengelolaUI(val);

    applyClientFilters();
}

// Handler Bottom Sheet Filter Mobile
function bukaBottomSheetFilterMobile() {
    const modal = document.getElementById("bottomSheetFilterModal");
    const card = document.getElementById("bottomSheetFilterCard");
    if (!modal || !card) return;

    updateMobilePengelolaUI(activePengelola);

    modal.classList.remove("hidden");
    requestAnimationFrame(() => {
        card.classList.remove("translate-y-full");
        card.classList.add("translate-y-0");
    });
    if (window.lucide) lucide.createIcons();
}

function tutupBottomSheetFilterMobile() {
    const modal = document.getElementById("bottomSheetFilterModal");
    const card = document.getElementById("bottomSheetFilterCard");
    if (!modal || !card) return;

    card.classList.remove("translate-y-0");
    card.classList.add("translate-y-full");

    setTimeout(() => {
        modal.classList.add("hidden");
    }, 250);
}

function pilihPengelolaMobile(val) {
    handleFilterPengelola(val);
    tutupBottomSheetFilterMobile();
}

function updateMobilePengelolaUI(selectedVal) {
    const options = [
        { id: "optPengelola-ALL", val: "ALL" },
        { id: "optPengelola-Lurah", val: "Lurah" },
        { id: "optPengelola-SekretarisKelurahan", val: "Sekretaris Kelurahan" },
        { id: "optPengelola-KasiPemerintahan", val: "Kepala Seksi Pemerintahan dan Pelayanan Publik" },
        { id: "optPengelola-KasiKesra", val: "Kepala Seksi Kesejahteraan Rakyat dan Perekonomian" },
        { id: "optPengelola-KasiTrantib", val: "Kepala Seksi Ketentraman, Ketertiban dan Pembangunan" }
    ];

    options.forEach(opt => {
        const btn = document.getElementById(opt.id);
        if (!btn) return;
        const checkIcon = btn.querySelector("i, svg");
        if (opt.val === selectedVal) {
            btn.className = "w-full text-left p-2.5 rounded-xl border text-xs font-bold flex items-center justify-between transition bg-blue-50 border-blue-200 text-blue-700";
            if (checkIcon) checkIcon.classList.remove("hidden");
        } else {
            btn.className = "w-full text-left p-2.5 rounded-xl border text-xs font-semibold flex items-center justify-between transition bg-slate-50 border-slate-200/80 text-slate-700";
            if (checkIcon) checkIcon.classList.add("hidden");
        }
    });
    if (window.lucide) lucide.createIcons();
}

// Ubah Tahun
function handleFilterTahun(year) {
    activeYear = year;
    loadAgendaData();
    loadStats();
}

// Terapkan Filter & Pencarian di Memori Klien
function applyClientFilters() {
    const searchRaw = document.getElementById("searchInput") ? document.getElementById("searchInput").value : "";
    const search = searchRaw.toLowerCase().trim();

    filteredAgenda = allAgenda.filter(item => {
        // 1. Filter Tab Bentuk / Kategori
        if (activeBentuk === "MUNDUR") {
            if (!item.is_mundur) return false;
        } else if (activeBentuk !== "ALL") {
            if (item.bentuk_surat !== activeBentuk) return false;
        }

        // 2. Filter Pengelola
        if (activePengelola !== "ALL" && item.penanggung_jawab_decrypted !== activePengelola) {
            return false;
        }

        // 3. Pencarian Teks Bebas
        if (search) {
            const nomor = (item.nomor_lengkap_decrypted || "").toLowerCase();
            const displayNo = (item.display_no || "").toLowerCase();
            const perihal = (item.perihal_decrypted || "").toLowerCase();
            const instansi = (item.instansi_decrypted || "").toLowerCase();
            const petugas = (item.petugas_decrypted || "").toLowerCase();
            const pengelola = (item.penanggung_jawab_decrypted || "").toLowerCase();
            const kode = (item.kode_klasifikasi_decrypted || "").toLowerCase();
            const tglSuratSearch = dapatkanSearchableTanggal(item.tgl_surat);
            const tglKirimSearch = dapatkanSearchableTanggal(item.tgl_kirim);

            return (
                nomor.includes(search) ||
                displayNo.includes(search) ||
                perihal.includes(search) ||
                instansi.includes(search) ||
                petugas.includes(search) ||
                pengelola.includes(search) ||
                kode.includes(search) ||
                tglSuratSearch.includes(search) ||
                tglKirimSearch.includes(search)
            );
        }

        return true;
    });

    renderTable();
}

// Render Tabel Desktop & Card Mobile
function renderTable() {
    const tbody = document.getElementById("agendaTableBody");
    const mobileList = document.getElementById("agendaMobileList");
    const emptyState = document.getElementById("emptyState");
    const countInfo = document.getElementById("countInfo");

    if (!tbody || !mobileList) return;

    if (countInfo) {
        countInfo.innerText = `Menampilkan ${filteredAgenda.length} dari total ${allAgenda.length} surat`;
    }

    if (filteredAgenda.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="py-14 px-4 text-center">
                    <div class="w-12 h-12 bg-slate-100 text-slate-400 rounded-2xl flex items-center justify-center mx-auto mb-3">
                        <i data-lucide="inbox" class="w-6 h-6"></i>
                    </div>
                    <h3 class="text-sm font-bold text-slate-800">Belum ada data agenda</h3>
                    <p class="text-xs text-slate-500 mt-1">Tidak ditemukan surat keluar dengan kriteria pencarian saat ini.</p>
                </td>
            </tr>
        `;
        mobileList.innerHTML = `
            <div class="bg-white border border-slate-200 rounded-2xl p-8 text-center shadow-xs">
                <div class="w-12 h-12 bg-slate-100 text-slate-400 rounded-2xl flex items-center justify-center mx-auto mb-3">
                    <i data-lucide="inbox" class="w-6 h-6"></i>
                </div>
                <h3 class="text-sm font-bold text-slate-800">Belum ada data agenda</h3>
                <p class="text-xs text-slate-500 mt-1">Tidak ditemukan surat keluar dengan kriteria pencarian saat ini.</p>
            </div>
        `;
        renderPagination(0);
        if (window.lucide) lucide.createIcons();
        return;
    }

    const totalPages = Math.ceil(filteredAgenda.length / pageSize) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    const startIdx = (currentPage - 1) * pageSize;
    const endIdx = startIdx + pageSize;
    const pageItems = filteredAgenda.slice(startIdx, endIdx);

    let desktopHTML = "";
    let mobileHTML = "";

    pageItems.forEach(item => {
        const isESurat = item.bentuk_surat === "eSurat (Elektronik)";
        const badgeBentuk = isESurat 
            ? "bg-amber-100 text-amber-800 border-amber-300" 
            : "bg-emerald-100 text-emerald-800 border-emerald-300";

        // Warna latar samar untuk nomor mundur (tanpa teks alay)
        const rowBg = item.is_mundur 
            ? "bg-indigo-50/40 hover:bg-indigo-50/70 border-l-4 border-l-indigo-500" 
            : (isESurat ? "hover:bg-amber-50/40" : "hover:bg-emerald-50/40");

        const noBadge = item.is_mundur
            ? `<span class="inline-block bg-indigo-100 text-indigo-900 border border-indigo-300 font-mono text-xs font-black px-2 py-0.5 rounded-lg shadow-2xs">${escapeHtml(item.display_no)}</span>`
            : `<span class="font-bold text-slate-700">${item.no_urut}</span>`;

        // 1. Render Desktop Table Row
        desktopHTML += `
            <tr class="border-b border-slate-200/80 ${rowBg} transition text-slate-800">
                <td class="py-3 px-3 text-center w-16">
                    ${noBadge}
                </td>
                <td class="py-3 px-3 whitespace-nowrap">
                    <div class="font-mono text-xs font-bold text-blue-700 select-all cursor-pointer inline-flex items-center gap-1 hover:text-blue-900" title="Klik untuk salin" onclick="salinNomorLengkap('${escapeHtml(item.nomor_lengkap_decrypted)}')">
                        ${escapeHtml(item.nomor_lengkap_decrypted)}
                        <i data-lucide="copy" class="w-3 h-3 text-slate-400"></i>
                    </div>
                    <div class="text-[11px] ${item.is_mundur ? 'text-indigo-800 font-bold' : 'text-slate-500 font-medium'}">
                        Tgl Surat: ${formatTanggalIndo(item.tgl_surat)}
                    </div>
                </td>
                <td class="py-3 px-3 max-w-xs">
                    <div class="font-semibold text-slate-900 text-sm leading-snug">${escapeHtml(item.perihal_decrypted)}</div>
                    <div class="text-xs text-slate-500 mt-0.5">Tujuan: <span class="font-medium text-slate-700">${escapeHtml(item.instansi_decrypted)}</span></div>
                </td>
                <td class="py-3 px-3 text-xs">
                    <div class="font-medium text-slate-700">${escapeHtml(item.penanggung_jawab_decrypted)}</div>
                    <div class="text-slate-400 text-[11px]">Kirim: ${item.tgl_kirim ? formatTanggalIndo(item.tgl_kirim) : '-'}</div>
                </td>
                <td class="py-3 px-3 text-center whitespace-nowrap">
                    <span class="inline-block text-[11px] font-bold px-2 py-0.5 rounded-full border ${badgeBentuk}">
                        ${escapeHtml(item.bentuk_surat)}
                    </span>
                </td>
                <td class="py-3 px-3 text-xs text-slate-700 whitespace-nowrap">
                    <div class="font-bold text-slate-800">${escapeHtml(item.petugas_decrypted)}</div>
                    <div class="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1 font-medium" title="Waktu pengerjaan realtime">
                        <i data-lucide="clock" class="w-3 h-3 text-slate-400 shrink-0"></i>
                        <span>${formatWaktuIndo(item.created_at)}</span>
                    </div>
                </td>
                <td class="py-3 px-3 text-center whitespace-nowrap">
                    <div class="flex items-center justify-center gap-1">
                        <button onclick="bukaModalEdit(${item.id}, ${item.is_mundur})" title="Edit Data" class="p-1.5 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition">
                            <i data-lucide="edit-3" class="w-4 h-4"></i>
                        </button>
                        <button onclick="bukaModalHapus(${item.id}, ${item.is_mundur})" title="${item.is_mundur ? 'Hapus Nomor Mundur' : 'Hapus Agenda'}" class="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition">
                            <i data-lucide="trash-2" class="w-4 h-4"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;

        // 2. Render Mobile Card (Kompak, Bersih, Bebas Over-Information)
        const badgeBgBentuk = isESurat 
            ? "bg-amber-50 text-amber-800 border-amber-200" 
            : "bg-emerald-50 text-emerald-800 border-emerald-200";

        mobileHTML += `
            <div class="bg-white border ${item.is_mundur ? 'border-indigo-200/90 bg-indigo-50/20' : 'border-slate-200'} rounded-2xl p-3.5 shadow-2xs space-y-2.5 transition">
                <!-- Baris Atas: Nomor Urut Badge, Bentuk Surat, dan Tombol Salin di Pojok Kanan Atas -->
                <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-1.5 flex-wrap">
                        ${item.is_mundur 
                            ? `<span class="bg-indigo-100 text-indigo-900 border border-indigo-300 font-mono text-xs font-black px-2 py-0.5 rounded-lg">${escapeHtml(item.display_no)}</span>`
                            : `<span class="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-700">${item.no_urut}</span>`
                        }
                        <span class="text-[10px] font-bold px-2 py-0.5 rounded-full border ${badgeBgBentuk}">
                            ${isESurat ? 'eSurat' : 'Manual'}
                        </span>
                    </div>
                    <!-- Tombol Salin di Pojok Kanan Atas -->
                    <button onclick="salinNomorLengkap('${escapeHtml(item.nomor_lengkap_decrypted)}')" 
                        class="inline-flex items-center gap-1 text-[11px] text-blue-700 font-bold px-2 py-1 bg-blue-50 border border-blue-200/70 rounded-lg hover:bg-blue-100 transition active:scale-95 shrink-0" 
                        title="Salin Nomor">
                        <i data-lucide="copy" class="w-3 h-3"></i>
                        <span>Salin</span>
                    </button>
                </div>

                <!-- Nomor Agenda & Perihal Surat Ringkas -->
                <div>
                    <div class="font-mono text-xs font-black text-blue-700 select-all truncate tracking-tight" title="${escapeHtml(item.nomor_lengkap_decrypted)}">
                        ${escapeHtml(item.nomor_lengkap_decrypted)}
                    </div>
                    <div class="text-xs sm:text-sm font-semibold text-slate-900 leading-snug mt-1 line-clamp-2">
                        ${escapeHtml(item.perihal_decrypted)}
                    </div>
                </div>

                <!-- Baris Bawah: Tujuan, Tanggal & Petugas di Kiri Bawah, Tombol Detail & Aksi di Kanan Bawah -->
                <div class="pt-2 border-t border-slate-100 flex items-end justify-between gap-2 text-xs">
                    <div class="space-y-0.5 flex-1 pr-1 min-w-0">
                        <div class="text-slate-600 text-[11px] truncate">
                            Tujuan: <span class="font-semibold text-slate-800">${escapeHtml(item.instansi_decrypted)}</span>
                        </div>
                        <div class="flex items-center gap-1.5 flex-wrap text-slate-400 text-[10px] font-medium">
                            <span class="inline-flex items-center gap-1">
                                <i data-lucide="calendar" class="w-3 h-3 text-slate-400 shrink-0"></i>
                                <span>${formatTanggalIndo(item.tgl_surat)}</span>
                            </span>
                            <span class="text-slate-300">&bull;</span>
                            <span class="inline-flex items-center gap-1 text-slate-600 font-semibold truncate max-w-[120px]" title="Petugas: ${escapeHtml(item.petugas_decrypted)}">
                                <i data-lucide="user" class="w-3 h-3 text-slate-400 shrink-0"></i>
                                <span class="truncate">${escapeHtml(item.petugas_decrypted)}</span>
                            </span>
                        </div>
                    </div>
                    <button type="button" onclick="bukaBottomSheetDetail(${item.id}, ${item.is_mundur})" 
                        class="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200/80 px-2.5 py-1.5 rounded-xl transition active:scale-95 shadow-2xs">
                        <span>Detail & Aksi</span>
                        <i data-lucide="chevron-up" class="w-3.5 h-3.5 text-blue-600"></i>
                    </button>
                </div>
            </div>
        `;
    });

    tbody.innerHTML = desktopHTML;
    mobileList.innerHTML = mobileHTML;

    renderPagination(totalPages);
    if (window.lucide) lucide.createIcons();
}

// Render Tombol Pagination & Pemilih Jumlah Baris (10, 20, 50)
function renderPagination(totalPages) {
    const paginContainer = document.getElementById("paginationContainer");
    if (!paginContainer) return;

    if (filteredAgenda.length === 0) {
        paginContainer.innerHTML = "";
        return;
    }

    const startItem = (currentPage - 1) * pageSize + 1;
    const endItem = Math.min(currentPage * pageSize, filteredAgenda.length);

    let html = `
        <div class="flex flex-col sm:flex-row items-center justify-between gap-3 w-full text-xs text-slate-600 mt-4 px-1">
            <div class="flex flex-wrap items-center gap-2">
                <span>Menampilkan <strong>${startItem}-${endItem}</strong> dari total <strong>${filteredAgenda.length}</strong> surat</span>
                <span class="text-slate-300 hidden sm:inline">&bull;</span>
                <div class="flex items-center gap-1.5">
                    <span>Tampilkan:</span>
                    <select onchange="ubahPageSize(this.value)" class="bg-white border border-slate-200 text-xs font-bold text-slate-700 py-1 px-2 rounded-lg focus:ring-1 focus:ring-blue-500 shadow-2xs">
                        <option value="10" ${pageSize === 10 ? 'selected' : ''}>10</option>
                        <option value="20" ${pageSize === 20 ? 'selected' : ''}>20</option>
                        <option value="50" ${pageSize === 50 ? 'selected' : ''}>50</option>
                    </select>
                    <span>baris</span>
                </div>
            </div>
            
            <div class="flex items-center gap-1.5">
                <span class="text-xs text-slate-500 mr-1.5">Halaman <strong>${currentPage}</strong> dari <strong>${totalPages || 1}</strong></span>
                <button onclick="gantiHalaman(${currentPage - 1})" ${currentPage <= 1 ? 'disabled class="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-300 cursor-not-allowed bg-slate-50"' : 'class="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 font-semibold text-slate-700 bg-white shadow-2xs transition active:scale-95"'}>
                    &larr; Prev
                </button>
                <button onclick="gantiHalaman(${currentPage + 1})" ${currentPage >= totalPages ? 'disabled class="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-300 cursor-not-allowed bg-slate-50"' : 'class="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 font-semibold text-slate-700 bg-white shadow-2xs transition active:scale-95"'}>
                    Next &rarr;
                </button>
            </div>
        </div>
    `;

    paginContainer.innerHTML = html;
}

function ubahPageSize(val) {
    pageSize = parseInt(val, 10) || 20;
    currentPage = 1;
    renderTable();
}

function gantiHalaman(page) {
    currentPage = page;
    renderTable();
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

// Modal Edit
var editingAgendaId = null;
var editingIsMundur = false;
let fpEditTglSurat = null;
let fpEditTglKirim = null;

function bukaModalEdit(id, isMundur = false) {
    const item = allAgenda.find(a => a.id === id && a.is_mundur === isMundur);
    if (!item) return;

    editingAgendaId = id;
    editingIsMundur = isMundur;

    document.getElementById("editNomorLengkap").innerText = item.nomor_lengkap_decrypted;
    document.getElementById("editKodeSurat").value = item.kode_klasifikasi_decrypted;
    document.getElementById("editPerihal").value = item.perihal_decrypted;
    document.getElementById("editInstansi").value = item.instansi_decrypted;
    document.getElementById("editPetugas").value = item.petugas_decrypted;

    const inputTglSurat = document.getElementById("editTglSurat");
    const inputTglKirim = document.getElementById("editTglKirim");
    const noteTglSurat = document.getElementById("editTglSuratNote");

    const hariKerjaSekarang = getTanggalKerjaEfektif();
    const maxKirim = addDays(item.tgl_surat, 14);

    if (fpEditTglSurat) { fpEditTglSurat.destroy(); fpEditTglSurat = null; }
    if (fpEditTglKirim) { fpEditTglKirim.destroy(); fpEditTglKirim = null; }

    // Aturan Ketat Nomor Mundur: Tanggal surat terkunci ke tanggal induk agar tidak merusak urutan penomoran
    if (isMundur) {
        inputTglSurat.readOnly = true;
        inputTglSurat.value = item.tgl_surat;
        inputTglSurat.classList.add("bg-slate-100", "cursor-not-allowed");
        if (inputTglKirim) {
            inputTglKirim.readOnly = true;
            inputTglKirim.value = item.tgl_kirim || item.tgl_surat;
            inputTglKirim.classList.add("bg-slate-100", "cursor-not-allowed");
        }
        if (noteTglSurat) {
            noteTglSurat.innerText = "Terkunci ke tanggal induk nomor mundur.";
            noteTglSurat.classList.remove("hidden");
        }
    } else {
        inputTglSurat.readOnly = false;
        inputTglSurat.classList.remove("bg-slate-100", "cursor-not-allowed");
        if (inputTglKirim) {
            inputTglKirim.readOnly = false;
            inputTglKirim.classList.remove("bg-slate-100", "cursor-not-allowed");
        }
        if (noteTglSurat) {
            noteTglSurat.innerText = `Batas: Minimal ${formatTanggalIndo(item.tgl_surat)} (tidak boleh mundur).`;
            noteTglSurat.classList.remove("hidden");
        }

        if (window.flatpickr) {
            fpEditTglSurat = flatpickr(inputTglSurat, {
                locale: "id",
                dateFormat: "Y-m-d",
                altInput: true,
                altFormat: "j F Y",
                minDate: item.tgl_surat,
                maxDate: hariKerjaSekarang,
                defaultDate: item.tgl_surat,
                disable: [
                    function(date) {
                        return (date.getDay() === 0 || date.getDay() === 6);
                    }
                ],
                disableMobile: true,
                onChange: function(selectedDates, dateStr) {
                    if (dateStr && fpEditTglKirim) {
                        const newMaxKirim = addDays(dateStr, 14);
                        fpEditTglKirim.set("minDate", dateStr);
                        fpEditTglKirim.set("maxDate", newMaxKirim);
                        if (inputTglKirim.value < dateStr) {
                            fpEditTglKirim.setDate(dateStr, false);
                        }
                    }
                }
            });

            fpEditTglKirim = flatpickr(inputTglKirim, {
                locale: "id",
                dateFormat: "Y-m-d",
                altInput: true,
                altFormat: "j F Y",
                minDate: item.tgl_surat,
                maxDate: maxKirim,
                defaultDate: item.tgl_kirim || item.tgl_surat,
                disableMobile: true,
                onChange: function(selectedDates, dateStr) {
                    if (dateStr) {
                        const currentTglSurat = inputTglSurat.value;
                        const batasMax = addDays(currentTglSurat, 14);
                        if (dateStr < currentTglSurat) {
                            showAppAlert(`Tanggal kirim (${formatTanggalIndo(dateStr)}) tidak boleh lebih awal dari tanggal surat (${formatTanggalIndo(currentTglSurat)})!`, "warning", "Jaring Pengaman Administrasi");
                            if (fpEditTglKirim) fpEditTglKirim.setDate(currentTglSurat, false);
                        } else if (dateStr > batasMax) {
                            showAppAlert(`Tanggal kirim maksimal 14 hari sejak tanggal surat (${formatTanggalIndo(batasMax)})!`, "warning", "Jaring Pengaman Administrasi");
                            if (fpEditTglKirim) fpEditTglKirim.setDate(batasMax, false);
                        }
                    }
                }
            });
        } else {
            inputTglSurat.value = item.tgl_surat;
            inputTglKirim.value = item.tgl_kirim || "";
            inputTglKirim.min = item.tgl_surat;
            inputTglKirim.max = maxKirim;
        }
    }

    document.getElementById("editPenanggungJawab").value = item.penanggung_jawab_decrypted;
    document.getElementById("editBentukSurat").value = item.bentuk_surat;

    document.getElementById("modalEdit").classList.remove("hidden");
    if (window.lucide) lucide.createIcons();
}

function tutupModalEdit() {
    editingAgendaId = null;
    editingIsMundur = false;
    if (fpEditTglSurat) { fpEditTglSurat.destroy(); fpEditTglSurat = null; }
    if (fpEditTglKirim) { fpEditTglKirim.destroy(); fpEditTglKirim = null; }
    document.getElementById("modalEdit").classList.add("hidden");
}

async function handleSimpanEdit(e) {
    if (e) e.preventDefault();
    if (!editingAgendaId) return;

    const tglSurat = document.getElementById("editTglSurat").value;
    const tglKirim = document.getElementById("editTglKirim").value;

    const item = allAgenda.find(a => a.id === editingAgendaId && a.is_mundur === editingIsMundur);
    if (!item) {
        showAppAlert("Data agenda tidak ditemukan!", "error", "Data Tidak Ditemukan");
        return;
    }

    // Tertib Administrasi: Tanggal surat tidak boleh Sabtu / Minggu
    if (isWeekend(tglSurat)) {
        showAppAlert("Tanggal surat tidak boleh jatuh pada hari Sabtu atau Minggu (hari libur kedinasan)!", "warning", "Tertib Administrasi");
        return;
    }

    // Jaring Pengaman Administrasi: Tanggal surat tidak boleh dimundurkan dari tanggal yang sudah ada saat ini!
    if (!editingIsMundur && tglSurat < item.tgl_surat) {
        showAppAlert(`Tanggal surat tidak boleh dimundurkan dari tanggal yang sudah ada (${formatTanggalIndo(item.tgl_surat)})!`, "warning", "Jaring Pengaman Administrasi");
        return;
    }

    // Jaring Pengaman: Tanggal kirim tidak boleh lebih awal dari tanggal surat dan maksimal 14 hari
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

    const btn = document.getElementById("btnSimpanEdit");
    btn.disabled = true;
    btn.innerText = "Menyimpan...";

    try {
        // Bersihkan whitespace ganda dan spasi berlebih
        const kodeKlasifikasi = bersihkanTeks(document.getElementById("editKodeSurat").value);
        const perihal = bersihkanTeks(document.getElementById("editPerihal").value);
        const instansi = bersihkanTeks(document.getElementById("editInstansi").value);
        const petugas = bersihkanTeks(document.getElementById("editPetugas").value);
        const penanggungJawab = document.getElementById("editPenanggungJawab").value;
        const bentukSurat = document.getElementById("editBentukSurat").value;
        if (!item) throw new Error("Data agenda tidak ditemukan");

        const noUrutStr = item.is_mundur ? item.display_no : item.no_urut;
        const nomorLengkap = `${kodeKlasifikasi} / ${noUrutStr} / 436.9.3.1 / ${item.tahun}`;

        // Enkripsi seluruh field di sisi browser (Zero-Knowledge)
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

        const endpoint = editingIsMundur ? `/api/nomor-mundur/${editingAgendaId}` : `/api/agenda/${editingAgendaId}`;

        const res = await fetch(endpoint, {
            method: "PUT",
            headers: getAuthHeaders({
                "Content-Type": "application/json"
            }),
            body: JSON.stringify({
                tgl_surat: tglSurat,
                tgl_kirim: tglKirim || null,
                bentuk_surat: bentukSurat,
                kode_klasifikasi_encrypted,
                nomor_lengkap_encrypted,
                penanggung_jawab_encrypted,
                perihal_encrypted,
                instansi_encrypted,
                petugas_encrypted
            })
        });

        const result = await res.json();
        if (result.success) {
            tutupModalEdit();
            // Otomatis segarkan seluruh data agenda & statistik dari server
            await loadAgendaData();
            await loadStats();
            showToast("Perubahan data agenda berhasil disimpan!");
        } else {
            showAppAlert("Gagal menyimpan perubahan: " + (result.error || "Terjadi kesalahan"), "error", "Gagal Simpan");
        }
    } catch (err) {
        console.error("Gagal simpan edit:", err);
        showAppAlert("Terjadi kesalahan sistem: " + (err.message || err), "error", "Kesalahan Sistem");
    } finally {
        btn.disabled = false;
        btn.innerText = "Simpan Perubahan";
    }
}

// ==============================================================
// BOTTOM SHEET MODAL (KARTU MUNCUL DARI BAWAH LAYAR)
// ==============================================================
var activeSheetItem = null;

function bukaBottomSheetDetail(id, isMundur) {
    const item = allAgenda.find(a => a.id === id && a.is_mundur === isMundur);
    if (!item) return;

    activeSheetItem = item;

    // 1. Header Badge Nomor & Bentuk
    const badgeNo = document.getElementById("sheetBadgeNo");
    const badgeBentuk = document.getElementById("sheetBadgeBentuk");

    if (badgeNo) {
        badgeNo.innerText = item.is_mundur ? item.display_no : `#${item.no_urut}`;
        badgeNo.className = item.is_mundur
            ? "font-mono text-xs font-black px-2.5 py-0.5 rounded-lg bg-indigo-100 text-indigo-900 border border-indigo-300"
            : "font-mono text-xs font-black px-2.5 py-0.5 rounded-lg bg-blue-50 text-blue-800 border border-blue-200";
    }

    if (badgeBentuk) {
        const isESurat = item.bentuk_surat === "eSurat (Elektronik)";
        badgeBentuk.innerText = isESurat ? "eSurat" : "Surat Manual";
        badgeBentuk.className = `text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${isESurat ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-emerald-50 text-emerald-800 border-emerald-200'}`;
    }

    // 2. Isi Konten Rincian
    const elNomor = document.getElementById("sheetNomorLengkap");
    const elPerihal = document.getElementById("sheetPerihal");
    const elInstansi = document.getElementById("sheetInstansi");
    const elTglSurat = document.getElementById("sheetTglSurat");
    const elTglKirim = document.getElementById("sheetTglKirim");
    const elPengelola = document.getElementById("sheetPengelola");
    const elPetugas = document.getElementById("sheetPetugas");

    if (elNomor) elNomor.innerText = item.nomor_lengkap_decrypted || "-";
    if (elPerihal) elPerihal.innerText = item.perihal_decrypted || "-";
    if (elInstansi) elInstansi.innerText = item.instansi_decrypted || "-";
    if (elTglSurat) elTglSurat.innerText = formatTanggalIndo(item.tgl_surat);
    if (elTglKirim) elTglKirim.innerText = item.tgl_kirim ? formatTanggalIndo(item.tgl_kirim) : "-";
    if (elPengelola) elPengelola.innerText = item.penanggung_jawab_decrypted || "-";
    if (elPetugas) elPetugas.innerText = item.petugas_decrypted || "-";

    const elWaktu = document.getElementById("sheetWaktuInput");
    if (elWaktu) elWaktu.innerText = formatWaktuIndo(item.created_at);

    // 3. Tombol Aksi Thumb-Friendly di Footer Sheet
    const actionsContainer = document.getElementById("sheetActionsContainer");
    if (actionsContainer) {
        let actionHTML = "";



        // Tombol Edit (Tersedia untuk Surat Reguler & Nomor Mundur)
        actionHTML += `
            <button type="button" onclick="bukaModalEdit(${item.id}, ${item.is_mundur}); tutupBottomSheetDetail();"
                class="flex-1 py-2.5 px-3 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 active:scale-95 shadow-2xs">
                <i data-lucide="edit-3" class="w-4 h-4"></i>
                <span>Edit</span>
            </button>
        `;

        // Tombol Hapus
        actionHTML += `
            <button type="button" onclick="bukaModalHapus(${item.id}, ${item.is_mundur}); tutupBottomSheetDetail();"
                class="flex-1 py-2.5 px-3 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 active:scale-95 shadow-2xs">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
                <span>Hapus</span>
            </button>
        `;

        actionsContainer.innerHTML = actionHTML;
    }

    // 4. Buka Modal dan Trigger Animasi Slide-up
    const modal = document.getElementById("bottomSheetModal");
    const card = document.getElementById("bottomSheetCard");
    if (modal && card) {
        modal.classList.remove("hidden");
        requestAnimationFrame(() => {
            card.classList.remove("translate-y-full");
            card.classList.add("translate-y-0");
        });
    }

    if (window.lucide) lucide.createIcons();
}

function tutupBottomSheetDetail() {
    const modal = document.getElementById("bottomSheetModal");
    const card = document.getElementById("bottomSheetCard");
    if (!modal || !card) return;

    card.classList.remove("translate-y-0");
    card.classList.add("translate-y-full");

    setTimeout(() => {
        modal.classList.add("hidden");
        activeSheetItem = null;
    }, 250);
}

// Salin Nomor Lengkap langsung dari Bottom Sheet
function salinNomorDariSheet() {
    if (!activeSheetItem || !activeSheetItem.nomor_lengkap_decrypted) return;
    salinNomorLengkap(activeSheetItem.nomor_lengkap_decrypted);
    const btn = document.getElementById("btnSheetCopy");
    if (btn) {
        const originalHTML = btn.innerHTML;
        btn.innerHTML = `<i data-lucide="check" class="w-3.5 h-3.5 text-emerald-600"></i><span class="text-[11px] text-emerald-600">Tersalin</span>`;
        if (window.lucide) lucide.createIcons();
        setTimeout(() => {
            btn.innerHTML = originalHTML;
            if (window.lucide) lucide.createIcons();
        }, 1500);
    }
}

// ==============================================================
// MODAL KONFIRMASI HAPUS DENGAN VERIFIKASI NAMA PETUGAS PEMBUAT
// ==============================================================
var deletingTargetItem = null;

function bukaModalHapus(id, isMundur) {
    const item = allAgenda.find(a => a.id === id && a.is_mundur === isMundur);
    if (!item) return;

    deletingTargetItem = item;

    document.getElementById("hapusTargetId").value = id;
    document.getElementById("hapusTargetIsMundur").value = isMundur ? "true" : "false";
    document.getElementById("hapusInfoNomor").innerText = item.nomor_lengkap_decrypted;
    document.getElementById("hapusInfoPerihal").innerText = item.perihal_decrypted;

    const inputPetugas = document.getElementById("hapusInputPetugas");
    inputPetugas.value = "";
    inputPetugas.placeholder = "Ketik nama petugas pembuat surat...";

    const errorMsg = document.getElementById("hapusErrorMsg");
    if (errorMsg) {
        errorMsg.classList.add("hidden");
        errorMsg.innerText = "";
    }

    const modal = document.getElementById("modalHapus");
    if (modal) modal.classList.remove("hidden");
    if (window.lucide) lucide.createIcons();

    setTimeout(() => {
        if (inputPetugas) inputPetugas.focus();
    }, 100);
}

function tutupModalHapus() {
    deletingTargetItem = null;
    const modal = document.getElementById("modalHapus");
    if (modal) modal.classList.add("hidden");
}

async function eksekusiHapusData(e) {
    if (e) e.preventDefault();
    if (!deletingTargetItem) return;

    const inputVal = (document.getElementById("hapusInputPetugas")?.value || "").trim();
    const targetPetugas = (deletingTargetItem.petugas_decrypted || "").trim();
    const errorMsg = document.getElementById("hapusErrorMsg");

    // Verifikasi: Pengguna wajib memasukkan nama petugas pembuat secara tepat (case-insensitive)
    if (inputVal.toLowerCase() !== targetPetugas.toLowerCase()) {
        if (errorMsg) {
            errorMsg.innerText = "Nama petugas pembuat tidak sesuai! Silakan ketik nama petugas yang menerbitkan surat ini dengan benar.";
            errorMsg.classList.remove("hidden");
        }
        return;
    }

    const btn = document.getElementById("btnKonfirmasiHapus");
    btn.disabled = true;
    btn.innerHTML = `<span class="inline-block animate-spin mr-1.5">⏳</span> Menghapus...`;

    try {
        const id = deletingTargetItem.id;
        const isMundur = deletingTargetItem.is_mundur;
        const endpoint = isMundur ? `/api/nomor-mundur/${id}` : `/api/agenda/${id}`;

        const res = await fetch(endpoint, {
            method: "DELETE",
            headers: getAuthHeaders()
        });

        const result = await res.json();
        if (result.success) {
            allAgenda = allAgenda.filter(a => !(a.id === id && a.is_mundur === isMundur));
            tutupModalHapus();
            applyClientFilters();
            updateStatsFromClient(allAgenda);
            if (typeof loadAgendaData === "function") {
                await loadAgendaData();
            }
            if (typeof loadStats === "function") {
                await loadStats();
            }
            showToast(isMundur ? "Nomor mundur berhasil dihapus!" : "Agenda berhasil dihapus!");
        } else {
            if (errorMsg) {
                errorMsg.innerText = result.error || "Gagal menghapus data dari server";
                errorMsg.classList.remove("hidden");
            } else {
                showAppAlert("Gagal menghapus: " + (result.error || "Terjadi kesalahan"), "error", "Gagal Menghapus");
            }
        }
    } catch (err) {
        console.error("Gagal hapus data:", err);
        if (errorMsg) {
            errorMsg.innerText = "Terjadi kendala jaringan/sistem: " + (err.message || err);
            errorMsg.classList.remove("hidden");
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="trash-2" class="w-4 h-4 mr-1"></i> Hapus Permanen`;
        if (window.lucide) lucide.createIcons();
    }
}

function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

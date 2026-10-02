/**
 * Modul Rantai Berantai (UI mikro-kosmetik).
 * Prinsip: pengguna tidak perlu tahu soal hash — yang terlihat hanya
 * cuplikan 7-char gaya git + penanda versi mungil. Detail penuh
 * tersembunyi di balik klik.
 */
var ChainUI = {
    revisions: {},
    head: null,
    valid: null,
    blocks: 0,
    historyCache: {},

    // Segarkan status rantai untuk tahun aktif. Dipanggil sekali tiap
    // loadAgendaData; tidak memblokir render tabel.
    async refresh() {
        const el = document.getElementById("chainInfo");
        try {
            const res = await fetch(`/api/chain/verify?tahun=${activeYear}`, { headers: getAuthHeaders() });
            const json = await res.json();
            if (!el) return;
            // Galat berkode (mudah didiagnosis, lihat ARCHITECTURE.md daftar kode)
            if (!json.success) {
                el.classList.remove("hidden");
                const label = {
                    BUTUH_BERTAHAP: "\u00b7 rantai besar",
                    KUOTA_HABIS: "\u00b7 kuota habis",
                    GALAT_VERIFY: "\u00b7 rantai galat",
                }[json.kode] || "\u00b7 rantai galat";
                const arti = {
                    BUTUH_BERTAHAP: `Rantai ${json.blocks || "?"} blok melebihi batas verifikasi penuh (${json.batas || "?"}). Perlu verifikasi bertahap \u2014 hubungi pengelola.`,
                    KUOTA_HABIS: "Kuota baris database harian habis (reset 07:00 WIB). Coba lagi nanti.",
                    GALAT_VERIFY: `Verifikasi gagal (${json.kode || "?"}) \u2014 hubungi pengelola.`,
                }[json.kode] || (json.error || "Verifikasi gagal.");
                el.innerHTML = label;
                el.className = "font-mono text-[10px] text-rose-400 hover:text-rose-600 cursor-pointer select-none transition";
                el.title = arti;
                return;
            }
            this.valid = json.valid;
            this.blocks = json.blocks || 0;
            this.head = json.head || null;
            const revBaru = JSON.stringify(json.revisions || {});
            const berubah = revBaru !== JSON.stringify(this.revisions);
            this.revisions = json.revisions || {};
            if (!el) return;
            if (this.blocks === 0) {
                el.classList.add("hidden");
                return;
            }
            el.classList.remove("hidden");
            if (json.valid && this.head) {
                el.innerHTML = `&middot; &#9935; ${escapeHtml(this.head.pendek)}`;
                el.className = "font-mono text-[10px] text-slate-400 hover:text-slate-600 cursor-pointer select-none transition";
                el.title = `Catatan berantai terverifikasi \u2022 ${this.blocks} blok \u2022 klik untuk cek ulang`;
            } else {
                el.innerHTML = `&middot; rantai perlu perhatian`;
                el.className = "font-mono text-[10px] text-rose-400 hover:text-rose-600 cursor-pointer select-none transition";
                el.title = "Verifikasi rantai gagal \u2014 klik untuk cek ulang, hubungi pengelola bila berlanjut";
            }
            if (window.lucide) lucide.createIcons();
            // Badge versi baru muncul setelah peta revisi tiba
            if (berubah && typeof renderTable === "function") renderTable();
        } catch (err) {
            if (el) {
                el.classList.remove("hidden");
                el.innerHTML = `&middot; rantai tak terjangkau`;
                el.className = "font-mono text-[10px] text-slate-300 select-none";
                el.title = "Status rantai tidak dapat dimuat saat ini";
            }
        }
    },

    revOf(item) {
        const key = `${item.is_mundur ? "mundur" : "reguler"}:${item.id}`;
        return this.revisions[key] || 1;
    },

    // Cuil hash mikro per baris (gaya git shortlog): pajangan saja,
    // TIDAK bisa diklik. Aksi riwayat ada di tombol Aksi per baris.
    micro(item) {
        const r = item._rantai;
        if (!r || !r.pendek) return "";
        const ver = (r.versi || 1) > 1 ? `\u00b7v${r.versi}` : "";
        return `<span class="font-mono text-[9px] leading-none text-slate-400 select-none whitespace-nowrap" title="Catatan berantai terverifikasi">\u26d3; ${escapeHtml(r.pendek)}${ver}</span>`;
    },

    // Satu baris halus di bottom sheet detail: cuplikan hash + jumlah versi.
    async fillSheetLine(item) {
        const el = document.getElementById("sheetChainLine");
        if (!el) return;
        el.innerHTML = `<span class="text-slate-300">\u26d3; merangkai&hellip;</span>`;
        try {
            const refKind = item.is_mundur ? "mundur" : "reguler";
            const cacheKey = `${refKind}:${item.id}`;
            let data = this.historyCache[cacheKey];
            if (!data) {
                const res = await fetch(`/api/chain/history?ref_kind=${refKind}&ref_id=${item.id}`, { headers: getAuthHeaders() });
                const json = await res.json();
                if (!json.success) throw new Error(json.error || "gagal");
                data = json.data || [];
                this.historyCache[cacheKey] = data;
            }
            if (data.length === 0) {
                el.innerHTML = `<span class="text-slate-300">pra-rantai</span>`;
                return;
            }
            const head = data[data.length - 1];
            const rev = data.length;
            el.innerHTML =
                `<span class="font-mono" title="Cuplikan pengaman catatan">\u26d3; ${escapeHtml(String(head.block_hash).slice(0, 7))}</span>` +
                (rev > 1 ? `<span class="text-slate-300"> \u2022 </span><span>${rev} versi (lihat tombol Riwayat)</span>`
                         : `<span class="text-slate-300"> \u2022 </span><span>versi awal</span>`);
        } catch (err) {
            el.innerHTML = `<span class="text-slate-300">riwayat tak tersedia</span>`;
        }
    },

    async openHistory(id, isMundur) {
        const modal = document.getElementById("chainHistoryModal");
        const body = document.getElementById("chainHistoryBody");
        const title = document.getElementById("chainHistoryTitle");
        if (!modal || !body) return;
        const item = (typeof allAgenda !== "undefined")
            ? allAgenda.find((a) => a.id === id && a.is_mundur === isMundur)
            : null;
        if (title) title.innerText = item ? `Riwayat ${item.display_no || "#" + item.no_urut}` : "Riwayat catatan";
        body.innerHTML = `<p class="text-xs text-slate-400 py-6 text-center">Memuat riwayat&hellip;</p>`;
        modal.classList.remove("hidden");
        try {
            const refKind = isMundur ? "mundur" : "reguler";
            const res = await fetch(`/api/chain/history?ref_kind=${refKind}&ref_id=${id}`, { headers: getAuthHeaders() });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || "gagal");
            const rows = json.data || [];
            if (rows.length === 0) {
                body.innerHTML = `<p class="text-xs text-slate-400 py-6 text-center">Belum ada catatan berantai (data pra-rantai).</p>`;
                return;
            }
            // Dekripsi tiap versi untuk ringkasan perubahan (di memori browser)
            const plain = [];
            for (const b of rows) {
                const [kode, perihal, instansi, pengelola, petugas] = await Promise.all([
                    AppCrypto.decrypt(b.kode_klasifikasi_encrypted, appKey),
                    AppCrypto.decrypt(b.perihal_encrypted, appKey),
                    AppCrypto.decrypt(b.instansi_encrypted, appKey),
                    AppCrypto.decrypt(b.penanggung_jawab_encrypted, appKey),
                    AppCrypto.decrypt(b.petugas_encrypted, appKey),
                ]);
                plain.push({ b, kode, perihal, instansi, pengelola, petugas });
            }
            const labelKind = { terbit: "Diterbitkan", koreksi: "Dikoreksi", hapus: "Dihapus" };
            let html = `<ol class="relative space-y-4 before:absolute before:left-[5px] before:top-2 before:bottom-2 before:w-px before:bg-slate-200">`;
            plain.forEach((p, i) => {
                const prev = i > 0 ? plain[i - 1] : null;
                const berubah = [];
                if (!prev) berubah.push("Versi awal");
                else {
                    if (p.kode !== prev.kode) berubah.push("Kode");
                    if (p.perihal !== prev.perihal) berubah.push("Perihal");
                    if (p.instansi !== prev.instansi) berubah.push("Tujuan");
                    if (p.pengelola !== prev.pengelola) berubah.push("Pengelola");
                    if (p.petugas !== prev.petugas) berubah.push("Petugas");
                    if (p.b.tgl_surat !== prev.b.tgl_surat) berubah.push("Tgl surat");
                    if ((p.b.tgl_kirim || "") !== (prev.b.tgl_kirim || "")) berubah.push("Tgl kirim");
                    if (p.b.bentuk_surat !== prev.b.bentuk_surat) berubah.push("Bentuk");
                    if (berubah.length === 0) berubah.push("Tanpa perubahan isi");
                }
                const dot = p.b.kind === "hapus" ? "bg-rose-400" : (p.b.kind === "koreksi" ? "bg-amber-400" : "bg-emerald-400");
                html += `
                    <li class="relative pl-5">
                        <span class="absolute left-0 top-1.5 w-[11px] h-[11px] rounded-full ${dot} ring-4 ring-white"></span>
                        <div class="flex items-center gap-1.5 flex-wrap">
                            <span class="text-xs font-bold text-slate-800">${labelKind[p.b.kind] || p.b.kind}</span>
                            <span class="font-mono text-[10px] text-slate-400">${escapeHtml(String(p.b.block_hash).slice(0, 7))}</span>
                        </div>
                        <div class="text-[11px] text-slate-500 mt-0.5">${escapeHtml(berubah.join(", "))} &middot; ${escapeHtml(p.petugas || "-")}</div>
                        <div class="text-[10px] text-slate-400">${typeof formatWaktuIndo === "function" ? formatWaktuIndo(p.b.created_at) : escapeHtml(p.b.created_at || "")}</div>
                    </li>`;
            });
            html += `</ol>`;
            body.innerHTML = html;
        } catch (err) {
            body.innerHTML = `<p class="text-xs text-rose-500 py-6 text-center">Gagal memuat riwayat: ${escapeHtml(err.message || err)}</p>`;
        }
        if (window.lucide) lucide.createIcons();
    },

    closeHistory() {
        const modal = document.getElementById("chainHistoryModal");
        if (modal) modal.classList.add("hidden");
    }
};

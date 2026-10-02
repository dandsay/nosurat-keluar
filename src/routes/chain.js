/**
 * Route Handler: Rantai Berantai (Hash-Chain Ledger) — read-only + backfill.
 * Append blok dilakukan di dalam route agenda/mundur (satu batch atomic
 * dengan insert/update/delete operasional), bukan dari sini.
 */
import { jsonResponse } from "../utils/response.js";
import { verifyChain, appendChainBlock, maxVerifyBlocks, kodeGalatVerify } from "../utils/chain.js";

// GET /api/chain/verify?tahun=2026|ALL — status rantai untuk badge UI.
export async function handleChainVerify(request, env, url) {
    try {
        const batas = maxVerifyBlocks(env);
        const hitung = await env.DB.prepare(
            "SELECT COUNT(*) AS n FROM agenda_chain"
        ).first();
        if ((hitung?.n || 0) > batas) {
            return jsonResponse({
                success: false,
                kode: "BUTUH_BERTAHAP",
                blocks: hitung.n,
                batas,
                error: `Rantai (${hitung.n} blok) melebihi batas verifikasi penuh (${batas}). Diperlukan verifikasi bertahap.`
            }, 200);
        }
        const tahunParam = url.searchParams.get("tahun");
        const tahun = (!tahunParam || tahunParam === "ALL") ? null : parseInt(tahunParam, 10);
        const hasil = await verifyChain(env, tahun);
        return jsonResponse({ success: true, ...hasil });
    } catch (err) {
        console.error("Error verify chain:", err);
        const kode = kodeGalatVerify(err);
        const pesan = kode === "KUOTA_HABIS"
            ? "Kuota baris database harian habis (reset 00:00 UTC / 07:00 WIB). Coba lagi nanti."
            : "Gagal memverifikasi rantai.";
        return jsonResponse({ success: false, kode, error: pesan }, kode === "KUOTA_HABIS" ? 429 : 500);
    }
}

// GET /api/chain/history?ref_kind=reguler&ref_id=123 — versi-versi satu nomor.
export async function handleChainHistory(request, env, url) {
    try {
        const refKind = url.searchParams.get("ref_kind");
        const refId = parseInt(url.searchParams.get("ref_id") || "0", 10);
        if ((refKind !== "reguler" && refKind !== "mundur") || !refId) {
            return jsonResponse({ success: false, error: "Parameter ref_kind (reguler|mundur) dan ref_id diperlukan." }, 400);
        }
        const { results } = await env.DB.prepare(
            "SELECT * FROM agenda_chain WHERE ref_kind = ? AND ref_id = ? ORDER BY id ASC"
        ).bind(refKind, refId).all();
        return jsonResponse({ success: true, ref_kind: refKind, ref_id: refId, versi: (results || []).length, data: results || [] });
    } catch (err) {
        console.error("Error chain history:", err);
        return jsonResponse({ success: false, error: "Gagal memuat riwayat nomor." }, 500);
    }
}

// POST /api/chain/backfill — rangkai blok 'terbit' untuk data pra-rantai.
// Idempoten: ref yang sudah punya blok dilewati. Dijalankan sekali pasca-deploy.
export async function handleChainBackfill(request, env) {
    try {
        const { results: chained } = await env.DB.prepare(
            "SELECT DISTINCT ref_kind, ref_id FROM agenda_chain"
        ).all();
        const sudah = new Set((chained || []).map((r) => `${r.ref_kind}:${r.ref_id}`));

        const { results: regRows } = await env.DB.prepare("SELECT * FROM agenda_surat").all();
        const { results: munRows } = await env.DB.prepare("SELECT * FROM agenda_nomor_mundur").all();

        const antre = [];
        for (const r of (regRows || [])) {
            if (sudah.has(`reguler:${r.id}`)) continue;
            antre.push({ refKind: "reguler", row: r, refNo: String(r.no_urut) });
        }
        for (const r of (munRows || [])) {
            if (sudah.has(`mundur:${r.id}`)) continue;
            antre.push({ refKind: "mundur", row: r, refNo: r.no_urut_lengkap });
        }
        antre.sort((a, b) => String(a.row.created_at || "").localeCompare(String(b.row.created_at || "")) || a.row.id - b.row.id);

        let dirangkai = 0;
        for (const item of antre) {
            const r = item.row;
            await appendChainBlock(env, {
                kind: "terbit",
                refKind: item.refKind,
                refId: r.id,
                refNo: item.refNo,
                tahun: r.tahun,
                tglSurat: r.tgl_surat,
                tglKirim: r.tgl_kirim,
                bentukSurat: r.bentuk_surat,
                enc: {
                    kode_klasifikasi_encrypted: r.kode_klasifikasi_encrypted,
                    nomor_lengkap_encrypted: r.nomor_lengkap_encrypted,
                    penanggung_jawab_encrypted: r.penanggung_jawab_encrypted,
                    perihal_encrypted: r.perihal_encrypted,
                    instansi_encrypted: r.instansi_encrypted,
                    petugas_encrypted: r.petugas_encrypted,
                },
            });
            dirangkai++;
        }

        return jsonResponse({ success: true, dirangkai, message: `Backfill selesai: ${dirangkai} blok terbit dirangkai.` });
    } catch (err) {
        console.error("Error chain backfill:", err);
        return jsonResponse({ success: false, error: "Gagal menjalankan backfill rantai." }, 500);
    }
}

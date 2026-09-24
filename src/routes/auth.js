/**
 * Route Handler: Autentikasi PIN Portal & Penerbitan Session Token
 */
import { jsonResponse } from "../utils/response.js";
import { verifyPin, createSessionToken } from "../utils/auth-crypto.js";

export async function handleAuthVerify(request, env) {
    try {
        const body = await request.json();
        const pin = body?.pin;

        if (!pin || typeof pin !== "string") {
            return jsonResponse({ success: false, error: "Format permintaan tidak valid. PIN diperlukan." }, 400);
        }

        const isValid = await verifyPin(pin, env);

        if (isValid) {
            const token = await createSessionToken(env);
            return jsonResponse({
                success: true,
                message: "Otorisasi Berhasil",
                token: token
            });
        } else {
            // Delay 500ms untuk memitigasi serangan brute-force otomatis
            await new Promise(resolve => setTimeout(resolve, 500));
            return jsonResponse({ success: false, error: "PIN Salah! Akses Ditolak." }, 401);
        }
    } catch (err) {
        console.error("Auth verify error:", err);
        return jsonResponse({ success: false, error: "Terjadi kesalahan saat memproses otorisasi." }, 500);
    }
}


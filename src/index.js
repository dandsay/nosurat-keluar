/**
 * Cloudflare Worker Backend for Register Agenda Surat Keluar
 * Kelurahan Alun-Alun Contong
 * 
 * Modular Router & Zero-Knowledge Backend
 */

import { jsonResponse } from "./utils/response.js";
import { verifySessionToken } from "./utils/auth-crypto.js";
import { handleAuthVerify } from "./routes/auth.js";
import { handleGetAgenda, handleCreateAgenda, handleUpdateAgenda, handleDeleteAgenda, handleGetNextNumber } from "./routes/agenda.js";
import { 
    handleSmartDetectNomorMundur,
    handleCheckNomorMundur, 
    handleGetNomorMundur, 
    handleCreateNomorMundur, 
    handleUpdateNomorMundur, 
    handleDeleteNomorMundur 
} from "./routes/mundur.js";
import { handleStats } from "./routes/stats.js";

export default {
    async fetch(request, env, ctx) {
        // 1. Handle CORS Preflight
        if (request.method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, Authorization"
                }
            });
        }

        const url = new URL(request.url);

        // 2. Security Check for API routes (Session Token Gatekeeper)
        if (url.pathname.startsWith("/api/") && url.pathname !== "/api/auth/verify") {
            let authorized = false;

            // Otorisasi Resmi: Authorization Header (Bearer Session Token HMAC-SHA256)
            const authHeader = request.headers.get("Authorization");
            if (authHeader && authHeader.startsWith("Bearer ")) {
                const token = authHeader.substring(7).trim();
                const session = await verifySessionToken(token, env);
                if (session) {
                    authorized = true;
                }
            }

            if (!authorized) {
                return jsonResponse({ success: false, error: "Akses ditolak. Sesi tidak valid atau telah kedaluwarsa." }, 401);
            }
        }

        // 3. API Router
        // 3.1 Auth PIN Verify
        if (url.pathname === "/api/auth/verify" && request.method === "POST") {
            return handleAuthVerify(request, env);
        }

        // 3.2 Statistik Dashboard
        if (url.pathname === "/api/stats" && request.method === "GET") {
            return handleStats(request, env, url);
        }

        // 3.4 Agenda Reguler: List, Create & Next Number
        if (url.pathname === "/api/agenda/next-number" && request.method === "GET") {
            return handleGetNextNumber(request, env, url);
        }

        if (url.pathname === "/api/agenda") {
            if (request.method === "GET") return handleGetAgenda(request, env, url);
            if (request.method === "POST") return handleCreateAgenda(request, env);
        }

        // 3.6 Agenda Reguler: Update & Delete by ID (/api/agenda/:id)
        if (url.pathname.startsWith("/api/agenda/")) {
            const id = url.pathname.split("/")[3];
            if (request.method === "PUT") return handleUpdateAgenda(request, env, id);
            if (request.method === "DELETE") return handleDeleteAgenda(request, env, id);
        }

        // 3.7 Agenda Nomor Mundur: Smart Detection by Date
        if (url.pathname === "/api/nomor-mundur/smart-detect" && request.method === "GET") {
            return handleSmartDetectNomorMundur(request, env, url);
        }

        // 3.8 Agenda Nomor Mundur: Check suggestion (Legacy)
        if (url.pathname === "/api/nomor-mundur/check" && request.method === "GET") {
            return handleCheckNomorMundur(request, env, url);
        }

        // 3.8 Agenda Nomor Mundur: List & Create
        if (url.pathname === "/api/nomor-mundur") {
            if (request.method === "GET") return handleGetNomorMundur(request, env, url);
            if (request.method === "POST") return handleCreateNomorMundur(request, env);
        }

        // 3.9 Agenda Nomor Mundur: Update & Delete by ID (/api/nomor-mundur/:id)
        if (url.pathname.startsWith("/api/nomor-mundur/")) {
            const id = url.pathname.split("/")[3];
            if (request.method === "PUT") return handleUpdateNomorMundur(request, env, id);
            if (request.method === "DELETE") return handleDeleteNomorMundur(request, env, id);
        }

        // 4. Static Assets Fallthrough (Frontend UI)
        if (env.ASSETS) {
            return env.ASSETS.fetch(request);
        }

        return new Response("Not Found", { status: 404 });
    }
};

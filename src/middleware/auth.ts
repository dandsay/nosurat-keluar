/**
 * Middleware gatekeeper Bearer session — Hono.
 * Port logika src/index.js: semua /api/* kecuali POST /api/auth/verify wajib token valid.
 */
import type { Context, Next } from "hono";
import type { Env, SessionPayload } from "../types";
import { verifySessionToken } from "../utils/auth-crypto";

export async function sessionGate(
  c: Context<{ Bindings: Env; Variables: { session: SessionPayload } }>,
  next: Next,
) {
  const path = c.req.path;
  const method = c.req.method;

  if (path === "/api/auth/verify" && method === "POST") {
    return next();
  }

  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.substring(7).trim();
    const session = await verifySessionToken(token, c.env);
    if (session) {
      c.set("session", session);
      return next();
    }
  }

  return c.json(
    { success: false, error: "Akses ditolak. Sesi tidak valid atau telah kedaluwarsa." },
    401,
  );
}

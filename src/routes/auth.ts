/**
 * Router Auth — Hono + TS.
 * POST /api/auth/verify
 */
import { Hono } from "hono";
import type { Env } from "../types";
import { verifyPin, createSessionToken } from "../utils/auth-crypto";

const auth = new Hono<{ Bindings: Env }>({ strict: false });

auth.post("/verify", async (c) => {
  try {
    const body = await c.req.json<{ pin?: unknown }>();
    const pin = body?.pin;
    if (!pin || typeof pin !== "string") {
      return c.json({ success: false, error: "Format permintaan tidak valid. PIN diperlukan." }, 400);
    }
    const isValid = await verifyPin(pin, c.env);
    if (isValid) {
      const token = await createSessionToken(c.env);
      return c.json({ success: true, message: "Otorisasi Berhasil", token });
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    return c.json({ success: false, error: "PIN Salah! Akses Ditolak." }, 401);
  } catch (err) {
    console.error("Auth verify error:", err);
    return c.json({ success: false, error: "Terjadi kesalahan saat memproses otorisasi." }, 500);
  }
});

export default auth;

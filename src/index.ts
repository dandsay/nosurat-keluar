/**
 * Entry Hono — Register Agenda Surat (clone belajar TS).
 * Menggantikan router manual if-pathname dengan Hono + middleware.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import { sessionGate } from "./middleware/auth";
import auth from "./routes/auth";
import agenda from "./routes/agenda";
import mundur from "./routes/mundur";
import { stats, chain } from "./routes/misc";

const app = new Hono<{ Bindings: Env }>({ strict: false });

// CORS untuk semua /api/*
app.use(
  "/api/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

// Gatekeeper Bearer (kecuali POST /api/auth/verify — dicek di dalam middleware)
app.use("/api/*", sessionGate);

// Healthcheck sederhana (tanpa auth? tetap lewat gate — taruh sebelum gate bila perlu publik)
// Dipasang di luar /api/* agar bisa dicek tanpa token.
app.get("/health", (c) => c.json({ ok: true, app: "agenda-surat-hono", ts: new Date().toISOString() }));

// Mount router — path sama persis dengan aslinya agar frontend lama langsung jalan.
app.route("/api/auth", auth);
app.route("/api/agenda", agenda);
app.route("/api/nomor-mundur", mundur);
app.route("/api/stats", stats);
app.route("/api/chain", chain);

// Static Assets fallthrough (frontend ./public)
app.all("*", async (c) => {
  const assets = (c.env as Env).ASSETS as unknown as Fetcher | undefined;
  if (assets) {
    return assets.fetch(c.req.raw);
  }
  return c.text("Not Found", 404);
});

export default app;

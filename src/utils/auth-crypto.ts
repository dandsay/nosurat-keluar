/**
 * Modul Kriptografi & Otorisasi Backend (TS).
 * Port 1:1 dari src/utils/auth-crypto.js — Web Crypto PBKDF2 + HMAC.
 */
import type { Env, SessionPayload } from "../types";

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(str: string): Uint8Array {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function computePbkdf2Hash(
  pin: string,
  saltBytes: Uint8Array,
  iterations = 100000,
): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(pin),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes.buffer as ArrayBuffer, iterations, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  return Array.from(new Uint8Array(derivedBits))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyPin(inputPin: string, env: Env): Promise<boolean> {
  if (!inputPin || typeof inputPin !== "string") return false;

  const storedHash = env.APP_PIN_HASH;
  if (storedHash && storedHash.startsWith("pbkdf2$")) {
    const parts = storedHash.split("$");
    if (parts.length === 4) {
      const iterations = parseInt(parts[1], 10);
      const saltHex = parts[2];
      const expectedHashHex = parts[3];
      if (iterations > 0 && saltHex.length % 2 === 0) {
        const saltBytes = new Uint8Array(
          saltHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)),
        );
        const computedHex = await computePbkdf2Hash(inputPin, saltBytes, iterations);
        return timingSafeEqual(computedHex, expectedHashHex);
      }
    }
  }

  if (env.APP_PIN && typeof env.APP_PIN === "string") {
    return timingSafeEqual(inputPin, env.APP_PIN);
  }
  return false;
}

function getSigningSecret(env: Env): string {
  const secret = env.SESSION_SECRET || env.APP_PIN_HASH || env.APP_PIN;
  if (!secret) {
    throw new Error(
      "Konfigurasi keamanan server tidak lengkap: Kredensial rahasia (SESSION_SECRET / APP_PIN_HASH / APP_PIN) belum disetel di Cloudflare Secret.",
    );
  }
  return secret;
}

export async function createSessionToken(
  env: Env,
  durationSeconds = 12 * 3600,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = { sub: "operator", iat: now, exp: now + durationSeconds };
  const enc = new TextEncoder();
  const payloadPart = base64UrlEncode(enc.encode(JSON.stringify(payload)));
  const secret = getSigningSecret(env);
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payloadPart));
  return `${payloadPart}.${base64UrlEncode(new Uint8Array(sig))}`;
}

export async function verifySessionToken(
  token: string,
  env: Env,
): Promise<SessionPayload | null> {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadPart, sigPart] = parts;
  try {
    const secret = getSigningSecret(env);
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const sigBytes = base64UrlDecode(sigPart);
    const valid = await crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(payloadPart));
    if (!valid) return null;
    const payload = JSON.parse(dec.decode(base64UrlDecode(payloadPart))) as SessionPayload;
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

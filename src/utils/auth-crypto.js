/**
 * Modul Kriptografi & Otorisasi Backend (Zero-Knowledge & Enterprise Grade)
 * Menggunakan Web Crypto API bawaan (PBKDF2-SHA256 & HMAC-SHA256)
 * Zero external npm dependencies.
 */

// Helper Base64URL Encoding & Decoding (Standar JWT/RFC 7515)
export function base64UrlEncode(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(str) {
    let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

// Constant-Time String Comparison untuk memitigasi serangan timing side-channel
export function timingSafeEqual(a, b) {
    if (typeof a !== "string" || typeof b !== "string") return false;
    if (a.length !== b.length) return false;
    let mismatch = 0;
    for (let i = 0; i < a.length; i++) {
        mismatch |= (a.charCodeAt(i) ^ b.charCodeAt(i));
    }
    return mismatch === 0;
}

// Hashing PIN menggunakan PBKDF2-SHA256 (100.000 iterasi)
export async function computePbkdf2Hash(pin, saltBytes, iterations = 100000) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        enc.encode(pin),
        { name: "PBKDF2" },
        false,
        ["deriveBits"]
    );

    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            salt: saltBytes,
            iterations: iterations,
            hash: "SHA-256"
        },
        keyMaterial,
        256 // 32 bytes
    );

    return Array.from(new Uint8Array(derivedBits))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
}

// Verifikasi PIN terhadap hash tersimpan atau fallback plaintext
export async function verifyPin(inputPin, env) {
    if (!inputPin || typeof inputPin !== "string") return false;

    // 1. Prioritas Utama: Periksa format PBKDF2 Hash di env.APP_PIN_HASH
    const storedHash = env.APP_PIN_HASH;
    if (storedHash && storedHash.startsWith("pbkdf2$")) {
        const parts = storedHash.split("$");
        if (parts.length === 4) {
            const iterations = parseInt(parts[1], 10);
            const saltHex = parts[2];
            const expectedHashHex = parts[3];

            if (iterations > 0 && saltHex.length % 2 === 0) {
                const saltBytes = new Uint8Array(saltHex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
                const computedHex = await computePbkdf2Hash(inputPin, saltBytes, iterations);
                return timingSafeEqual(computedHex, expectedHashHex);
            }
        }
    }

    // 2. Fallback Kompatibilitas: env.APP_PIN (jika belum migrasi ke APP_PIN_HASH)
    if (env.APP_PIN && typeof env.APP_PIN === "string") {
        return timingSafeEqual(inputPin, env.APP_PIN);
    }

    return false;
}

// Ambil secret signing key untuk HMAC Session Token
function getSigningSecret(env) {
    const secret = env.SESSION_SECRET || env.APP_PIN_HASH || env.APP_PIN;
    if (!secret) {
        throw new Error("Konfigurasi keamanan server tidak lengkap: Kredensial rahasia (SESSION_SECRET / APP_PIN_HASH / APP_PIN) belum disetel di Cloudflare Secret.");
    }
    return secret;
}

// Terbitkan Signed Session Token (HMAC-SHA256)
export async function createSessionToken(env, durationSeconds = 12 * 3600) {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        sub: "operator",
        iat: now,
        exp: now + durationSeconds
    };

    const enc = new TextEncoder();
    const payloadStr = JSON.stringify(payload);
    const payloadPart = base64UrlEncode(enc.encode(payloadStr));

    const secret = getSigningSecret(env);
    const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );

    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payloadPart));
    const sigPart = base64UrlEncode(new Uint8Array(sig));

    return `${payloadPart}.${sigPart}`;
}

// Verifikasi integritas & masa berlaku Signed Session Token
export async function verifySessionToken(token, env) {
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
            ["verify"]
        );

        const sigBytes = base64UrlDecode(sigPart);
        const valid = await crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(payloadPart));
        if (!valid) return null;

        const payloadJson = dec.decode(base64UrlDecode(payloadPart));
        const payload = JSON.parse(payloadJson);

        const now = Math.floor(Date.now() / 1000);
        if (payload.exp && payload.exp < now) {
            return null; // Token kedaluwarsa
        }

        return payload;
    } catch {
        return null;
    }
}

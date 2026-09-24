/**
 * Client-side Cryptography Module (Zero-Knowledge)
 * Menggunakan Web Crypto API (AES-GCM 256-bit + PBKDF2)
 * Kunci dan Salt identik dengan ekosistem rekap_ktp_kia
 */

const AppCrypto = {
    salt: new TextEncoder().encode("kelurahan-aac-salt-2026"),

    async deriveKey(pin) {
        const enc = new TextEncoder();
        const keyMaterial = await window.crypto.subtle.importKey(
            "raw",
            enc.encode(pin),
            { name: "PBKDF2" },
            false,
            ["deriveKey"]
        );

        return window.crypto.subtle.deriveKey(
            {
                name: "PBKDF2",
                salt: this.salt,
                iterations: 50000,
                hash: "SHA-256"
            },
            keyMaterial,
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"]
        );
    },

    async encrypt(text, key) {
        if (!text) return "";
        const enc = new TextEncoder();
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv },
            key,
            enc.encode(text)
        );

        // Gabungkan IV (12 bytes) dan Ciphertext menjadi Base64
        const combined = new Uint8Array(iv.length + encrypted.byteLength);
        combined.set(iv, 0);
        combined.set(new Uint8Array(encrypted), iv.length);

        let binary = '';
        for (let i = 0; i < combined.byteLength; i++) {
            binary += String.fromCharCode(combined[i]);
        }
        return btoa(binary);
    },

    async decrypt(cipherBase64, key) {
        if (!cipherBase64) return "";
        try {
            const binary = atob(cipherBase64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }

            const iv = bytes.slice(0, 12);
            const data = bytes.slice(12);

            const decrypted = await window.crypto.subtle.decrypt(
                { name: "AES-GCM", iv: iv },
                key,
                data
            );

            return new TextDecoder().decode(decrypted);
        } catch (e) {
            console.error("Gagal dekripsi:", e);
            return "[Terenkripsi - Kunci Salah]";
        }
    }
};

window.AppCrypto = AppCrypto;

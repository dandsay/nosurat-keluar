#!/usr/bin/env node
/**
 * Utility CLI: Generate PBKDF2-SHA256 Hash untuk Cloudflare Secret APP_PIN_HASH
 * 
 * Penggunaan:
 *   node scripts/generate-pin-hash.js [pin]
 * Contoh:
 *   node scripts/generate-pin-hash.js 123456
 */

import crypto from "node:crypto";

const pin = process.argv[2] || "123456";
const iterations = 100000;
const salt = crypto.randomBytes(16);
const hash = crypto.pbkdf2Sync(pin, salt, iterations, 32, "sha256");

const saltHex = salt.toString("hex");
const hashHex = hash.toString("hex");
const formattedHash = `pbkdf2$${iterations}$${saltHex}$${hashHex}`;

console.log("==================================================================");
console.log("  GENERATOR HASH PIN RESMI (PBKDF2-SHA256) - KELURAHAN ALUN-ALUN CONTONG");
console.log("==================================================================");
console.log(`PIN Target      : ${pin}`);
console.log(`Iterasi         : ${iterations}`);
console.log(`Salt (16 bytes) : ${saltHex}`);
console.log(`Hasil Hash      : ${formattedHash}`);
console.log("==================================================================");
console.log("\nLangkah Mengaktifkan di Cloudflare Secret KMS:");
console.log("Jalankan perintah berikut di terminal Anda:");
console.log(`\n  echo "${formattedHash}" | npx wrangler secret put APP_PIN_HASH\n`);
console.log("Setelah secret tersimpan di Cloudflare, worker akan otomatis");
console.log("memverifikasi login menggunakan PBKDF2 hash ini!");
console.log("==================================================================");

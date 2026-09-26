/**
 * Portal Cipher — animasi teks enkripsi ala mesin Enigma pada portal login.
 * Diport dari brankas-esp32 (public/js/cipher.js + initPortalCipher di ui.js),
 * disesuaikan ke gaya skrip klasik tanpa ES module (via window.*).
 *
 * Murni deterministik (tanpa Math.random): renderCipherTick(base, tick)
 * me-render satu frame teks untuk tick N. Siklus per baris:
 *   TYPE (acak tumbuh) -> SPIN0 (acak penuh) -> DECRYPT (terbuka kiri->kanan)
 *   -> HOLD (teks asli) -> ENCRYPT (menutup kiri->kanan) -> SPIN (acak penuh).
 */

(function () {
    var PHASE = {
        TYPE: 24,    // intro: ketik acak tumbuh
        SPIN0: 14,   // intro: putar penuh
        DECRYPT: 24, // loop: dekripsi mengetik (benar terbuka kiri->kanan)
        HOLD: 22,    // loop: teks asli utuh
        ENCRYPT: 24, // loop: enkripsi mengetik (acak menutup kiri->kanan)
        SPIN: 19     // loop: putar penuh
    };
    PHASE.INTRO = PHASE.TYPE + PHASE.SPIN0; // 38
    PHASE.LOOP = PHASE.DECRYPT + PHASE.HOLD + PHASE.ENCRYPT + PHASE.SPIN; // 89

    function caesarShiftChar(ch, k) {
        var base = (ch >= "a" && ch <= "z") ? 97 : (ch >= "A" && ch <= "Z") ? 65 : 0;
        if (!base) return ch;
        return String.fromCharCode(base + ((ch.charCodeAt(0) - base + k) % 26));
    }

    function encChar(ch, i, tick, speed) {
        var k;
        if (/[A-Za-z]/.test(ch)) {
            k = 1 + ((tick * speed + i * 11) % 25);
            return String.fromCharCode(65 + ((ch.toUpperCase().charCodeAt(0) - 65 + k) % 26));
        }
        if (/[0-9]/.test(ch)) {
            k = 1 + ((tick * speed + i * 11) % 25);
            return String.fromCharCode(48 + ((ch.charCodeAt(0) - 48 + k) % 10));
        }
        return String.fromCharCode(65 + ((tick * speed + i * 17) % 26)); // spasi/simbol -> huruf
    }

    function rotorTick(tick, i) {
        return String.fromCharCode(65 + (Math.floor(tick / [1, 3, 9][i]) % 26));
    }

    function fullScramble(chars, tick) {
        var out = "";
        for (var i = 0; i < chars.length; i++) out += encChar(chars[i], i, tick, 5);
        return out;
    }

    // Mesin tik dua arah: decrypt = kiri benar; encrypt = kiri acak.
    function typewriter(chars, frontier, decrypt, tick) {
        var out = "";
        for (var i = 0; i < chars.length; i++) {
            var done = i < frontier;
            if (decrypt ? done : !done) out += chars[i];
            else out += encChar(chars[i], i, tick, 7);
        }
        return out;
    }

    // Render satu frame teks untuk tick N (N<0 -> kosong). Murni, tanpa efek samping.
    function renderCipherTick(base, tick) {
        var chars = Array.from(base || "");
        var len = chars.length;
        if (tick < 0 || len === 0) return "";
        if (tick < PHASE.INTRO) {
            if (tick < PHASE.TYPE) {
                var count = Math.floor(((tick + 1) / PHASE.TYPE) * len);
                var out = "";
                for (var i = 0; i < count; i++) out += encChar(chars[i], i, tick, 7);
                return out;
            }
            return fullScramble(chars, tick);
        }
        var q = (tick - PHASE.INTRO) % PHASE.LOOP;
        if (q < PHASE.DECRYPT) {
            var settled = Math.floor(((q + 1) / PHASE.DECRYPT) * len);
            return typewriter(chars, settled, true, tick);
        }
        if (q < PHASE.DECRYPT + PHASE.HOLD) return base;
        if (q < PHASE.DECRYPT + PHASE.HOLD + PHASE.ENCRYPT) {
            var e = q - PHASE.DECRYPT - PHASE.HOLD;
            var frontier = Math.floor(((e + 1) / PHASE.ENCRYPT) * len);
            return typewriter(chars, frontier, false, tick);
        }
        return fullScramble(chars, tick);
    }

    // Kabel DOM + timer: hidupkan animasi untuk semua [data-scramble].
    function initPortalCipher() {
        if (typeof document === "undefined" || !document.querySelectorAll) return;
        var nodes = Array.prototype.slice.call(document.querySelectorAll("[data-scramble]"))
            .map(function (el) { return { el: el, base: el.textContent || "" }; })
            .filter(function (n) { return n.base.length > 0; });
        if (nodes.length === 0 || nodes[0].el._cipherTimer) return;
        if (typeof window !== "undefined" && window.matchMedia &&
            window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        // Intro langsung acak penuh (lewati fase tumbuh-dari-nol):
        // tinggal rotasi lalu dekripsi terbuka kiri->kanan.
        var tick = PHASE.INTRO - 1;
        nodes.forEach(function (n) { n.el.textContent = renderCipherTick(n.base, tick); });
        var timer = setInterval(function () {
            tick++;
            nodes.forEach(function (n) {
                n.el.textContent = renderCipherTick(n.base, tick);
            });
        }, 117);
        nodes.forEach(function (n) { n.el._cipherTimer = timer; });
    }

    var root = (typeof window !== "undefined") ? window : globalThis;
    root.PortalCipher = {
        PHASE: PHASE,
        caesarShiftChar: caesarShiftChar,
        encChar: encChar,
        rotorTick: rotorTick,
        renderCipherTick: renderCipherTick
    };
    root.initPortalCipher = initPortalCipher;

    if (typeof document !== "undefined" && document.addEventListener) {
        document.addEventListener("DOMContentLoaded", function () {
            root.initPortalCipher();
        });
    }
})();

/**
 * Portal Cipher — animasi teks enkripsi ala mesin Enigma pada portal login.
 * Engine SAMA dengan brankas-esp32 (public/js/cipher.js):
 * QWERTY-Caesar +2, rotor PIN/KEY, slowScramble.
 * Dibungkus klasik window.* (tanpa ES module) untuk agenda surat.
 *
 * Murni deterministik (tanpa Math.random): renderCipherTick(base, tick)
 * me-render satu frame teks untuk tick N. Siklus per baris:
 *   TYPE (acak tumbuh) -> SPIN0 (acak penuh) -> DECRYPT (terbuka kiri->kanan)
 *   -> HOLD (teks asli) -> ENCRYPT (menutup kiri->kanan) -> SPIN (acak penuh).
 */

(function () {
    var CIPHER = {
        TYPE: 24,    // intro: ketik acak tumbuh
        SPIN0: 14,   // intro: putar penuh
        DECRYPT: 24, // loop: dekripsi mengetik (benar terbuka kiri->kanan)
        HOLD: 22,    // loop: teks asli utuh
        ENCRYPT: 24, // loop: enkripsi mengetik (acak menutup kiri->kanan)
        SPIN: 19     // loop: putar penuh
    };
    CIPHER.INTRO = CIPHER.TYPE + CIPHER.SPIN0; // 38
    CIPHER.LOOP = CIPHER.DECRYPT + CIPHER.HOLD + CIPHER.ENCRYPT + CIPHER.SPIN; // 89
    // Alias beku: test lama memakai PortalCipher.PHASE.
    var PHASE = CIPHER;

    function caesarShiftChar(ch, k) {
        var base = (ch >= "a" && ch <= "z") ? 97 : (ch >= "A" && ch <= "Z") ? 65 : 0;
        if (!base) return ch;
        return String.fromCharCode(base + ((ch.charCodeAt(0) - base + k) % 26));
    }

    // --- QWERTY-CAESAR +2: satu rantai 26 huruf urut keyboard,
    // geser 2 tanpa kembali ke baris sendiri (p->s, l->x, m->w, n->q).
    var QWERTY_CHAIN = "qwertyuiopasdfghjklzxcvbnm";

    function qwertyStep(text, dir) {
        return String(text || "").split("").map(function (ch) {
            var idx = QWERTY_CHAIN.indexOf(ch.toLowerCase());
            if (idx < 0) return ch; // non-huruf: utuh (panjang 1:1 terjaga)
            var mapped = QWERTY_CHAIN[(idx + dir + 26) % 26];
            return (ch >= "A" && ch <= "Z") ? mapped.toUpperCase() : mapped;
        }).join("");
    }

    /** Caesar QWERTY+2 (maju). Murni. */
    function qwertyShift2(text) {
        return qwertyStep(text, 2);
    }

    function encChar(ch, i, tick, speed) {
        // Easter egg QWERTY-Caesar: huruf BERPUTAR di atas baris keyboard dengan
        // basis +2 (tick 0 = pola familiar qwerty->ertyui), lalu melangkah tiap
        // tick sampai fasenya tiba. Digit utuh, spasi/simbol -> huruf.
        if (/[A-Za-z]/.test(ch)) {
            var idx = QWERTY_CHAIN.indexOf(ch.toLowerCase());
            if (idx >= 0) {
                var step = 2 + tick * speed + i * 11;
                var pos = (idx + step) % 26;
                if (pos === idx) pos = (pos + 1) % 26; // tak pernah identik dgn asli (anti hold-palsu)
                return QWERTY_CHAIN[pos].toUpperCase(); // scramble selalu caps
            }
        }
        if (/[0-9]/.test(ch)) return ch;
        return String.fromCharCode(65 + ((tick * speed + i * 17) % 26)); // spasi/simbol -> huruf
    }

    function rotorTick(tick, i) {
        // Rotor kadang mengeja kata dengan mendarat LEMBUT: tiap rotor mengunci/
        // melepas pada waktunya sendiri mengikuti kecepatan putarnya (lambat
        // mengunci dulu, cepat terakhir — seperti pengereman; lepas sebaliknya).
        // "PIN" = petunjuk asli; "KEY" = pengecoh untuk orang yang tidak tahu.
        // Murni & deterministik. Periode 144 tick (~17 dtk @117ms).
        var SPEEDS = [1, 3, 9]; // cepat -> lambat
        var PERIOD = 144;
        var WORDS = [
            { word: "PIN", lockAt: [48, 44, 40], releaseAt: [56, 59, 62] },
            { word: "KEY", lockAt: [120, 116, 112], releaseAt: [128, 131, 134] }
        ];
        if (i >= 0 && i < 3) {
            var phase = ((tick % PERIOD) + PERIOD) % PERIOD;
            for (var w = 0; w < WORDS.length; w++) {
                var wd = WORDS[w];
                if (phase >= wd.lockAt[i] && phase < wd.releaseAt[i]) return wd.word[i];
            }
        }
        var step = SPEEDS[i] || 1;
        return String.fromCharCode(65 + ((((Math.floor(tick / step)) % 26) + 26) % 26));
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

    /** Scramble lambat untuk label tombol: selalu terenkripsi (caps),
     * tak pernah dekripsi. Murni. */
    function slowScramble(base, tick) {
        return String(base || "").split("").map(function (ch, i) {
            return encChar(ch, i, tick, 3);
        }).join("");
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

    // Kabel DOM + timer untuk [data-slow-scramble] (selalu terenkripsi, 1 detik).
    // Disediakan agar paritas dengan brankas; tidak aktif bila tanpa node.
    function initSlowCipher() {
        if (typeof document === "undefined" || !document.querySelectorAll) return;
        var nodes = Array.prototype.slice.call(document.querySelectorAll("[data-slow-scramble]"))
            .map(function (el) { return { el: el, base: el.textContent || "" }; })
            .filter(function (n) { return n.base.length > 0; });
        if (nodes.length === 0 || nodes[0].el._slowTimer) return;
        if (typeof window !== "undefined" && window.matchMedia &&
            window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        var tick = 0;
        nodes.forEach(function (n) { n.el.textContent = slowScramble(n.base, tick); });
        var timer = setInterval(function () {
            tick++;
            nodes.forEach(function (n) {
                n.el.textContent = slowScramble(n.base, tick);
            });
        }, 1000);
        nodes.forEach(function (n) { n.el._slowTimer = timer; });
    }

    var root = (typeof window !== "undefined") ? window : globalThis;
    root.PortalCipher = {
        PHASE: PHASE,
        CIPHER: CIPHER,
        caesarShiftChar: caesarShiftChar,
        encChar: encChar,
        qwertyShift2: qwertyShift2,
        rotorTick: rotorTick,
        slowScramble: slowScramble,
        renderCipherTick: renderCipherTick
    };
    root.initPortalCipher = initPortalCipher;
    root.initSlowCipher = initSlowCipher;

    if (typeof document !== "undefined" && document.addEventListener) {
        document.addEventListener("DOMContentLoaded", function () {
            root.initPortalCipher();
            root.initSlowCipher();
        });
    }
})();

/**
 * Modul Otentikasi & State Global Aplikasi Register Agenda Surat
 */

var appKey = null;
var currentPin = null;
var sessionToken = sessionStorage.getItem("agenda_session_token") || null;
var allAgenda = [];
var filteredAgenda = [];
var activeBentuk = "ALL"; // "ALL" | "eSurat (Elektronik)" | "Surat Manual (Fisik)"
var activePengelola = "ALL";
var activeYear = new Date().getFullYear().toString();
var currentPage = 1;
var pageSize = 20;

// Helper untuk menyusun header otorisasi (Session Token Bearer)
function getAuthHeaders(extra = {}) {
    const headers = { ...extra };
    if (sessionToken) {
        headers["Authorization"] = `Bearer ${sessionToken}`;
    }
    return headers;
}
window.getAuthHeaders = getAuthHeaders;

// ==============================================================================
// SISTEM NOTIFIKASI KUSTOM APLIKASI (PENGGANTI POPUP BROWSER WINDOW NATIVE)
// ==============================================================================

function showAppAlert(pesan, tipe = "warning", judul = null) {
    const modal = document.getElementById("customAlertModal");
    if (!modal) {
        console.warn("Alert:", pesan);
        return;
    }

    const titleEl = document.getElementById("customAlertTitle");
    const msgEl = document.getElementById("customAlertMessage");
    const iconContainer = document.getElementById("customAlertIconContainer");
    const iconEl = document.getElementById("customAlertIcon");
    const btnEl = document.getElementById("customAlertBtn");

    let defaultTitle = "Pemberitahuan Administrasi";
    let iconName = "alert-triangle";
    let bgIcon = "bg-amber-50 text-amber-600 ring-amber-50/60";
    let btnClass = "w-full py-2.5 px-5 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-98 text-white font-bold text-xs sm:text-sm shadow-md shadow-blue-600/20 transition";

    const pesanStr = String(pesan || "");

    if (pesanStr.includes("Tertib Administrasi")) {
        defaultTitle = "Tertib Administrasi Kedinasan";
        tipe = "warning";
    } else if (pesanStr.includes("Jaring Pengaman")) {
        defaultTitle = "Jaring Pengaman Administrasi";
        tipe = "warning";
    } else if (tipe === "error") {
        defaultTitle = "Peringatan Sistem";
    } else if (tipe === "success") {
        defaultTitle = "Berhasil";
    }

    const pesanBersih = pesanStr.replace(/^(Tertib Administrasi:\s*|Jaring Pengaman Administrasi:\s*|Jaring Pengaman:\s*|Peringatan:\s*)/i, "").trim();

    if (tipe === "error") {
        iconName = "alert-circle";
        bgIcon = "bg-rose-50 text-rose-600 ring-rose-50/60";
        btnClass = "w-full py-2.5 px-5 rounded-xl bg-rose-600 hover:bg-rose-700 active:scale-98 text-white font-bold text-xs sm:text-sm shadow-md shadow-rose-600/20 transition";
    } else if (tipe === "success") {
        iconName = "check-circle-2";
        bgIcon = "bg-emerald-50 text-emerald-600 ring-emerald-50/60";
        btnClass = "w-full py-2.5 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white font-bold text-xs sm:text-sm shadow-md shadow-emerald-600/20 transition";
    } else {
        iconName = "alert-triangle";
        bgIcon = "bg-amber-50 text-amber-600 ring-amber-50/60";
        btnClass = "w-full py-2.5 px-5 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-98 text-white font-bold text-xs sm:text-sm shadow-md shadow-blue-600/20 transition";
    }

    if (titleEl) titleEl.innerText = judul || defaultTitle;
    if (msgEl) msgEl.innerText = pesanBersih;
    if (iconContainer) iconContainer.className = `w-14 h-14 rounded-2xl flex items-center justify-center mx-auto ring-8 ${bgIcon}`;
    if (iconEl) iconEl.setAttribute("data-lucide", iconName);
    if (btnEl) btnEl.className = btnClass;

    if (window.lucide) lucide.createIcons();
    modal.classList.remove("hidden");
}

function closeCustomAlert() {
    const modal = document.getElementById("customAlertModal");
    if (modal) modal.classList.add("hidden");
}

function showToast(pesan, type = "success") {
    let toast = document.getElementById("appToast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "appToast";
        toast.className = "fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl shadow-xl text-white font-bold text-xs sm:text-sm transition-all duration-300 transform translate-y-10 opacity-0 pointer-events-none";
        document.body.appendChild(toast);
    }

    if (type === "success") {
        toast.className = "fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl shadow-xl text-white font-bold text-xs sm:text-sm bg-emerald-600 transition-all duration-300 transform translate-y-0 opacity-100";
    } else {
        toast.className = "fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl shadow-xl text-white font-bold text-xs sm:text-sm bg-rose-600 transition-all duration-300 transform translate-y-0 opacity-100";
    }

    toast.innerText = pesan;

    setTimeout(() => {
        toast.className = "fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl shadow-xl text-white font-bold text-xs sm:text-sm transition-all duration-300 transform translate-y-10 opacity-0 pointer-events-none";
    }, 3000);
}

// Override native window.alert agar seluruh popup browser otomatis menggunakan UI custom
window.alert = function(pesan) {
    showAppAlert(pesan);
};
window.showAppAlert = showAppAlert;
window.closeCustomAlert = closeCustomAlert;
window.showToast = showToast;

document.addEventListener("DOMContentLoaded", async () => {
    if (window.lucide) lucide.createIcons();

    // Pulihkan sesi PIN jika tersimpan di sessionStorage
    const savedPin = sessionStorage.getItem("agenda_app_pin");
    if (savedPin) {
        document.getElementById("inputPin").value = savedPin;
        await doLogin(savedPin);
    }
});

// Handler Form Login
async function handleLogin(e) {
    if (e) e.preventDefault();
    const pin = document.getElementById("inputPin").value.trim();
    const errEl = document.getElementById("loginError");
    errEl.classList.add("hidden");

    if (!pin) {
        errEl.innerText = "Masukkan PIN otorisasi!";
        errEl.classList.remove("hidden");
        return;
    }

    const success = await doLogin(pin);
    if (!success) {
        errEl.innerText = "PIN Salah! Akses Ditolak.";
        errEl.classList.remove("hidden");
    }
}

// Proses Eksekusi Login & Penurunan Kunci AES-GCM (Zero-Knowledge)
async function doLogin(pin) {
    const btn = document.getElementById("btnLogin");
    if (btn) btn.disabled = true;

    try {
        const res = await fetch("/api/auth/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pin })
        });

        const data = await res.json();
        if (data.success) {
            currentPin = pin;
            sessionStorage.setItem("agenda_app_pin", pin);
            if (data.token) {
                sessionToken = data.token;
                sessionStorage.setItem("agenda_session_token", data.token);
            }

            // Turunkan kunci AES-GCM 256-bit identik dari PIN
            appKey = await AppCrypto.deriveKey(pin);

            document.getElementById("loginModal").classList.add("hidden");
            document.getElementById("mainApp").classList.remove("hidden");
            if (window.lucide) lucide.createIcons();

            // Set default tanggal form reguler dan nomor mundur
            initFormDates();
            if (typeof initSmartNomorMundur === 'function') initSmartNomorMundur();

            // Muat data awal
            await Promise.all([
                loadAgendaData(),
                loadStats()
            ]);
            return true;
        } else {
            return false;
        }
    } catch (err) {
        console.error("Login error:", err);
        return false;
    } finally {
        if (btn) btn.disabled = false;
    }
}

// Logout
function handleLogout() {
    sessionStorage.removeItem("agenda_app_pin");
    sessionStorage.removeItem("agenda_session_token");
    sessionToken = null;
    currentPin = null;
    appKey = null;
    allAgenda = [];
    filteredAgenda = [];
    document.getElementById("inputPin").value = "";
    document.getElementById("mainApp").classList.add("hidden");
    document.getElementById("loginModal").classList.remove("hidden");
}

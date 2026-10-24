'use strict';
// ══════════════════════════════════════════════════════════════
// W-INIT — Inicialização escalonada para /workers (Sentinel only).
//
//   t=0ms   → workerRefresh()        (status Sentinel)
//   t=500ms → _workerLoadHistory()   (scores histórico)
//
// Auto-refresh:
//   Sentinel : a cada 60s
//   Histórico: a cada 120s
// ══════════════════════════════════════════════════════════════

(function () {
    if (typeof window._workerStatusChart === 'function') {
        window._workerStatusChart({});
    }

    if (typeof window.workerRefresh === 'function')      window.workerRefresh();
    setTimeout(function () { if (typeof window._workerLoadHistory === 'function') window._workerLoadHistory(); }, 500);

    setInterval(function () { if (typeof window.workerRefresh === 'function')      window.workerRefresh(); },       60000);
    setInterval(function () { if (typeof window._workerLoadHistory === 'function') window._workerLoadHistory(); }, 120000);
}());

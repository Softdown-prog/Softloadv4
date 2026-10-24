'use strict';
// ══════════════════════════════════════════════════════════════
// W-LOG-INIT — Init exclusivo para /workerlog.
// Carrega o error log imediatamente e mantém countdown de 60s.
// ══════════════════════════════════════════════════════════════

(function () {
    var INTERVAL_S = 60;
    var _remaining = INTERVAL_S;

    function updateCountdown() {
        var el = document.getElementById('refreshCountdown');
        if (el) el.textContent = _remaining + 's';
    }

    function tick() {
        _remaining--;
        if (_remaining <= 0) {
            _remaining = INTERVAL_S;
            if (typeof loadErrorLog === 'function') loadErrorLog();
        }
        updateCountdown();
    }

    document.addEventListener('DOMContentLoaded', function () {
        if (typeof loadErrorLog === 'function') loadErrorLog();
        updateCountdown();
        setInterval(tick, 1000);
    });
}());

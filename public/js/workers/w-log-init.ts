'use strict';
// Browser worker: fonte TS; JS clássico gerado sem módulos.
declare function loadErrorLog(): void;

(function (): void {
    var INTERVAL_S = 60;
    var _remaining = INTERVAL_S;

    function updateCountdown(): void {
        var el = document.getElementById('refreshCountdown');
        if (el) el.textContent = _remaining + 's';
    }

    function tick(): void {
        _remaining--;
        if (_remaining <= 0) {
            _remaining = INTERVAL_S;
            if (typeof loadErrorLog === 'function') loadErrorLog();
        }
        updateCountdown();
    }

    document.addEventListener('DOMContentLoaded', function (): void {
        if (typeof loadErrorLog === 'function') loadErrorLog();
        updateCountdown();
        setInterval(tick, 1000);
    });
}());

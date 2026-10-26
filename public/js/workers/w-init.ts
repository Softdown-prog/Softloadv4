'use strict';
// Browser worker: fonte TS; JS clássico gerado sem módulos.
interface Window {
    _workerStatusChart?: (payload: Record<string, unknown>) => void;
    workerRefresh?: () => void;
    _workerLoadHistory?: () => void;
}

(function (): void {
    if (typeof window._workerStatusChart === 'function') {
        window._workerStatusChart({});
    }

    if (typeof window.workerRefresh === 'function') window.workerRefresh();
    setTimeout(function (): void { if (typeof window._workerLoadHistory === 'function') window._workerLoadHistory(); }, 500);

    setInterval(function (): void { if (typeof window.workerRefresh === 'function') window.workerRefresh(); }, 60000);
    setInterval(function (): void { if (typeof window._workerLoadHistory === 'function') window._workerLoadHistory(); }, 120000);
}());

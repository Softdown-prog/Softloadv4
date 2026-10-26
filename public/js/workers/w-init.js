'use strict';
(function () {
    if (typeof window._workerStatusChart === 'function') {
        window._workerStatusChart({});
    }
    if (typeof window.workerRefresh === 'function')
        window.workerRefresh();
    setTimeout(function () { if (typeof window._workerLoadHistory === 'function')
        window._workerLoadHistory(); }, 500);
    setInterval(function () { if (typeof window.workerRefresh === 'function')
        window.workerRefresh(); }, 60000);
    setInterval(function () { if (typeof window._workerLoadHistory === 'function')
        window._workerLoadHistory(); }, 120000);
}());

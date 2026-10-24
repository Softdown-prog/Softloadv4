'use strict';
// Utilitários compartilhados entre os módulos Workers.
// Carregado antes de todos os outros w-*.js.
// Expostos em window._w para evitar colisão com globals de terceiros.

window._w = (function () {
    function el(id)          { return document.getElementById(id); }
    function setText(id, v)  { var e = el(id); if (e) e.textContent = v; }
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    return { el: el, setText: setText, esc: esc };
}());

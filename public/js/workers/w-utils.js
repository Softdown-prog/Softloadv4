'use strict';
window._w = (function () {
    function el(id) { return document.getElementById(id); }
    function setText(id, v) { var e = el(id); if (e)
        e.textContent = v; }
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    return { el: el, setText: setText, esc: esc };
}());

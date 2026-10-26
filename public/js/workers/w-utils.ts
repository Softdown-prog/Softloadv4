'use strict';
// Utilitários compartilhados entre os módulos Workers.
// Carregado antes de todos os outros w-*.js.
// Expostos em window._w para evitar colisão com globals de terceiros.
interface WorkerBrowserUtils {
    el(id: string): HTMLElement | null;
    setText(id: string, value: unknown): void;
    esc(value: unknown): string;
}
interface Window { _w: WorkerBrowserUtils }

window._w = (function (): WorkerBrowserUtils {
    function el(id: string): HTMLElement | null { return document.getElementById(id); }
    function setText(id: string, v: unknown): void { var e = el(id); if (e) e.textContent = v as string | null; }
    function esc(s: unknown): string {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    return { el: el, setText: setText, esc: esc };
}());

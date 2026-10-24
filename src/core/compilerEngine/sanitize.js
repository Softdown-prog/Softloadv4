"use strict";
/** Sanitização usada pelo compilador XML Blogger. Sem coerção implícita de entradas. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizarInput = sanitizarInput;
exports.validarHex = validarHex;
exports.sanitizarCssColor = sanitizarCssColor;
exports.hexParaRgb = hexParaRgb;
/** Escapa HTML em atributos e texto XML; não utilizar para valores CSS. */
function sanitizarInput(texto) {
    if (!texto || typeof texto !== 'string')
        return '';
    return texto
        .trim()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}
/** Reconhece somente #RGB ou #RRGGBB, preservando o contrato legado. */
function validarHex(hex) {
    return typeof hex === 'string' && /^#([0-9A-Fa-f]{3}){1,2}$/.test(hex.trim());
}
function sanitizarCssColor(val, fallback = '#000000') {
    return validarHex(val) ? val.trim() : fallback;
}
/** Converte cores hex válidas para o triplet decimal usado nas CSS vars. */
function hexParaRgb(hex, fallback = '0,0,0') {
    if (!validarHex(hex))
        return fallback;
    let h = hex.trim().replace('#', '');
    if (h.length === 3)
        h = h.split('').map(c => c + c).join('');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `${r},${g},${b}`;
}

/** Sanitização usada pelo compilador XML Blogger. Sem coerção implícita de entradas. */

/** Escapa HTML em atributos e texto XML; não utilizar para valores CSS. */
export function sanitizarInput(texto: unknown): string {
    if (!texto || typeof texto !== 'string') return '';
    return texto
        .trim()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

/** Reconhece somente #RGB ou #RRGGBB, preservando o contrato legado. */
export function validarHex(hex: unknown): hex is string {
    return typeof hex === 'string' && /^#([0-9A-Fa-f]{3}){1,2}$/.test(hex.trim());
}

export function sanitizarCssColor(val: unknown, fallback = '#000000'): string {
    return validarHex(val) ? val.trim() : fallback;
}

/** Converte cores hex válidas para o triplet decimal usado nas CSS vars. */
export function hexParaRgb(hex: unknown, fallback = '0,0,0'): string {
    if (!validarHex(hex)) return fallback;
    let h = hex.trim().replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `${r},${g},${b}`;
}

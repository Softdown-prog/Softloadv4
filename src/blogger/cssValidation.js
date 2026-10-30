"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validarTokensCss = validarTokensCss;
// ============================================================
// CSS WORKER — validação determinística de CSS de uma peça.
//
// Formaliza a checagem manual de "variável CSS órfã" já feita
// nesta sessão pra fechar bugs em nichos legados: var(--x) usado
// mas --x nunca declarado (nem localmente na própria peça, nem nos
// tokensCss globais do dossiê) vira efeito visual silenciosamente
// quebrado — o navegador não reclama, só ignora a regra.
//
// Usado pela validação estática dos nichos Blogger.
// ============================================================
function _extrairVarsDeclaradas(css) {
    const declaradas = new Set();
    const re = /(--[\w-]+)\s*:/g;
    let m;
    while ((m = re.exec(css)))
        declaradas.add(m[1]);
    return declaradas;
}
function _extrairVarsUsadas(css) {
    const usadas = new Set();
    // var(--x, fallback) é seguro por spec CSS mesmo se --x nunca for
    // declarada — o navegador cai no fallback. Só exige declaração
    // quando NÃO há vírgula de fallback logo após o nome da variável
    // (achado real: --radius em pop-retro-pixel, var(--radius, 12px)).
    const re = /var\(\s*(--[\w-]+)\s*(,)?/g;
    let m;
    while ((m = re.exec(css))) {
        if (!m[2])
            usadas.add(m[1]);
    }
    return usadas;
}
// ──────────────────────────────────────────────────────────────
// validarTokensCss — confere que todo var(--x) usado no CSS tem
// --x declarado localmente ou está na lista de tokens externos
// (ex: tokensCss.light_mode do dossiê do nicho). Nunca lança —
// retorna { ok, erros }.
// ──────────────────────────────────────────────────────────────
function validarTokensCss(css, opts = {}) {
    const erros = [];
    if (typeof css !== 'string' || !css.trim())
        return { ok: true, erros };
    const tokensExternos = new Set(opts.tokensExternos || []);
    const declaradas = _extrairVarsDeclaradas(css);
    const usadas = _extrairVarsUsadas(css);
    for (const v of usadas) {
        // --bs-* é o namespace nativo do Bootstrap 5.3 (--bs-primary,
        // --bs-emphasis-color, --bs-body-bg...) — declarado no PRÓPRIO
        // bootstrap.min.css, carregado via CDN em todo chassis deste
        // projeto. Nunca é "órfã": não precisa (e não deveria) ser
        // redeclarada nos tokens do dossiê nem localmente na peça
        // (achado real: exemplos/culinaria-boutique-gourmet.xml usa
        // color: var(--bs-emphasis-color) sem fallback e sem declarar).
        if (v.startsWith('--bs-'))
            continue;
        if (!declaradas.has(v) && !tokensExternos.has(v)) {
            erros.push(`variável CSS órfã: var(${v}) usada mas nunca declarada (nem localmente, nem nos tokens do dossiê).`);
        }
    }
    return { ok: erros.length === 0, erros };
}

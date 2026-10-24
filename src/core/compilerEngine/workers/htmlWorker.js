"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validarDomIds = validarDomIds;
// ============================================================
// HTML WORKER — validação determinística de domIds de uma peça
// isolada.
//
// Reaproveita a mesma regra de dossieIntegrityChecker.js
// (_idApareceNoXml), mas aplicada ao html de UMA peça antes dela
// entrar no dossiê — dossieIntegrityChecker.js continua validando
// o XML final já montado com todas as peças juntas.
// ============================================================
function _idApareceNoHtml(html, id) {
    return html.includes(`id='${id}'`) || html.includes(`id="${id}"`);
}
// ──────────────────────────────────────────────────────────────
// validarDomIds — confere que todo id em domIds aparece no html da
// peça. Peça sem domIds declarado passa trivialmente (peças
// "modulo" que só estilizam elemento já existente não precisam
// disso — ver dossieValidator.js). Nunca lança — retorna
// { ok, erros }.
// ──────────────────────────────────────────────────────────────
function validarDomIds(html, domIds) {
    const erros = [];
    const ids = Array.isArray(domIds) ? domIds : [];
    if (ids.length === 0)
        return { ok: true, erros };
    if (typeof html !== 'string' || !html.trim()) {
        for (const id of ids) {
            erros.push(`domId #${id} declarado mas a peça não tem html algum.`);
        }
        return { ok: false, erros };
    }
    for (const id of ids) {
        if (!_idApareceNoHtml(html, id)) {
            erros.push(`domId #${id} declarado mas não aparece no html da peça.`);
        }
    }
    return { ok: erros.length === 0, erros };
}

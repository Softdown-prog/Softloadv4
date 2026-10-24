/** Conferência de IDs reais no HTML gerado pela peça. */
export interface HtmlValidationResult { ok: boolean; erros: string[] }

// ============================================================
// HTML WORKER — validação determinística de domIds de uma peça
// isolada.
//
// Reaproveita a mesma regra de dossieIntegrityChecker.js
// (_idApareceNoXml), mas aplicada ao html de UMA peça antes dela
// entrar no dossiê — dossieIntegrityChecker.js continua validando
// o XML final já montado com todas as peças juntas.
// ============================================================

function _idApareceNoHtml(html: string, id: string): boolean {
    return html.includes(`id='${id}'`) || html.includes(`id="${id}"`);
}

// ──────────────────────────────────────────────────────────────
// validarDomIds — confere que todo id em domIds aparece no html da
// peça. Peça sem domIds declarado passa trivialmente (peças
// "modulo" que só estilizam elemento já existente não precisam
// disso — ver dossieValidator.js). Nunca lança — retorna
// { ok, erros }.
// ──────────────────────────────────────────────────────────────
function validarDomIds(html: string | null | undefined, domIds: string[] | null | undefined): HtmlValidationResult {
    const erros: string[] = [];
    const ids = Array.isArray(domIds) ? domIds : [];
    if (ids.length === 0) return { ok: true, erros };

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

export { validarDomIds };

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validarJs = validarJs;
// ============================================================
// SOLARIS JS WORKER (Fase 0)
// ============================================================
// Não duplica análise de JS — reusa src/core/parser/jsParser.js
// (analisarJs, Acorn por baixo, já determinístico e testado). Este
// Worker só normaliza a saída específica de JS
// (identificadoresNaoDeclarados/consoleLogs) pro formato
// { ok, erros, avisos } do pipeline.
// ============================================================
const { analisarJs } = require('../../core/parser/jsParser');
function validarJs(js) {
    const r = analisarJs(js);
    if (!r.ok) {
        const msg = r.erro && typeof r.erro === 'object'
            ? `${r.erro.mensagem}${r.erro.linha ? ` (linha ${r.erro.linha}, col ${r.erro.coluna})` : ''}`
            : String(r.erro);
        return { ok: false, erros: [msg], avisos: [] };
    }
    const avisos = [];
    for (const id of r.identificadoresNaoDeclarados || []) {
        avisos.push(`identificador "${id.nome}" usado mas não declarado neste arquivo${id.linha ? ` (linha ${id.linha})` : ''} — pode ser global legítimo (ex: window/document) ou variável faltando.`);
    }
    for (const log of r.consoleLogs || []) {
        avisos.push(`console.${log.metodo}(...) presente${log.linha ? ` (linha ${log.linha})` : ''} — remover antes de entregar em produção.`);
    }
    return { ok: true, erros: [], avisos, analise: r };
}

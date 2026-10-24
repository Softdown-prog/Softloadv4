"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validarHtml = validarHtml;
// ============================================================
// SOLARIS HTML WORKER (Fase 0)
// ============================================================
// Não duplica análise de HTML — reusa src/core/parser/htmlParser.js
// (analisarHtml, já determinístico e testado). Este Worker só
// normaliza a saída específica de HTML (avisosDeParse/idsDuplicados)
// pro formato { ok, erros, avisos } que o Orquestrador/pipeline
// espera de qualquer Worker (ver Etapa "Detector → Workers →
// Diagnóstico" do roadmap Solaris).
// ============================================================
const { analisarHtml } = require('../../core/parser/htmlParser');
function validarHtml(html) {
    const r = analisarHtml(html);
    if (!r.ok) {
        return { ok: false, erros: [typeof r.erro === 'string' ? r.erro : JSON.stringify(r.erro)], avisos: [] };
    }
    const avisos = [];
    for (const dup of r.idsDuplicados || []) {
        avisos.push(`id "${dup}" duplicado no HTML — cada id deve ser único no documento.`);
    }
    for (const ap of r.avisosDeParse || []) {
        avisos.push(`parse: ${ap.codigo}${ap.linha ? ` (linha ${ap.linha}, col ${ap.coluna})` : ''}.`);
    }
    return { ok: true, erros: [], avisos, analise: r };
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validarJson = validarJson;
// ============================================================
// SOLARIS JSON WORKER
// ============================================================
// Diferente dos demais Workers, não precisa de um parser dedicado em
// src/core/parser/ — JSON.parse do próprio Node JÁ é o parser
// determinístico de verdade pra JSON (gramática fechada, sem
// ambiguidade, sem necessidade de biblioteca externa). Mesmo contrato
// { ok, erros, avisos } dos outros Workers, pro tipo "json" do
// manifesto (ex: package.json/composer.json gerados junto do projeto).
// ============================================================
function validarJson(json) {
    if (typeof json !== 'string' || !json.trim()) {
        return { ok: false, erros: ['JSON vazio ou não é string.'], avisos: [] };
    }
    try {
        const valor = JSON.parse(json);
        const avisos = [];
        if (valor === null || typeof valor !== 'object') {
            avisos.push('JSON válido, mas a raiz não é um objeto nem array — formato incomum pra um arquivo de configuração.');
        }
        return { ok: true, erros: [], avisos };
    }
    catch (e) {
        return { ok: false, erros: [`JSON inválido: ${e.message}`], avisos: [] };
    }
}

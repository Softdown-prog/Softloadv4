"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsearDossie = parsearDossie;
exports.carregarNichoDossie = carregarNichoDossie;
exports.limparCache = limparCache;
// ============================================================
// DOSSIÊ LOADER — Lê o contrato formal por nicho (quando existe).
//
// tema-{nicho}-dossie.json substitui, para o nicho migrado, a
// combinação impl.json + tokens_css do meta.json + blocks.json.
// Nichos ainda não migrados não têm esse arquivo — carregarNichoDossie
// retorna null, e nichoBlocks.js cai no cano legado (walker heurístico).
//
// Diferente de blockLibrary.carregarBlocos, falhas de parsing NÃO podem
// cair silenciosamente no nicho legado: isso gera layouts errados com sucesso 200.
// ============================================================
const fs = require('fs');
const path = require('path');
const TEMAS_DIR = path.join(__dirname, '../../../src/blogger/nichos');
// Cache em memória: nicho → dossiê (ou null somente se ausente).
const _cache = new Map();
// ──────────────────────────────────────────────────────────────
// carregarNichoDossie — lê e cacheia o dossiê de um nicho.
// Retorna null SOMENTE se o arquivo não existe (nicho ainda não migrado).
// Se existir mas estiver corrompido, interrompe a compilação com erro claro.
// ──────────────────────────────────────────────────────────────
function parsearDossie(conteudo, nicho) {
    let dossie;
    try {
        dossie = JSON.parse(conteudo);
    }
    catch (err) {
        throw new Error(`[DOSSIE] Nicho "${nicho}": JSON inválido: ${err.message}`);
    }
    if (!dossie || typeof dossie !== 'object' || Array.isArray(dossie) ||
        dossie.nicho !== nicho || !Array.isArray(dossie.pecas) ||
        !dossie.tokensCss || typeof dossie.tokensCss !== 'object') {
        throw new Error(`[DOSSIE] Nicho "${nicho}": contrato inválido (nicho/pecas/tokensCss).`);
    }
    return dossie;
}
function carregarNichoDossie(nichoTema) {
    if (!nichoTema || typeof nichoTema !== 'string')
        return null;
    const base = nichoTema.replace(/^tema-/, '');
    if (_cache.has(base))
        return _cache.get(base);
    const filePath = path.join(TEMAS_DIR, `tema-${base}-dossie.json`);
    // Arquivo ausente: fallback legítimo para nichos ainda não migrados.
    if (!fs.existsSync(filePath)) {
        _cache.set(base, null);
        return null;
    }
    // Arquivo presente e inválido: FALHAR. Nunca aceitar tema genérico
    // quando o cliente solicitou um design autoral com dossiê dedicado.
    const dossie = parsearDossie(fs.readFileSync(filePath, 'utf-8'), base);
    _cache.set(base, dossie);
    return dossie;
}
// ──────────────────────────────────────────────────────────────
// limparCache — usado em testes.
// ──────────────────────────────────────────────────────────────
function limparCache() {
    _cache.clear();
}

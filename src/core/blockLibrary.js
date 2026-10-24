"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pickBlock = pickBlock;
exports.temBlocos = temBlocos;
exports.carregarBlocos = carregarBlocos;
exports.limparCache = limparCache;
exports.hashSeed = hashSeed;
// ============================================================
// BLOCK LIBRARY — Lê variantes geradas e escolhe uma por seed.
//
// Os arquivos tema-{nicho}-blocks.json são gerados por
// scripts/generateBlocks.js e ficam no mesmo diretório dos
// impl.json. Esta biblioteca os carrega e expõe pickBlock().
//
// Seed determinístico (baseado no siteName) → mesmo site sempre
// recebe a mesma variante; sites diferentes recebem variantes
// diferentes. O seed nunca é random — evita inconsistências.
// ============================================================
const fs = require('fs');
const path = require('path');
const TEMAS_DIR = path.join(__dirname, '../../src/rag/rag-ia-compiler/pipeline/temas');
// Cache em memória: nicho → blocos (evita I/O repetido por compilação)
const _cache = new Map();
// ──────────────────────────────────────────────────────────────
// hashSeed — hash simples (djb2) de uma string → número inteiro.
// Determinístico, sem dependências externas.
// ──────────────────────────────────────────────────────────────
function hashSeed(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) + h) ^ str.charCodeAt(i);
        h |= 0; // força 32-bit signed
    }
    return Math.abs(h);
}
// ──────────────────────────────────────────────────────────────
// carregarBlocos — lê e cacheia o arquivo de blocos para um nicho.
// Retorna null se o arquivo não existir (sem blocks gerados ainda).
// ──────────────────────────────────────────────────────────────
function carregarBlocos(nicho) {
    if (_cache.has(nicho))
        return _cache.get(nicho);
    const base = String(nicho).replace(/^tema-/, '');
    const filePath = path.join(TEMAS_DIR, `tema-${base}-blocks.json`);
    let dados = null;
    try {
        dados = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
    catch (_) {
        // Arquivo não existe — retorna null, caller usa impl.json como fallback
    }
    _cache.set(nicho, dados);
    return dados;
}
// ──────────────────────────────────────────────────────────────
// pickBlock — escolhe uma variante de um slot para um nicho.
//
// Parâmetros:
//   nicho   — ex: 'gamer-playerone'
//   slot    — 'card_css' | 'hero_html'
//   seedStr — string usada como semente (ex: siteName + nicho)
//
// Retorna a string do bloco escolhido, ou null se não houver
// blocos disponíveis para esse nicho/slot.
// ──────────────────────────────────────────────────────────────
function pickBlock(nicho, slot, seedStr) {
    const blocos = carregarBlocos(nicho);
    if (!blocos)
        return null;
    const variants = blocos[slot];
    if (!Array.isArray(variants) || variants.length === 0)
        return null;
    const idx = hashSeed(String(seedStr)) % variants.length;
    return variants[idx] || null;
}
// ──────────────────────────────────────────────────────────────
// temBlocos — verifica se um nicho tem biblioteca gerada.
// Útil para logging no compilador.
// ──────────────────────────────────────────────────────────────
function temBlocos(nicho) {
    const blocos = carregarBlocos(nicho);
    return Boolean(blocos && ((blocos.card_css && blocos.card_css.length > 0) ||
        (blocos.hero_html && blocos.hero_html.length > 0)));
}
// ──────────────────────────────────────────────────────────────
// limparCache — usado em testes ou após regerar blocos em runtime
// ──────────────────────────────────────────────────────────────
function limparCache() {
    _cache.clear();
}

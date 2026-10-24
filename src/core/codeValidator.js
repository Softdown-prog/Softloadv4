"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateXml = validateXml;
exports.validateCss = validateCss;
exports.validateJs = validateJs;
exports.validateCode = validateCode;
exports.extractCodeBlocks = extractCodeBlocks;
exports.validateResponseBlocks = validateResponseBlocks;
/**
 * codeValidator.js — Validação de sintaxe para snippets gerados pela IA
 *
 * Suporta: xml | html | css | javascript | js
 * Estratégia por tipo:
 *   xml/html  → fast-xml-parser XMLValidator (já instalado, strictMode)
 *   css       → heurística de chaves balanceadas (zero deps extras, zero falso-positivo)
 *   js        → node:vm Script() — detecta SyntaxError nativamente
 *
 * API pública:
 *   validateCode(code, lang)  → { ok, errors[], type, durationMs }
 *   extractCodeBlocks(text)   → [{ code, lang, raw }]
 */
const vm = require('node:vm');
const { XMLValidator } = require('fast-xml-parser');
// ─────────────────────────────────────────────────────────────────────────────
// DETECTORES DE LINGUAGEM
// ─────────────────────────────────────────────────────────────────────────────
const LANG_MAP = {
    xml: 'xml',
    html: 'xml',
    'xml/html': 'xml',
    css: 'css',
    scss: 'css',
    js: 'js',
    javascript: 'js',
    typescript: 'js',
    ts: 'js',
};
function normalizeLang(raw) {
    if (!raw)
        return null;
    return LANG_MAP[raw.toLowerCase().trim()] || null;
}
// ─────────────────────────────────────────────────────────────────────────────
// VALIDADORES
// ─────────────────────────────────────────────────────────────────────────────
/**
 * XML/HTML — fast-xml-parser XMLValidator
 * Wraps em <root> para aceitar fragmentos sem declaração XML.
 */
function validateXml(code) {
    const t0 = Date.now();
    // Fragmentos HTML sem raiz única precisam de wrapper para o parser XML
    const wrapped = `<_root_>${code}</_root_>`;
    const result = XMLValidator.validate(wrapped, { allowBooleanAttributes: true });
    if (result === true) {
        return { ok: true, errors: [], type: 'xml', durationMs: Date.now() - t0 };
    }
    const msg = result.err
        ? `Linha ${result.err.line}, col ${result.err.col}: ${result.err.msg}`
        : 'XML inválido';
    return { ok: false, errors: [msg], type: 'xml', durationMs: Date.now() - t0 };
}
/**
 * CSS — heurística de chaves balanceadas + strings não fechadas.
 * Estratégia escolhida: zero falso-positivo.
 * Detecta os erros reais que IA gera: { sem fechar, string aberta.
 */
function validateCss(code) {
    const t0 = Date.now();
    const errors = [];
    // Remove comentários para não confundir contagem de chaves
    const stripped = code.replace(/\/\*[\s\S]*?\*\//g, '');
    // 1. Chaves balanceadas
    let depth = 0;
    let col = 0;
    for (let i = 0; i < stripped.length; i++) {
        const ch = stripped[i];
        if (ch === '\n') {
            col = 0;
            continue;
        }
        col++;
        if (ch === '{') {
            depth++;
        }
        else if (ch === '}') {
            depth--;
            if (depth < 0) {
                errors.push(`} sem { correspondente (posição ~${i})`);
                break;
            }
        }
    }
    if (depth > 0) {
        errors.push(`${depth} bloco${depth > 1 ? 's' : ''} { sem } de fechamento`);
    }
    // 2. String sem fechar (aspa dupla ou simples que não fecha na mesma linha)
    const lines = stripped.split('\n');
    for (let li = 0; li < lines.length; li++) {
        const l = lines[li];
        // conta aspas não escapadas
        const doubles = (l.match(/(?<!\\)"/g) || []).length;
        const singles = (l.match(/(?<!\\)'/g) || []).length;
        if (doubles % 2 !== 0) {
            errors.push(`Linha ${li + 1}: aspas duplas não balanceadas`);
        }
        if (singles % 2 !== 0) {
            errors.push(`Linha ${li + 1}: aspas simples não balanceadas`);
        }
    }
    return {
        ok: errors.length === 0,
        errors,
        type: 'css',
        durationMs: Date.now() - t0,
    };
}
/**
 * JS/TS — node:vm Script() parse-only (não executa, só verifica sintaxe).
 * Usa o V8 nativo: detecta SyntaxError sem risco de execução.
 */
function validateJs(code) {
    const t0 = Date.now();
    try {
        // eslint-disable-next-line no-new
        new vm.Script(code, { filename: '<snippet>', lineOffset: 0 });
        return { ok: true, errors: [], type: 'js', durationMs: Date.now() - t0 };
    }
    catch (e) {
        // SyntaxError tem stack com número de linha
        const msg = e.message || String(e);
        return { ok: false, errors: [msg], type: 'js', durationMs: Date.now() - t0 };
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// API PÚBLICA
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Valida um bloco de código.
 * @param {string} code  — Conteúdo do bloco
 * @param {string} lang  — Linguagem declarada no fence (ex: 'js', 'xml', 'css')
 * @returns {{ ok: boolean, errors: string[], type: string|null, durationMs: number }}
 */
function validateCode(code, lang) {
    if (!code || typeof code !== 'string') {
        return { ok: false, errors: ['Bloco de código vazio'], type: null, durationMs: 0 };
    }
    const type = normalizeLang(lang);
    if (type === 'xml')
        return validateXml(code);
    if (type === 'css')
        return validateCss(code);
    if (type === 'js')
        return validateJs(code);
    // Linguagem não suportada → passa sem erro (não bloqueamos o que não sabemos validar)
    return { ok: true, errors: [], type: null, durationMs: 0, skipped: true };
}
/**
 * Extrai todos os blocos de código de um texto Markdown.
 * Suporta fences triplos com linguagem declarada (```js ... ```)
 * @param {string} text  — Texto Markdown da resposta da IA
 * @returns {{ code: string, lang: string|null, raw: string }[]}
 */
function extractCodeBlocks(text) {
    if (!text || typeof text !== 'string')
        return [];
    const blocks = [];
    // Regex: ``` + lang_opcional + newline + conteúdo + ```
    const re = /```([a-zA-Z0-9_\-/]*)\n([\s\S]*?)```/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        const lang = m[1].trim() || null;
        const code = m[2];
        blocks.push({ code, lang, raw: m[0] });
    }
    return blocks;
}
/**
 * Valida todos os blocos de código de uma resposta Markdown.
 * @param {string} text  — Resposta completa da IA
 * @returns {{ allOk: boolean, results: Array<{ lang, ok, errors, type, durationMs }> }}
 */
function validateResponseBlocks(text) {
    const blocks = extractCodeBlocks(text);
    const results = [];
    let allOk = true;
    for (const { code, lang } of blocks) {
        const r = validateCode(code, lang);
        results.push({ lang, ...r });
        if (!r.ok && !r.skipped)
            allOk = false;
    }
    return { allOk, results };
}

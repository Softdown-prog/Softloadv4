"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseHtml = parseHtml;
exports.analisarHtml = analisarHtml;
// ============================================================
// HTML PARSER — Fase 2 do projeto de parsers "fora do pipeline de
// compilação" (src/core/parser/, ver cssParser.js pra Fase 1 e o
// racional completo). Usa parse5 (parser HTML5 spec-compliant, mesmo
// motor usado por jsdom) — AST de verdade, não regex.
//
// Diferença de htmlWorker.js: aquele confere que uma LISTA de ids
// esperados aparece no html de uma peça de dossiê (contrato fechado,
// já sabe o que procurar). Este analisa HTML ARBITRÁRIO colado num
// chat, sem contrato prévio — descobre estrutura, conta elementos,
// acha id duplicado (bug real: quebra getElementById/#id do CSS).
//
// Achado importante sobre "erro de sintaxe" em HTML: HTML5, por spec,
// é tolerante a erro — o parser SEMPRE produz uma árvore, mesmo com
// tag não fechada ou aninhamento errado (o browser faz a mesma
// recuperação automática). Por isso não existe "sintaxe inválida" pra
// HTML do jeito que existe pra CSS/JS/XML — o que existe é uma lista
// de avisos de parse (ex: atributo duplicado), que reporta aqui como
// `avisosDeParse`, nunca como falha total.
// ============================================================
const parse5 = require('parse5');
// ──────────────────────────────────────────────────────────────
// parseHtml — parse puro via parse5.parseFragment (fragmento, não
// documento completo — evita ruído de "missing-doctype" em HTML
// arbitrário colado, que nunca é um documento HTML completo). Nunca
// lança. Retorna { ok:true, fragment, errosParse } — errosParse são os
// avisos de recuperação do parser (parse5 sempre produz árvore, então
// isso não é motivo de ok:false).
// ──────────────────────────────────────────────────────────────
function parseHtml(html) {
    if (typeof html !== 'string' || !html.trim()) {
        return { ok: false, erro: 'HTML vazio ou não é string.' };
    }
    const errosParse = [];
    let fragment;
    try {
        fragment = parse5.parseFragment(html, {
            sourceCodeLocationInfo: true,
            onParseError: (e) => errosParse.push(e),
        });
    }
    catch (e) {
        return { ok: false, erro: e.message };
    }
    return { ok: true, fragment, errosParse };
}
function _andarNos(no, visitor) {
    visitor(no);
    if (Array.isArray(no.childNodes)) {
        for (const filho of no.childNodes)
            _andarNos(filho, visitor);
    }
}
const MAX_ITENS_LISTA = 30;
const NOS_NAO_ELEMENTO = new Set(['#text', '#comment', '#document-fragment', '#document', '#documentType']);
// ──────────────────────────────────────────────────────────────
// analisarHtml — relatório estruturado: contagem de elementos por tag,
// ids duplicados (achado mais valioso — mesma classe de bug que a
// variável CSS órfã: silencioso, quebra seletor/JS sem erro visível),
// avisos reais de parse (atributo duplicado etc).
// ──────────────────────────────────────────────────────────────
function analisarHtml(html) {
    const parse = parseHtml(html);
    if (!parse.ok)
        return { ok: false, erro: parse.erro };
    const idsVistos = new Map();
    const idsDuplicados = [];
    const contagemTags = {};
    let totalElementos = 0;
    _andarNos(parse.fragment, (no) => {
        if (!no.nodeName || NOS_NAO_ELEMENTO.has(no.nodeName))
            return;
        totalElementos++;
        contagemTags[no.nodeName] = (contagemTags[no.nodeName] || 0) + 1;
        if (Array.isArray(no.attrs)) {
            for (const attr of no.attrs) {
                if (attr.name !== 'id' || !attr.value)
                    continue;
                const contagem = (idsVistos.get(attr.value) || 0) + 1;
                idsVistos.set(attr.value, contagem);
                if (contagem === 2)
                    idsDuplicados.push(attr.value);
            }
        }
    });
    const avisosDeParse = parse.errosParse
        .map(e => ({ codigo: e.code, linha: e.startLine ?? null, coluna: e.startCol ?? null }))
        .slice(0, MAX_ITENS_LISTA);
    return {
        ok: true,
        estrutura: { elementos: totalElementos, tags: contagemTags },
        idsDuplicados: idsDuplicados.slice(0, MAX_ITENS_LISTA),
        avisosDeParse,
    };
}

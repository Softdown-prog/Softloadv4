'use strict';
export interface KeywordScore { hits: number; score: number }
declare const module: { exports: unknown };

/**
 * ragMatcher — matching de palavras-chave compartilhado por todo o RAG
 * (chatRag, chatRagGpt e ragLoader).
 *
 * Substitui o antigo `texto.includes(keyword)`, que casava substrings dentro
 * de palavras: a keyword "ia" disparava em "criar"/"notícias"/"tecnologia",
 * "ui" disparava em "muito"/"aqui", "card" em "cardápio" — poluindo o system
 * prompt com ficheiros irrelevantes em quase toda mensagem em português.
 *
 * Regras:
 *  - Fronteira de palavra dos dois lados (letra/dígito não pode encostar na
 *    keyword) — "dark" casa em "tema dark", não em "darkness".
 *  - Acentos normalizados dos dois lados — "semântica" casa com "semantica".
 *  - Keywords multi-palavra ("dark mode", "html semântico") casam como frase.
 */

// Remove diacríticos e baixa a caixa — aplicado a texto E keyword.
function normalizar(str: unknown): string {
    return String(str || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

const _cacheRegex = new Map<string, RegExp>();

function _regexDe(keyword: string): RegExp {
    let re = _cacheRegex.get(keyword);
    if (!re) {
        const escapada = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Fronteira: nada de letra/dígito colado em nenhum dos lados.
        re = new RegExp(`(?<![\\p{L}\\p{N}])${escapada}(?![\\p{L}\\p{N}])`, 'u');
        _cacheRegex.set(keyword, re);
    }
    return re;
}

/**
 * Cria um matcher para uma mensagem: normaliza o texto uma única vez e
 * devolve uma função que testa keywords contra ele.
 * @param {string} texto — mensagem do usuário
 * @returns {(keyword: string) => boolean}
 */
function criarMatcher(texto: unknown): (keyword: string) => boolean {
    const textoNorm = normalizar(texto);
    return (keyword: string) => {
        const kw = normalizar(keyword).trim();
        if (!kw) return false;
        return _regexDe(kw).test(textoNorm);
    };
}

/**
 * Pontua uma lista de keywords contra a mensagem. Score favorece
 * especificidade: soma do comprimento das keywords que casaram — uma frase
 * como "dark mode" vale mais que a palavra solta "dark".
 * @returns {{ hits: number, score: number }}
 */
function pontuarKeywords(matcher: (keyword: string) => boolean, keywords?: readonly string[]): KeywordScore {
    let hits = 0, score = 0;
    for (const kw of (keywords || [])) {
        if (matcher(kw)) { hits++; score += normalizar(kw).trim().length; }
    }
    return { hits, score };
}

module.exports = { normalizar, criarMatcher, pontuarKeywords };

export {};

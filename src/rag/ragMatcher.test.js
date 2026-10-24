'use strict';

/**
 * Testes para ragMatcher.js
 * Execute: node src/rag/ragMatcher.test.js
 */

const { normalizar, criarMatcher, pontuarKeywords } = require('./ragMatcher');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

// ── normalizar ─────────────────────────────────────────────────────────────
assert('normaliza acentos', normalizar('Semântica') === 'semantica');
assert('normaliza caixa', normalizar('DARK Mode') === 'dark mode');
assert('null vira vazio', normalizar(null) === '');

// ── fronteira de palavra: os falsos positivos históricos ──────────────────
// A keyword "ia" disparava em criar/notícias/tecnologia/gastronomia
let m = criarMatcher('quero criar um blog de notícias de tecnologia e gastronomia');
assert('"ia" NÃO casa dentro de criar/notícias/tecnologia', !m('ia'));
// A keyword "ui" disparava em muito/aqui/fui
m = criarMatcher('o blog está muito lento, fui ver aqui');
assert('"ui" NÃO casa dentro de muito/fui/aqui', !m('ui'));
// A keyword "card" disparava em cardápio
m = criarMatcher('quero um cardápio no blog');
assert('"card" NÃO casa dentro de cardápio', !m('card'));
// "dark" não casa em darkness mas casa como palavra
m = criarMatcher('tema dark pra darkness fics');
assert('"dark" casa como palavra isolada', m('dark'));
assert('"toc" NÃO casa dentro de tocar', !criarMatcher('vou tocar em frente')('toc'));

// ── matches legítimos preservados ──────────────────────────────────────────
m = criarMatcher('como faço dark mode com toggle?');
assert('frase "dark mode" casa', m('dark mode'));
m = criarMatcher('problema com adsense no blog');
assert('"adsense" casa', m('adsense'));
m = criarMatcher('o que é b:includable?');
assert('"b:includable" casa (com pontuação interna)', m('b:includable'));
m = criarMatcher('minha url tem ?m=1 no final');
assert('"?m=1" casa (caracteres especiais escapados)', m('?m=1'));

// ── acentos dos dois lados ─────────────────────────────────────────────────
assert('usuário sem acento casa keyword com acento', criarMatcher('html semantico')('html semântico'));
assert('usuário com acento casa keyword sem acento', criarMatcher('domínio não conecta')('dominio'));

// ── pontuarKeywords ────────────────────────────────────────────────────────
m = criarMatcher('quero dark mode no meu blog gamer');
const p1 = pontuarKeywords(m, ['dark mode', 'gamer', 'saas']);
assert('pontua 2 hits', p1.hits === 2, `hits=${p1.hits}`);
const p2 = pontuarKeywords(m, ['dark']);
const p3 = pontuarKeywords(m, ['dark mode']);
assert('frase longa pontua mais que palavra curta', p3.score > p2.score);
assert('lista vazia = zero', pontuarKeywords(m, []).hits === 0);
assert('keywords undefined = zero', pontuarKeywords(m, undefined).hits === 0);

console.log(`\n${failed === 0 ? '✅' : '❌'} ragMatcher: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

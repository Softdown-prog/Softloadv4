'use strict';

/**
 * Testes do htmlParser — Fase 2 do projeto de parsers.
 * Execute: node src/core/parser/htmlParser.test.js
 */

const { parseHtml, analisarHtml } = require('./htmlParser');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

// ── parseHtml ────────────────────────────────────────────────────────
{
    const r = parseHtml('<div>oi</div>');
    assert('HTML válido: ok=true', r.ok === true);
    assert('HTML válido: devolve fragment', !!r.fragment);
}
{
    const r = parseHtml('');
    assert('HTML vazio: ok=false', r.ok === false);
}
{
    const r = parseHtml(null);
    assert('HTML não-string: ok=false, não lança', r.ok === false);
}
{
    // HTML5 é tolerante por spec — tag não fechada NUNCA falha o parse,
    // sempre produz árvore (mesma recuperação que o browser faz).
    const r = parseHtml('<div><span>oi</div>');
    assert('HTML "malformado" ainda parseia (recuperação HTML5 por spec)', r.ok === true);
}

// ── analisarHtml — estrutura básica ─────────────────────────────────
{
    const r = analisarHtml('<div><p>a</p><p>b</p><span>c</span></div>');
    assert('estrutura: ok=true', r.ok === true);
    assert('estrutura: conta 4 elementos (div+2p+span)', r.estrutura.elementos === 4, JSON.stringify(r.estrutura));
    assert('estrutura: contagem por tag correta', r.estrutura.tags.p === 2 && r.estrutura.tags.div === 1 && r.estrutura.tags.span === 1);
}

// ── analisarHtml — sem id duplicado ─────────────────────────────────
{
    const r = analisarHtml('<div id="a"><span id="b"></span></div>');
    assert('sem id duplicado: lista vazia', r.idsDuplicados.length === 0, JSON.stringify(r.idsDuplicados));
}

// ── analisarHtml — id duplicado (bug real: quebra getElementById) ──
{
    const r = analisarHtml('<div id="hero"><span id="hero">duplicado</span></div>');
    assert('id duplicado detectado', r.idsDuplicados.includes('hero'), JSON.stringify(r.idsDuplicados));
}
{
    const r = analisarHtml('<div id="a"></div><div id="b"></div><div id="a"></div>');
    assert('id duplicado detectado (elementos irmãos, não aninhados)', r.idsDuplicados.includes('a') && !r.idsDuplicados.includes('b'));
}

// ── analisarHtml — atributo duplicado gera aviso de parse ───────────
{
    const r = analisarHtml('<div class="a" class="b">oi</div>');
    assert('atributo duplicado: aviso de parse presente', r.avisosDeParse.some(a => a.codigo === 'duplicate-attribute'), JSON.stringify(r.avisosDeParse));
}

// ── analisarHtml — sintaxe inválida (não-string) propaga erro ───────
{
    const r = analisarHtml(undefined);
    assert('undefined: ok=false, não lança', r.ok === false);
}

console.log(`\n${failed === 0 ? '✅' : '❌'} htmlParser: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

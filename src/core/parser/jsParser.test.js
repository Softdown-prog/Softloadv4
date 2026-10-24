'use strict';

/**
 * Testes do jsParser — Fase 2 do projeto de parsers.
 * Execute: node src/core/parser/jsParser.test.js
 */

const { parseJs, analisarJs } = require('./jsParser');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

// ── parseJs ──────────────────────────────────────────────────────────
{
    const r = parseJs('const x = 1;');
    assert('JS válido: ok=true', r.ok === true);
    assert('JS válido: devolve ast', !!r.ast);
}
{
    const r = parseJs('');
    assert('JS vazio: ok=false', r.ok === false);
}
{
    const r = parseJs(null);
    assert('JS não-string: ok=false, não lança', r.ok === false);
}
{
    const r = parseJs('const x = ;');
    assert('JS com erro de sintaxe: ok=false', r.ok === false);
    assert('erro de sintaxe tem linha', r.erro.linha === 1, JSON.stringify(r.erro));
}

// ── analisarJs — estrutura básica ───────────────────────────────────
{
    const r = analisarJs('function foo() {} const arrow = () => {}; var x = 1; let y = 2;');
    assert('estrutura: ok=true', r.ok === true);
    assert('estrutura: 2 funções (declaração + arrow)', r.estrutura.funcoes === 2, JSON.stringify(r.estrutura));
    assert('estrutura: 3 variáveis (arrow conta como VariableDeclarator também)', r.estrutura.variaveis === 3, JSON.stringify(r.estrutura));
}

// ── analisarJs — identificador não declarado (typo real) ───────────
{
    const r = analisarJs('function foo() { retorna(zzzNuncaDeclarada); }');
    assert('identificador nunca declarado detectado', r.identificadoresNaoDeclarados.some(i => i.nome === 'zzzNuncaDeclarada'), JSON.stringify(r.identificadoresNaoDeclarados));
}

// ── analisarJs — variável declarada não é sinalizada ────────────────
{
    const r = analisarJs('function foo() { const x = 1; return x; }');
    assert('variável declarada e usada: não aparece como não-declarada', !r.identificadoresNaoDeclarados.some(i => i.nome === 'x'));
    assert('nome da própria função não aparece como não-declarada', !r.identificadoresNaoDeclarados.some(i => i.nome === 'foo'));
}

// ── analisarJs — globais conhecidos não são falso-positivo ─────────
{
    const r = analisarJs('document.getElementById("x"); console.log(window.location.href); setTimeout(() => {}, 100);');
    assert('globais de browser não aparecem como não-declarados', r.identificadoresNaoDeclarados.length === 0, JSON.stringify(r.identificadoresNaoDeclarados));
}

// ── analisarJs — destructuring registra os nomes declarados ────────
{
    const r = analisarJs('const {a, b: {c}} = obj; console.log(a, c);');
    assert('nomes de destructuring (a, c) não aparecem como não-declarados',
        !r.identificadoresNaoDeclarados.some(i => i.nome === 'a' || i.nome === 'c'));
    assert('"obj" (nunca declarado) é sinalizado', r.identificadoresNaoDeclarados.some(i => i.nome === 'obj'));
}

// ── analisarJs — parâmetro de função é declaração, não uso ─────────
{
    const r = analisarJs('function soma(a, b) { return a + b; }');
    assert('parâmetros de função não são sinalizados como não-declarados', r.identificadoresNaoDeclarados.length === 0, JSON.stringify(r.identificadoresNaoDeclarados));
}

// ── analisarJs — catch clause param é declaração ────────────────────
{
    const r = analisarJs('try { risco(); } catch (erro) { console.log(erro.message); }');
    assert('parâmetro do catch (erro) não é sinalizado', !r.identificadoresNaoDeclarados.some(i => i.nome === 'erro'));
    assert('"risco" (nunca declarado) é sinalizado', r.identificadoresNaoDeclarados.some(i => i.nome === 'risco'));
}

// ── analisarJs — console.log detectado (debug esquecido) ───────────
{
    const r = analisarJs('function f() { console.log("debug"); console.warn("aviso"); }');
    assert('console.log detectado', r.consoleLogs.some(c => c.metodo === 'log'));
    assert('console.warn detectado', r.consoleLogs.some(c => c.metodo === 'warn'));
}
{
    const r = analisarJs('const x = 1;');
    assert('sem console.*: lista vazia', r.consoleLogs.length === 0);
}

console.log(`\n${failed === 0 ? '✅' : '❌'} jsParser: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

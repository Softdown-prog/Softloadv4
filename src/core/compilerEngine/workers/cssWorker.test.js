'use strict';

/**
 * Testes do cssWorker — validarTokensCss().
 * Execute: node src/core/compilerEngine/workers/cssWorker.test.js
 */

const { validarTokensCss } = require('./cssWorker');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

// A. CSS vazio ou sem var() não gera erro.
{
    const { erros } = validarTokensCss('');
    assert('css vazio: zero erros', erros.length === 0, erros.join(' | '));
}
{
    const { erros } = validarTokensCss('.a { color: red; }');
    assert('css sem var(): zero erros', erros.length === 0, erros.join(' | '));
}

// B. var() com --x declarado localmente não gera erro.
{
    const css = ':root { --x: #fff; } .a { color: var(--x); }';
    const { erros } = validarTokensCss(css);
    assert('var() com --x declarado localmente: zero erros', erros.length === 0, erros.join(' | '));
}

// C. var() com --x nos tokens externos (dossiê) não gera erro.
{
    const css = '.a { color: var(--sd-primary); }';
    const { erros } = validarTokensCss(css, { tokensExternos: ['--sd-primary'] });
    assert('var() com --x em tokensExternos: zero erros', erros.length === 0, erros.join(' | '));
}

// D. var() órfã (nem local, nem externa) é erro — achado real desta sessão.
{
    const css = '.a { color: var(--nunca-declarada); }';
    const { ok, erros } = validarTokensCss(css);
    assert('var() órfã: ok=false', ok === false);
    assert('var() órfã: mensagem menciona a variável', erros.some(e => e.includes('--nunca-declarada')), erros.join(' | '));
}

// E. var() com fallback (var(--x, valor)) NÃO é órfã mesmo sem --x
// declarada — seguro por spec CSS, o navegador usa o fallback (achado
// real: --radius em pop-retro-pixel, var(--radius, 12px)).
{
    const css = '.a { border-radius: var(--radius, 12px); }';
    const { ok, erros } = validarTokensCss(css);
    assert('var() com fallback: zero erros mesmo sem declaração', ok === true, erros.join(' | '));
}
{
    // mas se a MESMA variável aparecer em outro lugar sem fallback,
    // continua sendo cobrada normalmente.
    const css = '.a { border-radius: var(--radius, 12px); } .b { padding: var(--radius); }';
    const { ok, erros } = validarTokensCss(css);
    assert('var() sem fallback continua exigindo declaração', ok === false, erros.join(' | '));
}

console.log(`\n${failed === 0 ? '✅' : '❌'} cssWorker: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

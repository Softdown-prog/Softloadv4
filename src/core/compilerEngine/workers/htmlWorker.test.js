'use strict';

/**
 * Testes do htmlWorker — validarDomIds().
 * Execute: node src/core/compilerEngine/workers/htmlWorker.test.js
 */

const { validarDomIds } = require('./htmlWorker');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

// A. Sem domIds declarado passa trivialmente (peça "modulo").
{
    const { ok, erros } = validarDomIds('', []);
    assert('sem domIds: ok=true', ok === true, erros.join(' | '));
}

// B. domId presente (aspas simples ou duplas) passa.
{
    const { ok } = validarDomIds("<div id='x'></div>", ['x']);
    assert('domId com aspas simples: ok=true', ok === true);
}
{
    const { ok } = validarDomIds('<div id="y"></div>', ['y']);
    assert('domId com aspas duplas: ok=true', ok === true);
}

// C. domId ausente é erro.
{
    const { ok, erros } = validarDomIds('<div id="outro"></div>', ['x']);
    assert('domId ausente: ok=false', ok === false);
    assert('erro menciona o id ausente', erros.some(e => e.includes('#x')), erros.join(' | '));
}

// D. domId declarado mas peça sem html algum — achado real desta sessão
// (css/js extraídos, html nunca documentado — banner de cookie órfão).
{
    const { ok, erros } = validarDomIds('', ['cookie-banner']);
    assert('domId sem html algum: ok=false', ok === false);
    assert('erro menciona ausência de html', erros.some(e => e.includes('não tem html')), erros.join(' | '));
}

console.log(`\n${failed === 0 ? '✅' : '❌'} htmlWorker: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

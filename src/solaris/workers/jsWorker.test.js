'use strict';

/**
 * Testes de jsWorker.js.
 * Execute: node src/solaris/workers/jsWorker.test.js
 */

const { validarJs } = require('./jsWorker');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

// A. JS válido sem problemas.
{
    const r = validarJs('function soma(a, b) { return a + b; } soma(1, 2);');
    assert('JS válido: ok true', r.ok === true, JSON.stringify(r));
    assert('JS válido: zero avisos', r.avisos.length === 0, JSON.stringify(r.avisos));
}

// B. erro de sintaxe real vira erro, não lança.
{
    const r = validarJs('function soma(a, b) { return a + ; }');
    assert('JS malformado: ok false', r.ok === false);
    assert('JS malformado: erro reportado', r.erros.length > 0, JSON.stringify(r.erros));
}

// C. console.log vira aviso (limpar antes de produção).
{
    const r = validarJs('console.log("debug");');
    assert('console.log: ok true (não bloqueia)', r.ok === true);
    assert('console.log: aviso reporta', r.avisos.some((a) => a.includes('console.log')), JSON.stringify(r.avisos));
}

// D. identificador global conhecido (window/document) não vira falso-positivo.
{
    const r = validarJs('document.getElementById("x");');
    assert('document não é reportado como não-declarado', !r.avisos.some((a) => a.includes('"document"')));
}

console.log(`\n${failed === 0 ? '✅' : '❌'} jsWorker: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

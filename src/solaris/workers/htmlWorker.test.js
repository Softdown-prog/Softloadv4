'use strict';

/**
 * Testes de htmlWorker.js.
 * Execute: node src/solaris/workers/htmlWorker.test.js
 */

const { validarHtml } = require('./htmlWorker');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

// A. HTML válido sem problemas.
{
    const r = validarHtml('<div class="card"><h1 id="titulo">Ola</h1></div>');
    assert('HTML válido: ok true', r.ok === true, JSON.stringify(r));
    assert('HTML válido: zero avisos', r.avisos.length === 0, JSON.stringify(r.avisos));
}

// B. HTML vazio/não-string vira erro (não lança).
{
    const r = validarHtml('');
    assert('HTML vazio: ok false, sem lançar', r.ok === false && r.erros.length > 0);
}

// C. id duplicado vira aviso, não erro bloqueante.
{
    const r = validarHtml('<div id="x"></div><div id="x"></div>');
    assert('id duplicado: ok true (não bloqueia)', r.ok === true);
    assert('id duplicado: aviso reporta', r.avisos.some((a) => a.includes('duplicado')), JSON.stringify(r.avisos));
}

console.log(`\n${failed === 0 ? '✅' : '❌'} htmlWorker: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

'use strict';

/**
 * Testes de phpWorker.js.
 * Execute: node src/solaris/workers/phpWorker.test.js
 */

const { validarPhp } = require('./phpWorker');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

// A. PHP válido sem problemas.
{
    const r = validarPhp('<?php\nfunction ola() { echo "oi"; }\n');
    assert('PHP válido: ok true', r.ok === true, JSON.stringify(r));
    assert('PHP válido: zero erros', r.erros.length === 0);
}

// B. PHP vazio/não-string vira erro (não lança).
{
    const r = validarPhp('');
    assert('PHP vazio: ok false, sem lançar', r.ok === false && r.erros.length > 0);
}
{
    const r = validarPhp(null);
    assert('PHP não-string: ok false, sem lançar', r.ok === false);
}

// C. sintaxe quebrada vira erro com linha na mensagem.
{
    const r = validarPhp('<?php\nfunction foo( {\n  return 1;\n}\n');
    assert('sintaxe quebrada: ok false', r.ok === false);
    assert('erro cita a linha', r.erros[0].includes('linha'), JSON.stringify(r.erros));
}

console.log(`\n${failed === 0 ? '✅' : '❌'} phpWorker: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

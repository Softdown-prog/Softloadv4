'use strict';

/**
 * Testes de ejsWorker.js.
 * Execute: node src/solaris/workers/ejsWorker.test.js
 */

const { validarEjs } = require('./ejsWorker');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

// A. EJS válido sem include, sem avisos.
{
    const r = validarEjs('<h1><%= titulo %></h1>');
    assert('EJS válido: ok true', r.ok === true, JSON.stringify(r));
    assert('EJS válido: zero avisos', r.avisos.length === 0);
}

// B. EJS vazio/não-string vira erro (não lança).
{
    const r = validarEjs('');
    assert('EJS vazio: ok false, sem lançar', r.ok === false && r.erros.length > 0);
}

// C. tag não fechada vira erro.
{
    const r = validarEjs('<h1><%= titulo %');
    assert('tag não fechada: ok false', r.ok === false);
}

// D. include() vira aviso (não bloqueia, mas avisa do risco do pipeline granular).
{
    const r = validarEjs("<%- include('partials/header') %><h1>Oi</h1>");
    assert('include: ok true (não bloqueia)', r.ok === true);
    assert('include: aviso reporta o nome', r.avisos.some((a) => a.includes('partials/header')), JSON.stringify(r.avisos));
}

console.log(`\n${failed === 0 ? '✅' : '❌'} ejsWorker: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

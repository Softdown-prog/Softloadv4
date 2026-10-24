'use strict';

/**
 * Testes de jsonWorker.js.
 * Execute: node src/solaris/workers/jsonWorker.test.js
 */

const { validarJson } = require('./jsonWorker');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

// A. JSON válido (objeto) sem problemas.
{
    const r = validarJson('{"nome": "produto", "preco": 10}');
    assert('JSON válido: ok true', r.ok === true, JSON.stringify(r));
    assert('JSON válido: zero avisos', r.avisos.length === 0);
}

// B. JSON válido (array) sem problemas.
{
    const r = validarJson('[1, 2, 3]');
    assert('JSON array válido: ok true', r.ok === true);
    assert('JSON array válido: zero avisos', r.avisos.length === 0);
}

// C. JSON vazio/não-string vira erro (não lança).
{
    const r = validarJson('');
    assert('JSON vazio: ok false, sem lançar', r.ok === false && r.erros.length > 0);
}
{
    const r = validarJson(null);
    assert('JSON não-string: ok false, sem lançar', r.ok === false);
}

// D. JSON malformado vira erro com mensagem.
{
    const r = validarJson('{ "x": }');
    assert('JSON malformado: ok false', r.ok === false);
    assert('erro cita "JSON inválido"', r.erros[0].includes('JSON inválido'), JSON.stringify(r.erros));
}

// E. JSON válido mas raiz não é objeto/array vira aviso (não erro).
{
    const r = validarJson('"apenas uma string"');
    assert('raiz string: ok true (não bloqueia)', r.ok === true);
    assert('raiz string: aviso reporta', r.avisos.length === 1, JSON.stringify(r.avisos));
}
{
    const r = validarJson('42');
    assert('raiz número: ok true (não bloqueia)', r.ok === true);
    assert('raiz número: aviso reporta', r.avisos.length === 1);
}

console.log(`\n${failed === 0 ? '✅' : '❌'} jsonWorker: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

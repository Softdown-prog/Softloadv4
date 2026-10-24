'use strict';

/**
 * Testes do jsWorker — validarEscopoGlobal().
 * Execute: node src/core/compilerEngine/workers/jsWorker.test.js
 */

const { validarEscopoGlobal } = require('./jsWorker');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

// A. Vazio/nulo não gera erro.
{
    const { ok } = validarEscopoGlobal('');
    assert('js vazio: ok=true', ok === true);
}
{
    const { ok } = validarEscopoGlobal([]);
    assert('array vazio: ok=true', ok === true);
}

// B. Blocos sem colisão de escopo passam.
{
    const { ok, erro } = validarEscopoGlobal(['const a = 1;', 'const b = 2;']);
    assert('blocos sem colisão: ok=true', ok === true, erro);
}

// C. Colisão real de identificador entre dois blocos — achado real desta
// sessão (peça "widget" injetada 2x, `const btnScroll` duplicado).
{
    const { ok, erro } = validarEscopoGlobal(['const btnScroll = 1;', 'const btnScroll = 2;']);
    assert('colisão de identificador: ok=false', ok === false);
    assert('erro menciona o identificador', erro.includes('btnScroll'), erro);
}

// D. String única (não array) também funciona.
{
    const { ok } = validarEscopoGlobal('const x = 1; function f() { return x; }');
    assert('string única sem colisão: ok=true', ok === true);
}

console.log(`\n${failed === 0 ? '✅' : '❌'} jsWorker: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

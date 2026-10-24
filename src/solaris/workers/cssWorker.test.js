'use strict';

/**
 * Testes de cssWorker.js.
 * Execute: node src/solaris/workers/cssWorker.test.js
 */

const { validarCss } = require('./cssWorker');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

// A. CSS válido sem problemas.
{
    const r = validarCss(':root { --brand: #198754; } .btn { color: var(--brand); }');
    assert('CSS válido: ok true', r.ok === true, JSON.stringify(r));
    assert('CSS válido: zero avisos', r.avisos.length === 0, JSON.stringify(r.avisos));
}

// B. erro de sintaxe real vira erro com linha/coluna, não lança.
{
    const r = validarCss('.btn { color: ;');
    assert('CSS malformado: ok false', r.ok === false);
    assert('CSS malformado: erro reportado', r.erros.length > 0, JSON.stringify(r.erros));
}

// C. variável CSS órfã vira aviso.
{
    const r = validarCss('.btn { color: var(--nunca-declarada); }');
    assert('var órfã: ok true (não bloqueia)', r.ok === true);
    assert('var órfã: aviso reporta', r.avisos.some((a) => a.includes('--nunca-declarada')), JSON.stringify(r.avisos));
}

// D. tokensExternos evita falso-positivo de var órfã (ex: --sl-primary global).
{
    const r = validarCss('.btn { color: var(--sl-primary); }', { tokensExternos: ['--sl-primary'] });
    assert('token externo não vira aviso de var órfã', !r.avisos.some((a) => a.includes('--sl-primary')));
}

console.log(`\n${failed === 0 ? '✅' : '❌'} cssWorker: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

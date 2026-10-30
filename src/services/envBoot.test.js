'use strict';

/**
 * Testes do envBoot — validarEnvBoot é pura (recebe `env` como parâmetro),
 * então nenhum teste aqui muta process.env de verdade.
 *
 * Execute: node src/services/envBoot.test.js
 */

const { validarEnvBoot, OBRIGATORIAS, OPCIONAIS } = require('./envBoot');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

function envCompleto() {
    const env = {};
    [...OBRIGATORIAS, ...OPCIONAIS].forEach(v => { env[v] = 'valor-de-teste'; });
    return env;
}

// ── Todas as vars presentes ──────────────────────────────────────────
{
    const r = validarEnvBoot(envCompleto());
    assert('env completo: ok=true', r.ok === true);
    assert('env completo: sem obrigatórias faltando', r.faltandoObrigatorias.length === 0);
    assert('env completo: sem opcionais faltando', r.faltandoOpcionais.length === 0);
}

// ── Falta uma obrigatória (SESSION_SECRET) ───────────────────────────
{
    const env = envCompleto();
    delete env.SESSION_SECRET;
    const r = validarEnvBoot(env);
    assert('sem SESSION_SECRET: ok=false', r.ok === false);
    assert('sem SESSION_SECRET: aparece na lista de obrigatórias faltando', r.faltandoObrigatorias.includes('SESSION_SECRET'));
}

// ── Faltam todas as obrigatórias ─────────────────────────────────────
{
    const r = validarEnvBoot({});
    assert('env vazio: ok=false', r.ok === false);
    assert('env vazio: todas as obrigatórias faltando', r.faltandoObrigatorias.length === OBRIGATORIAS.length);
    assert('env vazio: todas as opcionais faltando', r.faltandoOpcionais.length === OPCIONAIS.length);
}

// ── Falta só uma opcional — não derruba ok ───────────────────────────
{
    const env = envCompleto();
    delete env.RESEND_API_KEY;
    const r = validarEnvBoot(env);
    assert('sem RESEND_API_KEY (opcional): ok continua true', r.ok === true);
    assert('sem RESEND_API_KEY (opcional): aparece na lista de opcionais faltando', r.faltandoOpcionais.includes('RESEND_API_KEY'));
}

// ── String vazia conta como ausente (não só undefined) ───────────────
{
    const env = envCompleto();
    env.SESSION_SECRET = '';
    const r = validarEnvBoot(env);
    assert('SESSION_SECRET vazio: ok=false', r.ok === false);
    assert('SESSION_SECRET vazio: aparece na lista de obrigatórias faltando', r.faltandoObrigatorias.includes('SESSION_SECRET'));
}

console.log(`\n${failed === 0 ? '✅' : '❌'} envBoot: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

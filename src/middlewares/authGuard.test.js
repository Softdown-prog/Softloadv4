'use strict';

/**
 * Testes do authGuard — foco em verificarSaldo()/verificarSaldoBloggerAi(),
 * que passaram a bloquear de verdade assinante ativo sem saldo (antes só
 * passava, crédito era analytics). Mocka db.collection(...).doc(...).get() (Firestore-backed,
 * sem credenciais reais neste ambiente de teste) via monkey-patch no
 * módulo firebase.js ANTES do require de authGuard.js — mesmo truque de
 * ordenação já usado em outros testes desta sessão (pecaOrchestrator.test.js
 * etc): authGuard.js faz `const { db } = require('../services/firebase')`
 * uma vez só, então db.collection precisa já estar substituído antes disso.
 *
 * Execute: node src/middlewares/authGuard.test.js
 */

const firebase = require('../services/firebase');

let docFake = null; // { exists, data() } — controlado por teste, ou null pra simular doc ausente
let deveLancar = false;

firebase.db.collection = () => ({
    doc: () => ({
        get: async () => {
            if (deveLancar) throw new Error('falha simulada de Firestore');
            return docFake
                ? { exists: true, data: () => docFake }
                : { exists: false, data: () => ({}) };
        },
    }),
});

const { verificarSaldo, verificarSaldoBloggerAi } = require('./authGuard');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

function _req({ user, body }) {
    return { session: { user }, body: body || {} };
}

function _res() {
    const r = { statusCode: null, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (obj) => { r.body = obj; return r; };
    return r;
}

async function run() {
    // A. Sem sessão — 401.
    {
        const req = _req({ user: null });
        const res = _res();
        let nextChamado = false;
        await verificarSaldo(req, res, () => { nextChamado = true; });
        assert('sem sessão: 401', res.statusCode === 401);
        assert('sem sessão: next() não chamado', nextChamado === false);
    }

    // B. Assinante ativo, Gemini (model ausente = default), sem crédito — bloqueia.
    {
        docFake = { creditos: 0 };
        const req = _req({ user: { email: 'x@x.com', is_active: true } });
        const res = _res();
        let nextChamado = false;
        await verificarSaldo(req, res, () => { nextChamado = true; });
        assert('assinante ativo sem crédito Gemini: 402', res.statusCode === 402, JSON.stringify(res.body));
        assert('assinante ativo sem crédito Gemini: código SEM_CREDITOS', res.body?.codigo === 'SEM_CREDITOS');
        assert('assinante ativo sem crédito Gemini: next() NÃO chamado (bloqueio de verdade)', nextChamado === false);
    }

    // C. Assinante ativo, GPT (model="gpt-5.4"), sem crédito GPT — bloqueia, mensagem menciona GPT.
    {
        docFake = { creditos: 500, creditos_gpt: 0 }; // tem crédito Gemini, mas não de GPT
        const req = _req({ user: { email: 'x@x.com', is_active: true }, body: { model: 'gpt-5.4' } });
        const res = _res();
        let nextChamado = false;
        await verificarSaldo(req, res, () => { nextChamado = true; });
        assert('assinante ativo sem crédito GPT: 402', res.statusCode === 402);
        assert('assinante ativo sem crédito GPT: mensagem menciona GPT', res.body?.erro.includes('GPT'), JSON.stringify(res.body));
        assert('assinante ativo sem crédito GPT: next() NÃO chamado', nextChamado === false);
    }

    // D. Assinante ativo, GPT, mas com crédito Gemini positivo — não confunde os dois pools.
    {
        docFake = { creditos: 500, creditos_gpt: 0 };
        const req = _req({ user: { email: 'x@x.com', is_active: true }, body: { model: 'gemini-flash' } });
        const res = _res();
        let nextChamado = false;
        await verificarSaldo(req, res, () => { nextChamado = true; });
        assert('crédito Gemini positivo mesmo com GPT zerado: passa (pools não se confundem)', nextChamado === true, JSON.stringify(res.body));
    }

    // E. Assinante ativo, crédito positivo — passa.
    {
        docFake = { creditos: 100 };
        const req = _req({ user: { email: 'x@x.com', is_active: true } });
        const res = _res();
        let nextChamado = false;
        await verificarSaldo(req, res, () => { nextChamado = true; });
        assert('assinante ativo com crédito: next() chamado', nextChamado === true);
        assert('assinante ativo com crédito: sem resposta HTTP', res.statusCode === null);
    }

    // F. Assinante ativo, créditos expirados — bloqueia com código certo.
    {
        docFake = { creditos: 100, creditos_expira_em: new Date(Date.now() - 86400000).toISOString() };
        const req = _req({ user: { email: 'x@x.com', is_active: true } });
        const res = _res();
        let nextChamado = false;
        await verificarSaldo(req, res, () => { nextChamado = true; });
        assert('créditos expirados: 402 CREDITOS_EXPIRADOS', res.statusCode === 402 && res.body?.codigo === 'CREDITOS_EXPIRADOS', JSON.stringify(res.body));
        assert('créditos expirados: next() NÃO chamado', nextChamado === false);
    }

    // G. Assinante ativo, falha no Firestore — nunca bloqueia cliente pagante à toa (fail open).
    {
        deveLancar = true;
        const req = _req({ user: { email: 'x@x.com', is_active: true } });
        const res = _res();
        let nextChamado = false;
        await verificarSaldo(req, res, () => { nextChamado = true; });
        assert('falha de Firestore: next() chamado (fail open)', nextChamado === true, JSON.stringify(res.body));
        deveLancar = false;
    }

    // H. Assinante ativo, doc ausente no Firestore — fail open (sem dado, sem bloqueio).
    {
        docFake = null;
        const req = _req({ user: { email: 'x@x.com', is_active: true } });
        const res = _res();
        let nextChamado = false;
        await verificarSaldo(req, res, () => { nextChamado = true; });
        assert('doc ausente: next() chamado (fail open)', nextChamado === true);
    }

    // I. Usuário free (is_active=false) — comportamento antigo preservado (não é o que mudou aqui).
    {
        docFake = null; // snap.exists=false → deixa passar (doc recém-criado)
        const req = _req({ user: { email: 'x@x.com', is_active: false } });
        const res = _res();
        let nextChamado = false;
        await verificarSaldo(req, res, () => { nextChamado = true; });
        assert('free sem doc ainda: next() chamado', nextChamado === true);
    }

    // J. verificarSaldoBloggerAi — free/inativo: 403 PLANO_INSUFICIENTE (comportamento antigo preservado).
    {
        docFake = null;
        const req = _req({ user: { email: 'x@x.com', is_active: false, plano: 'free' } });
        const res = _res();
        let nextChamado = false;
        await verificarSaldoBloggerAi(req, res, () => { nextChamado = true; });
        assert('bloggerai free: 403 PLANO_INSUFICIENTE', res.statusCode === 403 && res.body?.codigo === 'PLANO_INSUFICIENTE', JSON.stringify(res.body));
        assert('bloggerai free: next() NÃO chamado', nextChamado === false);
    }

    // K. verificarSaldoBloggerAi — assinante ativo sem crédito bloggerai — bloqueia.
    {
        docFake = { creditos_bloggerai: 0 };
        const req = _req({ user: { email: 'x@x.com', is_active: true, plano: 'studio' } });
        const res = _res();
        let nextChamado = false;
        await verificarSaldoBloggerAi(req, res, () => { nextChamado = true; });
        assert('bloggerai sem crédito: 402 SEM_CREDITOS', res.statusCode === 402 && res.body?.codigo === 'SEM_CREDITOS', JSON.stringify(res.body));
        assert('bloggerai sem crédito: next() NÃO chamado (bloqueio de verdade)', nextChamado === false);
    }

    // L. verificarSaldoBloggerAi — assinante ativo com crédito — passa.
    {
        docFake = { creditos_bloggerai: 100 };
        const req = _req({ user: { email: 'x@x.com', is_active: true, plano: 'studio' } });
        const res = _res();
        let nextChamado = false;
        await verificarSaldoBloggerAi(req, res, () => { nextChamado = true; });
        assert('bloggerai com crédito: next() chamado', nextChamado === true, JSON.stringify(res.body));
    }

    // M. verificarSaldoBloggerAi — créditos expirados — bloqueia com código certo.
    {
        docFake = { creditos_bloggerai: 100, creditos_bloggerai_expira_em: new Date(Date.now() - 86400000).toISOString() };
        const req = _req({ user: { email: 'x@x.com', is_active: true, plano: 'studio' } });
        const res = _res();
        let nextChamado = false;
        await verificarSaldoBloggerAi(req, res, () => { nextChamado = true; });
        assert('bloggerai créditos expirados: 402 CREDITOS_EXPIRADOS', res.statusCode === 402 && res.body?.codigo === 'CREDITOS_EXPIRADOS', JSON.stringify(res.body));
        assert('bloggerai créditos expirados: next() NÃO chamado', nextChamado === false);
    }

    // N. verificarSaldoBloggerAi — falha no Firestore — fail open, nunca bloqueia cliente pagante à toa.
    {
        deveLancar = true;
        const req = _req({ user: { email: 'x@x.com', is_active: true, plano: 'studio' } });
        const res = _res();
        let nextChamado = false;
        await verificarSaldoBloggerAi(req, res, () => { nextChamado = true; });
        assert('bloggerai falha de Firestore: next() chamado (fail open)', nextChamado === true, JSON.stringify(res.body));
        deveLancar = false;
    }

    console.log(`\n${failed === 0 ? '✅' : '❌'} authGuard: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
}

run();

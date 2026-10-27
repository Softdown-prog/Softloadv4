'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

function loadRoute(file, dependencies, env = {}) {
    const routes = new Map();
    const guards = {
        exigirLogin(_req, _res, next) { return next(); },
        exigirSuperAdmin(_req, _res, next) { return next(); },
        verificarSaldo(_req, _res, next) { return next(); },
    };
    const limiter = (_req, _res, next) => next();
    const router = Object.fromEntries(['get', 'post', 'delete', 'use'].map(method => [method,
        (url, ...handlers) => routes.set(`${method} ${url}`, handlers)]));
    const filename = path.join(__dirname, file);
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        module, exports: module.exports, Buffer, URL, AbortSignal, Date,
        console: { log() {}, warn() {}, error() {} }, process: { env },
        require(id) {
            if (id === 'express') return { Router: () => router };
            if (id === 'express-rate-limit') return () => limiter;
            if (/middlewares\/(authGuard|adminGuard)$/.test(id)) return guards;
            if (['crypto', 'fs', 'os', 'path'].includes(id)) return require(id);
            const suffix = Object.keys(dependencies).find(key => id.endsWith(key));
            if (suffix) return dependencies[suffix];
            throw new Error(`Dependência não simulada: ${id}`);
        },
    }, { filename });
    return { routes, guards, limiter, router: module.exports };
}
function response() {
    return {
        statusCode: 200, headers: {},
        status(code) { this.statusCode = code; return this; },
        set(name, value) { this.headers[name] = value; return this; },
        setHeader(name, value) { this.headers[name] = value; },
        json(value) { this.body = value; }, send(value) { this.body = value; },
        render(value) { this.view = value; }, redirect(value) { this.location = value; },
    };
}
function request(body = {}) {
    return { body, query: {}, params: {}, headers: {}, protocol: 'https',
        get: () => 'https://softload.test',
        session: { user: { uid: 'session-uid', email: 'client@example.test', plano: 'pro' } } };
}
function last(harness, key) { return harness.routes.get(key).at(-1); }

function apiHarness({ approved = true, failTransaction = false } = {}) {
    const records = new Map([['clientes_premium/client@example.test', {
        email: 'client@example.test', nome: 'Cliente', plano_pendente: 'pro', creditos: 0,
    }]]);
    const calls = [];
    const snapshot = ref => ({ id: ref.id, ref, exists: records.has(ref.path), data: () => records.get(ref.path) });
    const doc = p => ({ id: p.split('/').at(-1), path: p,
        async get() { return snapshot(this); },
        async set(value) { records.set(p, { ...records.get(p), ...value }); },
        async update(value) { records.set(p, { ...records.get(p), ...value }); },
    });
    const db = {
        collection(name) { return {
            doc: id => doc(`${name}/${id}`),
            where() { return this; }, limit() { return this; },
            async get() { const docs = [...records.keys()].filter(p => p.startsWith(`${name}/`)).map(p => snapshot(doc(p))); return { docs, empty: !docs.length }; },
        }; },
        async runTransaction(fn) {
            calls.push('transaction');
            if (failTransaction) throw new Error('Firestore indisponível');
            const staged = [];
            const result = await fn({
                get: async ref => snapshot(ref),
                create: (ref, data) => staged.push([ref.path, data]),
                update: (ref, data) => staged.push([ref.path, { ...records.get(ref.path), ...data }]),
            });
            for (const [p, value] of staged) records.set(p, value);
            return result;
        },
        batch() { return { update() {}, async commit() {} }; },
    };
    const details = { status: 'approved', external_reference: 'client@example.test', currency_id: 'BRL', transaction_amount: approved ? 39.90 : 0.01 };
    const env = { NODE_ENV: 'production', MP_WEBHOOK_SECRET: 'test-only-secret', MP_ACCESS_TOKEN: 'test-only-token' };
    const dependencies = {
        'services/firebase': { db },
        'services/creditService': { PLAN_CREDITS: { pro: 100 }, GPT_PLAN_CREDITS: { pro: 20 }, BLOGGERAI_PLAN_CREDITS: { pro: 30 } },
        'services/mpPlanRules': require('../services/mpPlanRules'),
        'services/storageService': { STORAGE_LIMITS_MB: {} },
        'services/emailService': { async enviarPlanoAtivado(...args) { calls.push(['email', args]); } },
        mercadopago: {
            MercadoPagoConfig: class {},
            Payment: class { async get({ id }) { calls.push(['payment', id]); return details; } },
            Preference: class {},
        },
        'tools/projectStorage': {}, 'rag/ragLocalSearch': { buscarCatalogoLocal: async () => ({ query: '', resultados: [] }) },
        'codeCorpus/codeSearchService': {}, 'knowledge/ragNamespaces': {},
    };
    const harness = loadRoute('apiRoutes.js', dependencies, env);
    function signed() {
        const req = request({ type: 'payment', data: { id: '123' } });
        req.headers['x-request-id'] = 'request-1';
        const digest = crypto.createHmac('sha256', env.MP_WEBHOOK_SECRET).update('id:123;request-id:request-1;ts:1000;').digest('hex');
        req.headers['x-signature'] = `ts=1000,v1=${digest}`;
        return req;
    }
    return { ...harness, records, calls, env, signed };
}

test('webhook rejeita assinatura inválida e segredo ausente em produção antes de consultar o pagamento', async () => {
    const h = apiHarness();
    const handler = last(h, 'post /webhook/mercado-pago');
    const invalid = response();
    await handler(request({ type: 'payment', data: { id: '123' } }), invalid);
    assert.equal(invalid.statusCode, 403);
    const signed = h.signed();
    delete h.env.MP_WEBHOOK_SECRET;
    const missing = response();
    await handler(signed, missing);
    assert.equal(missing.statusCode, 403);
    assert.equal(h.calls.length, 0);
});

test('webhook assinado ativa os três saldos e recibo juntos, sem renovar em um retry', async () => {
    const h = apiHarness();
    const handler = last(h, 'post /webhook/mercado-pago');
    const first = response();
    await handler(h.signed(), first);
    assert.equal(first.statusCode, 200);
    const account = h.records.get('clientes_premium/client@example.test');
    assert.equal(account.plano, 'pro');
    assert.equal(account.creditos, 100);
    assert.equal(account.creditos_gpt, 20);
    assert.equal(account.creditos_bloggerai, 30);
    assert.equal(account.mp_payment_id, '123');
    assert.equal(h.records.get('softload_mp_payments/123').plan, 'pro');
    const second = response();
    await handler(h.signed(), second);
    assert.equal(second.statusCode, 200);
    assert.equal(h.records.get('clientes_premium/client@example.test').premium_ate, account.premium_ate);
    assert.equal(h.calls.filter(x => x[0] === 'email').length, 1);
});

test('webhook não concede plano para valor incorreto e retorna 500 para permitir retry após falha transacional', async () => {
    for (const options of [{ approved: false }, { failTransaction: true }]) {
        const h = apiHarness(options);
        const res = response();
        await last(h, 'post /webhook/mercado-pago')(h.signed(), res);
        assert.equal(res.statusCode, options.failTransaction ? 500 : 200);
        assert.equal(h.records.has('softload_mp_payments/123'), false);
        assert.equal(h.records.get('clientes_premium/client@example.test').creditos, 0);
        assert.equal(h.calls.filter(x => x[0] === 'email').length, 0);
    }
});

test('checkout mantém autenticação e rate limit, enquanto webhook preserva autenticação HMAC própria', () => {
    const h = apiHarness();
    for (const url of ['/dashboard/checkout-create', '/dashboard/payment/process']) {
        const handlers = h.routes.get(`post ${url}`);
        assert.equal(handlers[0], h.guards.exigirLogin);
        assert.equal(handlers[1], h.limiter);
    }
    assert.equal(h.routes.get('post /webhook/mercado-pago').length, 1);
});

function adminHarness() {
    const calls = [];
    const db = { collection(name) { return {
        async add(value) { calls.push(['log', value]); },
        doc(id) { return {
            async get() { return { exists: true, data: () => ({ is_active: false }) }; },
            async update(value) { calls.push(['update', name, id, value]); },
            async set(value) { calls.push(['set', name, id, value]); },
        }; },
    }; } };
    const deps = {
        'services/firebase': { db, admin: { firestore: { FieldValue: { serverTimestamp: () => 'server-time' } } } },
        'services/creditService': {
            PLAN_CREDITS: {}, async concederCreditos(...args) { calls.push(['grant', ...args]); },
            async concederCreditosBloggerAi(...args) { calls.push(['blogger', ...args]); },
        },
        'services/billingRecoveryMonitor': { obterStatusRecuperacaoCobrancas: () => ({ pending: 0 }) },
        'services/buildInfo': {}, 'compilerEngine/pecaOrchestrator': {}, 'ai/solAgent': {},
        'services/chatStorageService': {},
    };
    return { ...loadRoute('adminRoutes.js', deps), calls };
}

test('todas as rotas admin exigem superadmin e mantêm limite de chamadas', () => {
    const h = adminHarness();
    assert.equal(h.routes.get('use /eu')[0], h.limiter);
    for (const [key, handlers] of h.routes) {
        if (!key.startsWith('use ')) assert.equal(handlers[0], h.guards.exigirSuperAdmin, key);
    }
});

test('admin ativa plano e concede somente os serviços disponíveis; crédito negativo não escreve', async () => {
    const h = adminHarness();
    const req = request({ ativo: true, plano: 'pro' });
    req.params.email = 'CLIENT@example.test';
    const res = response();
    await last(h, 'post /eu/api/usuario/:email/premium')(req, res);
    assert.equal(res.body.plano, 'pro');
    assert.deepEqual(h.calls.find(x => x[0] === 'grant'), ['grant', 'client@example.test', 'pro']);
    assert.deepEqual(h.calls.find(x => x[0] === 'blogger'), ['blogger', 'client@example.test', 'pro']);
    const invalid = response();
    req.body = { gemini: '-1' };
    await last(h, 'post /eu/api/usuario/:email/creditos')(req, invalid);
    assert.equal(invalid.statusCode, 400);
    assert.equal(h.calls.some(x => x[0] === 'set'), false);
});

function solarisHarness() {
    const calls = [];
    class GithubOperationError extends Error {}
    const githubApp = { async status(uid) { calls.push(['status', uid]); return { connected: true }; } };
    const githubAgent = { async approve(uid) { calls.push(['approve', uid]); return { ok: true }; } };
    const noop = () => {};
    const deps = {
        multer: Object.assign(() => ({ single: () => noop }), { memoryStorage: noop }),
        'services/chatStorageService': {}, 'services/firebase': { db: {}, admin: {} },
        'services/creditService': {},
        'chat/solarisChat': { criarSolarisChat: () => ({}) },
        'chat/solarisGenerationTrigger': {},
        'pipeline/orchestrator': { criarOrquestrador: () => ({}) },
        'codeCorpus/codeSearchService': {},
        'llm/modelRouter': { criarModelRouter: () => ({}) },
        'services/aiBudgetLedger': { criarLivroRazaoIa: () => ({}) },
        'services/aiBudgetGeminiClient': {},
        'services/aiCreditsV2Mode': { criarGateCreditosSolarisV2: () => noop },
        'services/aiCreditsV2Http': { criarHandlerResumoCreditosV2: () => noop, criarHandlerHistoricoCreditosV2: () => noop },
        'services/solarisGithubApp': { createGithubAppService: () => githubApp },
        'services/solarisGithubOperations': { GithubOperationError, createGithubOperations: () => ({ async execute(uid, input) { calls.push(['execute', uid, input.action]); return {}; } }) },
        'services/solarisGithubAgent': { createSolarisGithubAgent: () => githubAgent },
        'services/solarisGithubMcp': {}, 'services/solarisGithubReadiness': {}, 'tools/solarisToolModes': {},
        '@google/genai': {}, 'services/agentBridge': {}, 'pipeline/projectInspector': {},
        'pipeline/projectEditor': {}, 'tools/fileTools': {}, 'tools/archiveExtractClient': {},
        'tools/frameworkDetector': {}, 'tools/projectStorage': {},
        'http/solarisChatHandler': { criarHandlerChatSolaris: () => noop },
        'http/solarisProUsage': {}, 'http/solarisUploadHandler': { criarHandlerUploadSolaris: () => noop },
        'visual/visualReview': { criarHandlerVisual: () => noop }, 'visual/browserReadiness': {},
    };
    return { ...loadRoute('dashboard_routes/solaris.js', deps, { BASE_URL: 'https://softload.test' }), calls };
}

test('Solaris mantém login em todas as rotas e origem obrigatória antes de ação/aprovação', () => {
    const h = solarisHarness();
    for (const [key, handlers] of h.routes) assert.equal(handlers[0], h.guards.exigirLogin, key);
    for (const url of ['/dashboard/solaris/github/action', '/dashboard/solaris/github/approve']) {
        const handlers = h.routes.get(`post ${url}`);
        const res = response();
        const req = request();
        req.get = () => 'https://foreign.test';
        let allowed = false;
        handlers[2](req, res, () => { allowed = true; });
        assert.equal(res.statusCode, 403);
        assert.equal(allowed, false);
    }
});

test('Solaris bloqueia gravação direta mesmo com confirm:true; leitura e aprovação usam o UID da sessão', async () => {
    const h = solarisHarness();
    const action = last(h, 'post /dashboard/solaris/github/action');
    const blocked = response();
    await action(request({ action: 'file_commit', confirm: true }), blocked);
    assert.equal(blocked.statusCode, 403);
    assert.equal(h.calls.length, 0);
    const read = response();
    await action(request({ action: 'file_read', uid: 'forged-uid' }), read);
    assert.equal(read.statusCode, 200);
    assert.deepEqual(h.calls[0], ['execute', 'session-uid', 'file_read']);
    const approved = response();
    await last(h, 'post /dashboard/solaris/github/approve')(request({ uid: 'forged-uid', content: 'forged' }), approved);
    assert.deepEqual(h.calls[1], ['approve', 'session-uid']);
    assert.equal(approved.body.ok, true);
    assert.equal(h.router.SOLARIS_CHAT_SESSION_TYPE, 'solaris-chat');
});

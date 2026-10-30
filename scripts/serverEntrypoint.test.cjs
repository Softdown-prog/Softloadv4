'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function fixture({ valid = true } = {}) {
    const routes = new Map(), middlewares = [], calls = [], rows = new Map(), handlers = {}, timers = [];
    const state = { failGet: false, failSet: false, files: [], ping: 0, store: null, monitor: null, listener: null, env: { SESSION_SECRET: 'fake-private-session-secret', NODE_ENV: 'production' } };
    const exit = code => { throw Object.assign(Error('fake exit'), { exitCode: code }); };
    const app = { set(name, value) { calls.push(['setting', name, value]); }, use(...args) { middlewares.push(args); },
        get(route, callback) { routes.set(route, callback); }, listen(port, host, callback) { state.listener = { port, host, callback }; } };
    const express = Object.assign(() => app, { urlencoded: options => ({ urlencoded: options }), json: () => ({ json: true }),
        static(root, options) { state.static = { root, options }; return { static: true }; } });
    const session = Object.assign(options => { state.session = options; state.store = options.store; return { session: true }; }, { Store: class {} });
    const db = { collection(name) { assert.equal(name, 'sessions'); return {
        doc(id) { return {
            async get() { if (state.failGet) throw Error('fake read failure'); return { exists: rows.has(id), data: () => rows.get(id) }; },
            async set(data) { if (state.failSet) throw Error('fake write failure'); rows.set(id, data); },
            async delete() { rows.delete(id); },
        }; },
        limit(n) { assert.equal(n, 1); return { async get() { state.ping++; } }; },
    }; } };
    const mod = { exports: {} };
    const context = { module: mod, exports: mod.exports, __dirname: path.join(__dirname, '..'), console: { log() {}, warn() {}, error() {} },
        process: { env: state.env, on(name, callback) { handlers[name] = callback; }, exit },
        setInterval(callback, delay) { const timer = { callback, delay, unref() { calls.push(['unref']); } }; timers.push(timer); return timer; },
        clearInterval(timer) { calls.push(['clear', timer]); },
        fetch: async (url, options) => { calls.push(['fetch', url, options]); return { ok: true }; }, AbortSignal: { timeout: ms => ({ ms }) }, URL,
        require(id) {
            if (id === 'express') return express;
            if (id === 'path') return path;
            if (id === 'dotenv') return { config() {} };
            if (id === './src/services/envBoot') return { validarEnvBoot: () => ({ ok: valid, faltandoObrigatorias: valid ? [] : ['SESSION_SECRET'], faltandoOpcionais: [] }) };
            if (id === './src/services/firebase') return { db, bucket: { async getFiles(options) { assert.equal(options.maxResults, 26); return [state.files]; } } };
            if (id === 'express-session') return session;
            if (id === './src/middlewares/security') return { helmetMiddleware: 'helmet', corsMiddleware: 'cors' };
            if (id.startsWith('./src/routes/')) return { router: id };
            if (id === './src/services/sentinelWorker') return { start(ms) { calls.push(['sentinel:start', ms]); }, stop() { calls.push(['sentinel:stop']); }, getStatus: () => ({ healthScore: 100 }) };
            if (id === './src/services/errorLogWorker') return { start() { calls.push(['errors:start']); } };
            if (id === './src/services/buildInfo') return { gitSha: 'tested-sha', gitDate: null, buildTime: null };
            if (id === './src/services/creditService') return { recuperarCobrancasPendentes: async () => ({ processadas: 0, falhas: 0 }) };
            if (id === './src/services/workspaceCreditReservations') return { async recuperarReservasWorkspace() { calls.push(['workspace:recover']); return { recuperadas: 0, falhas: 0 }; } };
            if (id === './src/services/billingRecoveryMonitor') return {
                criarMonitorRecuperacaoCobrancas(options) { state.monitor = options; return { executar: async () => ({ estado: 'ok', processadas: 0, falhas: 0, falhasConsecutivas: 0, quantidadeAmostrada: 0, alertaAtivo: false }) }; },
                definirMonitorRecuperacaoCobrancas() {},
            };
            if (id === './scripts/vendorCachePolicy') return { setPublicStaticHeaders: (...args) => calls.push(['static:headers', ...args]) };
            throw Error('External service forbidden: ' + id);
        },
    };
    let stopped; try { vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8'), context); } catch (error) { if (error.exitCode === undefined) throw error; stopped = error.exitCode; }
    return { state, routes, middlewares, calls, rows, handlers, timers, stopped };
}
const response = () => ({ headers: {}, locals: {}, statusCode: 200, set(name, value) { this.headers[name] = value; },
    setHeader(name, value) { this.headers[name] = value; }, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }, render(view) { this.view = view; return this; }, redirect(code, target) { this.statusCode = code; this.target = target; } });

test('boot rejects invalid environment before loading services or listening', () => {
    const f = fixture({ valid: false }); assert.equal(f.stopped, 1); assert.equal(f.state.listener, null); assert.equal(f.state.store, null);
});

test('boot preserves middleware order, secure cookies, static cache and dynamic no-store', () => {
    const f = fixture(); assert.equal(f.middlewares[0][0], 'helmet'); assert.equal(f.middlewares[1][0], 'cors');
    assert.equal(f.state.session.cookie.secure, true); assert.equal(f.state.session.cookie.httpOnly, true); assert.equal(f.state.session.cookie.sameSite, 'lax');
    assert.equal(f.state.session.saveUninitialized, false); assert.equal(f.state.static.options.immutable, true);
    const res = response(), req = { path: '/dashboard', get: () => '', session: { user: { uid: 'u' } } };
    for (const [handler] of f.middlewares) if (typeof handler === 'function' && handler.length === 3) handler(req, res, () => {});
    assert.equal(res.headers['Cache-Control'], 'no-store'); assert.equal(res.locals.gitSha, 'tested-sha'); assert.equal(res.locals.user.uid, 'u');
    assert.equal(f.state.listener.host, '0.0.0.0');
});

test('session store round-trips JSON, expires records, fails closed on reads and propagates write errors', async () => {
    const f = fixture(), store = f.state.store;
    await store.set('a', { user: { uid: 'u' }, cookie: { expires: new Date(Date.now() + 100000) }, remove: undefined }, error => assert.equal(error, null));
    assert.equal(typeof f.rows.get('a').sess.cookie.expires, 'string'); assert.equal('remove' in f.rows.get('a').sess, false);
    await store.get('a', (error, value) => { assert.equal(error, null); assert.equal(value.user.uid, 'u'); });
    f.rows.set('expired', { sess: {}, expires: Date.now() - 100 });
    await store.get('expired', (error, value) => assert.equal(value, null)); assert.equal(f.rows.has('expired'), false);
    f.state.failGet = true; await store.get('a', (error, value) => { assert.equal(error, null); assert.equal(value, null); });
    f.state.failSet = true; await store.set('a', {}, error => assert.match(error.message, /write failure/));
    await store.destroy('a', error => assert.equal(error, null)); assert.equal(f.rows.has('a'), false);
});

test('health exposes booleans and revision without secrets; global errors keep generic responses', async () => {
    const f = fixture(), res = response(); await f.routes.get('/health')({}, res);
    assert.equal(res.body.deploy.gitSha, 'tested-sha'); assert.equal(res.body.envs.SESSION_SECRET, true); assert.equal(res.body.firestore, true);
    assert.ok(!JSON.stringify(res.body).includes(f.state.env.SESSION_SECRET));
    const handler = f.middlewares.map(args => args[0]).find(x => typeof x === 'function' && x.length === 4);
    const api = response(); handler({ message: 'private internal error', status: 503 }, { path: '/api/test', get: () => '' }, api, () => {});
    assert.equal(api.statusCode, 503); assert.doesNotMatch(JSON.stringify(api.body), /private internal/);
    const html = response(); handler({ message: 'failure' }, { path: '/dashboard', get: () => '' }, html, () => {});
    assert.equal(html.statusCode, 500); assert.equal(html.view, 'pages/404');
});

test('only the operational monitor starts and stops; no retired billing jobs', () => {
  const f = fixture(); f.state.listener.callback();
  assert.ok(f.calls.some(x => x[0] === 'sentinel:start' && x[1] === 60000));
  assert.equal(f.state.monitor, null); assert.equal(f.timers.length, 0);
  assert.throws(() => f.handlers.SIGTERM(), error => error.exitCode === 0);
  assert.ok(f.calls.some(x => x[0] === 'sentinel:stop'));
});

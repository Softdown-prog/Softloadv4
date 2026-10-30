'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, 'authRoutes.js'), 'utf8');

function harness({ identity = {}, record = {}, resetReject = null } = {}) {
    const routes = new Map(), limiters = [], redirects = [], rendered = [], writes = [], emails = [], sessions = [], providerRequests = [];
    const user = { email: 'person@example.com', nome: 'Pessoa', plano: 'pro', is_active: true, premium_ate: '2028-01-01T00:00:00.000Z', ...record };
    const ref = {
        async update(fields) { Object.assign(user, fields); writes.push(['update', fields]); },
        async set(fields) { writes.push(['set', fields]); },
        async get() { return { exists: true, data: () => user }; },
    };
    const collection = {
        where(key, op, value) { assert.equal(key, 'email'); assert.equal(op, '=='); return { limit(count) { assert.equal(count, 1); return { async get() { return { empty: false, docs: [{ ref, data: () => user }] }; } }; } }; },
        doc(id) { assert.equal(id, 'person@example.com'); return ref; },
    };
    const firebase = {
        db: { collection(name) { assert.equal(name, 'clientes_premium'); return collection; } },
        admin: { auth() { return { async generatePasswordResetLink(email, options) { if (resetReject) throw resetReject; assert.equal(email,'person@example.com'); assert.match(options.url,/\/login$/); return 'https://example.com/reset-token'; } }; } }
    };
    const rateLimit = opts => { limiters.push(opts); return (req, res) => opts.handler(req, res); };
    const mailer = {
        enviarBoasVindas: async (...args) => emails.push(['welcome', ...args]),
        enviarRecuperacaoSenha: async (...args) => emails.push(['reset', ...args])
    };
    const fakeRouter = {
        get(url, ...handlers) { routes.set('GET ' + url, handlers); },
        post(url, ...handlers) { routes.set('POST ' + url, handlers); },
    };
    const module = { exports: {} };
    const fetch = async (url, options) => { providerRequests.push({ url, options }); const action = url.includes('signUp') ? 'signUp' : 'signIn'; const data = identity[action] || { ok: true, body: { localId: 'firebase-uid' } }; return { ok: data.ok, json: async () => data.body }; };
    vm.runInNewContext(code, {
        require(mod) { if (mod === 'express') return { Router: () => fakeRouter }; if (mod === 'express-rate-limit') return rateLimit; if (mod === '../services/firebase') return firebase; if (mod === '../services/emailService') return mailer; throw Error('Unexpected require ' + mod); },
        module, exports: module.exports, fetch, process: { env: { FIREBASE_API_KEY: 'test-only', BASE_URL: 'https://softload.example' } }, console: { log() {}, warn() {}, error() {} }, Date, setTimeout,
    }, {filename: 'authRoutes.js', timeout: 1500});
    function request(body = {}, extraSession = {}) {
        const session = { user: undefined, save(cb) { sessions.push('saved'); cb(null); }, destroy(cb) { sessions.push('destroyed'); cb(null); }, ...extraSession };
        return { body, session };
    }
    function response() { return { redirect(url) { redirects.push(url); }, render(view) { rendered.push(view); } }; }
    async function invoke(method, url, req, res = response()) { const handlers = routes.get(method + ' ' + url); assert.ok(handlers, method + ' ' + url); return handlers[handlers.length - 1](req, res); }
    return { routes, limiters, redirects, rendered, writes, emails, sessions, providerRequests, ref, user, invoke, request, response };
}

test('rotas GET renderizam EJS simples e bloqueiam usuário autenticado', async () => {
    const h=harness();
    for (const p of ['/login', '/register', '/recover']) {
        await h.invoke('GET',p,h.request());
        await h.invoke('GET',p,h.request({}, { user: {email: 'person@example.com'}}));
    }
    assert.deepEqual(h.rendered,['pages/auth-simples','pages/auth-simples','pages/auth-simples']);
    assert.deepEqual(h.redirects,['/dashboard','/dashboard','/dashboard']);
    assert.deepEqual(h.limiters.map(x=>x.max),[10,5,5]);
    assert.deepEqual(h.limiters.map(x=>x.windowMs),[900000,3600000,900000]);
});

test('cadastro mantém créditos free e e-mail assíncrono sem exibir senha', async () => {
    const h=harness();
    await h.invoke('POST','/register',h.request({name: 'Pessoa',email:'person@example.com',password:'secret'}));
    assert.equal(h.providerRequests.length,1);
    assert.ok(h.providerRequests[0].url.includes(':signUp?key=test-only'));
    assert.equal(h.writes[0][0],'set');
    assert.equal(Object.hasOwn(h.writes[0][1], 'creditos'), false);
    assert.equal(h.writes[0][1].plano,'free');
    assert.equal(h.writes[0][1].uid,'firebase-uid');
    assert.deepEqual(h.emails,[['welcome','person@example.com','Pessoa']]);
    assert.match(h.redirects[0],/^\/login\?sucesso=/);
});

test('cadastro e login rejeitados não salvam sessão nem escrevem no Firestore', async () => {
    const h=harness({identity:{signUp:{ok:false,body:{error:{message:'EMAIL_EXISTS'}}},signIn:{ok:false,body:{error:{message:'INVALID_PASSWORD'}}}}});
    await h.invoke('POST','/register',h.request({name:'Pessoa',email:'person@example.com',password:'x'}));
    await h.invoke('POST','/login',h.request({email:'person@example.com',password:'x'}));
    assert.equal(h.writes.length,0); assert.equal(h.sessions.length,0);assert.equal(h.emails.length,0);
    assert.match(h.redirects[0],/Este%20e-mail%20j%C3%A1/);
    assert.equal(h.redirects[1],'/login?erro=E-mail ou senha incorretos.');
});

test('login salva sessão com perfil e rebaixa assinatura vencida', async () => {
    const h=harness({record:{premium_ate:'2020-01-01T00:00:00.000Z'}});
    const req=h.request({email:'person@example.com',password:'secret'});
    await h.invoke('POST','/login',req);
    assert.equal(req.session.user.uid,'firebase-uid');
    assert.equal(req.session.user.plano,'free');
    assert.equal(req.session.user.is_active,false);
    assert.equal(h.writes.length,1);
    assert.equal(h.writes[0][1].status,'pendente');
    assert.deepEqual(h.sessions,['saved']);
    assert.deepEqual(h.redirects,['/dashboard']);
});

test('falha de persistência de sessão retorna login sem autenticar resposta',async()=>{
    const h=harness();
    const req=h.request({email:'person@example.com',password:'secret'},{save:cb=>cb(new Error('offline'))});
    await h.invoke('POST','/login',req);
    assert.equal(h.redirects[0],'/login?erro=Erro ao criar sessão. Tente novamente.');
});

test('recuperação não enumera e-mails e mantém resposta genérica',async()=>{
    const h=harness({resetReject:Object.assign(new Error('no user'),{code:'USER_NOT_FOUND'})});
    await h.invoke('POST','/recover',h.request({email:'PERSON@example.com'}));
    assert.deepEqual(h.emails,[]);
    assert.equal(h.redirects[0],'/recover?sucesso=Se o e-mail existir, o link foi enviado.');
    const h2=harness();
    await h2.invoke('POST','/recover',h2.request({email:' person@example.com '}));
    assert.equal(h2.emails[0][0],'reset');
    assert.equal(h2.emails[0][1],'person@example.com');
    assert.equal(h2.redirects[0],'/recover?sucesso=Se o e-mail existir, o link foi enviado.');
});

test('logout destrói sessão e redireciona',async()=>{
    const h=harness();
    await h.invoke('GET','/logout',h.request());
    assert.deepEqual(h.sessions,['destroyed']);
    assert.match(h.redirects[0],/^\/login\?sucesso=/);
});

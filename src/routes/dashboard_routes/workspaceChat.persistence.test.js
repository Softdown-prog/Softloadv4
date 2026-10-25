'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createHarness({ failSave = false, delaySave = null, delayDebit = null } = {}) {
    const routes = { get: new Map(), post: new Map() };
    const calls = [];
    const router = {
        get(url, ...handlers) { routes.get.set(url, handlers.at(-1)); },
        post(url, ...handlers) { routes.post.set(url, handlers.at(-1)); },
    };
    const sessionDocument = {
        async get() { return { exists: true, data: () => ({ snapshot: null, chatSessionId: 'chat-1' }) }; },
        async update(value) { calls.push(['link', value]); },
    };
    const db = {
        collection(name) {
            assert.equal(name, 'clientes_premium');
            return {
                doc() {
                    return {
                        async get() {
                            return { exists: true, data: () => ({ creditos: 30, creditos_ciclo_total: 50 }) };
                        },
                        collection(child) {
                            assert.notEqual(child, 'chats', 'não restaurar chat de coleção Firestore legada');
                            assert.equal(child, 'projetos');
                            return {
                                doc() {
                                    return {
                                        collection(n) {
                                            assert.equal(n, 'sessoes');
                                            return { doc: () => sessionDocument };
                                        },
                                    };
                                },
                            };
                        },
                    };
                },
            };
        },
    };
    const storage = {
        newSessionId: () => 'chat-1',
        async loadSession(...args) {
            calls.push(['load', args]);
            return { messages: [{ role: 'assistant', content: 'mensagem persistida no GCS' }] };
        },
        async saveSession(...args) {
            if (delaySave) await delaySave;
            calls.push(['save', args]);
            if (failSave) throw new Error('GCS indisponível');
            return { messages: args[3].messages };
        },
        async updateMemoryFromSession() { calls.push(['memory']); },
    };
    const mockRequire = (id) => {
        if (id === 'express') return { Router: () => router };
        if (id.endsWith('middlewares/authGuard')) {
            return { exigirLogin() {}, exigirPlanoStudio() {}, verificarSaldo() {} };
        }
        if (id.endsWith('chatStorageService')) return storage;
        if (id.endsWith('services/firebase')) {
            return { db, admin: { firestore: { FieldValue: {
                serverTimestamp: () => 'server-time',
                delete: () => 'deleted',
            } } } };
        }
        if (id.endsWith('services/creditService')) {
            return {
                PLAN_CREDITS: { free: 0, studio: 50 },
                async debitarCreditos(...args) {
                    if (delayDebit) await delayDebit;
                    calls.push(['debit', args]);
                },
            };
        }
        if (id.endsWith('chat/chatEditFlow')) return { processarEdicaoDeTemplate() { throw Error('sem edição'); } };
        if (id.endsWith('chat/chatGenerationFlow')) {
            return { async gerarComPossivelTemplate({ sendEvent }) {
                sendEvent({ type: 'chunk', text: 'Resposta gerada' });
                return { fullText: 'Resposta gerada', novoSnapshot: null };
            } };
        }
        if (id.endsWith('chat/chatHistory')) return { montarHistoricoSeguro: () => [] };
        if (id.endsWith('services/storageService')) return { carregarManifesto: async () => null };
        throw new Error('Require não simulado: ' + id);
    };
    const filename = path.join(__dirname, 'workspaceChat.js');
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        module,
        exports: module.exports,
        require: mockRequire,
        Date, console: { warn() {}, error() {} },
        process: { env: {} },
    }, { filename });
    return { routes, calls };
}

const fakeReq = (body = {}) => ({
    session: { user: { uid: 'uid-1', email: 'cliente@example.test', plano: 'studio' } },
    query: { wsSession: 'ws-1', projeto: 'project-1' },
    body: {
        message: 'Criar template', history: [], sessionId: 'chat-1',
        wsSessionId: 'ws-1', wsProjetoId: 'project-1', ...body,
    },
});
function fakeResponse(events) {
    return {
        setHeader() {},
        flushHeaders() {},
        status() { return this; },
        json(value) { this.payload = value; return this; },
        write(text) {
            const event = JSON.parse(text.slice(6).trim());
            events.push(event.type === 'done' ? ['done', event] : ['event', event]);
        },
        end() { events.push(['end']); },
    };
}

test('GET info carrega mensagens do serviço GCS, não do Firestore chats', async () => {
    const { routes, calls } = createHarness();
    const events = [];
    const res = fakeResponse(events);
    await routes.get.get('/api/workspace/chat/info')(fakeReq(), res);
    assert.equal(res.payload.messages[0].content, 'mensagem persistida no GCS');
    assert.equal(res.payload.sessionId, 'chat-1');
    assert.equal(res.payload.creditosGemini, 30);
    assert.deepEqual(calls[0], ['load', ['uid-1', 'workspace-chat', 'chat-1']]);
});

test('SSE done aguarda gravação, vínculo no Workspace e débito de créditos', async () => {
    let releaseSave, releaseDebit;
    const saveGate = new Promise(resolve => { releaseSave = resolve; });
    const debitGate = new Promise(resolve => { releaseDebit = resolve; });
    const { routes, calls } = createHarness({ delaySave: saveGate, delayDebit: debitGate });
    const events = [];
    const response = fakeResponse(events);
    const handling = routes.post.get('/dashboard/workspace/chat/stream')(fakeReq(), response);

    await new Promise(resolve => setImmediate(resolve));
    assert.equal(events.some(e => e[0] === 'done' || e[0] === 'end'), false);
    releaseSave();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(events.some(e => e[0] === 'done' || e[0] === 'end'), false);
    releaseDebit();
    await handling;

    assert.deepEqual(calls.filter(e => ['save', 'link', 'debit'].includes(e[0])).map(e => e[0]),
        ['save', 'link', 'debit']);
    assert.equal(calls.find(e => e[0] === 'link')[1].chatSessionId, 'chat-1');
    assert.deepEqual(events.slice(-2).map(e => e[0]), ['done', 'end']);
    assert.equal(events.at(-2)[1].reply, 'Resposta gerada');
});

test('falha no GCS não bloqueia cobrança nem finge que o histórico foi salvo', async () => {
    const { routes, calls } = createHarness({ failSave: true });
    const events = [];
    await routes.post.get('/dashboard/workspace/chat/stream')(fakeReq(), fakeResponse(events));
    assert.equal(calls.some(e => e[0] === 'debit'), true);
    assert.equal(calls.some(e => e[0] === 'link'), false);
    const done = events.find(e => e[0] === 'done')[1];
    assert.match(done.reply, /não consegui salvar esta conversa no histórico/);
    assert.equal(events.at(-1)[0], 'end');
});

test('modo edição também aguarda o débito antes de concluir', () => {
    const edit = fs.readFileSync(path.join(__dirname, 'chat/chatEditFlow.js'), 'utf8');
    assert.match(edit, /await debitarCreditos\(user\.email, tokens\.input, tokens\.output\)/);
});

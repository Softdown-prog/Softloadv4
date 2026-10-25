'use strict';
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { RemoteAgent, _taskParaAcao, _lerAutorizacao } = require('./agentBridge');
const previous = { ...process.env };
afterEach(() => { process.env = { ...previous }; });

test('ação desconhecida ou tipo inválido é recusado antes de transmitir', () => {
    for (const task of [null, {}, { type: 'unknown.execute' }, { type: 'file' }, { type: '' }]) {
        assert.throws(() => _taskParaAcao(task), /Worker Agent/);
    }
    assert.equal(_taskParaAcao({ type: 'code.search', query: 'x' }).capability, 'code-search');
    assert.equal(_taskParaAcao({ type: 'web.fetch', url: 'https://example.test' }).capability, 'web-fetch');
    assert.equal(_lerAutorizacao({ get(name) { assert.equal(name, 'authorization'); return 'Bearer fixture'; } }), 'Bearer fixture');
});

test('agent não iniciado ou com URL ausente falha sem enviar dados ao worker', async () => {
    let calls = 0;
    const agent = new RemoteAgent({ fetchImpl: async () => { calls++; throw Error('não deveria chamar'); } });
    await assert.rejects(() => agent.execute({type:'file.read'}), /não foi iniciado/);
    await agent.start();
    delete process.env.WORKER_AGENT_SERVICE_URL;
    await assert.rejects(() => agent.execute({type:'file.read'}), /não configurada/);
    assert.equal(calls, 0);
    await agent.stop();
});

test('erro HTTP ou resposta sem action correspondente não é aceito como sucesso', async () => {
    process.env.WORKER_AGENT_SERVICE_URL = 'https://worker.test/';
    delete process.env.WORKER_AGENT_IAM_AUTH;
    for (const response of [
        { ok: false, status: 502, json: async () => ({ error: 'unavailable' }) },
        { ok: true, status: 200, json: async () => ({ results: [{ actionId: 'other' }] }) },
    ]) {
        const agent = new RemoteAgent({ fetchImpl: async () => response });
        await agent.start();
        await assert.rejects(() => agent.execute({ type:'file.list' }), /Worker Agent/);
    }
});

'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { RemoteAgent, _taskParaAcao } = require('./agentBridge');

let envOriginal;
beforeEach(() => {
    envOriginal = { ...process.env };
    process.env.WORKER_AGENT_SERVICE_URL = 'https://worker-agent.exemplo.internal';
    process.env.WORKER_SHARED_SECRET = 'segredo-teste';
});
afterEach(() => { process.env = envOriginal; });

test('_taskParaAcao converte task interna para o protocolo HTTP do Worker', () => {
    assert.deepEqual(_taskParaAcao({ type: 'file.edit', path: 'a.txt', oldString: 'a', newString: 'b', replaceAll: true }, 'a1'), {
        id: 'a1', capability: 'filesystem', operation: 'edit',
        input: { path: 'a.txt', old_string: 'a', new_string: 'b', replace_all: true },
    });
});

test('RemoteAgent chama POST /run com segredo e retorna o resultado da action', async () => {
    const chamadas = [];
    const agent = new RemoteAgent({
        fetchImpl: async (url, opcoes) => {
            chamadas.push({ url, opcoes });
            const action = JSON.parse(opcoes.body).actions[0];
            return { ok: true, status: 200, json: async () => ({ results: [{ actionId: action.id, ok: true, taskType: 'file.read', result: { content: 'ok' } }] }) };
        },
        idGenerator: (() => { let i = 0; return () => `id-${++i}`; })(),
    });
    await agent.start();
    const resultado = await agent.execute({ type: 'file.read', path: 'README.md' });
    assert.equal(resultado.ok, true);
    assert.equal(chamadas[0].url, 'https://worker-agent.exemplo.internal/run');
    assert.equal(chamadas[0].opcoes.headers['x-worker-secret'], 'segredo-teste');
    assert.deepEqual(JSON.parse(chamadas[0].opcoes.body).actions[0], {
        id: 'id-1', capability: 'filesystem', operation: 'read', input: { path: 'README.md' },
    });
});

test('RemoteAgent envia ID token quando WORKER_AGENT_IAM_AUTH está ativada', async () => {
    process.env.WORKER_AGENT_IAM_AUTH = 'true';
    let headers;
    const agent = new RemoteAgent({
        fetchImpl: async (_url, opcoes) => {
            headers = opcoes.headers;
            const action = JSON.parse(opcoes.body).actions[0];
            return { ok: true, status: 200, json: async () => ({ results: [{ actionId: action.id, ok: true }] }) };
        },
        obterTokenIdentidade: async () => 'Bearer token-de-teste',
    });
    await agent.start();
    await agent.execute({ type: 'file.list' });
    assert.equal(headers.Authorization, 'Bearer token-de-teste');
});

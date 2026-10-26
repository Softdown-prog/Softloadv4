'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const filename = path.join(__dirname, 'ragAgent.js');
function load(responses = []) {
    const calls = [], reads = [];
    const mod = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        module: mod, exports: mod.exports, __dirname,
        process: { env: { GEMINI_API_KEY: 'fake-key-for-local-tests', RAG_AGENT_BUDGET: '10000' } },
        console: { warn() {} },
        require(id) {
            if (id === 'node:path') return path;
            if (id === 'node:fs') return { readFileSync(file) { reads.push(file); return '{"fixture":true}'; } };
            if (id === '@google/genai') return {
                HarmCategory: {}, HarmBlockThreshold: {},
                GoogleGenAI: class { constructor() { this.chats = { create(config) {
                    calls.push({ config });
                    return { async sendMessage(input) {
                        calls.push(input);
                        if (!responses.length) throw Error('Unexpected model call');
                        return responses.shift();
                    } };
                } }; } },
            };
            throw Error('Unexpected dependency: ' + id);
        },
    }, { filename });
    return { api: mod.exports, calls, reads };
}
const reply = parts => ({ candidates: [{ content: { parts } }], usageMetadata: { totalTokenCount: 23 } });

test('shared budget obeys caller-supplied tool limit, reports usage and file estimates', () => {
    const { api } = load();
    const budget = new api.TokenBudget(2000, 2);
    budget.track(1200, 'fixture');
    assert.equal(budget.remaining(), 800);
    assert.equal(budget.canLoadFile(), true);
    budget.toolCalls = 2;
    assert.equal(budget.isExhausted(), true);
    assert.equal(budget.canLoadFile(), false);
    assert.equal(budget.summary().toolCallsMaximos, 2);
    assert.equal(budget.summary().tokensPorcentagem, '60.0%');
});

test('schema validates required enums, module lists and scalar fields', () => {
    const { api } = load();
    const schema = {
        headerStyle: 'sticky', menuType: 'simple', sidebarPosition: 'right', heroSection: 'none',
        gridLayout: 'lista', paginationStyle: 'classic-numbers', commentSystem: 'blogger-native',
        colorPreset: 'tech-blue', darkMode: 'disabled', typography: 'inter', elementRadius: 'rounded',
        footerStyle: 'simple-copyright', siteName: 'Fixture', postModules: [], coreFeatures: [], adSlots: false,
    };
    assert.equal(api.validateTemplateSchema(JSON.stringify(schema)).valid, true);
    assert.equal(api.validateTemplateSchema('{').valid, false);
    const invalid = api.validateTemplateSchema(JSON.stringify({ ...schema, menuType: 'unknown',
        postModules: ['unknown'], coreFeatures: false, siteName: 'x', adSlots: 'true' }));
    assert.equal(invalid.valid, false);
    assert.equal(invalid.erros.length, 5);
});

test('tool response preserves transport envelope, isolates filesystem reads and reports budget', async () => {
    const { api, calls, reads } = load([
        reply([{ functionCall: { name: 'rag_load_file', args: { arquivo: 'fixture.json' } } }]),
        reply([{ text: 'Resposta simulada' }]),
    ]);
    const result = await api.agenticChat([{ role: 'assistant', content: 'Anterior' }], 'Pergunta', 'System');
    assert.equal(result.resposta, 'Resposta simulada');
    assert.equal(result.iteracoes, 1);
    assert.equal(reads.length, 1);
    assert.equal(reads[0], path.join(__dirname, 'fixture.json'));
    assert.equal(result.budget.toolCallsTotal, 1);
    assert.deepEqual(Array.from(result.budget.ficheirosCarregados), ['fixture.json']);
    assert.equal(calls[0].config.history[0].role, 'model');
    const envelope = calls[2].message[0];
    assert.equal(envelope.role, 'user');
    assert.equal(envelope.parts[0].functionResponse.name, 'rag_load_file');
    assert.equal(envelope.parts[0].functionResponse.response.conteudo.fixture, true);
});

test('insufficient remaining tokens block the file load before any filesystem read', async () => {
    const { api, reads } = load([
        reply([{ functionCall: { name: 'rag_load_file', args: { arquivo: 'fixture.json' } } }]),
        reply([{ text: 'Resposta' }]),
    ]);
    // A small remaining balance refuses a file, while still allowing the model
    // to receive the refusal and answer without a filesystem or API dependency.
    const result = await api.agenticChat([], 'Pergunta', '', { budgetTokens: 100 });
    assert.equal(reads.length, 0);
    assert.equal(result.budget.toolCallsTotal, 1);
});

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function fixture({ replies = [], chunks = [], key = 'fake-local-key' } = {}) {
    const calls = [], logs = [], mod = { exports: {} };
    let clients = 0;
    const methods = {
        async generateContent(input) { calls.push(input); if (!replies.length) throw Error('No fake response'); const next = replies.shift(); if (next instanceof Error) throw next; return next; },
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'geminiService.js'), 'utf8'), {
        module: mod, exports: mod.exports, process: { env: { GEMINI_API_KEY: key } },
        console: { warn: text => logs.push(text), error: text => logs.push(text) },
        require(id) {
            if (id === '@google/genai') return {
                HarmCategory: {}, HarmBlockThreshold: {},
                GoogleGenAI: class {
                    constructor() { clients++; this.models = methods; this.chats = { create(config) {
                        calls.push(config);
                        return { sendMessage: methods.generateContent, async sendMessageStream(input) {
                            calls.push(input);
                            return (async function* () { for (const item of chunks) { if (item instanceof Error) throw item; yield item; } })();
                        } };
                    } }; }
                },
            };
            if (id === '../ai/pecaRequestSchema') return require('../ai/pecaRequestSchema');
            if (id === '../rag/design-rules/padroesVisuais') return { padroesVisuaisParaPrompt: () => 'LOCAL VISUAL RULE' };
            throw Error('External dependency forbidden: ' + id);
        },
    });
    return { api: mod.exports, calls, logs, clients: () => clients };
}
const reply = (text, finishReason = 'STOP', usageMetadata) => ({ text, candidates: [{ finishReason }], usageMetadata });

test('client is lazy; missing key fails without starting an SDK client', async () => {
    const f = fixture({ key: '' });
    assert.equal(f.clients(), 0);
    await assert.rejects(() => f.api.gerarTexto('test'), /GEMINI_API_KEY/);
    assert.equal(f.clients(), 0);
});

test('chat preserves role mapping, output limit, system prompt and truncated text', async () => {
    const f = fixture({ replies: [reply('partial', 'MAX_TOKENS'), reply('next')] });
    const result = await f.api.gerarChat([{ role: 'assistant', content: 'prior' }], 'hello', 'system', { maxOutputTokens: 90, temperature: 0 });
    assert.equal(result, 'partial');
    assert.equal(f.calls[0].history[0].role, 'model');
    assert.equal(f.calls[0].config.temperature, 0);
    assert.equal(f.calls[0].config.maxOutputTokens, 90);
    assert.equal(f.calls[0].config.systemInstruction, 'system');
    assert.equal(f.calls[0].config.safetySettings.length, 4);
    assert.equal(f.calls[1].message, 'hello');
    await f.api.gerarTexto('second');
    assert.equal(f.clients(), 1);
});

test('JSON generation rejects truncation and invalid JSON; parses valid output', async () => {
    const f = fixture({ replies: [reply('{', 'MAX_TOKENS'), reply('invalid'), reply('{"ok":true}')] });
    await assert.rejects(() => f.api.gerarJson('a'), /JSON truncado/);
    await assert.rejects(() => f.api.gerarJson('b'), /JSON válido/);
    assert.equal((await f.api.gerarJson('c', 'json-only', { maxOutputTokens: 200 })).ok, true);
    assert.equal(f.calls[2].config.responseMimeType, 'application/json');
    assert.equal(f.calls[2].config.maxOutputTokens, 200);
});

test('blocked output and SDK failures preserve tagged errors, cause and HTTP diagnostics', async () => {
    const sdkError = Object.assign(Error('quota exhausted'), { status: 429, cause: Error('upstream') });
    const f = fixture({ replies: [reply('blocked', 'SAFETY'), sdkError] });
    await assert.rejects(() => f.api.gerarTexto('a'), /filtro de segurança/);
    await assert.rejects(() => f.api.gerarTexto('b'), error => error.cause === sdkError && /\[GEMINI\] quota/.test(error.message));
    assert.ok(f.logs.some(log => log.includes('HTTP 429') && log.includes('upstream')));
});

test('stream yields text fragments and final usage without losing output to metadata-only chunks', async () => {
    const f = fixture({ chunks: [{ text: 'hello ' }, { text: 'world' }, { usageMetadata: { totalTokenCount: 15, promptTokenCount: 10, candidatesTokenCount: 5 } }] });
    const tokensRef = {}, parts = [];
    for await (const part of f.api.gerarChatStream([], 'question', '', { tokensRef })) parts.push(part);
    assert.deepEqual(parts, ['hello ', 'world']);
    assert.deepEqual(tokensRef, { total: 15, input: 10, output: 5 });
});

test('piece generation preserves schema, retry feedback and real piece validation', async () => {
    const piece = { tipo: 'hero', css: '.hero{}', html: '<section id="hero">Hi</section>', js: '', domIds: ['hero'], descricao: 'Fixture' };
    const f = fixture({ replies: [reply(JSON.stringify(piece), 'STOP', { totalTokenCount: 5, promptTokenCount: 3, candidatesTokenCount: 2 })] });
    const result = await f.api.gerarPeca({ pedido: 'hero', nichoTema: 'tech', tokensCss: { primary: '#123456' } }, { erroAnterior: 'Missing id', maxOutputTokens: 500 });
    assert.equal(result.valido, true);
    assert.equal(result.peca.tipo, 'hero');
    assert.equal(result.peca.protegida, false);
    assert.equal(result.tokens.total, 5);
    assert.match(f.calls[0].contents, /Missing id/);
    assert.ok(f.calls[0].config.responseSchema);
    assert.equal(f.calls[0].config.temperature, 0);
    assert.equal(f.calls[0].config.maxOutputTokens, 500);
    assert.match(f.calls[0].config.systemInstruction, /LOCAL VISUAL RULE/);
});

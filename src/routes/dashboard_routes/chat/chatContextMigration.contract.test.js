'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { criarMatcher } = require('../../../rag/ragMatcher');

const PALETTE = Object.freeze({
    'tech-blue': { label: 'Azul', primary: '#0055ff', bgBody: '#111', cardBg: '#222', textMain: '#eee', footerBg: '#333' },
    'warm': { label: 'Quente', primary: '#bb5500', bgBody: '#fff', cardBg: '#fafafa', textMain: '#333', footerBg: '#ddd' },
});
function load(name, imports, extra = {}) {
    const module = { exports: {} };
    const ctx = {
        module, exports: {}, console: { log() {}, warn() {} },
        require(id) {
            if (!(id in imports)) throw new Error('Dependência inesperada: ' + id);
            return imports[id];
        },
        ...extra,
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, name), 'utf8'), ctx, { filename: name });
    return module.exports;
}

test('template: consulta pelo email normalizado e usa último documento', async () => {
    const steps = [];
    const snapshot = { empty: false, docs: [{ data() { return { siteName: 'Meu Site', colorPreset: 'warm' }; } }] };
    const chain = {
        collection(value) { steps.push(['collection', value]); return this; },
        doc(value) { steps.push(['doc', value]); return this; },
        orderBy(...args) { steps.push(['orderBy', ...args]); return this; },
        limit(value) { steps.push(['limit', value]); return this; },
        async get() { return snapshot; },
    };
    const { buscarContextoTemplate } = load('chatTemplateContext.js', {
        '../../../services/firebase': { db: chain },
        '../../../core/presets': { COLOR_PRESETS: PALETTE },
    });
    const out = await buscarContextoTemplate('USER@EXAMPLE.COM');
    assert.equal(out.siteName, 'Meu Site');
    assert.equal(out.colorPreset, 'warm');
    assert.deepEqual(steps, [['collection', 'clientes_premium'], ['doc', 'user@example.com'], ['collection', 'compilacoes'], ['orderBy', 'criadoEm', 'desc'], ['limit', 1]]);
});

test('template: falha Firestore e documento ausente não quebram o chat', async () => {
    let shouldFail = false;
    let empty = true;
    const chain = {
        collection() { return this; }, doc() { return this; },
        orderBy() { return this; }, limit() { return this; },
        async get() { if (shouldFail) throw new Error('offline'); return { empty, docs: [] }; },
    };
    const { buscarContextoTemplate, montarContextoTemplate, precisaContextoTemplate } = load('chatTemplateContext.js', {
        '../../../services/firebase': { db: chain },
        '../../../core/presets': { COLOR_PRESETS: PALETTE },
    });
    assert.equal(await buscarContextoTemplate('user@example.com'), null);
    shouldFail = true;
    assert.equal(await buscarContextoTemplate('user@example.com'), null);
    assert.match(montarContextoTemplate({ siteName: 'Meu blog', colorPreset: 'inexistente' }), /#0055ff/);
    assert.equal(precisaContextoTemplate('muda a cor do botão'), true);
    assert.equal(precisaContextoTemplate('bom dia'), false);
});

test('workspace: injeta preset, tipografia e layout sem alterar a orientação para respostas educativas', () => {
    const { montarContextoWorkspace } = load('chatWorkspaceContext.js', {
        '../../../core/presets': { COLOR_PRESETS: PALETTE },
    });
    const context = montarContextoWorkspace({ siteName: 'Loja', colorPreset: 'warm', typography: 'poppins', gridLayout: 'grid' });
    assert.match(context, /Loja/);
    assert.match(context, /#bb5500/);
    assert.match(context, /poppins/);
    assert.match(context, /grid/);
    assert.match(context, /NÃO mencione o nome do blog/);
    assert.match(montarContextoWorkspace({ colorPreset: 'invalid' }), /#0055ff/);
});

test('RAG GPT: mantém fundação e seleciona somente documentos temáticos relevantes', () => {
    const records = {
        'index.json': { ficheiros: [
            { arquivo: 'base.json', fundacao: true, palavras_chave: [] },
            { arquivo: 'dark.json', tags: ['dark mode'] },
            { arquivo: 'widgets.json', tags: ['widget'] },
            { arquivo: 'unrelated.json', tags: ['adsense'] },
        ] },
        'base.json': { titulo: 'Diretriz principal' },
        'dark.json': { titulo: 'Design escuro' },
        'widgets.json': { titulo: 'Componentes' },
        'unrelated.json': { titulo: 'Anúncios' },
    };
    const { buscarRagGpt, montarContextoRagGpt } = load('chatRagGpt.js', {
        fs: { readFileSync(file) { const name = file.split('/').at(-1); return JSON.stringify(records[name]); } },
        path: { join: (...segments) => segments.join('/') },
        '../../../rag/ragMatcher': { criarMatcher },
    }, { __dirname: '/chat' });
    const selected = buscarRagGpt('Preciso de dark mode e widget');
    assert.equal(selected.length, 3);
    assert.deepEqual(Array.from(selected, x => x.arquivo), ['base.json', 'dark.json', 'widgets.json']);
    assert.deepEqual(Array.from(buscarRagGpt('olá'), x => x.arquivo), ['base.json']);
    assert.match(montarContextoRagGpt(selected), /DIRETRIZ GPT: Diretriz principal/);
    assert.equal(montarContextoRagGpt([]), '');
});

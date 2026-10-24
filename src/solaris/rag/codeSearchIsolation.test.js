'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { uniqueResults, buscarConhecimentoMisto, buscarCodigo } = require('../../../scripts/codeCorpus/codeSearchService');

test('RAG codigo remove chunks duplicados, entradas vazias e preserva ordem', () => {
    const seen = new Set(['already']);
    const result = uniqueResults([
        null, {}, { entryId: 'a', texto: '  ' }, { entryId: 'already', texto: 'ignorado' },
        { entryId: 'a', texto: 'primeiro' }, { entryId: 'a', texto: 'duplicado' },
        { entryId: 'b', texto: 'segundo' },
    ], 2, seen);
    assert.deepEqual(result.map(x => x.entryId), ['a', 'b']);
    assert.deepEqual([...seen].sort(), ['a', 'already', 'b']);
    assert.deepEqual(uniqueResults([{ entryId: 'x', texto: 'texto' }], 0), []);
});

test('RAG misto respeita flag, desduplicacao e catalogo independente', async () => {
    const catalogFn = async () => ({ resultados: [
        { entryId: 'doc', texto: 'documentacao' },
        { entryId: 'code', texto: 'duplicado' },
        { entryId: 'doc2', texto: 'mais informacao' },
    ] });
    const codeFn = async () => ({ resultados: [
        { entryId: 'code', texto: 'exemplo' },
        { entryId: 'code', texto: 'outro chunk' },
        { entryId: 'code2', texto: 'outro exemplo' },
    ] });
    const base = { db: {}, query: 'código React', topK: 3, catalogFn, codeFn };
    assert.deepEqual((await buscarConhecimentoMisto(base)).resultados.map(x => x.entryId), ['doc', 'code', 'doc2']);
    assert.deepEqual((await buscarConhecimentoMisto({ ...base, codeSearchEnabled: true })).resultados.map(x => x.entryId), ['code', 'code2', 'doc']);
    assert.deepEqual((await buscarConhecimentoMisto({ ...base, query: 'sugestões de conteúdo', codeSearchEnabled: true,
        codeFn: async () => { throw new Error('nao consultar'); } })).resultados.map(x => x.entryId), ['doc', 'code', 'doc2']);
});

test('RAG misto continua com uma fonte offline e falha se ambas cairem', async () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
        const base = { db: {}, query: 'código Python', codeSearchEnabled: true, topK: 2 };
        const onlineCode = () => Promise.resolve({ resultados: [{ entryId: 'code', texto: 'ok' }] });
        const offline = async () => { throw new Error('offline'); };
        assert.deepEqual((await buscarConhecimentoMisto({ ...base, catalogFn: offline, codeFn: onlineCode })).resultados.map(x => x.entryId), ['code']);
        await assert.rejects(() => buscarConhecimentoMisto({ ...base, catalogFn: offline, codeFn: offline }), /duas bases RAG/);
    } finally { console.warn = warn; }
    await assert.rejects(() => buscarCodigo({ db: {}, query: '' }), /db e query/);
});

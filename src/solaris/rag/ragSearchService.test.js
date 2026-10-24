'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buscarNoCatalogo, TOP_K_PADRAO, TOP_K_MAXIMO } = require('./ragSearchService');
const { substituirVetoresDaEntrada } = require('./ragVectorStore');
const { criarFakeFirestore } = require('./__testUtils__/fakeFirestore');

function fakeGerarEmbeddingsFn(vetor) {
    return async ({ textos, taskType }) => {
        assert.equal(textos.length, 1);
        assert.equal(taskType, 'RETRIEVAL_QUERY');
        return [vetor];
    };
}

test('buscarNoCatalogo embeda a query com RETRIEVAL_QUERY e busca no vector store', async () => {
    const db = criarFakeFirestore();
    await substituirVetoresDaEntrada({
        db,
        entrada: { id: 'flask-fundamentos', categoria: 'flask' },
        chunks: ['Flask é um microframework Python.'],
        embeddings: [[1, 0, 0]],
    });

    const { query, resultados } = await buscarNoCatalogo({
        query: 'como uso flask?',
        db,
        gerarEmbeddingsFn: fakeGerarEmbeddingsFn([0.9, 0.1, 0]),
    });

    assert.equal(query, 'como uso flask?');
    assert.equal(resultados.length, 1);
    assert.equal(resultados[0].entryId, 'flask-fundamentos');
});

test('buscarNoCatalogo usa TOP_K_PADRAO quando topK não é fornecido', async () => {
    const db = criarFakeFirestore();
    let topKRecebido;
    const { buscarNoCatalogo: fn } = require('./ragSearchService');

    const resultado = await fn({
        query: 'teste',
        db,
        gerarEmbeddingsFn: fakeGerarEmbeddingsFn([1, 0]),
        buscarSimilaresFn: async ({ topK }) => {
            topKRecebido = topK;
            return [];
        },
    });

    assert.equal(topKRecebido, TOP_K_PADRAO);
    assert.deepEqual(resultado.resultados, []);
});

test('buscarNoCatalogo clampa topK acima do máximo permitido', async () => {
    const db = criarFakeFirestore();
    let topKRecebido;

    await buscarNoCatalogo({
        query: 'teste',
        topK: 999,
        db,
        gerarEmbeddingsFn: fakeGerarEmbeddingsFn([1, 0]),
        buscarSimilaresFn: async ({ topK }) => {
            topKRecebido = topK;
            return [];
        },
    });

    assert.equal(topKRecebido, TOP_K_MAXIMO);
});

test('buscarNoCatalogo ignora topK inválido (0, negativo, não-inteiro) e usa o default', async () => {
    const db = criarFakeFirestore();
    for (const topKInvalido of [0, -5, 1.5, 'x', null]) {
        let topKRecebido;
        await buscarNoCatalogo({
            query: 'teste',
            topK: topKInvalido,
            db,
            gerarEmbeddingsFn: fakeGerarEmbeddingsFn([1, 0]),
            buscarSimilaresFn: async ({ topK }) => {
                topKRecebido = topK;
                return [];
            },
        });
        assert.equal(topKRecebido, TOP_K_PADRAO, `topK inválido: ${topKInvalido}`);
    }
});

test('vetores legados descontinuados não aparecem na busca', async () => {
    const resultado = await buscarNoCatalogo({
        query: 'Supabase com automação', db: criarFakeFirestore(),
        gerarEmbeddingsFn: fakeGerarEmbeddingsFn([1, 0]),
        buscarSimilaresFn: async () => [
            { entryId: 'supabase-chatgpt-integration', texto: 'Entrada antiga' },
            { entryId: 'supabase-ai-assistant-integration', texto: 'Entrada atual' },
        ],
    });
    assert.deepEqual(resultado.resultados.map(x => x.entryId), ['supabase-ai-assistant-integration']);
});

test('buscarNoCatalogo rejeita query ausente/vazia', async () => {
    const db = criarFakeFirestore();
    await assert.rejects(buscarNoCatalogo({ query: '', db }), /query/);
    await assert.rejects(buscarNoCatalogo({ query: '   ', db }), /query/);
    await assert.rejects(buscarNoCatalogo({ db }), /query/);
});

test('buscarNoCatalogo rejeita db ausente', async () => {
    await assert.rejects(
        buscarNoCatalogo({ query: 'teste', gerarEmbeddingsFn: fakeGerarEmbeddingsFn([1]) }),
        /db/,
    );
});

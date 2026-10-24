'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { substituirVetoresDaEntrada, buscarSimilares, COLECAO } = require('./ragVectorStore');
const { criarFakeFirestore } = require('./__testUtils__/fakeFirestore');

test('substituirVetoresDaEntrada grava um doc por chunk com id determinístico', async () => {
    const db = criarFakeFirestore();
    const entrada = { id: 'flask-fundamentos', categoria: 'flask' };

    const resultado = await substituirVetoresDaEntrada({
        db,
        entrada,
        chunks: ['chunk um', 'chunk dois'],
        embeddings: [[0.1, 0.2], [0.3, 0.4]],
    });

    assert.deepEqual(resultado, { escritos: 2, removidos: 0 });

    const dump = db._dump(COLECAO);
    assert.equal(dump.size, 2);
    assert.ok(dump.has('flask-fundamentos::chunk0'));
    assert.ok(dump.has('flask-fundamentos::chunk1'));

    const doc0 = dump.get('flask-fundamentos::chunk0');
    assert.equal(doc0.entryId, 'flask-fundamentos');
    assert.equal(doc0.categoria, 'flask');
    assert.equal(doc0.chunkIndex, 0);
    assert.equal(doc0.totalChunks, 2);
    assert.equal(doc0.texto, 'chunk um');
    assert.deepEqual(doc0.embedding.toArray(), [0.1, 0.2]);
    assert.ok(doc0.atualizadoEm);
});

test('substituirVetoresDaEntrada faz replace completo -- reindexar não duplica nem deixa vetor órfão', async () => {
    const db = criarFakeFirestore();
    const entrada = { id: 'django-orm' };

    // Primeira indexação: 3 chunks.
    await substituirVetoresDaEntrada({
        db,
        entrada,
        chunks: ['a', 'b', 'c'],
        embeddings: [[1], [2], [3]],
    });
    assert.equal(db._dump(COLECAO).size, 3);

    // Segunda indexação da MESMA entrada, agora com só 1 chunk (texto encolheu)
    // -- os 2 chunks antigos (chunk1, chunk2) não podem sobrar órfãos.
    const resultado = await substituirVetoresDaEntrada({
        db,
        entrada,
        chunks: ['a-novo'],
        embeddings: [[9]],
    });

    assert.deepEqual(resultado, { escritos: 1, removidos: 3 });
    const dump = db._dump(COLECAO);
    assert.equal(dump.size, 1);
    assert.ok(dump.has('django-orm::chunk0'));
    assert.equal(dump.get('django-orm::chunk0').texto, 'a-novo');
});

test('substituirVetoresDaEntrada não mexe em vetores de OUTRAS entradas', async () => {
    const db = criarFakeFirestore();
    await substituirVetoresDaEntrada({ db, entrada: { id: 'a' }, chunks: ['x'], embeddings: [[1]] });
    await substituirVetoresDaEntrada({ db, entrada: { id: 'b' }, chunks: ['y'], embeddings: [[2]] });

    await substituirVetoresDaEntrada({ db, entrada: { id: 'a' }, chunks: ['x-novo'], embeddings: [[3]] });

    const dump = db._dump(COLECAO);
    assert.equal(dump.size, 2);
    assert.equal(dump.get('a::chunk0').texto, 'x-novo');
    assert.equal(dump.get('b::chunk0').texto, 'y');
});

test('substituirVetoresDaEntrada rejeita entrada sem id', async () => {
    const db = criarFakeFirestore();
    await assert.rejects(
        substituirVetoresDaEntrada({ db, entrada: {}, chunks: ['a'], embeddings: [[1]] }),
        /entrada\.id.*obrigatório/,
    );
});

test('substituirVetoresDaEntrada rejeita chunks/embeddings de tamanhos diferentes', async () => {
    const db = criarFakeFirestore();
    await assert.rejects(
        substituirVetoresDaEntrada({ db, entrada: { id: 'x' }, chunks: ['a', 'b'], embeddings: [[1]] }),
        /mesmo tamanho/,
    );
});

test('buscarSimilares retorna os chunks mais próximos, ordenados por distância', async () => {
    const db = criarFakeFirestore();
    await substituirVetoresDaEntrada({
        db,
        entrada: { id: 'flask', categoria: 'python' },
        chunks: ['fala sobre flask'],
        embeddings: [[1, 0, 0]],
    });
    await substituirVetoresDaEntrada({
        db,
        entrada: { id: 'django', categoria: 'python' },
        chunks: ['fala sobre django'],
        embeddings: [[0, 1, 0]],
    });

    // Query bem mais próxima (em cosseno) do vetor de "flask" ([1,0,0]).
    const resultados = await buscarSimilares({ db, queryEmbedding: [0.9, 0.1, 0], topK: 2 });

    assert.equal(resultados.length, 2);
    assert.equal(resultados[0].entryId, 'flask');
    assert.equal(resultados[0].texto, 'fala sobre flask');
    assert.equal(resultados[0].categoria, 'python');
    assert.ok(resultados[0].distancia < resultados[1].distancia);
});

test('buscarSimilares respeita o topK', async () => {
    const db = criarFakeFirestore();
    for (let i = 0; i < 5; i++) {
        await substituirVetoresDaEntrada({
            db,
            entrada: { id: `entrada-${i}` },
            chunks: [`texto ${i}`],
            embeddings: [[i, 0]],
        });
    }

    const resultados = await buscarSimilares({ db, queryEmbedding: [1, 0], topK: 2 });
    assert.equal(resultados.length, 2);
});

test('buscarSimilares rejeita queryEmbedding vazio', async () => {
    const db = criarFakeFirestore();
    await assert.rejects(buscarSimilares({ db, queryEmbedding: [], topK: 5 }), /queryEmbedding/);
});

test('buscarSimilares rejeita topK inválido', async () => {
    const db = criarFakeFirestore();
    await assert.rejects(buscarSimilares({ db, queryEmbedding: [1], topK: 0 }), /topK/);
    await assert.rejects(buscarSimilares({ db, queryEmbedding: [1], topK: -1 }), /topK/);
});

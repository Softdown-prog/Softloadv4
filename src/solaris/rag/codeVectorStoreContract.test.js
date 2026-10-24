'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarFakeFirestore } = require('./__testUtils__/fakeFirestore');
const { COLLECTION, DIMENSION, replaceCodeVectors, findCodeVectors } =
  require('../../../scripts/codeCorpus/codeVectorStore');

const ID = 'code-' + 'a'.repeat(32);
const vec = () => Array.from({ length: DIMENSION }, (_, index) => index === 0 ? 1 : 0);
const entry = {
  id: ID, repo: 'example/project', path: 'src/index.js', language: 'javascript',
  sourceUrl: 'https://github.com/example/project/blob/' + 'b'.repeat(40) + '/src/index.js',
  commitSha: 'b'.repeat(40), license: 'MIT', contentHash: 'c'.repeat(64), validated: true,
};

test('vector store: nao escreve vetores invalidos nem chunks acima do limite', async () => {
  const db = criarFakeFirestore();
  for (const params of [
    { entry: { ...entry, id: 'other-collection' }, chunks: ['a'], embeddings: [vec()] },
    { entry, chunks: [], embeddings: [] },
    { entry, chunks: Array(101).fill('a'), embeddings: Array.from({ length: 101 }, vec) },
    { entry, chunks: ['a'], embeddings: [[1, 0]] },
    { entry, chunks: ['a'], embeddings: [vec().map((n, i) => i === 4 ? NaN : n)] },
    { entry, chunks: ['a'], embeddings: [vec().map((n, i) => i === 4 ? Infinity : n)] },
  ]) {
    await assert.rejects(replaceCodeVectors({ db, ...params }), /inválid|768/);
  }
  assert.equal(db._dump(COLLECTION).size, 0);
  assert.equal(db._dump('solaris_rag_vectors').size, 0);
});

test('vector store: substituicao atomica e recuperacao preservam metadados', async () => {
  const db = criarFakeFirestore();
  assert.deepEqual(await replaceCodeVectors({ db, entry, chunks: ['primeiro', 'segundo'], embeddings: [vec(), vec()] }),
    { written: 2, removed: 0 });
  assert.deepEqual(await replaceCodeVectors({ db, entry, chunks: ['novo'], embeddings: [vec()] }),
    { written: 1, removed: 2 });
  const result = await findCodeVectors({ db, queryEmbedding: vec(), topK: 1 });
  assert.equal(result.length, 1);
  assert.equal(result[0].entryId, ID);
  assert.equal(result[0].texto, 'novo');
  assert.equal(result[0].categoria, 'codigo');
  assert.equal(result[0].validated, true);
  assert.equal(result[0].license, 'MIT');
  assert.equal(result[0].origin, 'github-external');
  assert.equal(db._dump('solaris_rag_vectors').size, 0);
});

test('vector store: busca rejeita vetores e limites invalidos', async () => {
  const db = criarFakeFirestore();
  for (const topK of [0, -1, 21, 1.5, NaN]) {
    await assert.rejects(findCodeVectors({ db, queryEmbedding: vec(), topK }), /Busca de código inválida/);
  }
  for (const queryEmbedding of [[], [1], vec().map((n, i) => i === 2 ? Infinity : n)]) {
    await assert.rejects(findCodeVectors({ db, queryEmbedding }), /768/);
  }
});

test('vector store: limite Firestore impede batch sem gravacoes', async () => {
  let batchCalls = 0;
  const db = {
    collection() {
      return { where() { return { async get() { return { size: 400, docs: [] }; } }; } };
    },
    batch() { batchCalls++; throw new Error('batch proibido'); },
  };
  await assert.rejects(replaceCodeVectors({ db, entry, chunks: ['codigo'], embeddings: [vec()] }), /Muitos chunks/);
  assert.equal(batchCalls, 0);
});

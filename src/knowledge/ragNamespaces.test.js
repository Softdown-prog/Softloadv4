'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  RAG_NAMESPACES, normalizeSolarisCorpus, shouldSearchCodeCorpus,
  validateNamespaceRegistry,
} = require('./ragNamespaces');
const { buscarConhecimentoMisto, uniqueResults } = require('../../scripts/codeCorpus/codeSearchService');
const { COLLECTION: CODE_COLLECTION, replaceCodeVectors } = require('../../scripts/codeCorpus/codeVectorStore');
const { COLECAO: TECH_COLLECTION, substituirVetoresDaEntrada } = require('../solaris/rag/ragVectorStore');
const { criarFakeFirestore } = require('../solaris/rag/__testUtils__/fakeFirestore');

const codeHit = (id, text) => ({ entryId: id, texto: text, categoria: 'codigo', origin: 'softload-authored' });
const techHit = (id, text) => ({ entryId: id, texto: text, categoria: 'documentacao' });

test('as três bases têm owners e destinos únicos; Blogger não tem coleção Firestore', () => {
  assert.equal(validateNamespaceRegistry(), true);
  assert.equal(RAG_NAMESPACES.blogger.owner, 'especialista-blogger');
  assert.equal(RAG_NAMESPACES.blogger.mode, 'filesystem');
  assert.equal(RAG_NAMESPACES.blogger.collection, null);
  assert.equal(RAG_NAMESPACES.blogger.root, 'src/rag');
  assert.equal(RAG_NAMESPACES.solarisTechnical.collection, TECH_COLLECTION);
  assert.equal(RAG_NAMESPACES.solarisCode.collection, CODE_COLLECTION);
  assert.notEqual(TECH_COLLECTION, CODE_COLLECTION);
  const indexFile = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../firestore.indexes.json'), 'utf8'));
  const vectorGroups = indexFile.fieldOverrides.filter(x => x.fieldPath === 'embedding');
  assert.deepEqual(new Set(vectorGroups.map(x => x.collectionGroup)), new Set([TECH_COLLECTION, CODE_COLLECTION]));
  assert.ok(vectorGroups.every(x => x.indexes[0].vectorConfig.dimension === 768));
  assert.throws(() => validateNamespaceRegistry({
    blogger: RAG_NAMESPACES.blogger,
    first: RAG_NAMESPACES.solarisCode,
    second: { ...RAG_NAMESPACES.solarisTechnical, collection: CODE_COLLECTION },
  }), /Coleção RAG duplicada/);
});

test('endpoint Solaris só permite catálogo técnico, código e modo misto', () => {
  for (const corpus of ['catalogo', 'codigo', 'ambos']) assert.equal(normalizeSolarisCorpus(corpus), corpus);
  assert.equal(normalizeSolarisCorpus(), 'catalogo');
  for (const corpus of ['blogger', 'rag-ia-compiler', 'rag-ia-suporte', 'src/rag', '', null, 'SOLARIS_CODE']) {
    assert.throws(() => normalizeSolarisCorpus(corpus), /corpus/);
  }
});

test('intenção genérica Blogger não dispara consulta à biblioteca de código', () => {
  assert.equal(shouldSearchCodeCorpus('Me ajude com SEO de um template Blogger'), false);
  assert.equal(shouldSearchCodeCorpus('Quero ajustar o layout e as cores do blog'), false);
  assert.equal(shouldSearchCodeCorpus('Como corrigir React com TypeScript?'), true);
  assert.equal(shouldSearchCodeCorpus('Exemplo de código Python com Flask'), true);
});

test('replace do Solaris técnico e do Solaris Code são coleções independentes', async () => {
  const db = criarFakeFirestore();
  const vector = Array.from({ length: 768 }, (_, i) => i === 0 ? 1 : 0);
  await substituirVetoresDaEntrada({
    db, entrada: { id: 'arquitetura-react', categoria: 'react' },
    chunks: ['Referência arquitetural'], embeddings: [vector],
  });
  await replaceCodeVectors({
    db, entry: {
      id: 'code-' + 'a'.repeat(32), repo: 'Softdown-prog/softload-engine-v3',
      path: 'examples/solaris-code/typescript/exemplo.ts', language: 'typescript',
      sourceUrl: 'https://github.com/Softdown-prog/softload-engine-v3', license: 'PROJECT',
      contentHash: 'd'.repeat(64), origin: 'softload-authored', title: 'Exemplo',
    },
    chunks: ['export const id = 1;'], embeddings: [vector],
  });
  assert.equal(db._dump(TECH_COLLECTION).size, 1);
  assert.equal(db._dump(CODE_COLLECTION).size, 1);
  assert.equal(db._dump(TECH_COLLECTION).values().next().value.entryId, 'arquitetura-react');
  assert.equal(db._dump(CODE_COLLECTION).values().next().value.origin, 'softload-authored');
  assert.equal(db._dump('blogger_vectors').size, 0);
});

test('busca mista limita fontes, remove chunks duplicados e preserva contexto técnico', async () => {
  let calls = { tech: 0, code: 0 };
  const result = await buscarConhecimentoMisto({
    query: 'Como escrever código React?', db: {}, topK: 3, codeSearchEnabled: true,
    catalogFn: async ({ topK }) => {
      calls.tech++;
      assert.equal(topK, 3);
      return { resultados: [techHit('tech-1', 'Padrões'), techHit('tech-2', 'Arquitetura')] };
    },
    codeFn: async ({ topK }) => {
      calls.code++;
      assert.ok(topK >= 3);
      return { resultados: [
        codeHit('code-1', 'Função inicial'),
        codeHit('code-1', 'Outro chunk do mesmo exemplo'),
        codeHit('code-2', 'Componente React'),
      ] };
    },
  });
  assert.deepEqual(result.resultados.map(x => x.entryId), ['code-1', 'code-2', 'tech-1']);
  assert.deepEqual(calls, { tech: 1, code: 1 });
  assert.deepEqual(uniqueResults([codeHit('a', 'a')], 0), []);
});

test('pedido Blogger e flag desligada não consultam RAG de código', async () => {
  const codeFn = async () => { throw new Error('NÃO deve consultar códigos'); };
  const catalogFn = async () => ({ resultados: [techHit('t', 'conhecimento técnico')] });
  for (const opts of [
    { query: 'Ajude com SEO de template Blogger', codeSearchEnabled: true },
    { query: 'Exemplo de código React', codeSearchEnabled: false },
  ]) {
    const res = await buscarConhecimentoMisto({ ...opts, db: {}, catalogFn, codeFn });
    assert.deepEqual(res.resultados.map(x => x.entryId), ['t']);
  }
});

test('se qualquer uma das duas bases Solaris falhar, a outra continua', async () => {
  const catalogFn = async () => ({ resultados: [techHit('tech', 'Guia')] });
  const codeFn = async () => ({ resultados: [codeHit('code', 'Código')] });
  const opts = { query: 'Exemplo código Node.js', db: {}, codeSearchEnabled: true };
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const withoutCode = await buscarConhecimentoMisto({
      ...opts, catalogFn, codeFn: async () => { throw new Error('índice code ausente'); },
    });
    assert.deepEqual(withoutCode.resultados.map(x => x.entryId), ['tech']);
    const withoutTech = await buscarConhecimentoMisto({
      ...opts, codeFn, catalogFn: async () => { throw new Error('índice técnico ausente'); },
    });
    assert.deepEqual(withoutTech.resultados.map(x => x.entryId), ['code']);
    await assert.rejects(buscarConhecimentoMisto({
      ...opts,
      catalogFn: async () => { throw new Error('cat'); },
      codeFn: async () => { throw new Error('code'); },
    }), /duas bases RAG/);
  } finally { console.warn = originalWarn; }
});

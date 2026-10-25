'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  RAG_NAMESPACES, SOLARIS_CORPORA, normalizeSolarisCorpus,
  shouldSearchCodeCorpus, validateNamespaceRegistry,
} = require('./ragNamespaces');

test('os três RAGs têm fronteiras únicas sem coleção vetorial Blogger', () => {
  assert.equal(validateNamespaceRegistry(), true);
  assert.equal(RAG_NAMESPACES.blogger.mode, 'filesystem');
  assert.equal(RAG_NAMESPACES.blogger.collection, null);
  assert.equal(RAG_NAMESPACES.blogger.root, 'src/rag');
  assert.equal(RAG_NAMESPACES.solarisTechnical.collection, 'solaris_rag_vectors');
  assert.equal(RAG_NAMESPACES.solarisCode.collection, 'solaris_code_vectors');
  assert.notEqual(RAG_NAMESPACES.solarisTechnical.collection, RAG_NAMESPACES.solarisCode.collection);
  assert.ok(Object.isFrozen(RAG_NAMESPACES));
  assert.ok(Object.isFrozen(RAG_NAMESPACES.solarisCode));
});

test('somente três opções de corpus podem entrar no Solaris, não Blogger', () => {
  assert.deepEqual(Array.from(SOLARIS_CORPORA), ['catalogo','codigo','ambos']);
  assert.equal(normalizeSolarisCorpus(), 'catalogo');
  for (const corpus of SOLARIS_CORPORA) assert.equal(normalizeSolarisCorpus(corpus), corpus);
  for (const corpus of ['blogger', 'src/rag', 'Blogger', '', null, 0, {}]) {
    assert.throws(() => normalizeSolarisCorpus(corpus), /corpus deve ser/);
  }
});

test('sem intenção técnica, um pedido Blogger não acessa corpus Solaris Code', () => {
  for (const query of ['Preciso de um template Blogger', 'Otimizar SEO dos posts', '', null, {}]) {
    assert.equal(shouldSearchCodeCorpus(query), false);
  }
  for (const query of ['Quero aprender TypeScript', 'Depurar função Python Flask', 'Implementar código React']) {
    assert.equal(shouldSearchCodeCorpus(query), true);
  }
});

test('validador rejeita coleções duplicadas, campos vazios e Blogger no Firestore', () => {
  const entries = { blogger: RAG_NAMESPACES.blogger, technical: RAG_NAMESPACES.solarisTechnical, code: RAG_NAMESPACES.solarisCode };
  assert.throws(() => validateNamespaceRegistry({ ...entries, code: { ...entries.code, collection: entries.technical.collection } }), /Coleção RAG duplicada/);
  assert.throws(() => validateNamespaceRegistry({ ...entries, blogger: { ...entries.blogger, collection: 'blogger_vectors' } }), /Namespace de arquivos/);
  assert.throws(() => validateNamespaceRegistry({ ...entries, technical: { ...entries.technical, owner: '' } }), /Namespace RAG incompleto/);
  assert.throws(() => validateNamespaceRegistry({ ...entries, code: { ...entries.code, id: entries.technical.id } }), /Namespace RAG duplicado/);
});

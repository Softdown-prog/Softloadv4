'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buscarCatalogoLocal } = require('./ragLocalSearch');

test('busca RAG funciona sem embeddings nem rede', async () => {
  const result = await buscarCatalogoLocal({ query: 'como configurar flask?' });
  assert.equal(result.query, 'como configurar flask?');
  assert.ok(Array.isArray(result.resultados));
  assert.ok(result.resultados.length <= 1);
  for (const item of result.resultados) {
    assert.equal(typeof item.entryId, 'string');
    assert.equal(typeof item.texto, 'string');
    assert.ok(item.texto.length <= 1800);
  }
});

test('rejeita query vazia', async () => {
  await assert.rejects(buscarCatalogoLocal({ query: '' }), /string não vazia/);
});

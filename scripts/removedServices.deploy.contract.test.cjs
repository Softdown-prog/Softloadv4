'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/deploy.yml'), 'utf8');

test('deploy somente publica app e agent', () => {
  const services = [...workflow.matchAll(/^\s+- service: (\S+)$/gm)].map(m => m[1]);
  assert.deepEqual(services, ['app', 'agent']);
  assert.doesNotMatch(workflow, /softload-(?:sandbox|embeddings)|Embedings-python|sandbox-efemoro|matrix\.service == '(?:sandbox|embeddings)'/);
});

test('imagens removidas não têm Dockerfiles ou diretórios de código na árvore', () => {
  assert.equal(fs.existsSync(path.join(root, 'Embedings-python')), false);
  assert.equal(fs.existsSync(path.join(root, 'sandbox-efemoro')), false);
});

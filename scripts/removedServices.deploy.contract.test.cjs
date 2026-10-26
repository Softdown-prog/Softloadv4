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

test('ativação v2 é protegida por handshake somente-leitura antes de upload', () => {
  const protocol = workflow.indexOf('Confirm receiver understands app+agent before upload');
  const transfer = workflow.indexOf('  build_and_transfer:');
  assert.ok(protocol > 0 && transfer > protocol, 'pré-validação precisa ocorrer no job plan');
  assert.match(workflow, /'contract:v2'/);
  assert.match(workflow, /softload-deploy:v2:app,agent/);
  assert.match(workflow, /Receptor VPS não confirmou contrato v2 app\+agent/);
});

test('imagem Agent usa base slim e mantém ferramentas de GitHub/MCP/Forge', () => {
  const dockerfile = fs.readFileSync(path.join(root, 'agent/Dockerfile'), 'utf8');
  assert.match(dockerfile, /^FROM node:22-bookworm-slim$/m);
  assert.match(dockerfile, /apt-get install -y --no-install-recommends/);
  for (const tool of ['git', 'openssh-client', 'python3', 'ffmpeg', 'php-cli']) {
    assert.match(dockerfile, new RegExp('\\\\b'+tool+'\\\\b'));
  }
  assert.match(dockerfile, /SOLARIS_FORGE_PYTHON/);
  assert.doesNotMatch(dockerfile, /playwright|chromium|puppeteer/i);
});

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
  assert.match(workflow, /Reconfirm receiver v2 immediately before activating/);
  assert.equal((workflow.match(/'contract:v2'/g) || []).length, 2, 'dois handshakes independentes');
  assert.ok(workflow.indexOf('Reconfirm receiver v2 immediately before activating') < workflow.indexOf('Activate only after every image arrives'));
  assert.match(workflow, /Contrato v2 divergente; ativação cancelada sem trocar containers/);
});

test('imagem Agent usa base slim e mantém ferramentas de GitHub/MCP/Forge', () => {
  const dockerfile = fs.readFileSync(path.join(root, 'agent/Dockerfile'), 'utf8');
  assert.match(dockerfile, /^FROM node:22-bookworm-slim$/m);
  assert.match(dockerfile, /apt-get install -y --no-install-recommends/);
  for (const tool of ['git', 'openssh-client', 'python3', 'ffmpeg', 'php-cli']) {
    assert.ok(dockerfile.includes(tool), tool);
  }
  assert.match(dockerfile, /SOLARIS_FORGE_PYTHON/);
  assert.doesNotMatch(dockerfile, /playwright|chromium|puppeteer/i);
});

test('inspeção manual do receptor é estritamente read-only e usa segredo SSH', () => {
  const inspector = fs.readFileSync(path.join(root, '.github/workflows/receiver-v2-readonly.yml'), 'utf8');
  assert.match(inspector, /workflow_dispatch:/);
  assert.doesNotMatch(inspector, /\n\s+push:\s|\n\s+schedule:\s/);
  assert.match(inspector, /'contract:v2'/);
  assert.match(inspector, /'current'/);
  assert.match(inspector, /softload-deploy:v2:app,agent/);
  assert.match(inspector, /secrets\.SOFTLOAD_VPS_SSH_KEY/);
  assert.match(inspector, /softload\.analysepro\.com\/health/);
  assert.doesNotMatch(inspector, /'(?:finish|reuse|deploy):|docker\s+(?:rm|rmi|system\s+prune)|sudo\s+/);
});

test('inventário do receptor usa apenas comandos de leitura e sintaxe shell válida', () => {
  const { execFileSync } = require('node:child_process');
  const inventoryPath = path.join(root, 'scripts/vps/inspect-receiver-readonly.sh');
  execFileSync('bash', ['-n', inventoryPath], { stdio: 'pipe' });
  const content = fs.readFileSync(inventoryPath, 'utf8');
  assert.match(content, /authorized_keys/);
  assert.match(content, /forced_command_path=/);
  assert.match(content, /docker ps -a --format/);
  assert.match(content, /docker system df/);
  assert.match(content, /root_authorized_keys=\[not readable by current user\]/);
  assert.doesNotMatch(content, /docker (?:rm|rmi|system prune|volume rm)|sudo\s|chmod\s|chown\s|ssh-keygen\s/);
  assert.doesNotMatch(content, /cat\s+\/root\/\.ssh\/authorized_keys|docker inspect.*Env/);
});


test('inspeção do receptor v2 é estática e não executa código remoto', () => {
  const file=fs.readFileSync(path.join(root,'scripts/vps/inspect-receiver-readonly.sh'),'utf8');
  assert.match(file,/Receiver v2 static compatibility indicators/);
  assert.match(file,/receiver_candidates_checked/);
  assert.match(file,/contract:v2/);
  assert.match(file,/softload-deploy:v2:app,agent/);
  assert.match(file,/bash -n/);
  assert.doesNotMatch(file,/SSH_ORIGINAL_COMMAND\s*=/);
  assert.doesNotMatch(file,/docker\s+(?:rm|rmi|system\s+prune)|sudo\s|chmod\s|chown\s|ssh-keygen\s/);
});

test('runbook inclui causa do erro e proíbe contornar o handshake', () => {
  const doc=fs.readFileSync(path.join(root,'docs/VPS_DEPLOY.md'),'utf8');
  assert.match(doc,/Command not allowed/);
  assert.match(doc,/No such image/);
  assert.match(doc,/softload-deploy:v2:app,agent/);
  assert.match(doc,/Não aplicar atualização automática do receptor desconhecido/);
});

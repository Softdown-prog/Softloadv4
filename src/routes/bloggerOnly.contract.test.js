'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('Blogger ships no retired product runtime or AI SDK', () => {
  for (const name of ['agent', 'src/ai', 'src/rag', 'src/solaris', 'src/workers',
    'src/services/geminiService.js', 'src/services/openaiService.js',
    'src/services/creditService.js', 'src/services/workspaceCreditReservations.js']) {
    assert.equal(fs.existsSync(path.join(root, name)), false, name);
  }
  const pkg = JSON.parse(read('package.json'));
  for (const name of ['@google/genai', 'openai', 'react', 'vite', '@modelcontextprotocol/sdk']) {
    assert.equal(Object.hasOwn(pkg.dependencies || {}, name), false, name);
    assert.equal(Object.hasOwn(pkg.devDependencies || {}, name), false, name);
  }
  for (const name of ['server.js', 'src/routes/adminRoutes.js', 'src/routes/apiRoutes.js',
    'src/middlewares/authGuard.js']) {
    assert.doesNotMatch(read(name), /require\(['"][^'"]*(?:gemini|openai|creditService|workspaceCredit|\/solaris\/|\/ai\/)/i);
  }
});

test('App-only deployment checks a compatible receiver before transferring or activating', () => {
  const workflow = read('.github/workflows/deploy.yml');
  const receiver = read('scripts/vps/softload-actions-receiver.sh');
  assert.match(workflow, /softload-deploy:v3:app/);
  assert.match(receiver, /softload-deploy:v3:app/);
  assert.doesNotMatch(workflow, /app,agent|AGENT_CHANGED|service: agent|reuse:/);
  assert.doesNotMatch(receiver, /app agent|app\|agent|softload-agent/);
  assert.match(receiver, /--no-deps app/);
  assert.match(receiver, /Archive checksum mismatch/);
  assert.match(receiver, /Health check failed; rolling back/);
  assert.match(receiver, /flock -n/);
});

test('static compiler inputs, data compatibility and financial guards survive retirement', () => {
  assert.ok(fs.readdirSync(path.join(root, 'src/blogger/nichos')).length >= 14);
  assert.ok(fs.existsSync(path.join(root, 'src/blogger/templates/template_base.xml')));
  assert.match(read('src/routes/apiRoutes.js'), /softload_mp_payments/);
  assert.match(read('src/routes/apiRoutes.js'), /verificarAssinaturaMP/);
  assert.match(read('server.js'), /FirestoreSessionStore/);
  assert.doesNotMatch(read('server.js'), /recuperarReservasWorkspace|criarMonitorRecuperacaoCobrancas/);
  assert.match(read('src/services/sentinelWorker.js'), /makeRequest\('\/dashboard\/gerador-blogger'\)/);
});


test('production Compose keeps one App and resolves the release tag from environment', () => {
  const compose = JSON.parse(read('infra/compose.vps.yaml'));
  assert.deepEqual(Object.keys(compose.services), ['app']);
  assert.match(compose.services.app.image, /\$\{SOFTLOAD_IMAGE_TAG:/);
  assert.equal(compose.services.app.depends_on, undefined);
  assert.equal(compose.services.app.ports, undefined);
  assert.doesNotMatch(JSON.stringify(compose), /GEMINI|OPENAI|SOLARIS|WORKER_SHARED|SANDBOX|EMBEDDINGS/);
  assert.ok(compose.secrets.SESSION_SECRET);
  assert.ok(compose.secrets.MP_WEBHOOK_SECRET);
  assert.ok(compose.secrets.GCP_ADC);
});

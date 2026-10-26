'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const script = fs.readFileSync(path.join(__dirname, 'record-solaris-demo.mjs'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/marketing-solaris-demo.yml'), 'utf8');
const solaris = fs.readFileSync(path.join(root, 'frontend/pages/Solaris.tsx'), 'utf8');

test('filma interface atual do Solaris sem contas reais ou chamadas de IA', () => {
  assert.match(script, /recordVideo:/);
  assert.match(script, /pressSequentially\(QUESTION/);
  assert.match(script, /\/dashboard\/solaris\/chat\/stream/);
  assert.match(script, /text\/event-stream/);
  assert.match(script, /interface-real-com-respostas-simuladas/);
  assert.match(script, /route\.abort\(\)/);
  assert.match(script, /DEMONSTRAÇÃO • RESPOSTA SIMULADA/);
  assert.doesNotMatch(script, /https:\/\/softload\.analysepro\.com/);
  assert.doesNotMatch(script, /process\.env\.(?:FIREBASE|GEMINI|OPENAI|PASSWORD|TOKEN)/);
  assert.match(solaris, /Fale com o Solaris\.\.\./);
  assert.match(solaris, /aria-label="Enviar mensagem"/);
  assert.match(solaris, /sl-conversation__bubble--assistant/);
});
test('captura em Actions sem VPS, deploy ou publicacao automatica no portal', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /retention-days: 14/);
  assert.match(workflow, /ffmpeg/);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /SOFTLOAD_VPS_SSH_KEY/);
  assert.doesNotMatch(workflow, /scp |ssh |deploy|git push/);
  assert.doesNotMatch(workflow, /public\/videos\/.*mp4/);
});

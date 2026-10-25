'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadGenerator({ responses = [], args = ['--dry-run'] } = {}) {
  const writes = [];
  const calls = [];
  const logs = [];
  const module = { exports: {} };
  const fakeRequire = id => {
    if (id === 'dotenv') return { config() {} };
    if (id === 'fs') return {
      writeFileSync(file, contents, encoding) { writes.push({ file, contents, encoding }); },
    };
    if (id === 'path') return path;
    if (id === '../src/services/geminiService') return {
      async gerarTexto(prompt) {
        calls.push(prompt);
        const response = responses.shift();
        if (response instanceof Error) throw response;
        return response === undefined ? '{"id":"unexpected","categoria":"mock"}' : response;
      },
    };
    throw new Error('Require inesperado: ' + id);
  };
  fakeRequire.main = null;
  const context = {
    module, exports: module.exports, require: fakeRequire,
    __dirname: __dirname,
    process: {
      argv: ['node', 'generateRagBalcao.js', ...args],
      cwd: () => '/tmp',
      exit(code) { throw new Error('Unexpected process.exit: ' + code); },
    },
    console: { log: (...s) => logs.push(s.join(' ')), error: (...s) => logs.push(s.join(' ')), warn: (...s) => logs.push(s.join(' ')) },
    setTimeout(fn) { fn(); },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'generateRagBalcao.js'), 'utf8'), context, { timeout: 3000 });
  return { generator: module.exports, writes, calls, logs };
}

test('dry-run nunca chama Gemini e não grava arquivos', async () => {
  const x = loadGenerator();
  await x.generator.main();
  assert.equal(x.calls.length, 0);
  assert.equal(x.writes.length, 0);
  assert.ok(x.logs.some(l => l.includes('[DRY-RUN]')));
});

test('extrai JSON puro ou cercado em markdown sem inventar campos', () => {
  const x = loadGenerator();
  assert.equal(x.generator.extrairJSON('{"id":"a","categoria":"b"}').id, 'a');
  assert.equal(x.generator.extrairJSON('```json\n{"id":"a","categoria":"b"}\n```').categoria, 'b');
  assert.equal(x.generator.extrairJSON('sem JSON'), null);
});

test('salva documento válido apenas na pasta Balcão e preserva seu id', async () => {
  const x = loadGenerator({ responses: ['{"id":"ia-balcao-teste","categoria":"layout","extra":1}'] });
  assert.equal(await x.generator.gerarEsalvar('ia-balcao-teste', 'prompt teste'), true);
  assert.equal(x.calls.length, 1);
  assert.equal(x.writes.length, 1);
  assert.ok(x.writes[0].file.endsWith('src/rag/ia-de-balcao/ia-balcao-teste.json'));
  assert.deepEqual(JSON.parse(x.writes[0].contents), { id: 'ia-balcao-teste', categoria: 'layout', extra: 1 });
});

test('sem id e categoria não escreve arquivo', async () => {
  const x = loadGenerator({ responses: ['{"id":"incompleto"}'] });
  assert.equal(await x.generator.gerarEsalvar('ia-balcao-teste', 'prompt teste'), false);
  assert.equal(x.writes.length, 0);
});

test('retry 429 usa serviço simulado e não executa espera real', async () => {
  const x = loadGenerator({ responses: [new Error('429 quota'), 'ok'] });
  assert.equal(await x.generator.gerarTextoComRetry('teste'), 'ok');
  assert.equal(x.calls.length, 2);
});

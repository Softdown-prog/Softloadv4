'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadGenerator({ responses = [], existing = false } = {}) {
  const writes = [];
  const calls = [];
  const logs = [];
  const scriptModule = { exports: {} };
  const requireMock = function (id) {
    if (id === 'dotenv') return { config() {} };
    if (id === 'path') return path;
    if (id === 'fs') return {
      existsSync(file) { calls.push(['exists', file]); return existing; },
      writeFileSync(file, value, encoding) { writes.push({ file, value, encoding }); },
    };
    if (id === '../src/services/geminiService') return {
      async gerarChat(history, prompt, system, options) {
        calls.push(['gemini', prompt, system, options]);
        const next = responses.shift();
        if (next instanceof Error) throw next;
        return next === undefined ? 'resposta inválida' : next;
      },
    };
    throw Error('Unexpected import: ' + id);
  };
  requireMock.main = null;
  const sandbox = {
    module: scriptModule,
    exports: scriptModule.exports,
    require: requireMock,
    __dirname: __dirname,
    console: {
      log: (...args) => logs.push(args.join(' ')),
      error: (...args) => logs.push(args.join(' ')),
      warn: (...args) => logs.push(args.join(' ')),
    },
    setTimeout(callback) { callback(); },
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, 'gerar-blocos-rag.js'), 'utf8'),
    sandbox,
    { filename: 'gerar-blocos-rag.js', timeout: 2000 },
  );
  return { api: scriptModule.exports, writes, calls, logs };
}

const validEntry = id => ({
  id,
  categoria: 'componentes',
  conceito: 'Bloco UI validado',
  variante_1: { html: '<div class="card">A</div>', css: '.card{}', js: '' },
  variante_2: { html: '<div class="card">B</div>' },
  notas_tecnicas: ['exemplo'],
});

test('importação é segura e preserva as quinze receitas do Blogger sem chamar Gemini', () => {
  const { api, writes, calls } = loadGenerator();
  assert.equal(api.BLOCOS.length, 15);
  assert.equal(new Set(api.BLOCOS.map(x => x.id)).size, 15);
  assert.ok(api.BLOCOS.every(x => x.id.startsWith('ia-balcao-') && x.prompt.length > 80));
  assert.equal(writes.length, 0);
  assert.equal(calls.filter(x => Array.isArray(x) && x[0] === 'gemini').length, 0);
});

test('validação rejeita id incorreto, poucas variantes e tags de template Blogger', () => {
  const { api } = loadGenerator();
  const id = 'ia-balcao-teste';
  assert.equal(api.validar(validEntry(id), id).length, 0);
  assert.ok(api.validar(validEntry('outro'), id).some(x => x.includes('id incorreto')));
  const missing = validEntry(id);
  delete missing.variante_2;
  assert.ok(api.validar(missing, id).some(x => x.includes('menos de 2 variantes')));
  const blogger = validEntry(id);
  blogger.variante_2.html = '<b:section id="posts"/>';
  assert.ok(api.validar(blogger, id).some(x => x.includes('tag Blogger')));
  const brokenComment = validEntry(id);
  brokenComment.variante_1.html = '<!-- Use var(--sl-primary) --><div>A</div>';
  assert.ok(api.validar(brokenComment, id).some(x => x.includes('comentário XML')));
});

test('geração válida após erros simulados de Gemini/JSON grava uma única receita', async () => {
  const id = 'ia-balcao-teste';
  const { api, writes, calls } = loadGenerator({
    responses: [
      new Error('429 quota'),
      'nao eh JSON',
      JSON.stringify(validEntry(id)),
    ],
  });
  const result = await api.gerarBloco({ id, prompt: 'gera mock seguro' });
  assert.equal(result.status, 'ok');
  assert.equal(result.tentativas, 3);
  assert.equal(calls.filter(x => Array.isArray(x) && x[0] === 'gemini').length, 3);
  assert.equal(writes.length, 1);
  assert.ok(writes[0].file.endsWith('src/rag/ia-de-balcao/blogger-ui/' + id + '.json'));
  assert.equal(writes[0].encoding, 'utf-8');
  assert.equal(JSON.parse(writes[0].value).id, id);
});

test('arquivo existente ou resposta sempre inválida nunca são sobrescritos', async () => {
  const id = 'ia-balcao-existente';
  const a = loadGenerator({ existing: true });
  assert.equal((await a.api.gerarBloco({ id, prompt: 'p' })).status, 'skip');
  assert.equal(a.writes.length, 0);
  assert.equal(a.calls.some(x => Array.isArray(x) && x[0] === 'gemini'), false);

  const b = loadGenerator({ responses: ['sem JSON', 'sem JSON', 'sem JSON'] });
  const result = await b.api.gerarBloco({ id, prompt: 'p' });
  assert.equal(result.status, 'fail');
  assert.equal(b.writes.length, 0);
  assert.equal(b.calls.filter(x => Array.isArray(x) && x[0] === 'gemini').length, 3);
});

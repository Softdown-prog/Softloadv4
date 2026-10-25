'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadGenerator({ responses = [], meta = { descricao: 'Nicho de teste', nicho: 'Teste' }, nicho = 'gamer-playerone' } = {}) {
  const writes = [];
  const calls = [];
  const logs = [];
  const scriptModule = { exports: {} };
  function mockRequire(id) {
    if (id === 'dotenv') return { config() {} };
    if (id === 'path') return path;
    if (id === 'fs') return {
      readFileSync(file) {
        calls.push({ type: 'read', file });
        return JSON.stringify(meta);
      },
      writeFileSync(file, value, encoding) {
        writes.push({ file, value, encoding });
      },
    };
    if (id === '../src/services/geminiService') return {
      async gerarTexto(prompt) {
        calls.push({ type: 'gemini', prompt });
        const response = responses.shift();
        if (response instanceof Error) throw response;
        return response === undefined ? '{"card_css":[],"hero_html":[]}' : response;
      },
    };
    throw Error('Dependência inesperada: ' + id);
  }
  mockRequire.main = null;
  const sandbox = {
    module: scriptModule,
    exports: scriptModule.exports,
    require: mockRequire,
    __dirname: __dirname,
    process: {
      argv: ['node', 'generateBlocks.js', nicho],
      cwd: () => '/tmp',
      exit() { throw Error('Não executar process.exit durante testes'); },
    },
    console: {
      log: (...args) => logs.push(args.join(' ')),
      warn: (...args) => logs.push(args.join(' ')),
      error: (...args) => logs.push(args.join(' ')),
    },
    setTimeout(cb) { cb(); },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'generateBlocks.js'), 'utf8'), sandbox, {
    filename: 'generateBlocks.js', timeout: 3000,
  });
  return { api: scriptModule.exports, calls, writes, logs };
}

const validCss = '/* Variante: Neon */ .sl-card { color: var(--sl-primary); }';
const validHero = '<section class="sl-hero container"><h1>Conteúdo estático</h1></section>';

test('importação não acessa Gemini ou temas; catálogo mantém os 14 nichos e constantes', () => {
  const { api, calls, writes } = loadGenerator();
  assert.equal(api.TODOS_OS_NICHOS.length, 14);
  assert.equal(new Set(api.TODOS_OS_NICHOS).size, 14);
  assert.equal(api.CSS_VARIANTS, 5);
  assert.equal(api.HERO_VARIANTS, 3);
  assert.equal(calls.length, 0);
  assert.equal(writes.length, 0);
});

test('prompt preserva nicho, variáveis CSS e formato 5 CSS + 3 hero', () => {
  const { api } = loadGenerator();
  const prompt = api.buildPrompt('gamer-playerone', { descricao: 'Jogos retrô', nicho: 'Gamer' });
  assert.match(prompt, /Jogos retrô/);
  assert.match(prompt, /Gamer/);
  assert.match(prompt, /var\(--sl-primary\)/);
  assert.match(prompt, /EXATAMENTE 5 strings/);
  assert.match(prompt, /EXATAMENTE 3 strings/);
});

test('parser aceita JSON puro, fenced e JSON cercado por explicação, rejeita inválido', () => {
  const { api } = loadGenerator();
  assert.equal(api.extrairJSON('{"card_css":[],"hero_html":[]}').card_css.length, 0);
  assert.equal(api.extrairJSON('```json\n{"card_css":["x"],"hero_html":[]}\n```').card_css[0], 'x');
  assert.equal(api.extrairJSON('Resposta: {"card_css":[],"hero_html":[]} fim').hero_html.length, 0);
  assert.equal(api.extrairJSON('lixo sem JSON'), null);
});

test('validadores rejeitam placeholders, tags Blogger e blocos sem conteúdo', () => {
  const { api } = loadGenerator();
  assert.equal(api.validarCSS(validCss), true);
  assert.equal(api.validarHero(validHero), true);
  assert.equal(api.validarCSS('.x{ color: data:cor; }'), false);
  assert.equal(api.validarCSS('.x{color: [VARIAVEL]; }'), false);
  assert.equal(api.validarHero('<section><h1>[TITULO]</h1></section>'), false);
  assert.equal(api.validarHero('<b:section id="posts"/>'), false);
  assert.equal(api.validarHero('não é html'), false);
});

test('geração filtra variantes inválidas, sem escrever até salvarBlocos', async () => {
  const { api, calls, writes } = loadGenerator({
    responses: [JSON.stringify({
      card_css: [validCss, '.x{ color: data:cor; }'],
      hero_html: [validHero, '<section><h1>[TITULO]</h1></section>'],
    })],
  });
  const generated = await api.gerarBlocosParaNicho('gamer-playerone');
  assert.equal(generated.nicho, 'gamer-playerone');
  assert.equal(generated.total_css, 1);
  assert.equal(generated.total_hero, 1);
  assert.equal(writes.length, 0);
  assert.equal(calls.filter(c => c.type === 'gemini').length, 1);
  api.salvarBlocos('gamer-playerone', generated);
  assert.equal(writes.length, 1);
  assert.match(writes[0].file, /tema-gamer-playerone-blocks\.json$/);
  assert.deepEqual(JSON.parse(writes[0].value).card_css, [validCss]);
  assert.equal(writes[0].encoding, 'utf-8');
});

test('falha de API ou todas as variantes inválidas não grava arquivos', async () => {
  const a = loadGenerator({ responses: [new Error('429 quota')] });
  assert.equal(await a.api.gerarBlocosParaNicho('gamer-playerone'), null);
  assert.equal(a.writes.length, 0);
  const b = loadGenerator({ responses: ['{"card_css":["inválido"],"hero_html":["inválido"]}'] });
  assert.equal(await b.api.gerarBlocosParaNicho('gamer-playerone'), null);
  assert.equal(b.writes.length, 0);
});

test('CLI com um nicho usa o modelo simulado e grava apenas o destino esperado', async () => {
  const { api, calls, writes } = loadGenerator({
    responses: [JSON.stringify({ card_css: [validCss], hero_html: [validHero] })],
  });
  await api.main();
  assert.equal(calls.filter(c => c.type === 'gemini').length, 1);
  assert.equal(writes.length, 1);
  assert.match(writes[0].file, /\/temas\/tema-gamer-playerone-blocks\.json$/);
});

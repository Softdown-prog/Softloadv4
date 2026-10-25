'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const existingCss = '/* Variante 1: Neon Glow */ .sl-card { color: var(--sl-primary); }';
const newCss = '/* Variante Nova 1: Swiss */ .sl-card { border: 1px solid #222; }';
const existingHero = '<section class="sl-hero"><h1>Original destacado</h1></section>';
const newHero = '<section class="sl-hero"><h1>Novo exemplo válido</h1></section>';
function harness({ argv = ['gamer-playerone'], responses = [], existing } = {}) {
  const calls = [], writes = [], logs = [];
  const result = { exports: {} };
  const mockRequire = (id) => {
    if (id === 'dotenv') return { config() {} };
    if (id === 'fs') return {
      readFileSync(file) {
        calls.push(['read', file]);
        if (file.endsWith('-blocks.json')) {
          if (!existing) throw Error('Arquivo não existe');
          return JSON.stringify(existing);
        }
        return JSON.stringify({ descricao: 'Descrição de teste', nicho: 'Gamer' });
      },
      writeFileSync(file, value, encoding) { writes.push({ file, value, encoding }); },
    };
    if (id === 'path') return path;
    if (id === '../src/services/geminiService') return { async gerarTexto(prompt) {
      calls.push(['gemini', prompt]);
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next === undefined ? '{"card_css":[],"hero_html":[]}' : next;
    }};
    throw Error('Dependência inesperada: ' + id);
  };
  mockRequire.main = null;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'appendBlocks.js'), 'utf8'), {
    require: mockRequire, module: result, exports: result.exports, __dirname,
    process: {
      argv: ['node', 'appendBlocks.js', ...argv],
      exit() { throw Error('Não encerrar processo nos testes'); },
    },
    console: {
      log: (...a) => logs.push(a.join(' ')),
      warn: (...a) => logs.push(a.join(' ')),
      error: (...a) => logs.push(a.join(' ')),
    },
    setTimeout(callback) { callback(); },
  }, { filename: 'appendBlocks.js', timeout: 3000 });
  return { api: result.exports, calls, writes, logs };
}
test('importação e CLI padrão não consomem Gemini nem alteram arquivos', async () => {
  const h = harness();
  assert.equal(h.api.TODOS_OS_NICHOS.length, 14);
  assert.equal(h.api.CSS_NOVAS, 5);
  assert.equal(h.api.HERO_NOVAS, 2);
  assert.equal(h.calls.length, 0);
  await h.api.main();
  assert.equal(h.calls.length, 0);
  assert.equal(h.writes.length, 0);
  assert.ok(h.logs.some(l => l.includes('DRY-RUN')));
});
test('prompt lista estilos já usados e validadores rejeitam Blogger e placeholders', () => {
  const h = harness();
  assert.equal(h.api.extrairNomeEstilo(existingCss), 'Neon Glow');
  const prompt = h.api.buildPromptAppend('gamer-playerone', { descricao: 'Jogos', nicho: 'Gamer' }, ['Neon Glow']);
  assert.match(prompt, /Neon Glow/);
  assert.match(prompt, /NÃO REPITA ESTES/);
  assert.match(prompt, /EXATAMENTE 5 strings/);
  assert.equal(h.api.validarCSS(newCss), true);
  assert.equal(h.api.validarHero(newHero), true);
  assert.equal(h.api.validarCSS('.sl-card {color:data:primary}'), false);
  assert.equal(h.api.validarHero('<section><h1>[TITULO]</h1></section>'), false);
  assert.equal(h.api.extrairJSON('sem json'), null);
  const fence=String.fromCharCode(96).repeat(3);
  assert.deepEqual(JSON.parse(JSON.stringify(h.api.extrairJSON(fence+'json\n{"card_css":[]}\n'+fence))), {card_css:[]});
});
test('apenas --apply chama Gemini e anexa CSS/Hero existentes sem substituí-los', async () => {
  const h = harness({
    argv: ['--apply', '--delay=0', 'gamer-playerone'],
    existing: { card_css: [existingCss], hero_html: [existingHero] },
    responses: [JSON.stringify({card_css:[newCss, '.x {color: b:skin;}'], hero_html:[newHero,'<b:section id="invalid"/>']})],
  });
  await h.api.main();
  assert.equal(h.calls.filter(c => c[0] === 'gemini').length, 1);
  assert.equal(h.writes.length, 1);
  const bundle=JSON.parse(h.writes[0].value);
  assert.deepEqual(bundle.card_css, [existingCss,newCss]);
  assert.deepEqual(bundle.hero_html, [existingHero,newHero]);
  assert.equal(bundle.total_css, 2);
  assert.equal(bundle.total_hero, 2);
  assert.equal(h.writes[0].encoding, 'utf-8');
});
test('falha ou retorno inválido não modifica a biblioteca; --dry-run sobrepõe --apply', async () => {
  const a=harness({argv:['--apply','gamer-playerone'],responses:[Error('crédito indisponível')]});
  await a.api.main();
  assert.equal(a.writes.length,0);
  const b=harness({argv:['--apply','gamer-playerone'],responses:['{"card_css":[],"hero_html":[]}']});
  await b.api.main();
  assert.equal(b.writes.length,0);
  const c=harness({argv:['--apply','--dry-run','gamer-playerone']});
  await c.api.main();
  assert.equal(c.calls.filter(x=>x[0]==='gemini').length,0);
});

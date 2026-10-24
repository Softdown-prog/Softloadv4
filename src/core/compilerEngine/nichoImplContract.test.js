'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const filename = require.resolve('./nichoImpl');
const source = fs.readFileSync(filename, 'utf8');

function criarExtrator(impl, meta) {
    const leituras = [];
    const originalRequire = require;
    const fakeFs = {
        readFileSync(arquivo) {
            leituras.push(arquivo);
            if (arquivo.endsWith('-impl.json')) {
                if (impl === undefined) throw new Error('impl ausente');
                return typeof impl === 'string' ? impl : JSON.stringify(impl);
            }
            if (arquivo.endsWith('-meta.json')) {
                if (meta === undefined) throw new Error('meta ausente');
                return typeof meta === 'string' ? meta : JSON.stringify(meta);
            }
            throw new Error('arquivo inesperado: ' + arquivo);
        }
    };
    const mod = new Module(filename, module);
    mod.filename = filename;
    mod.paths = module.paths;
    mod.require = (id) => id === 'fs' ? fakeFs : originalRequire(id);
    mod._compile(source, filename);
    return { extrair: mod.exports.carregarNichoImpl, leituras };
}

assert.deepEqual(criarExtrator({}).extrair(''), { css: '', js: '', heroHtml: '' });
assert.deepEqual(criarExtrator({}).extrair(null), { css: '', js: '', heroHtml: '' });
const sem = criarExtrator(undefined);
const aviso = console.warn;
console.warn = () => {};
try {
    assert.deepEqual(sem.extrair('nao-existe'), { css: '', js: '', heroHtml: '' });
} finally { console.warn = aviso; }
assert.equal(sem.leituras.length, 1, 'sem impl não tenta carregar meta');

const cases = criarExtrator({
    css_raiz: '.card { color: red; }',
    ui: { css_base: '.base { display: block; }', irmao: '.irmão { display: flex; }',
        desc: 'Descrição em português sem código executável', javascript: {
            script: 'const alpha = 1;',
            nota: 'Anotação contendo o termo const mas sem começar pelo token',
        }
    },
    hero_destaque: { container_html: '<section id="hero-ok">Olá &nbsp; mundo</section>',
       rotina_js: 'const alpha = 1;' },
    fundo: 'Não extrair texto aleatório',
}, undefined);
const resultado = cases.extrair('tema-fixture');
assert.ok(resultado.css.includes('.base'));
assert.ok(resultado.css.includes('.irmão'));
assert.ok(resultado.css.includes('.card'));
assert.ok(!resultado.css.includes('Descrição'));
assert.equal((resultado.js.match(/const alpha = 1/g)||[]).length, 1, 'dedup JS');
assert.ok(!resultado.js.includes('Anotação'));
assert.ok(resultado.heroHtml.includes('hero-ok'));
assert.ok(!resultado.heroHtml.includes('&nbsp;'), 'HTML hero deve estar pronto para XML Blogger');
assert.ok(cases.leituras.every(nome => nome.includes('tema-fixture-')));

const modo = criarExtrator({}, {
  tokens_css: {
    light_mode: { '--x-primary': '#000', '--x-primary-hover': '#111', '--x-bg': '#fff', '--font-body': 'Georgia' },
    dark_mode: { seletor: '.dark', '--x-bg': '#000' }
  }
}).extrair('paleta');
assert.ok(modo.css.includes('--x-primary: var(--sl-primary);'));
assert.ok(modo.css.includes('--x-primary-hover: #111;'));
assert.ok(modo.css.includes('--font-body: Georgia;'));
assert.ok(modo.css.includes('.dark {'));
assert.ok(modo.css.includes('--x-bg: #000;'), 'modo escuro preserva literal');
console.log('✅ nichoImpl: extração sem disco, tokens, deduplicação e fallback.');

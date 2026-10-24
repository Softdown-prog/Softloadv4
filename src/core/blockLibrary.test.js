'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const filename = require.resolve('./blockLibrary');
const source = fs.readFileSync(filename, 'utf8');

function instancia(arquivos) {
    const leituras = [];
    const mod = new Module(filename, module);
    mod.filename = filename;
    mod.paths = module.paths;
    mod.require = id => id === 'fs' ? {
        readFileSync(file) {
            leituras.push(file);
            const name = file.split(/[\\/]/).at(-1);
            if (!Object.prototype.hasOwnProperty.call(arquivos, name)) throw new Error('missing');
            return arquivos[name];
        }
    } : require(id);
    mod._compile(source, filename);
    return { lib: mod.exports, leituras, arquivos };
}

const fixture = instancia({
    'tema-teste-blocks.json': JSON.stringify({
        card_css: ['.a{color:red}', '.b{color:blue}', '.c{color:green}'],
        hero_html: ['<div>A</div>', '<div>B</div>'],
    }),
    'tema-vazio-blocks.json': JSON.stringify({ card_css: [], hero_html: [] }),
    'tema-hero-blocks.json': JSON.stringify({ hero_html: ['<h1>Hero</h1>'] }),
    'tema-invalido-blocks.json': '{ JSON quebrado',
});
const { lib, leituras } = fixture;
assert.deepEqual(Object.keys(lib), ['pickBlock', 'temBlocos', 'carregarBlocos', 'limparCache', 'hashSeed']);
assert.equal(lib.hashSeed(''), 5381);
assert.equal(lib.hashSeed('Softload'), lib.hashSeed('Softload'));
assert.notEqual(lib.hashSeed('Softload'), lib.hashSeed('softload'));
const seed = 'Site Alpha';
const variantes = lib.carregarBlocos('teste').card_css;
assert.strictEqual(lib.pickBlock('teste', 'card_css', seed), variantes[lib.hashSeed(seed) % variantes.length]);
assert.strictEqual(lib.pickBlock('teste', 'card_css', seed), lib.pickBlock('teste', 'card_css', seed));
assert.ok(lib.temBlocos('teste'));
assert.equal(leituras.length, 1, 'uma leitura por nicho em cache');
assert.strictEqual(lib.carregarBlocos('teste'), lib.carregarBlocos('teste'), 'mesma referência cacheada');
assert.strictEqual(lib.pickBlock('teste', 'desconhecido', seed), null);
assert.strictEqual(lib.temBlocos('vazio'), false);
assert.strictEqual(lib.pickBlock('vazio', 'card_css', seed), null);
assert.strictEqual(lib.temBlocos('hero'), true);
assert.equal(lib.pickBlock('hero', 'hero_html', seed), '<h1>Hero</h1>');
assert.strictEqual(lib.carregarBlocos('ausente'), null);
fixture.arquivos['tema-ausente-blocks.json'] = JSON.stringify({card_css:['.novo{}']});
assert.strictEqual(lib.carregarBlocos('ausente'), null, 'ausência também é cacheada');
assert.strictEqual(lib.carregarBlocos('invalido'), null, 'JSON inválido preserva fallback');
assert.equal(lib.pickBlock('invalido', 'card_css', seed), null);
lib.limparCache();
assert.equal(lib.pickBlock('ausente', 'card_css', seed), '.novo{}', 'limpar cache relê arquivo');
assert.ok(leituras.length > 1);
assert.ok(lib.carregarBlocos('tema-teste').card_css.length > 0, 'prefixo tema- é normalizado na leitura');
console.log('✅ blockLibrary: hash estável, seleção determinística, cache, fallback e limpeza.');

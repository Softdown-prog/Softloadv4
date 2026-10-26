'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'catalog.cjs'), 'utf8');
function fixture() {
    const entries = {
        '/forge/tools/visitor_forge_2d/examples': [{name:'2d.json',isDirectory:()=>false}],
        '/forge/tools/a7_audio_lab/jobs': [{name:'audio.json',isDirectory:()=>false}],
    };
    const files = {
        '/forge/tools/visitor_forge_2d/examples/2d.json': JSON.stringify({contract:'CH_2D_GRAPH_RECIPE_V1',id:'r1'}),
        '/forge/tools/a7_audio_lab/jobs/audio.json': JSON.stringify({contract:'CH_AUDIO_GENERATION_V1',id:'snd'}),
    };
    const mockedFs = {
        readdirSync: dir => { assert.ok(dir in entries); return entries[dir]; },
        readFileSync: filename => { assert.ok(filename in files); return files[filename]; },
    };
    const module = { exports: {} };
    vm.runInNewContext(source, {
        module, __dirname:'/forge', require: name => name==='node:fs' ? mockedFs : name==='node:path' ? path : (()=>{throw Error(name)})(),
    }, { filename:'catalog.cjs' });
    return module.exports;
}
test('catálogo Forge preserva contratos, comandos e ordenação', () => {
    const c=fixture(); const catalog=c.catalog();
    assert.equal(catalog.version,1);assert.equal(catalog.recipes.length,2);
    assert.deepEqual(Array.from(catalog.recipes, x=>x.command),['audio-synth','draw-graph']);
    assert.deepEqual(Array.from(catalog.runtime),['runtime.mjs','procedural.mjs']);
    assert.equal(catalog.reviewRequired,true);
});
test('leitura limitada ao catálogo e rejeição de receitas ausentes', () => {
    const c=fixture();
    assert.equal(c.readRecipe('tools/visitor_forge_2d/examples/2d.json').recipe.id,'r1');
    assert.throws(()=>c.readRecipe('../outside.json'),/Receita ausente/);
});

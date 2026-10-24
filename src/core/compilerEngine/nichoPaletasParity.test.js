'use strict';
const assert = require('node:assert/strict');
const { gerarPaletaCss, PALETAS } = require('./nichoPaletas');
const { hashSeed } = require('../blockLibrary');
const EXPECTED_PALETTES = [
    ['#FF4500', '#00FF41'],
    ['#7B2FBE', '#FF006E'],
    ['#FFE600', '#00FFFF'],
    ['#E3000B', '#0078D7'],
    ['#00FF41', '#FF4500'],
];
const cssFor = (primary, secondary) =>
    ":root {\n" +
    "  --primary: " + primary + ";\n" +
    "  --secondary: " + secondary + ";\n" +
    "  --bg-light: #F4F4F4;\n" +
    "  --border-pixel: 4px solid #000000;\n" +
    "  --font-pixel: 'Press Start 2P', cursive;\n" +
    "}";
assert.deepEqual(Object.keys(PALETAS),['pop-retro-pixel']);
assert.deepEqual(PALETAS['pop-retro-pixel'].map(({primary,secondary})=>[primary,secondary]),EXPECTED_PALETTES);
const fixtures = [
    ['',2],['seed-fixo',2],['SiteA',3],['SiteB',0],
    ['SiteC',4],['Meu Sitepop-retro-pixel',0],['Site 🟣',2],
    ['exemplo & <br>',4],[null,2],[undefined,2],[false,2],[0,2],[42,2],
];
for (const [seed, index] of fixtures) {
    const [primary, secondary] = EXPECTED_PALETTES[index];
    assert.equal(gerarPaletaCss('pop-retro-pixel',seed),cssFor(primary,secondary),
        'A seed '+String(seed)+' deve manter a mesma saída CSS byte a byte');
}
for (const nicho of [undefined, null, '', false, 0, 'nao-cadastrado', 'tema-pop-retro-pixel']) {
    assert.equal(gerarPaletaCss(nicho,'seed-fixo'),'',
        'Não inventar paleta; alias tema- pertence ao carregador, não à paleta');
}
let count=0;
for (let i=0;i<320;i++) {
    const seed='Site#'+i+'–😺–'+String(i*i);
    const idx=hashSeed(seed+':paleta')%5;
    const [p,s]=EXPECTED_PALETTES[idx];
    const css=gerarPaletaCss('pop-retro-pixel',seed);
    assert.equal(css,cssFor(p,s));
    assert.equal(css,gerarPaletaCss('pop-retro-pixel',seed),'determinismo sem Math.random');
    count++;
}
const first=PALETAS['pop-retro-pixel'][0];
assert.equal(Object.getPrototypeOf(PALETAS),Object.prototype,
    'Manter tabela normal para acesso dos consumidores CommonJS');
assert.equal(gerarPaletaCss('pop-retro-pixel','SiteB').includes(first.primary),true);
console.log('✅ Paletas CSS: '+count+' seeds e '+fixtures.length+' casos dourados preservados.');

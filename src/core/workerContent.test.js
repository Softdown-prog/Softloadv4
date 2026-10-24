'use strict';
const assert = require('node:assert/strict');
const { normalizarFlagsConteudo, normalizarTextosConteudo } = require('./workerContent');

function flagsLegado(body) {
    const seoAtivo = !(body.enableSeo === false || body.enableSeo === 'false');
    const lazyLoadAtivo = Boolean(body.lazyLoad === 'true' || body.lazyLoad === true || body.lazyLoad);
    return { seoAtivo, lazyLoadAtivo };
}
function textosLegado(body) {
    return {
        description: typeof body.description === 'string' && body.description.trim()
            ? body.description.trim().substring(0, 240) : null,
        heroTitle: typeof body.heroTitle === 'string' && body.heroTitle.trim()
            ? body.heroTitle.trim().substring(0, 120) : null,
        heroSubtitle: typeof body.heroSubtitle === 'string' && body.heroSubtitle.trim()
            ? body.heroSubtitle.trim().substring(0, 200) : null,
        buttonStyle: typeof body.buttonStyle === 'string' ? body.buttonStyle : 'default',
    };
}

const valores = [undefined, null, false, true, 0, 1, '', 'false', 'true',
    '  false  ', '  ', '  Um título  ', '<h1>Olá & bem-vindo</h1>',
    'A'.repeat(241), 'B'.repeat(121), 'C'.repeat(201), [], {}, ['abc']];
let nFlags = 0;
for (const enableSeo of valores) {
    for (const lazyLoad of valores) {
        assert.deepEqual(normalizarFlagsConteudo({ enableSeo, lazyLoad }),
            flagsLegado({ enableSeo, lazyLoad }));
        nFlags++;
    }
}
let nTextos = 0;
for (const valor of valores) {
    const body = { description: valor, heroTitle: valor,
        heroSubtitle: valor, buttonStyle: valor };
    assert.deepEqual(normalizarTextosConteudo(body), textosLegado(body));
    nTextos++;
}
for (const [description, heroTitle, heroSubtitle] of [
    [' x '.repeat(125), 'H'.repeat(130), 'S'.repeat(230)],
    ['', ' título ', null],
    ['<meta>&', '<h1>Hero</h1>', '  Subtítulo com acento ☕  '],
    [null, null, null],
]) {
    const body = {description, heroTitle, heroSubtitle};
    assert.deepEqual(normalizarTextosConteudo(body), textosLegado(body));
    nTextos++;
}
const vazio = normalizarTextosConteudo({});
assert.deepEqual(vazio, { description: null, heroTitle: null, heroSubtitle: null, buttonStyle: 'default' });
assert.deepEqual(normalizarFlagsConteudo({lazyLoad:'false'}), {seoAtivo:true, lazyLoadAtivo:true});
assert.deepEqual(normalizarFlagsConteudo({enableSeo:'false'}), {seoAtivo:false, lazyLoadAtivo:false});
assert.equal(normalizarTextosConteudo({description:'A'.repeat(241)}).description.length,240);
assert.equal(normalizarTextosConteudo({heroTitle:'A'.repeat(121)}).heroTitle.length,120);
assert.equal(normalizarTextosConteudo({heroSubtitle:'A'.repeat(201)}).heroSubtitle.length,200);
assert.equal(normalizarTextosConteudo({buttonStyle:''}).buttonStyle,'');
console.log('✅ workerContent: '+nFlags+' combinações de flags e '+nTextos+' casos de texto legados.');

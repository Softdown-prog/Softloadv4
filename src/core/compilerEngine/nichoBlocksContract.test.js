'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const filename = require.resolve('./nichoBlocks');
const codigo = fs.readFileSync(filename, 'utf8');

function criarMontador(comDossie) {
    let dossie = comDossie;
    const calls = [];
    const mod = new Module(filename, module);
    mod.filename = filename;
    mod.paths = module.paths;
    const native = require;
    mod.require = id => {
        if (id === './dossieLoader') return { carregarNichoDossie: () => dossie };
        if (id === './nichoImpl') return { carregarNichoImpl: () => ({ css: '.original{}', js: '<script>legado</script>', heroHtml: '<div id="hero">Legado</div>' }) };
        if (id === './nichoPaletas') return { gerarPaletaCss: () => '.paleta{}' };
        if (id === '../blockLibrary') return { temBlocos: () => true, pickBlock: (n, slot) => slot === 'card_css' ? '.variante{}' : '<section id="hero">Variação</section>', hashSeed: str => [...str].reduce((s,c)=>s+c.charCodeAt(0),0) };
        return native(id);
    };
    mod._compile(codigo, filename);
    return { api: mod.exports, calls, setDossie: valor => { dossie = valor; } };
}

const mock = criarMontador(null);
const legado = mock.api.carregarNichoImplComBlocos('tema-legado', 'Meu Site');
assert.ok(legado.css.includes('.paleta{}'));
assert.ok(legado.css.includes('.original{}'));
assert.ok(legado.css.includes('.variante{}'));
assert.equal(legado.js, '<script>legado</script>');
assert.ok(legado.heroHtml.includes('Variação'));
assert.equal(legado.widgetsHtml, '');

const base = {
    nicho: 'nicho-autoral',
    tokensCss: {light_mode:{'--x':'1px'},dark_mode:{seletor:'.dark','--x':'2px'}},
    pecas:[
        {id:'hero-autoral',tipo:'hero',protegida:true,html:'<h1>Autoral</h1>',css:'.hero{}',js:'const heroA=1;',htmlVariantes:['<h1>Autoral 0</h1>','<h1>Autoral 1</h1>']},
        {id:'widget-badge',tipo:'widget',html:'<div id="cookie">ok</div>',css:'.cookie{}',js:'const cookieA=1;',htmlVariantes:['<div id="cookie">A</div>','<div id="cookie">B</div>'],jsVariantes:['const cookieA=1;','const cookieA=2;']},
        {id:'secao-lateral',tipo:'secao',html:'<b:widget id="BlogSearch1" type="BlogSearch"/>',css:'.secao{}',js:''},
        {id:'modulo-rodape',tipo:'modulo',html:'',css:'.footer{}',js:'const footerA=1;'},
    ]
};
mock.setDossie(base);
const resultado=mock.api.carregarNichoImplComBlocos('nicho-autoral','Site A');
assert.ok(resultado.css.includes(':root {'));
assert.ok(resultado.css.includes('.dark {'));
assert.ok(resultado.css.includes('.hero{}')&&resultado.css.includes('.footer{}'));
assert.ok(!resultado.css.includes('.cookie{}'),'widget possui CSS no próprio corpo');
assert.ok(!resultado.js.includes('cookieA'),'widget não duplica JS no geral');
assert.ok(resultado.widgetsHtml.includes('.cookie{}')&&resultado.widgetsHtml.includes('const cookieA='));
assert.ok(resultado.extraSecoesHtml.includes("id='secao-lateral'"));
assert.ok(resultado.extraSecoesHtml.includes('BlogSearch1'));
assert.ok(resultado.heroHtml.includes('Autoral'));
assert.ok(!resultado.heroHtml.includes('Variação'),'hero protegido não recebe bloco externo');
assert.ok(resultado.js.includes('heroA')&&resultado.js.includes('footerA'));
assert.equal(mock.api.carregarNichoImplComBlocos('nicho-autoral','Site A').widgetsHtml,resultado.widgetsHtml,'semente determinística');

const comNativo = {...base, pecas: [{id:'hero-native',tipo:'hero',widgetNativo:'featured-post-card',tituloWidget:'Título real',domIds:['hero-real']}]};
mock.setDossie(comNativo);
const nativeOutput=mock.api.carregarNichoImplComBlocos('nicho-autoral','Site A');
assert.equal(nativeOutput.heroHtml,'');
assert.ok(nativeOutput.heroNativoXml.includes("type='FeaturedPost'"));
assert.ok(nativeOutput.heroNativoXml.includes("id='hero-real'"));
assert.ok(nativeOutput.heroNativoXml.includes('data:postUrl'));
console.log('✅ nichoBlocks: cano legado/dossiê, hero nativo, peças protegidas, widgets e seções.');

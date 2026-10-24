'use strict';
const assert = require('node:assert/strict');
const { normalizarIdentidadeSite, resolverLayoutPadrao } = require('./workerLayout');
const { NICHO_PAGE_TYPE_MAP, pageTypeParaNicho } = require('./nichoTaxonomy');
const { modulosPadraoDoNicho } = require('./nichoModuleDefaults');
const { hashSeed } = require('./blockLibrary');

// Implementação legada independente para detectar regressões.
function identidadeLegada(siteName) {
    const siteNameBruto = String(siteName).trim().substring(0, 60);
    const slug = siteNameBruto.toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .substring(0, 40) || 'template';
    return { siteNameBruto, slug };
}
const gridsAntigos = {
    'portal-noticias': ['mural', 'revista'],
    'magazine': ['revista', 'mural'],
    'documentacao': ['lista', 'dupla'],
    'catalogo-produtos': ['quadrado', 'mural'],
};
function layoutLegado(nome, nicho, defaults) {
    const seed = nome + (nicho || '');
    const pageTypeAtual = pageTypeParaNicho(nicho);
    const escolher = (papel, opcoes) => opcoes[hashSeed((seed || '') + ':' + papel) % opcoes.length];
    const opcoes = gridsAntigos[pageTypeAtual];
    return {
        pageTypeAtual,
        gridLayoutDefault: opcoes ? escolher('gridlayout', opcoes) : (defaults.gridLayout || 'revista'),
        sidebarPositionDefault: escolher('sidebar', ['right', 'left']),
    };
}
const nomes = [undefined, null, '', '  São Paulo & Ação  ', 'Café ☕', '  ™★  ',
    'Softload '.repeat(9), 'Á'.repeat(61), 'a'.repeat(48), 'A B-C',
    '  LOGÍSTICA E TURISMO  ', '123', '<Empresa>', 'São João'];
const nichos = [...Object.keys(NICHO_PAGE_TYPE_MAP), null, 'inexistente'];
let casos = 0;
for (const siteName of nomes) {
    const { siteNameBruto, slug } = normalizarIdentidadeSite(siteName);
    assert.deepEqual({siteNameBruto, slug}, identidadeLegada(siteName));
    assert.ok(siteNameBruto.length <= 60 && slug.length <= 40);
    for (const nichoTema of nichos) {
        const nichoDefaults = modulosPadraoDoNicho(nichoTema);
        const entrada = {siteNameBruto, nichoTema, nichoDefaults, pageTypeParaNicho, hashSeed};
        assert.deepEqual(resolverLayoutPadrao(entrada), layoutLegado(siteNameBruto, nichoTema, nichoDefaults));
        assert.deepEqual(resolverLayoutPadrao(entrada), resolverLayoutPadrao(entrada));
        casos++;
    }
}
const calls = [];
resolverLayoutPadrao({siteNameBruto:'Teste',nichoTema:'noticias-mag-news',nichoDefaults:{},pageTypeParaNicho,
    hashSeed:seed=>{calls.push(seed);return hashSeed(seed);}});
assert.deepEqual(calls,['Testenoticias-mag-news:gridlayout','Testenoticias-mag-news:sidebar']);
assert.equal(resolverLayoutPadrao({siteNameBruto:'Teste',nichoTema:null,nichoDefaults:{},pageTypeParaNicho,hashSeed}).gridLayoutDefault,'revista');
console.log('✅ workerLayout: '+casos+' combinações nome/nicho e seeds iguais ao legado');

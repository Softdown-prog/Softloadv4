'use strict';
const assert = require('node:assert/strict');
const { normalizarManifesto } = require('./workerManifest');
const { normalizarFlagsConteudo, normalizarTextosConteudo } = require('./workerContent');
const { normalizarModulosAtivos, normalizarBadgesCategoria } = require('./workerNormalize');
const { normalizarIdentidadeSite, resolverLayoutPadrao } = require('./workerLayout');
const { resolverEnum, resolverDesignVoice } = require('./workerInput');
const { sanitizarInput } = require('./compilerEngine');
const { ENUMS } = require('../ai/blueprintSchema');
const { NICHO_DESIGN_VOICE_MAP, COLOR_DESIGN_VOICE_HINT } = require('./designVoicePresets');
const { NICHO_CHASSIS_MAP, chassisParaNicho, pageTypeParaNicho } = require('./nichoTaxonomy');
const { modulosPadraoDoNicho } = require('./nichoModuleDefaults');
const { hashSeed } = require('./blockLibrary');

// Snapshot lógico do antigo compilerWorker.js: independente de workerManifest.
function referenciaLegada(body, avisos) {
    const { seoAtivo, lazyLoadAtivo } = normalizarFlagsConteudo(body);
    const nichoTemaRaw = typeof body.nichoTema === 'string' ? body.nichoTema.trim() : '';
    const nichoTemaNorm = nichoTemaRaw.replace(/^tema-/, '').toLowerCase();
    const nichoTema = chassisParaNicho(nichoTemaNorm)
        ? nichoTemaNorm
        : (nichoTemaRaw ? (avisos.push(nichoTemaRaw), null) : null);
    const nichoDefaults = modulosPadraoDoNicho(nichoTema);
    const modulosAtivos = normalizarModulosAtivos(body.modules, nichoDefaults);
    const badgesProcessados = normalizarBadgesCategoria(body.categoryBadges);
    const { siteNameBruto, slug } = normalizarIdentidadeSite(body.siteName);
    const { pageTypeAtual, gridLayoutDefault, sidebarPositionDefault } = resolverLayoutPadrao({
        siteNameBruto, nichoTema, nichoDefaults, pageTypeParaNicho, hashSeed,
    });
    const { description, heroTitle, heroSubtitle, buttonStyle } = normalizarTextosConteudo(body);
    return {
        siteName: siteNameBruto,
        siteNameSanitizado: sanitizarInput(siteNameBruto),
        description, seoAtivo, lazyLoadAtivo, modulosAtivos, badgesProcessados, slug, nichoTema,
        pageType: pageTypeAtual,
        colorPreset: resolverEnum(body.colorPreset, 'colorPreset', 'tech-blue', ENUMS),
        typography: resolverEnum(body.typography, 'typography', 'inter', ENUMS),
        gridLayout: resolverEnum(body.gridLayout, 'gridLayout', gridLayoutDefault, ENUMS),
        buttonStyle,
        footerStyle: resolverEnum(body.footerStyle, 'footerStyle', 'advanced-3-cols', ENUMS),
        sidebarPosition: resolverEnum(body.sidebarPosition, 'sidebarPosition', sidebarPositionDefault, ENUMS),
        heroTitle, heroSubtitle,
        designVoice: resolverDesignVoice(body.designVoice, body.nichoTema, body.colorPreset,
            ENUMS, NICHO_DESIGN_VOICE_MAP, COLOR_DESIGN_VOICE_HINT),
    };
}
const names = ['Portal de Tecnologia', '  Café & Família  ', '  Revista Ômega  ', 'Loja A'.repeat(16)];
const niches = [...Object.keys(NICHO_CHASSIS_MAP), 'tema-gamer-playerone',
    ' TEMA-VIRAL-MAGAZINE ', 'tema-inexistente', 'INEXISTENTE', null, ''];
const variations = [
    {},
    { enableSeo: false, lazyLoad: 'false', description: ' Uma descrição válida ',
        heroTitle: ' Título de impacto ', heroSubtitle: ' Subtítulo ',
        colorPreset: 'tech-blue', modules: {darkMode: true, error404: true}, categoryBadges: ['FPS', 'RPG'] },
    { enableSeo: 'false', lazyLoad: false, description: 'D'.repeat(250),
        heroTitle: 'H'.repeat(140), heroSubtitle: 'S'.repeat(215),
        modules: {darkMode: false, contactFormTitle: 'Contato personalizado'},
        categoryBadges: [{nome:'notícias & dicas',bg:'#abc',text:'invalid'}] },
    { gridLayout: 'mural', sidebarPosition: 'none', typography: 'playfair',
        buttonStyle: '', designVoice: 'editorial-clean',
        modules: {toc:'false', slotAfter:true}, categoryBadges: { Tecnologia: {bg:'#333',text:'#fff'} } },
    { gridLayout: 'unrecognized', sidebarPosition: 'wrong', typography: 'unknown',
        footerStyle: 'broken', designVoice: 'auto', colorPreset: 'invalid' },
    { categoryBadges: [], modules: null, description: null, heroTitle: ' ',
        heroSubtitle: null, enableSeo: true, lazyLoad: true },
];
let checked = 0;
for (const siteName of names) {
    for (const nichoTema of niches) {
        for (const extra of variations) {
            const body = {siteName, nichoTema, ...extra};
            const actualWarnings = [];
            const legacyWarnings = [];
            const deps = {
                enums: ENUMS, nicheVoiceMap: NICHO_DESIGN_VOICE_MAP,
                colorVoiceHints: COLOR_DESIGN_VOICE_HINT,
                chassisParaNicho, pageTypeParaNicho, modulosPadraoDoNicho, hashSeed,
                avisarNichoInvalido: raw => actualWarnings.push(raw),
            };
            const actual = normalizarManifesto(body, deps);
            const expected = referenciaLegada(body, legacyWarnings);
            assert.deepEqual(actual, expected, 'Manifesto diferente: ' + JSON.stringify(body));
            assert.equal(JSON.stringify(actual), JSON.stringify(expected), 'Ordem de propriedades alterada');
            assert.deepEqual(actualWarnings, legacyWarnings, 'Aviso de nicho inválido mudou');
            checked++;
        }
    }
}
const bad = [];
normalizarManifesto({siteName:'Teste',nichoTema:'tema-ausente'}, {
    enums:ENUMS, nicheVoiceMap:NICHO_DESIGN_VOICE_MAP, colorVoiceHints:COLOR_DESIGN_VOICE_HINT,
    chassisParaNicho, pageTypeParaNicho, modulosPadraoDoNicho, hashSeed,
    avisarNichoInvalido: raw=>bad.push(raw),
});
assert.deepEqual(bad, ['tema-ausente']);
console.log('✅ workerManifest: '+checked+' cenários de paridade total, ordem de propriedades e avisos');

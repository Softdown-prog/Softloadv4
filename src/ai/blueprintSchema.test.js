'use strict';
const assert = require('node:assert/strict');
const { ENUMS } = require('./blueprintSchema');
const { COLOR_PRESETS } = require('../core/presets');
const { PAGE_TYPES_VALIDOS } = require('../core/nichoTaxonomy');
const { DESIGN_VOICE_PRESETS } = require('../core/designVoicePresets');

const keys = [
    'pageType', 'designVoice', 'colorPreset', 'typography', 'gridLayout',
    'sidebarPosition', 'heroSection', 'headerStyle', 'menuType', 'elementRadius',
    'darkMode', 'paginationStyle', 'postModules', 'coreFeatures',
    'footerStyle', 'commentSystem',
];
assert.deepEqual(Object.keys(require('./blueprintSchema')), ['ENUMS'], 'a API CommonJS mantém um único export');
assert.deepEqual(Object.keys(ENUMS), keys, 'os 16 conjuntos de enums continuam disponíveis');
for (const key of keys) {
    assert.ok(Array.isArray(ENUMS[key]), 'enum ' + key + ' é um array');
    assert.ok(ENUMS[key].length > 0, 'enum ' + key + ' não está vazio');
    assert.equal(new Set(ENUMS[key]).size, ENUMS[key].length, 'enum ' + key + ' não tem duplicatas');
}
assert.deepEqual(ENUMS.colorPreset, Object.keys(COLOR_PRESETS), 'cores vêm de presets reais, na mesma ordem');
assert.deepEqual(ENUMS.pageType, [...PAGE_TYPES_VALIDOS], 'tipos de página coincidem com compilador');
assert.equal(ENUMS.designVoice[0], 'auto', 'inferência de voz de design preservada');
assert.deepEqual(
    ENUMS.designVoice.slice(1).filter(id => !Object.prototype.hasOwnProperty.call(DESIGN_VOICE_PRESETS, id)),
    [], 'vozes de design são implementadas'
);
assert.deepEqual(ENUMS.menuType,
    ['simple','classico','offcanvas','offcanvas-right','hamburger-svg','hamburger-icons'],
    'compatibilidade do menu clássico e offcanvas preservada');
assert.equal(ENUMS.menuType.includes('mega-menu'),false,'mega-menu legado segue desabilitado');
assert.deepEqual(ENUMS.darkMode,['disabled','toggle-btn','auto-system']);
assert.deepEqual(ENUMS.typography,['inter','roboto-slab','playfair','space-grotesk','oswald','pt-sans']);
assert.deepEqual(ENUMS.coreFeatures,['seo-premium','lazy-load','minify-assets','anti-copy']);
assert.deepEqual(ENUMS.commentSystem,['blogger-native']);
console.log('✅ blueprintSchema: 16 enums, paletas, pageTypes, menus e compatibilidade CommonJS.');

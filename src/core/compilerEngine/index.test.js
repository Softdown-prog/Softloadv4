'use strict';
const assert = require('node:assert/strict');
const api = require('./index');

// Compatibilidade: a entrada pública mantém exatamente as 29 chaves antigas,
// inclusive a ordem usada por integrações que inspecionam Object.keys().
const nomes = [
    "sanitizarInput",
    "validarHex",
    "sanitizarCssColor",
    "gerarSeoModule",
    "gerarDynamicCss",
    "gerarFontModule",
    "gerarTypographyCss",
    "gerarCategoryBadgesCss",
    "gerarButtonCss",
    "gerarLayoutCss",
    "gerarDesignVoiceCss",
    "resolverLayoutClasses",
    "gerarFooterNewsletter",
    "injetarHeroTexto",
    "montarWidgetHtml",
    "detectarOrfaos",
    "compilarTemplate",
    "construirGrafoCampos",
    "carregarNichoImpl",
    "carregarNichoImplComBlocos",
    "sanitizarEntidadesXml",
    "SLOT_MANIFEST",
    "GRID_OPTIONS",
    "COLOR_PRESETS",
    "BUTTON_STYLES",
    "TYPOGRAPHY_PRESETS",
    "carregarNichoDossie",
    "validarDossie",
    "verificarDomIdsNoOutput"
];
assert.deepEqual(Object.keys(api), nomes);
assert.equal(Object.getPrototypeOf(api), Object.prototype);
assert.equal(Object.prototype.propertyIsEnumerable.call(api, '__esModule'), false);

// Barrel puro: cada export é a própria função/constante do módulo de origem,
// não wrapper que altere argumentos, estado ou resultado de compilação.
const modulos = {
  '../presets': ['COLOR_PRESETS', 'BUTTON_STYLES', 'TYPOGRAPHY_PRESETS'],
  '../designVoicePresets': ['gerarDesignVoiceCss'],
  './sanitize': ['sanitizarInput', 'validarHex', 'sanitizarCssColor'],
  './xmlEntities': ['sanitizarEntidadesXml', 'injetarHeroTexto'],
  './orphans': ['detectarOrfaos'],
  './seo': ['gerarSeoModule'],
  './fonts': ['gerarFontModule'],
  './widgets': ['montarWidgetHtml'],
  './designTokensCss': ['gerarDynamicCss', 'gerarTypographyCss', 'gerarCategoryBadgesCss', 'gerarButtonCss'],
  './layout': ['gerarLayoutCss', 'resolverLayoutClasses', 'gerarFooterNewsletter'],
  './nichoImpl': ['carregarNichoImpl'],
  './nichoBlocks': ['carregarNichoImplComBlocos'],
  './slotManifest': ['SLOT_MANIFEST', 'GRID_OPTIONS'],
  './fieldGraph': ['construirGrafoCampos'],
  './compile': ['compilarTemplate'],
  './dossieLoader': ['carregarNichoDossie'],
  './dossieValidator': ['validarDossie'],
  './dossieIntegrityChecker': ['verificarDomIdsNoOutput'],
};
for (const [path, nomesDoModulo] of Object.entries(modulos)) {
  const modulo = require(path);
  for (const nome of nomesDoModulo) {
    assert.strictEqual(api[nome], modulo[nome], nome + ': mesma referência do módulo original');
  }
}
assert.equal(api.sanitizarInput('  <meu>  '), '&lt;meu&gt;');
assert.equal(api.validarHex('#aBc'), true);
assert.equal(api.validarHex('red'), false);
assert.equal(typeof api.compilarTemplate, 'function');
assert.ok(Array.isArray(api.SLOT_MANIFEST));
assert.equal(typeof api.GRID_OPTIONS.revista, 'string');
console.log('✅ compilerEngine barrel: 29 exports, ordem, referências e smoke tests preservados.');

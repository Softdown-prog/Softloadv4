"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verificarDomIdsNoOutput = exports.validarDossie = exports.carregarNichoDossie = exports.TYPOGRAPHY_PRESETS = exports.BUTTON_STYLES = exports.COLOR_PRESETS = exports.GRID_OPTIONS = exports.SLOT_MANIFEST = exports.sanitizarEntidadesXml = exports.carregarNichoImplComBlocos = exports.carregarNichoImpl = exports.construirGrafoCampos = exports.compilarTemplate = exports.detectarOrfaos = exports.montarWidgetHtml = exports.injetarHeroTexto = exports.gerarFooterNewsletter = exports.resolverLayoutClasses = exports.gerarDesignVoiceCss = exports.gerarLayoutCss = exports.gerarButtonCss = exports.gerarCategoryBadgesCss = exports.gerarTypographyCss = exports.gerarFontModule = exports.gerarDynamicCss = exports.gerarSeoModule = exports.sanitizarCssColor = exports.validarHex = exports.sanitizarInput = void 0;
// ==========================================
// COMPILER ENGINE — barrel
// ==========================================
// Motor de compilação (Chassis + DNA) quebrado em módulos menores por
// responsabilidade. Este arquivo só reexporta a API pública — mantém
// exatamente o mesmo module.exports de quando tudo vivia num único
// compilerEngine.js, para que nenhum consumidor precise mudar require().
//
//   sanitize.js        → escapes/validação de string e cor
//   xmlEntities.js     → sanitização de entidades HTML → XML (hero)
//   seo.js             → bloco de SEO (meta tags + JSON-LD)
//   fonts.js           → import de Google Fonts
//   widgets.js         → widgets XML (header, navegação, HTML genérico)
//   designTokensCss.js → CSS de cor/tipografia/badges/botão
//   layout.js          → CSS de layout (footer/sidebar) + faixa de newsletter
//   nichoImpl.js       → extrai CSS/JS/hero do impl.json de um nicho
//   nichoBlocks.js     → combina impl.json com variantes do Block Worker
//   orphans.js         → remove placeholders [[...]] não resolvidos
//   slotManifest.js    → SLOT_MANIFEST + GRID_OPTIONS (constantes declarativas)
//   fieldGraph.js      → grafo de dependências campo→slot (Layer 1)
//   compile.js         → compilarTemplate() — motor principal, injeção de DNA
// ==========================================
const { COLOR_PRESETS, BUTTON_STYLES, TYPOGRAPHY_PRESETS } = require('../presets');
exports.COLOR_PRESETS = COLOR_PRESETS;
exports.BUTTON_STYLES = BUTTON_STYLES;
exports.TYPOGRAPHY_PRESETS = TYPOGRAPHY_PRESETS;
const { gerarDesignVoiceCss } = require('../designVoicePresets');
exports.gerarDesignVoiceCss = gerarDesignVoiceCss;
const { sanitizarInput, validarHex, sanitizarCssColor } = require('./sanitize');
exports.sanitizarInput = sanitizarInput;
exports.validarHex = validarHex;
exports.sanitizarCssColor = sanitizarCssColor;
const { sanitizarEntidadesXml, injetarHeroTexto } = require('./xmlEntities');
exports.sanitizarEntidadesXml = sanitizarEntidadesXml;
exports.injetarHeroTexto = injetarHeroTexto;
const { detectarOrfaos } = require('./orphans');
exports.detectarOrfaos = detectarOrfaos;
const { gerarSeoModule } = require('./seo');
exports.gerarSeoModule = gerarSeoModule;
const { gerarFontModule } = require('./fonts');
exports.gerarFontModule = gerarFontModule;
const { montarWidgetHtml } = require('./widgets');
exports.montarWidgetHtml = montarWidgetHtml;
const { gerarDynamicCss, gerarTypographyCss, gerarCategoryBadgesCss, gerarButtonCss, } = require('./designTokensCss');
exports.gerarDynamicCss = gerarDynamicCss;
exports.gerarTypographyCss = gerarTypographyCss;
exports.gerarCategoryBadgesCss = gerarCategoryBadgesCss;
exports.gerarButtonCss = gerarButtonCss;
const { gerarLayoutCss, resolverLayoutClasses, gerarFooterNewsletter, } = require('./layout');
exports.gerarLayoutCss = gerarLayoutCss;
exports.resolverLayoutClasses = resolverLayoutClasses;
exports.gerarFooterNewsletter = gerarFooterNewsletter;
const { carregarNichoImpl } = require('./nichoImpl');
exports.carregarNichoImpl = carregarNichoImpl;
const { carregarNichoImplComBlocos } = require('./nichoBlocks');
exports.carregarNichoImplComBlocos = carregarNichoImplComBlocos;
const { SLOT_MANIFEST, GRID_OPTIONS } = require('./slotManifest');
exports.SLOT_MANIFEST = SLOT_MANIFEST;
exports.GRID_OPTIONS = GRID_OPTIONS;
const { construirGrafoCampos } = require('./fieldGraph');
exports.construirGrafoCampos = construirGrafoCampos;
const { compilarTemplate } = require('./compile');
exports.compilarTemplate = compilarTemplate;
const { carregarNichoDossie } = require('./dossieLoader');
exports.carregarNichoDossie = carregarNichoDossie;
const { validarDossie } = require('./dossieValidator');
exports.validarDossie = validarDossie;
const { verificarDomIdsNoOutput } = require('./dossieIntegrityChecker');
exports.verificarDomIdsNoOutput = verificarDomIdsNoOutput;
const publicApi = {
    sanitizarInput,
    validarHex,
    sanitizarCssColor,
    gerarSeoModule,
    gerarDynamicCss,
    gerarFontModule,
    gerarTypographyCss,
    gerarCategoryBadgesCss,
    gerarButtonCss,
    gerarLayoutCss,
    gerarDesignVoiceCss,
    resolverLayoutClasses,
    gerarFooterNewsletter,
    injetarHeroTexto,
    montarWidgetHtml,
    detectarOrfaos,
    compilarTemplate,
    construirGrafoCampos,
    carregarNichoImpl,
    carregarNichoImplComBlocos,
    sanitizarEntidadesXml,
    SLOT_MANIFEST,
    GRID_OPTIONS,
    COLOR_PRESETS,
    BUTTON_STYLES,
    TYPOGRAPHY_PRESETS,
    carregarNichoDossie,
    validarDossie,
    verificarDomIdsNoOutput,
};
module.exports = publicApi;

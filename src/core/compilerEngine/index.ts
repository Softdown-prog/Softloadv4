/** Superfície pública síncrona do compilador, preservada durante a migração para TypeScript. */
import type { ColorDesignTokens, ButtonDesignTokens, TypographyDesignTokens } from './designTokensCss';
import type { TypographyFont } from './fonts';
import type { NicheSlotFragments } from './resolvedMap';
declare function require(path: string): unknown;
declare const module: { exports: unknown };
interface ColorPreset extends ColorDesignTokens {
    label?: string;
    badgePalette?: string[];
}
interface ButtonPreset extends ButtonDesignTokens { label?: string }
type TypographyPreset = TypographyFont & TypographyDesignTokens;
interface NichoImplLegado {
    css: string;
    js: string;
    heroHtml: string;
}
type NichoImplCompilado = NicheSlotFragments & { heroHtml?: string | null };

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

const { COLOR_PRESETS, BUTTON_STYLES, TYPOGRAPHY_PRESETS } = require('../presets') as {
    COLOR_PRESETS: Record<string, ColorPreset>;
    BUTTON_STYLES: Record<string, ButtonPreset>;
    TYPOGRAPHY_PRESETS: Record<string, TypographyPreset>;
};
const { gerarDesignVoiceCss } = require('../designVoicePresets') as { gerarDesignVoiceCss: (voice?: string) => string };

const { sanitizarInput, validarHex, sanitizarCssColor } = require('./sanitize') as typeof import('./sanitize');
const { sanitizarEntidadesXml, injetarHeroTexto } = require('./xmlEntities') as typeof import('./xmlEntities');
const { detectarOrfaos } = require('./orphans') as typeof import('./orphans');
const { gerarSeoModule } = require('./seo') as typeof import('./seo');
const { gerarFontModule } = require('./fonts') as typeof import('./fonts');
const { montarWidgetHtml } = require('./widgets') as typeof import('./widgets');
const {
    gerarDynamicCss,
    gerarTypographyCss,
    gerarCategoryBadgesCss,
    gerarButtonCss,
} = require('./designTokensCss') as typeof import('./designTokensCss');
const {
    gerarLayoutCss,
    resolverLayoutClasses,
    gerarFooterNewsletter,
} = require('./layout') as typeof import('./layout');
const { carregarNichoImpl } = require('./nichoImpl') as typeof import('./nichoImpl');
const { carregarNichoImplComBlocos } = require('./nichoBlocks') as typeof import('./nichoBlocks');
const { SLOT_MANIFEST, GRID_OPTIONS } = require('./slotManifest') as typeof import('./slotManifest');
const { construirGrafoCampos } = require('./fieldGraph') as typeof import('./fieldGraph');
const { compilarTemplate } = require('./compile') as typeof import('./compile');
const { carregarNichoDossie } = require('./dossieLoader') as typeof import('./dossieLoader');
const { validarDossie } = require('./dossieValidator') as typeof import('./dossieValidator');
const { verificarDomIdsNoOutput } = require('./dossieIntegrityChecker') as typeof import('./dossieIntegrityChecker');

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

/** Contrato nominal do barrel: mesmo objeto e mesma ordem da API CommonJS legada. */
export type CompilerEnginePublicApi = typeof publicApi;
module.exports = publicApi;
export { sanitizarInput, validarHex, sanitizarCssColor, gerarSeoModule, gerarDynamicCss, gerarFontModule, gerarTypographyCss, gerarCategoryBadgesCss, gerarButtonCss, gerarLayoutCss, gerarDesignVoiceCss, resolverLayoutClasses, gerarFooterNewsletter, injetarHeroTexto, montarWidgetHtml, detectarOrfaos, compilarTemplate, construirGrafoCampos, carregarNichoImpl, carregarNichoImplComBlocos, sanitizarEntidadesXml, SLOT_MANIFEST, GRID_OPTIONS, COLOR_PRESETS, BUTTON_STYLES, TYPOGRAPHY_PRESETS, carregarNichoDossie, validarDossie, verificarDomIdsNoOutput };

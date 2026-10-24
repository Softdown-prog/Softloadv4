import type { CompilerTemplateOptions, CompilerTemplateResult } from '../../contracts/compiler';
import type { TypographyFont } from './fonts';
import type { NicheSlotFragments } from './resolvedMap';

declare function require(path: string): unknown;

interface ColorPreset {
    primary: string;
    bgBody: string;
    [key: string]: unknown;
}
type TypographyPreset = TypographyFont & Record<string, unknown>;
type NichoImpl = NicheSlotFragments & { heroHtml?: string | null };

const { COLOR_PRESETS, BUTTON_STYLES, TYPOGRAPHY_PRESETS } = require('../presets') as {
    COLOR_PRESETS: Record<string, ColorPreset>;
    BUTTON_STYLES: Record<string, unknown>;
    TYPOGRAPHY_PRESETS: Record<string, TypographyPreset>;
};
const { resolverModulos, DROPCAP_CSS, escolherIconeAutor } = require('../modules') as {
    resolverModulos: (modules: Record<string, unknown>, seed: string) => Record<string, string>;
    DROPCAP_CSS: string;
    escolherIconeAutor: (seed: string) => string;
};
const { gerarDesignVoiceCss } = require('../designVoicePresets') as { gerarDesignVoiceCss: (voice?: string) => string };
const { GRID_OPTIONS } = require('./slotManifest') as { GRID_OPTIONS: Readonly<Record<string, string>> };
const { injetarSlotsXml, construirTraceCompilacao } = require('./compileStages') as typeof import('./compileStages');
const { montarMapaSlotsResolvidos } = require('./resolvedMap') as typeof import('./resolvedMap');
const { sanitizarEntidadesXml, injetarHeroTexto } = require('./xmlEntities') as {
    sanitizarEntidadesXml: (text: string) => string;
    injetarHeroTexto: (html: string, title?: string | null, subtitle?: string | null) => string;
};
const { gerarSeoModule } = require('./seo') as typeof import('./seo');
const { gerarFontModule } = require('./fonts') as typeof import('./fonts');
const { gerarHeaderWidget, montarWidgetHtml, gerarNavWidget } = require('./widgets') as typeof import('./widgets');
const {
    gerarDynamicCss,
    gerarTypographyCss,
    gerarCategoryBadgesCss,
    gerarButtonCss,
    gerarGridCardCss,
} = require('./designTokensCss') as {
    gerarDynamicCss: (
        presets: { color: ColorPreset; button: unknown; typography: TypographyPreset },
        options: { preserveNicheFooter: boolean },
    ) => string;
    gerarTypographyCss: (typography: TypographyPreset) => string;
    gerarCategoryBadgesCss: (badges: ReadonlyArray<{ nome: string; bg: string; text: string }>) => string;
    gerarButtonCss: (style: string, primary: string) => string;
    gerarGridCardCss: () => string;
};
const {
    gerarLayoutCss,
    resolverLayoutClasses,
    gerarFooterNewsletter,
} = require('./layout') as typeof import('./layout');
const { carregarNichoImplComBlocos } = require('./nichoBlocks') as typeof import('./nichoBlocks');
const { detectarOrfaos } = require('./orphans') as typeof import('./orphans');
const { gerarPlaceholderImagemSvg } = require('./placeholderImage') as {
    gerarPlaceholderImagemSvg: (primary: string, background: string) => string;
};

// ==========================================
// MOTOR PRINCIPAL
// ==========================================

/**
 * Compila o template XML do Blogger aplicando o manifesto de opções do usuário.
 *
 * Fluxo (Chassis + DNA):
 *  1. Carrega o Chassis (templateBase — imutável, passado pelo caller)
 *  2. Lê o Manifesto JSON (opcoes)
 *  3. Resolve todos os valores ANTES de injetar (permite capturar trace)
 *  4. Aplica DNA via split/join em placeholders exatos
 *  5. Remove placeholders órfãos — garante XML limpo
 *
 * Retorna { xml, trace } onde trace é um array de ASTNode-like:
 *   { slot, type, valueBytes, active, sources }
 * Use construirGrafoCampos(trace) para obter o grafo de dependências.
 */
/**
 * @param {string} templateBase
 * @param {import('../../contracts/compiler').CompilerTemplateOptions} opcoes
 * @returns {import('../../contracts/compiler').CompilerTemplateResult}
 */
export function compilarTemplate(templateBase: string, opcoes: CompilerTemplateOptions): CompilerTemplateResult {
    const {
        siteName, description, enableSeo, gridLayout, colorPreset,
        buttonStyle, typography, modules, categoryBadges, lazyLoad,
        nichoTema, footerStyle, sidebarPosition, heroTitle, heroSubtitle,
        designVoice, temHeroDesignPackage,
    } = opcoes;

    const color      = COLOR_PRESETS[colorPreset]     ?? COLOR_PRESETS['tech-blue'];
    const button     = BUTTON_STYLES[buttonStyle]     ?? BUTTON_STYLES['default'];
    const typo       = TYPOGRAPHY_PRESETS[typography] ?? TYPOGRAPHY_PRESETS['inter'];
    const gridClass  = GRID_OPTIONS[gridLayout]       ?? GRID_OPTIONS.revista;

    // ── Resolver todos os valores antes de injetar ─────────────────────────
    const seoValue      = enableSeo ? gerarSeoModule(siteName, description as string | undefined) : '<!-- SEO desativado -->';
    const fontValue     = gerarFontModule(typo);
    // BioLink tem rodapé autoral transparente; nunca aplicar o fundo
    // global de footer (preset escuro) ao <footer> próprio deste nicho.
    // A variável --sl-footer-bg continua disponível para módulos extras.
    const dynamicCss    = gerarDynamicCss(
        { color, button, typography: typo },
        { preserveNicheFooter: nichoTema === 'biolink-social' }
    );
    const badgesCss     = gerarCategoryBadgesCss(categoryBadges || []);
    const buttonCss     = gerarButtonCss(buttonStyle || 'default', color.primary);
    const layoutCss     = gerarLayoutCss({ footerStyle, sidebarPosition });
    const voiceCss      = gerarDesignVoiceCss(designVoice);
    const dropcapCss    = modules && modules.dropcap ? DROPCAP_CSS : '';
    const fullCss       = dynamicCss
        + (badgesCss ? '\n    ' + badgesCss : '')
        + '\n    ' + buttonCss
        + (layoutCss ? '\n    ' + layoutCss : '')
        + '\n    ' + gerarTypographyCss(typo)
        + '\n    ' + gerarGridCardCss()
        + (voiceCss   ? '\n    ' + voiceCss   : '')
        + (dropcapCss ? '\n    ' + dropcapCss : '');
    const lazyValue     = lazyLoad ? "loading='lazy'" : '';
    // Placeholder de imagem (card sem foto de post) — gerado com as cores
    // reais do colorPreset do site, self-contained (data URI), nunca
    // depende de serviço externo nem escreve "Softload" no card de um
    // site de cliente. Ver placeholderImage.js pro achado completo.
    const placeholderImg = gerarPlaceholderImagemSvg(color.primary, color.bgBody);
    // Seed determinístico (mesmo princípio de carregarNichoImplComBlocos) —
    // escolhe variante de ícone (dark mode/back-to-top/autor) por site, nunca
    // Math.random(): mesmo siteName+nicho sempre recebe o mesmo ícone entre
    // recompilações; sites diferentes tendem a variar.
    const iconSeed      = (siteName || '') + nichoTema;
    const modSnippets   = resolverModulos(modules || {}, iconSeed);
    const iconAuthor    = escolherIconeAutor(iconSeed);
    const nichoImpl     = carregarNichoImplComBlocos(nichoTema, siteName);

    // Layout: classe do <body> + faixa de newsletter (quando aplicável)
    const bodyLayoutClass = resolverLayoutClasses({ footerStyle, sidebarPosition });
    const footerNewsletter = footerStyle === 'newsletter-integrated'
        ? sanitizarEntidadesXml(gerarFooterNewsletter())
        : '';

    // Breaking news bar: só se o placeholder existir no template
    const breakingNewsBar = templateBase.includes('[[BREAKING_NEWS_BAR]]')
        ? `<div class='mag-ticker-bar'>
    <div class='container d-flex align-items-center overflow-hidden' style='height:32px;'>
      <span class='mag-ticker-label'>&#9654; Últimas</span>
      <div class='mag-ticker-track'>
        <div class='mag-ticker-content' id='mag-ticker-items'>
          <span>A carregar notícias recentes...</span>
        </div>
      </div>
    </div>
  </div>`
        : '';

    // H1 de fallback, oculto visualmente — achado real (auditoria SEO com
    // template real de usuário): a home de TODO nicho renderiza só h2/h3 no
    // hero (nunca h1 — o h1 real só existe na view de post único, ver
    // template_*.xml), e pelo menos 8 dos 15 nichos migrados têm hero 100%
    // visual (tira/badge/slider JS) sem heading nenhum — a home inteira
    // ficava sem NENHUM <h1> no site. hero-area só renderiza em
    // data:view.isMultipleItems, mutuamente exclusivo da view de post único
    // — nunca colide com o h1 real do post. Só injeta quando o hero do
    // nicho (heroHtml OU heroNativoXml) ainda não tem h1 próprio — nunca
    // duplica. data:blog.title é sempre um candidato correto de H1 quando
    // não há nada mais específico (é literalmente o nome do site).
    const H1_FALLBACK_OCULTO = "<h1 class='visually-hidden'><data:blog.title/></h1>";
    const heroHtmlComTexto = injetarHeroTexto(nichoImpl.heroHtml || '', heroTitle, heroSubtitle);
    const heroJaTemH1 = /<h1\b/i.test(heroHtmlComTexto) || /<h1\b/i.test(nichoImpl.heroNativoXml || '');

    // Mapa slot → valores: precedência dos módulos e callbacks de widgets
    // ficam tipados, sem antecipar hero HTML89 ou navegação.
    const resolvedMap = montarMapaSlotsResolvidos({
        primaryColor: color.primary,
        seoValue,
        fontValue,
        fullCss,
        gridClass,
        lazyValue,
        placeholderImg,
        nichoImpl,
        temHeroDesignPackage,
        gerarHeroWidget: () => montarWidgetHtml('HTML89', 'Hero', (heroJaTemH1 ? '' : H1_FALLBACK_OCULTO) + heroHtmlComTexto),
        breakingNewsBar,
        bodyLayoutClass,
        footerNewsletter,
        gerarHeaderWidget,
        gerarNavWidget,
        iconAuthor,
    }, modSnippets);

    // Injeção DNA em ordem legada (agora em etapa TypeScript isolada).
    let xml = injetarSlotsXml(templateBase, resolvedMap, modSnippets);

    // Pós-compilação: remove placeholders não substituídos.
    xml = detectarOrfaos(xml);

    // O trace segue a mesma ordem e referências de SLOT_MANIFEST.
    const trace = construirTraceCompilacao(resolvedMap);

    return { xml, trace };
}


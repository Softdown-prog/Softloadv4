/** Contratos estáticos do marcador TEMPLATE, preservando os valores do compilador. */
export type BlueprintEnumKey = keyof typeof ENUMS;
export type BlueprintEnumValue<K extends BlueprintEnumKey> = (typeof ENUMS)[K][number];
declare function require(path: string): unknown;
declare const module: { exports: unknown };

// ============================================================
// BLUEPRINT SCHEMA — fonte única de verdade dos enums do blueprint
// ============================================================
// ENUMS espelha exatamente os valores aceites pelo compilador — usado
// pra validar/gerar o marcador [[TEMPLATE:{...}]] do chat (via
// blueprintCritics.js/blueprintSelector.js) e pelo schema de edição
// (templateEditSchema.js).
//
// GEMINI_RESPONSE_SCHEMA/validarBlueprint/aplicarDefaults existiram aqui
// (gate server-side + responseSchema do Gemini) mas só serviam
// compilarTemplateIA()/bloggerAiCompiler.js, o compilador AST legado
// removido — sem chamador vivo, foram removidos junto (mesma limpeza do
// resto da cadeia M4, ver PRs #497/#500/#502).
// ============================================================

const { COLOR_PRESETS } = require('../core/presets') as { COLOR_PRESETS: Readonly<Record<string, unknown>> };

// ──────────────────────────────────────────────────────────────────────────
// Enums — espelham exatamente os valores aceites pelo compilador
// ──────────────────────────────────────────────────────────────────────────
const ENUMS = {
    pageType: [
        'blogger-conteudo',   // blog genérico: feed de posts, sidebar, grid configurável
        'landing-page',       // SaaS/startup: hero split + features + pricing, sem feed
        'portal-noticias',    // portal editorial: breaking news, muitos posts, ticker
        'magazine',           // revista digital: curadoria editorial, hero mosaico, categorias visuais
        'biolink',            // link-in-bio: perfil + botões sociais, glassmorphism, sem feed
        'documentacao',       // e-learning/docs: TOC, módulos, progress tracking, leitura linear
        'catalogo-produtos',  // app/produto: grade fixa, cards com ícone+preço+botão, sem editorialização
    ],
    designVoice: [
        'auto',              // inferido automaticamente de nichoTema + colorPreset
        'editorial-clean',   // papel editorial: bordas finas, sombra suave, tipografia precisa
        'bold-impact',       // brutalista: offset de sombra, sem raio, headings peso 900
        'minimal-mono',      // essencialismo utilitário: zero sombra, borda hairline, letra espaçada
        'dark-atmospheric',  // névoa e profundidade: sombras profundas, borda translúcida clara
        'warm-organic',      // calor e respiro: raio 12px, sombra suave, botão pill
        'tech-sharp',        // precisão sistêmica: raio 4px, borda 1px, sombra funcional
        'vibrant-pop',       // energia celebrativa: raio 16px, escala hover, headings peso 800
        'artisanal-craft',   // cuidado artesanal: raio 6px, sombra contida, detalhes refinados
        'retro-web1',        // nostalgia Web 1.0: bordas em relevo (outset/inset), zero raio/sombra
        'glass-translucent', // glassmorphism: fundo translúcido com blur, borda de brilho
        'neumorphic-soft',   // soft UI: sombra dupla clara/escura simulando relevo esculpido
        'monochrome-accent', // preto/branco/cinza estrito, só a cor de destaque no accent
    ],
    // derivado de presets.js (fonte real das cores) — nunca mais diverge manualmente
    colorPreset:     Object.keys(COLOR_PRESETS),
    typography:      ['inter','roboto-slab','playfair','space-grotesk','oswald','pt-sans'],
    gridLayout:      ['lista','dupla','revista','quadrado','mural','coluna-unica','zigzag'],
    sidebarPosition: ['right','left','none'],
    heroSection:     ['carousel','grid-mosaic','static-banner','none'],
    headerStyle:     ['sticky','transparent-scroll','default'],
    // 'mega-menu' removido — enum morto, nunca teve implementação no
    // compilador. 'simple' é traduzido pra 'classico' em
    // chatTemplateCompiler.js (histórico/compatibilidade); os outros 4
    // valores usam o mesmo nome dos dois lados (ver MOBILE_MENU_VARIANTES
    // em modules.js / MENU_VALIDOS em compilerWorker.js).
    menuType:        ['simple','classico','offcanvas','offcanvas-right','hamburger-svg','hamburger-icons'],
    elementRadius:   ['rounded','square'],
    darkMode:        ['disabled','toggle-btn','auto-system'],
    paginationStyle: ['ajax-load-more','infinite-scroll','classic-numbers'],
    postModules:     ['author-box','floating-share','related-posts','reading-time'],
    coreFeatures:    ['seo-premium','lazy-load','minify-assets','anti-copy'],
    footerStyle:     ['simple-copyright','advanced-3-cols','newsletter-integrated'],
    commentSystem:   ['blogger-native'],
} as const;

module.exports = { ENUMS };
export { ENUMS };

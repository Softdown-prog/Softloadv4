/** Contratos do gate determinístico de blueprints (sem chamadas de IA). */
export type BlueprintCriticsInput = Readonly<Record<string, unknown>>;
export interface BlueprintCriticsResult {
    blueprint: BlueprintCriticsOutput;
    criticas: string[];
    erros: string[];
    correcoes: string[];
}
/** Campos reconhecidos pelas regras; valores são validados no runtime legado. */
export interface BlueprintCriticsOutput extends Record<string, unknown> {
    nichoTema?: string;
    colorPreset?: string;
    darkMode?: string;
    menuType?: string;
    gridLayout?: string;
    categoryBadges?: unknown;
    heroHtml?: string;
    customCss?: string;
    postModules?: unknown;
    coreFeatures?: unknown;
    pageType?: string;
    sidebarPosition?: string;
    designVoice?: string;
    moduleOverrides?: unknown;
    heroTitle?: unknown;
    heroSubtitle?: unknown;
}
type ColorPreset = { badgePalette: string[] };
type ColorRule = { proibidos: string[]; fallback: string };
type ModuleRecommendation = { pm: string[]; cf: string[] };
type DossieHeroPiece = { tipo?: unknown; widgetNativo?: unknown };
declare function require(path: string): unknown;
declare const module: { exports: unknown };


const { NICHO_DESIGN_VOICE_MAP, COLOR_DESIGN_VOICE_HINT, DESIGN_VOICE_PRESETS } = require('./designVoicePresets') as {
    NICHO_DESIGN_VOICE_MAP: Record<string, string>;
    COLOR_DESIGN_VOICE_HINT: Record<string, string>;
    DESIGN_VOICE_PRESETS: Record<string, string>;
};
const { NICHO_PAGE_TYPE_MAP, PAGE_TYPES_VALIDOS } = require('./nichoTaxonomy') as {
    NICHO_PAGE_TYPE_MAP: Record<string, string>;
    PAGE_TYPES_VALIDOS: ReadonlySet<string>;
};
const { COLOR_PRESETS } = require('./presets') as { COLOR_PRESETS: Record<string, ColorPreset> };
const { carregarNichoDossie } = require('./compilerEngine/dossieLoader') as typeof import('./compilerEngine/dossieLoader');

// ──────────────────────────────────────────────────────────────────────────
// Blueprint Critics — validação e auto-correção antes da compilação
//
// Examina o blueprint gerado pelo Gemini e aplica 10 regras de validação:
//   correcoes: auto-corrigido (sem perda de qualidade)
//   criticas:  sub-ótimos detectados mas não auto-corrigidos (requer julgamento)
//   erros:     fatais — bloqueiam a compilação
//
// Retorna: { blueprint, criticas: string[], erros: string[], correcoes: string[] }
// ──────────────────────────────────────────────────────────────────────────

const NOMES_TECNICOS_PROIBIDOS = new Set([
    'saas-nexus','viral-magazine','noticias-mag-news','tecnologia-mag-tech',
    'tecnologia-techwind','gamer-playerone','culinaria-boutique-gourmet',
    'natureza-bulma-vegan','elearning-academy','pop-retro-pixel',
    'portfolio-minimalista','biolink-social','brutalista-appcraft',
    'appstore-bulma-mobile','base','blog','magazine','saas','portfolio',
    'biolink','meu blog','meu site','teste','template','softload',
]);

// Nichos onde dark mode é parte da identidade — não pode ser 'disabled'
const NICHOS_DARK_OBRIGATORIO = new Set([
    'gamer-playerone', 'pop-retro-pixel', 'brutalista-appcraft',
]);

// Nichos que exigem menu offcanvas (imersivo)
const NICHOS_OFFCANVAS_OBRIGATORIO = new Set([
    'gamer-playerone', 'pop-retro-pixel', 'biolink-social',
    'saas-nexus', 'brutalista-appcraft', 'appstore-bulma-mobile',
]);

// gridLayout sub-ótimo por nicho — apenas nichos blogger-conteudo com preferência específica.
// Nichos de outros pageTypes usam PAGE_TYPE_GRID_PREFERIDO (evita criticas duplicadas).
const NICHO_GRID_PREFERIDO: Record<string, string> = {
    // nenhum nicho blogger-conteudo tem preferência forte o suficiente para crítica
    // (deixar o usuário escolher livremente dentro do tipo)
};

// colorPresets semanticamente incompatíveis por nicho → auto-correge
const NICHO_COLOR_INCOMPATIVEIS: Record<string, ColorRule> = {
    'gamer-playerone':              { proibidos: ['rose-gold', 'warm-amber', 'forest-green'], fallback: 'gamer-dark' },
    'pop-retro-pixel':              { proibidos: ['rose-gold', 'forest-green'], fallback: 'midnight-purple' },
    'natureza-bulma-vegan':         { proibidos: ['gamer-dark', 'carbon-dark', 'neon-orange'], fallback: 'forest-green' },
    'culinaria-boutique-gourmet':   { proibidos: ['gamer-dark', 'carbon-dark'], fallback: 'warm-amber' },
    'biolink-social':               { proibidos: ['gamer-dark'], fallback: 'midnight-purple' },
    'portfolio-minimalista':        { proibidos: ['gamer-dark', 'neon-orange'], fallback: 'tech-blue' },
};

// Módulos recomendados por nicho que são adicionados se ausentes
const NICHO_MODULOS_RECOMENDADOS: Record<string, ModuleRecommendation> = {
    'elearning-academy':   { pm: ['reading-time'], cf: ['seo-premium', 'lazy-load'] },
    'noticias-mag-news':   { pm: ['reading-time'], cf: ['seo-premium', 'lazy-load'] },
    'viral-magazine':      { pm: ['reading-time'], cf: ['seo-premium', 'lazy-load'] },
    'tecnologia-mag-tech': { pm: ['reading-time'], cf: ['seo-premium', 'lazy-load'] },
};

// Derivado de presets.js (fonte real das cores) — mesmo princípio já usado
// abaixo pra NICHO_TEMAS_VALIDOS, nunca diverge manualmente.
const COLOR_PRESETS_VALIDOS = new Set(Object.keys(COLOR_PRESETS));

// Deriva de NICHO_PAGE_TYPE_MAP (nichoTaxonomy.js) — todo nicho válido tem
// exatamente um pageType, então as chaves do mapa já são a lista completa.
const NICHO_TEMAS_VALIDOS = new Set(Object.keys(NICHO_PAGE_TYPE_MAP));

// Nichos cujo hero é um widget NATIVO do Blogger (FeaturedPost com
// data:postTitle/postUrl/postFirstImage reais — ver nichoBlocks.js
// gerarHeroDestaqueMosaico), não HTML estático. heroTitle/heroSubtitle do
// blueprint nunca chegam nesses nichos: compile.js usa nichoImpl.heroNativoXml
// em vez de injetarHeroTexto(heroHtml, heroTitle, heroSubtitle) sempre que
// existe (comentário "nunca passa por injetarHeroTexto... só fazem sentido
// pra HTML estático"). Achado real (teste manual "News"/noticias-mag-news):
// a IA prometeu heroTitle/heroSubtitle específicos na conversa e nenhum dos
// dois apareceu no XML compilado — o usuário nunca sabe que a promessa foi
// silenciosamente descartada. Derivado do dossiê real (não hardcoded) pra
// nunca divergir se outro nicho ganhar um hero de posts reais no futuro.
const NICHOS_HERO_DE_POSTS_REAIS = new Set(
    [...NICHO_TEMAS_VALIDOS].filter(nicho => {
        const dossie = carregarNichoDossie(nicho);
        return !!(dossie && dossie.pecas.some(p => (p as DossieHeroPiece).tipo === 'hero' && (p as DossieHeroPiece).widgetNativo === 'featured-post'));
    })
);

// NICHO_PAGE_TYPE_MAP e PAGE_TYPES_VALIDOS vêm de nichoTaxonomy.js — fonte
// única de verdade compartilhada com compilerWorker.js (fluxo determinístico),
// pra pageType e chassis nunca mais divergirem em silêncio entre os dois fluxos.

// Tipos sem sidebar de feed (sidebarPosition forçado para 'none')
const PAGE_TYPES_SEM_SIDEBAR = new Set(['landing-page', 'biolink', 'catalogo-produtos']);

// gridLayout preferido por tipo (crítica, não erro)
const PAGE_TYPE_GRID_PREFERIDO: Record<string, string[]> = {
    'portal-noticias':  ['mural', 'revista'],
    'magazine':         ['revista', 'mural'],
    'documentacao':     ['lista', 'dupla'],
    'catalogo-produtos':['quadrado', 'mural'],
};

// Tipos onde categoryBadges são irrelevantes
const PAGE_TYPES_SEM_BADGES = new Set(['landing-page', 'biolink']);

// Únicos módulos que blueprint.moduleOverrides pode desligar — todos os
// que só existem por default de nicho (nichoModuleDefaults.js), nunca
// por escolha livre da IA (ver chatTemplateCompiler.js). Deliberadamente
// NÃO inclui menuType/gridLayout/darkMode/etc — esses já são campos de
// escolha direta no blueprint, não módulos on/off.
const MODULE_OVERRIDES_PERMITIDOS = new Set([
    'contactForm', 'popularPostsRanking', 'sliderJson', 'relatedPosts',
    'statsWidget', 'blogArchiveWidget', 'translateWidget',
    'featuredPostWidget', 'labelCloudWidget', 'socialLinksWidget',
]);

/**
 * Valida e auto-corrige um blueprint antes de enviá-lo ao compilador.
 *
 * @param {object} bp — blueprint bruto do marcador [[TEMPLATE:{...}]]
 * @returns {{ blueprint, criticas: string[], erros: string[], correcoes: string[] }}
 */
function criticarBlueprint(bp: BlueprintCriticsInput): BlueprintCriticsResult {
    const criticas  = [];
    const erros     = [];
    const correcoes = [];
    const blueprint: BlueprintCriticsOutput = { ...bp };

    // ── Regra 1: siteName ──────────────────────────────────────────────
    const siteNameRaw = String(blueprint.siteName || '').trim();
    if (!siteNameRaw) {
        erros.push('siteName ausente — o nome real do blog é obrigatório.');
    } else if (NOMES_TECNICOS_PROIBIDOS.has(siteNameRaw.toLowerCase())) {
        erros.push(`siteName "${siteNameRaw}" é um identificador técnico interno — o nome real do blog não foi coletado.`);
    }

    // ── Regra 2: nichoTema existente ───────────────────────────────────
    if (blueprint.nichoTema && !NICHO_TEMAS_VALIDOS.has(blueprint.nichoTema as string)) {
        criticas.push(`nichoTema "${blueprint.nichoTema}" não existe no catálogo — será usado o chassis padrão.`);
    }

    // ── Regra 3: colorPreset existente ─────────────────────────────────
    if (blueprint.colorPreset && !COLOR_PRESETS_VALIDOS.has(blueprint.colorPreset as string)) {
        blueprint.colorPreset = 'tech-blue';
        correcoes.push(`colorPreset "${bp.colorPreset}" inválido → 'tech-blue'`);
    }

    // ── Regra 4: darkMode obrigatório por nicho ────────────────────────
    if (NICHOS_DARK_OBRIGATORIO.has(blueprint.nichoTema as string) && blueprint.darkMode === 'disabled') {
        blueprint.darkMode = 'toggle-btn';
        correcoes.push(`darkMode 'disabled' → 'toggle-btn' (nicho ${blueprint.nichoTema} exige dark mode)`);
    }

    // ── Regra 5: menuType obrigatório por nicho ────────────────────────
    if (NICHOS_OFFCANVAS_OBRIGATORIO.has(blueprint.nichoTema as string) && blueprint.menuType === 'simple') {
        blueprint.menuType = 'offcanvas';
        correcoes.push(`menuType 'simple' → 'offcanvas' (nicho ${blueprint.nichoTema} exige offcanvas)`);
    }

    // ── Regra 6: colorPreset incompatível com nicho ────────────────────
    const colorRule = NICHO_COLOR_INCOMPATIVEIS[blueprint.nichoTema || ''];
    if (colorRule && colorRule.proibidos.includes(blueprint.colorPreset as string)) {
        const antes = blueprint.colorPreset;
        blueprint.colorPreset = colorRule.fallback;
        correcoes.push(`colorPreset '${antes}' incompatível com ${blueprint.nichoTema} → '${colorRule.fallback}'`);
    }

    // ── Regra 7: gridLayout sub-ótimo por nicho ────────────────────────
    const gridPref = NICHO_GRID_PREFERIDO[blueprint.nichoTema || ''];
    if (gridPref && blueprint.gridLayout && blueprint.gridLayout !== gridPref) {
        criticas.push(`gridLayout '${blueprint.gridLayout}' sub-ótimo para ${blueprint.nichoTema} (recomendado: '${gridPref}')`);
    }

    // ── Regra 8: categoryBadges — validação + cor determinística por preset ──
    // A cor NUNCA vem da IA (mesmo que ela mande um hex válido) — sempre
    // derivada da badgePalette do colorPreset escolhido (presets.js),
    // ciclando por posição. Antes disso a IA "inventava" hex livremente
    // (âncora no exemplo do prompt) e o fallback de validação usava uma
    // paleta genérica fixa — os dois caminhos produziam badges coloridos
    // mas desconectados da identidade do site (mesmo arco-íris em todo
    // template, independente do nicho/preset escolhido).
    if (Array.isArray(blueprint.categoryBadges)) {
        const paleta = (COLOR_PRESETS[blueprint.colorPreset || ''] && COLOR_PRESETS[blueprint.colorPreset || ''].badgePalette)
            || COLOR_PRESETS['tech-blue'].badgePalette;
        const badgesValidos: Array<{ nome: string; bg: string; text: string }> = [];
        for (const raw of blueprint.categoryBadges.slice(0, 8)) {
            // Aceita string solta (só o nome) ou objeto {nome, ...} — a IA
            // não precisa mais mandar bg/text, mas objetos antigos com esses
            // campos continuam aceitos (só não são mais usados pra cor).
            const nomeBruto = (raw && typeof raw === 'object') ? raw.nome : raw;
            if (!nomeBruto || typeof nomeBruto !== 'string' || !nomeBruto.trim()) {
                criticas.push(`categoryBadge ignorado — sem 'nome' válido.`);
                continue;
            }
            const i = badgesValidos.length;
            badgesValidos.push({
                nome: nomeBruto.trim().substring(0, 40),
                bg:   paleta[i % paleta.length],
                text: '#ffffff',
            });
        }
        if (badgesValidos.length > 0) {
            correcoes.push(`categoryBadges: cores atribuídas pela paleta do preset '${blueprint.colorPreset}' (${badgesValidos.length} badge(s)).`);
        }
        blueprint.categoryBadges = badgesValidos;
    }

    // ── Regra 9: heroHtml — rejeita tags Blogger ───────────────────────
    if (typeof blueprint.heroHtml === 'string' && blueprint.heroHtml.trim()) {
        if (/\b(b:|data:|expr:)\w/.test(blueprint.heroHtml)) {
            delete blueprint.heroHtml;
            erros.push('heroHtml rejeitado — contém tags Blogger (b:, data:, expr:) que causam SAXParseException.');
        }
    }

    // ── Regra 10: customCss — segurança e tamanho ─────────────────────
    if (typeof blueprint.customCss === 'string' && blueprint.customCss.trim()) {
        if (blueprint.customCss.includes('@import')) {
            delete blueprint.customCss;
            erros.push('customCss rejeitado — @import não é permitido (use o campo typography para fontes).');
        } else if (blueprint.customCss.length > 400) {
            const antes = blueprint.customCss.length;
            blueprint.customCss = blueprint.customCss.slice(0, 400);
            correcoes.push(`customCss truncado: ${antes} → 400 chars`);
        }
    }

    // ── Regra 11: módulos recomendados por nicho ───────────────────────
    const modulosRec = NICHO_MODULOS_RECOMENDADOS[blueprint.nichoTema || ''];
    if (modulosRec) {
        const pm = Array.isArray(blueprint.postModules)  ? [...blueprint.postModules]  : [];
        const cf = Array.isArray(blueprint.coreFeatures) ? [...blueprint.coreFeatures] : [];
        let changed = false;
        for (const mod of modulosRec.pm)  { if (!pm.includes(mod)) { pm.push(mod); changed = true; } }
        for (const feat of modulosRec.cf) { if (!cf.includes(feat)) { cf.push(feat); changed = true; } }
        if (changed) {
            blueprint.postModules  = pm;
            blueprint.coreFeatures = cf;
            correcoes.push(`Módulos recomendados para ${blueprint.nichoTema} adicionados automaticamente.`);
        }
    }

    // ── Regra 12: pageType — inferir/corrigir usando NICHO_PAGE_TYPE_MAP ──
    const canonicalType = NICHO_PAGE_TYPE_MAP[blueprint.nichoTema || ''];
    if (!blueprint.pageType || !PAGE_TYPES_VALIDOS.has(blueprint.pageType as string)) {
        // Ausente ou valor fora do enum — infere do nichoTema
        blueprint.pageType = canonicalType || 'blogger-conteudo';
        correcoes.push(`pageType ausente/inválido → '${blueprint.pageType}' (inferido de nichoTema '${blueprint.nichoTema}')`);
    } else if (canonicalType && blueprint.pageType !== canonicalType) {
        // Valor presente mas incompatível com o nicho — corrige
        const antes = blueprint.pageType;
        blueprint.pageType = canonicalType;
        correcoes.push(`pageType '${antes}' incompatível com '${blueprint.nichoTema}' → '${canonicalType}'`);
    }

    // ── Regra 13: sidebarPosition forçado por tipo de página ──────────────
    if (PAGE_TYPES_SEM_SIDEBAR.has(blueprint.pageType as string) && blueprint.sidebarPosition !== 'none') {
        const antes = blueprint.sidebarPosition || '(ausente)';
        blueprint.sidebarPosition = 'none';
        correcoes.push(`sidebarPosition '${antes}' → 'none' (${blueprint.pageType} não tem sidebar de feed)`);
    }

    // ── Regra 14: categoryBadges em tipos sem sidebar (aviso) ─────────────
    if (PAGE_TYPES_SEM_BADGES.has(blueprint.pageType as string) &&
        Array.isArray(blueprint.categoryBadges) && blueprint.categoryBadges.length > 0) {
        criticas.push(`categoryBadges definidos em '${blueprint.pageType}' (${blueprint.nichoTema}) — badges de categoria só aparecem em blogger-conteudo, magazine ou portal-noticias.`);
    }

    // ── Regra 15: gridLayout sub-ótimo para o tipo de página ──────────────
    const gridOtimos = PAGE_TYPE_GRID_PREFERIDO[blueprint.pageType || ''];
    if (gridOtimos && blueprint.gridLayout && !gridOtimos.includes(blueprint.gridLayout)) {
        criticas.push(`gridLayout '${blueprint.gridLayout}' sub-ótimo para '${blueprint.pageType}' — recomendados: ${gridOtimos.join(' ou ')}.`);
    }

    // ── Regra 16: designVoice — inferir/corrigir ──────────────────────────
    const voiceValidos = new Set(Object.keys(DESIGN_VOICE_PRESETS));
    const rawVoice = blueprint.designVoice;

    if (!rawVoice || rawVoice === 'auto' || !voiceValidos.has(rawVoice as string)) {
        // Inferir: nicho primeiro, colorPreset como desempate
        const inferido = NICHO_DESIGN_VOICE_MAP[blueprint.nichoTema || '']
            || COLOR_DESIGN_VOICE_HINT[blueprint.colorPreset || '']
            || 'tech-sharp';
        if (rawVoice !== inferido) {
            blueprint.designVoice = inferido;
            correcoes.push(`designVoice '${rawVoice || '(ausente)'}' → '${inferido}' (inferido de nichoTema='${blueprint.nichoTema}' colorPreset='${blueprint.colorPreset}')`);
        }
    }

    // ── Regra 17: moduleOverrides — liga/desliga, só whitelist ──────────
    // Jeito da IA ligar OU desligar um módulo genérico de chassis que o
    // usuário pediu explicitamente (ex: "quero formulário de contato" num
    // nicho que não tem por padrão, ou "sem ranking de populares" num que
    // tem). A whitelist é só de flags GENÉRICOS de chassis (formulário,
    // widgets de sidebar/rodapé) — nenhum deles afeta a identidade visual
    // do nicho (cor, tipografia, grid, hero), essa continua vindo só de
    // nichoModuleDefaults.js/dossiê. Antes só aceitava `false` (só
    // desligar) — achado real (auditoria "chat não usa o que o usuário
    // pediu"): pedido de funcionalidade extra era sempre descartado sem
    // aviso, mesmo sendo um toggle genérico e seguro de ligar. Qualquer
    // chave fora da whitelist, ou valor que não seja boolean, é
    // descartada silenciosamente (mesmo espírito de validarEdicao em
    // templateEditSchema.js — campo inválido não invalida o resto).
    if (blueprint.moduleOverrides && typeof blueprint.moduleOverrides === 'object' && !Array.isArray(blueprint.moduleOverrides)) {
        const validos: Record<string, boolean> = {};
        for (const [campo, valor] of Object.entries(blueprint.moduleOverrides)) {
            if (MODULE_OVERRIDES_PERMITIDOS.has(campo) && typeof valor === 'boolean') {
                validos[campo] = valor;
            } else {
                criticas.push(`moduleOverrides.${campo} ignorado — só aceita true/false em campos na whitelist (${[...MODULE_OVERRIDES_PERMITIDOS].join(', ')}).`);
            }
        }
        blueprint.moduleOverrides = validos;
    } else if (blueprint.moduleOverrides !== undefined) {
        delete blueprint.moduleOverrides;
    }

    // ── Regra 18: heroTitle/heroSubtitle sem efeito em hero de posts reais ──
    // Mesma classe de bug da Regra 6 (cor prometida e trocada em silêncio):
    // aqui não é trocado, é IGNORADO — compile.js usa heroNativoXml (widget
    // FeaturedPost) em vez de injetarHeroTexto pra esses nichos, então
    // qualquer heroTitle/heroSubtitle no blueprint nunca aparece no XML.
    // Remove aqui pra não sobreviver no manifesto como promessa morta, e
    // avisa explicitamente (o texto do prompt já orienta a IA a não prometer
    // isso, essa regra é a rede de segurança determinística).
    if (NICHOS_HERO_DE_POSTS_REAIS.has(blueprint.nichoTema as string)) {
        if (blueprint.heroTitle) {
            correcoes.push(`heroTitle removido — ${blueprint.nichoTema} usa hero com posts reais (FeaturedPost), texto customizado nunca aparece.`);
            delete blueprint.heroTitle;
        }
        if (blueprint.heroSubtitle) {
            correcoes.push(`heroSubtitle removido — ${blueprint.nichoTema} usa hero com posts reais (FeaturedPost), texto customizado nunca aparece.`);
            delete blueprint.heroSubtitle;
        }
    }

    return { blueprint, criticas, erros, correcoes };
}

module.exports = {
    criticarBlueprint,
    NICHO_TEMAS_VALIDOS,
    COLOR_PRESETS_VALIDOS,
    MODULE_OVERRIDES_PERMITIDOS,
    NICHO_PAGE_TYPE_MAP,
    PAGE_TYPES_VALIDOS,
    PAGE_TYPES_SEM_SIDEBAR,
    // Exportado pra chatSystemPrompt.js expor a regra na conversa (achado
    // real: a IA prometia uma cor ao usuário sem saber que a Regra 6 ia
    // trocá-la depois, silenciosamente — o usuário nunca ficava sabendo).
    NICHO_COLOR_INCOMPATIVEIS,
    // Mesmo motivo, pra Regra 18 (heroTitle/heroSubtitle ignorados).
    NICHOS_HERO_DE_POSTS_REAIS,
};

export {
    criticarBlueprint, NICHO_TEMAS_VALIDOS, COLOR_PRESETS_VALIDOS,
    MODULE_OVERRIDES_PERMITIDOS, NICHO_PAGE_TYPE_MAP, PAGE_TYPES_VALIDOS,
    PAGE_TYPES_SEM_SIDEBAR, NICHO_COLOR_INCOMPATIVEIS, NICHOS_HERO_DE_POSTS_REAIS,
};

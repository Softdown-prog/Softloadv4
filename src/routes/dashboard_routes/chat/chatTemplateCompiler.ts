'use strict';
interface ChatBlueprint {
    coreFeatures?: string[];
    postModules?: string[];
    siteName?: string;
    nichoTema?: string;
    moduleOverrides?: Partial<Record<string, boolean>> | null;
    pageType?: string;
    description?: string;
    colorPreset?: string;
    buttonStyle?: string;
    typography?: string;
    gridLayout?: string;
    footerStyle?: string;
    designVoice?: string;
    sidebarPosition?: string;
    heroTitle?: string;
    heroSubtitle?: string;
    categoryBadges?: Array<string | {nome: string; bg?: string; text?: string}>;
    darkMode?: string;
    menuType?: string;
    darkTheme?: boolean | string;
    customCss?: string;
    svgLogo?: string;
    heroHtml?: string;
    staticSections?: string;
}
interface NicheModuleDefaults {
    backToTop?: boolean;
    shareButtons?: boolean;
    readingTime?: boolean;
    readingProgress?: boolean;
    toc?: boolean;
    error404?: boolean;
    cookieBanner?: boolean;
    dropcap?: boolean;
    reviewEngine?: boolean;
    sliderJson?: boolean;
    relatedPosts?: boolean;
    contactForm?: boolean;
    popularPostsRanking?: boolean;
    appDownloadCta?: boolean;
    menuDropdownPrefixo?: boolean;
    statsWidget?: boolean;
    blogArchiveWidget?: boolean;
    translateWidget?: boolean;
    featuredPostWidget?: boolean;
    labelCloudWidget?: boolean;
    socialLinksWidget?: boolean;
    error404Theme?: string;
    contactFormTitle?: string;
    popularPostsRankingTitle?: string;
    menuType?: string;
}
interface ChatManifesto {
    siteName: string;
    nichoTema?: string | null;
    colorPreset?: string;
    typography?: string;
    gridLayout?: string;
    [key: string]: unknown;
}
interface ChatCompilerUser { email: string; [key: string]: unknown }
interface WorkspaceIds { wsProjetoId?: string | null; wsSessionId?: string | null }
interface CompilationProgress { type: string; label: string }
type SendCompilerEvent = (event: CompilationProgress) => void;
interface CompileOutput { downloadUrl: string; xmlPath?: string | null; gcPath?: string | null }
interface CriticReport { correcoes: string[]; criticas: string[]; erros: string[] }
interface TemplateSnapshot {
    compilacaoId: string | null;
    siteName: string | null;
    colorPreset: string;
    typography: string;
    gridLayout: string;
    nichoTema: string | null;
    xmlPath: string | null;
    gcPath: string | null;
    manifesto: ChatManifesto;
    snapshotEm: unknown;
}
interface CompilerDb { collection(name: string): {doc(id: string): {update(fields: Record<string, unknown>): Promise<unknown>}} }
interface CompilerAdmin { firestore: { FieldValue: {serverTimestamp(): unknown; increment(value: number): unknown}} }
declare const require: (id: string) => unknown;
declare const module: {exports: unknown};

const { db, admin } = require('../../../services/firebase') as { db: CompilerDb; admin: CompilerAdmin };
const { compilarComPipeline } = require('../../../core/compilerPipeline') as { compilarComPipeline: (bp: ChatBlueprint, manifesto: ChatManifesto, user: ChatCompilerUser, status: (label: string) => void, ids: WorkspaceIds) => Promise<CompileOutput> };
const { refinarBlueprint } = require('../../../core/blueprintSelector') as { refinarBlueprint: (bp: ChatBlueprint) => Promise<{ blueprint: ChatBlueprint; report: CriticReport }> };
const { NICHO_PAGE_TYPE_MAP, PAGE_TYPES_SEM_SIDEBAR } = require('../../../core/blueprintCritics') as { NICHO_PAGE_TYPE_MAP: Record<string, string>; PAGE_TYPES_SEM_SIDEBAR: Set<string> };
const { modulosPadraoDoNicho } = require('../../../core/nichoModuleDefaults') as { modulosPadraoDoNicho: (nicho?: string) => NicheModuleDefaults };

// Nomes técnicos que nunca devem ser usados como siteName
const NOMES_TECNICOS_PROIBIDOS = new Set([
    'saas-nexus','viral-magazine','noticias-mag-news','tecnologia-mag-tech',
    'tecnologia-techwind','gamer-playerone','culinaria-boutique-gourmet',
    'natureza-bulma-vegan','elearning-academy','pop-retro-pixel',
    'portfolio-minimalista','biolink-social','brutalista-appcraft',
    'appstore-bulma-mobile','base','blog','magazine','saas','portfolio',
    'biolink','meu blog','meu site','teste','template','softload',
]);

// Defaults de módulos por nicho vêm de nichoModuleDefaults.js — fonte única
// de verdade compartilhada com compilerWorker.js (fluxo determinístico do
// Workspace), pra pageType e módulos não divergirem entre os dois fluxos
// (mesmo espírito de nichoTaxonomy.js).

/**
 * Converte o blueprint do chat (campos do marcador [[TEMPLATE:{...}]])
 * para o formato aceito por executarCompilacao() (compilerWorker).
 * Isso garante que o chassis correto é selecionado via NICHO_TEMPLATE_MAP.
 */
function _blueprintParaManifesto(bp: ChatBlueprint): ChatManifesto {
    const cf = Array.isArray(bp.coreFeatures) ? bp.coreFeatures : [];
    const pm = Array.isArray(bp.postModules)  ? bp.postModules  : [];

    // Rejeita siteName técnico — se a IA não perguntou o nome real, não compila
    const siteNameRaw = String(bp.siteName || '').trim();
    if (!siteNameRaw || NOMES_TECNICOS_PROIBIDOS.has(siteNameRaw.toLowerCase())) {
        throw new Error(`siteName inválido: "${siteNameRaw}". O nome real do blog não foi confirmado pelo usuário.`);
    }

    // Defaults por nicho (base) + overrides explícitos da IA (pm/cf)
    const nichoDefaults = modulosPadraoDoNicho(bp.nichoTema);

    // moduleOverrides — liga OU desliga um módulo genérico de chassis que
    // o usuário pediu explicitamente (já filtrado pela whitelist em
    // blueprintCritics.js, regra 17 — aqui só aplica o valor booleano
    // que sobreviveu ao filtro). Sem isso, os campos abaixo simplesmente
    // nunca apareceriam em manifesto.modules e cairiam de volta no
    // default do nicho dentro de compilerWorker.js/normalizarManifesto
    // (mesma fonte, resolvida de novo) — moduleOverrides teria zero efeito.
    const moduleOverrides: Partial<Record<string, boolean>> = (bp.moduleOverrides && typeof bp.moduleOverrides === 'object') ? bp.moduleOverrides : {};
    const comOverride = (campo: string, valorPadrao: boolean): boolean => (typeof moduleOverrides[campo] === 'boolean' ? moduleOverrides[campo] : valorPadrao);

    // Resolve o pageType canônico: usa o do blueprint (já validado pelos critics)
    // com fallback inferido do nichoTema, garantindo que sidebar e grid sejam corretos.
    const resolvedPageType = bp.pageType || NICHO_PAGE_TYPE_MAP[bp.nichoTema as string] || 'blogger-conteudo';
    const semSidebar = PAGE_TYPES_SEM_SIDEBAR.has(resolvedPageType);

    // description — resumo do que o usuário descreveu sobre o negócio/blog
    // (capturado do marcador, ver chatSystemPrompt.js). Antes desse campo
    // existir, essa informação só servia pra IA escolher o nichoTema e
    // depois era descartada — nunca chegava no manifesto nem no snapshot,
    // então nem uma sessão de edição futura conseguia recuperá-la. Não é
    // usada diretamente por executarCompilacao() (não é um parâmetro do
    // compilador) — o efeito real dela já aconteceu antes, quando a IA
    // escreveu o heroSubtitle a partir dela; aqui só evita que se perca.
    const descriptionRaw = String(bp.description || '').trim().slice(0, 240);

    const manifesto: ChatManifesto = {
        siteName:       siteNameRaw,
        description:    descriptionRaw || null,
        nichoTema:      bp.nichoTema      || null,
        colorPreset:    bp.colorPreset    || 'tech-blue',
        buttonStyle:    bp.buttonStyle    || 'default',
        typography:     bp.typography     || 'inter',
        gridLayout:     bp.gridLayout     || 'revista',
        footerStyle:     bp.footerStyle     || 'advanced-3-cols',
        // designVoice: 'auto' é resolvido pelo compilerWorker via NICHO_DESIGN_VOICE_MAP
        designVoice:    bp.designVoice    || 'auto',
        // landing-page, biolink e catalogo-produtos não têm sidebar de feed
        sidebarPosition: semSidebar ? 'none' : (bp.sidebarPosition || 'right'),
        heroTitle:       bp.heroTitle       || null,
        heroSubtitle:    bp.heroSubtitle    || null,
        enableSeo:      cf.includes('seo-premium'),
        lazyLoad:       cf.includes('lazy-load'),
        categoryBadges: (() => {
            if (!Array.isArray(bp.categoryBadges)) return [];
            const PALETA = ['#6366f1','#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6'];
            return bp.categoryBadges.slice(0, 8).map((b, i) => {
                if (b && typeof b === 'object' && b.nome) return b;
                const nome = typeof b === 'string' ? b : String(b);
                return { nome, bg: PALETA[i % PALETA.length], text: '#ffffff' };
            });
        })(),
        modules: {
            darkMode:        bp.darkMode === 'toggle-btn' || bp.darkMode === 'auto-system',
            backToTop:       nichoDefaults.backToTop       || false,
            shareButtons:    pm.includes('floating-share') || nichoDefaults.shareButtons    || false,
            readingTime:     pm.includes('reading-time')   || nichoDefaults.readingTime     || false,
            readingProgress: pm.includes('reading-time')   || nichoDefaults.readingProgress || false,
            toc:             pm.includes('toc')            || nichoDefaults.toc             || false,
            error404:        pm.includes('error-404')      || nichoDefaults.error404        || false,
            error404Theme:   nichoDefaults.error404Theme    || '',
            cookieBanner:    pm.includes('cookie-banner')  || nichoDefaults.cookieBanner    || false,
            dropcap:         nichoDefaults.dropcap         || false,
            reviewEngine:    nichoDefaults.reviewEngine    || false,
            sliderJson:      comOverride('sliderJson',   nichoDefaults.sliderJson   || false),
            relatedPosts:    comOverride('relatedPosts', nichoDefaults.relatedPosts || false),
            contactForm:      comOverride('contactForm', nichoDefaults.contactForm || false),
            contactFormTitle: nichoDefaults.contactFormTitle || '',
            popularPostsRanking:      comOverride('popularPostsRanking', nichoDefaults.popularPostsRanking || false),
            popularPostsRankingTitle: nichoDefaults.popularPostsRankingTitle || '',
            appDownloadCta:   nichoDefaults.appDownloadCta   || false,
            menuDropdownPrefixo: nichoDefaults.menuDropdownPrefixo || false,
            slotBefore:      pm.includes('ad-slot-before') || false,
            slotAfter:       pm.includes('ad-slot-after')  || false,
            // Mobília nativa (sidebar/rodapé, ver modules.js) — sem
            // moduleOverrides, cada uma cai no default do nicho, igual
            // seria se este campo nem existisse aqui (compilerWorker.js
            // aplicaria o mesmo default de qualquer forma). Explícitas
            // aqui só pra moduleOverrides ter algo pra sobrescrever.
            statsWidget:        comOverride('statsWidget',        nichoDefaults.statsWidget        || false),
            blogArchiveWidget:  comOverride('blogArchiveWidget',  nichoDefaults.blogArchiveWidget  || false),
            translateWidget:    comOverride('translateWidget',    nichoDefaults.translateWidget    || false),
            featuredPostWidget: comOverride('featuredPostWidget', nichoDefaults.featuredPostWidget || false),
            labelCloudWidget:   comOverride('labelCloudWidget',   nichoDefaults.labelCloudWidget   || false),
            socialLinksWidget:  comOverride('socialLinksWidget',  nichoDefaults.socialLinksWidget  || false),
            mobileMenuType:  (() => {
                // Explicit AI choice wins — 'offcanvas-right'/'hamburger-svg'/
                // 'hamburger-icons' já usam o mesmo nome nos dois lados (ver
                // MOBILE_MENU_VARIANTES em modules.js / MENU_VALIDOS em
                // compilerWorker.js) — repassados 1:1, sem tradução. Só
                // 'simple'→'classico' continua como caso especial (nome
                // histórico do vocabulário da IA).
                if (['offcanvas', 'offcanvas-right', 'hamburger-svg', 'hamburger-icons'].includes(bp.menuType as string)) return bp.menuType;
                if (bp.menuType === 'simple')    return 'classico';
                // Nicho default
                if (nichoDefaults.menuType)      return nichoDefaults.menuType;
                // Layout-based fallback
                const layout = bp.gridLayout || 'revista';
                return (layout === 'mural' || layout === 'revista') ? 'offcanvas' : 'classico';
            })(),
            commentsSystem:  pm.includes('comments-native') ? 'nativo'
                           : pm.includes('comments-disqus') ? 'disqus' : '',
        },
    };
    // Campos de design package — opcionais, passados diretamente ao compilador
    if (bp.darkTheme === true || bp.darkTheme === 'true') manifesto.darkTheme = true;
    if (typeof bp.customCss    === 'string' && bp.customCss.trim())    manifesto.customCss    = bp.customCss;
    if (typeof bp.svgLogo      === 'string' && bp.svgLogo.trim())      manifesto.svgLogo      = bp.svgLogo;
    if (typeof bp.heroHtml     === 'string' && bp.heroHtml.trim())     manifesto.heroHtml     = bp.heroHtml;
    if (typeof bp.staticSections === 'string' && bp.staticSections.trim()) manifesto.staticSections = bp.staticSections;
    return manifesto;
}

// Monta o snapshot persistido na sessão de workspace a partir de um downloadUrl
// + manifesto — reaproveitado tanto após gerar um template novo quanto após
// aplicar uma edição (chatEditFlow.js).
// xmlPath/gcPath (opcionais) — sem eles, o botão "Ver Demo" do Workspace
// falha com "Snapshot sem xmlPath" (ver views/pages/dashboard/workspace/index.ejs).
function _snapshotDeManifesto(downloadUrl: string, manifesto: ChatManifesto, xmlPath: string | null = null, gcPath: string | null = null): TemplateSnapshot {
    const compilacaoIdMatch = downloadUrl.match(/\/compilacao\/([^/]+)\/download/);
    return {
        compilacaoId: compilacaoIdMatch ? compilacaoIdMatch[1] : null,
        siteName:     manifesto.siteName    || null,
        colorPreset:  manifesto.colorPreset || 'tech-blue',
        typography:   manifesto.typography  || 'inter',
        gridLayout:   manifesto.gridLayout  || 'mural',
        nichoTema:    manifesto.nichoTema   || null,
        xmlPath:      xmlPath || null,
        gcPath:       gcPath  || null,
        manifesto,                          // registro completo — usado pelo worker de edição
        snapshotEm:   admin.firestore.FieldValue.serverTimestamp(),
    };
}

/**
 * Compila um blueprint extraído do marcador [[TEMPLATE:{...}]].
 * Espelha as garantias da rota /api/blogger-ai/compile: valida o XML
 * e verifica a cota de armazenamento ANTES do upload ao GCS, fechando
 * o bypass que existia no caminho do chat.
 *
 * Lança erro se a compilação, validação ou cota falhar — o caller
 * (handler SSE) captura e omite o downloadUrl sem derrubar a resposta.
 *
 * @param {object} blueprint — campos do blueprint (parcial ou completo)
 * @param {object} user      — req.session.user (uid, email, plano)
 * @param {object} [wsIds]   — { wsProjetoId, wsSessionId } opcionais — liga a
 *   compilação de volta à sessão do Workspace que a gerou, pra histórico de
 *   versões por sessão (ver workspace.js .../historico e .../reverter).
 * @returns {Promise<{ downloadUrl: string, snapshot: object }>}
 */
async function _compilarParaChat(blueprint: ChatBlueprint, user: ChatCompilerUser, sendEvent: SendCompilerEvent, wsIds: WorkspaceIds = {}): Promise<{downloadUrl: string; snapshot: TemplateSnapshot}> {
    // ── Critics + Refinamento ─────────────────────────────────────────────
    // Valida e auto-corrige o blueprint (regras), depois chama Gemini leve
    // para refinamento de coerência nicho × preset × layout quando necessário.
    sendEvent({ type: 'status', label: 'Validando blueprint...' });
    const { blueprint: blueprintFinal, report } = await refinarBlueprint(blueprint);

    if (report.correcoes.length > 0) {
        console.log(`[CRITICS] Auto-correcoes em "${blueprint.siteName}":`, report.correcoes.join(' | '));
    }
    if (report.criticas.length > 0) {
        console.warn(`[CRITICS] Avisos em "${blueprint.siteName}":`, report.criticas.join(' | '));
    }
    if (report.erros.length > 0) {
        throw new Error(`[CRITICS] Blueprint inválido — ${report.erros.join('; ')}`);
    }

    const manifesto = _blueprintParaManifesto(blueprintFinal);

    // Pipeline multi-stage: enriquece → compila → verifica → empacota → persiste
    // sendEvent é usado como callback de status para cada stage
    const onStatus = (label: string) => sendEvent({ type: 'status', label });

    const { downloadUrl, xmlPath, gcPath } = await compilarComPipeline(blueprintFinal, manifesto, user, onStatus, wsIds);

    // Atualiza contador de compilações (storage e compilacoes já tratados no pipeline)
    await db.collection('clientes_premium')
        .doc(user.email.toLowerCase())
        .update({ tentativas_compilacao: (require('firebase-admin') as CompilerAdmin).firestore.FieldValue.increment(1) })
        .catch(() => {});

    // Snapshot fresco desta compilação — usado para atualizar a sessão de
    // workspace vinculada (se houver), evitando que o chat continue injetando
    // no system prompt os dados do template ANTERIOR depois de gerar um novo.
    const snapshot = _snapshotDeManifesto(downloadUrl, manifesto, xmlPath, gcPath);
    return { downloadUrl, snapshot };
}

module.exports = {
    _blueprintParaManifesto,
    _compilarParaChat,
    _snapshotDeManifesto,
};

export {};

import { sanitizarInput, validarHex } from './compilerEngine/sanitize';

/** Configuração bruta recebida após a validação inicial do manifesto. */
export type ModuleInput = unknown;
/** Defaults existentes em nichoModuleDefaults.js; não são normalizados aqui. */
export type NicheModuleDefaults = Readonly<Record<string, unknown>>;

const MENU_VALIDOS = ['classico', 'offcanvas', 'offcanvas-right', 'hamburger-svg', 'hamburger-icons'];
const COMMENTS_VALIDOS = ['nativo', 'disqus'];

/**
 * Reproduz as escolhas do worker legado, na mesma ordem, inclusive a
 * precedência do valor explícito sobre os defaults do nicho. Importante:
 * Boolean('false') segue sendo true (contrato legado; sem novo parser aqui).
 */
export function normalizarModulosAtivos(modules: ModuleInput, nichoDefaults: NicheModuleDefaults): Record<string, unknown> {
    const m = modules && typeof modules === 'object' ? modules as Record<string, unknown> : {};
    const comDefault = (campo: string): boolean => m[campo] !== undefined ? Boolean(m[campo]) : Boolean(nichoDefaults[campo]);

    return {
        darkMode:        comDefault('darkMode'),
        backToTop:       comDefault('backToTop'),
        cookieBanner:    comDefault('cookieBanner'),
        toc:             comDefault('toc'),
        error404:        comDefault('error404'),
        error404Theme:   ['gamer', 'appstore', 'natureza', 'techwind', 'magnews'].includes(m.error404Theme as string) ? m.error404Theme : (nichoDefaults.error404Theme || ''),
        slotBefore:      Boolean(m.slotBefore),
        slotAfter:       Boolean(m.slotAfter),
        shareButtons:    comDefault('shareButtons'),
        readingProgress: comDefault('readingProgress'),
        readingTime:     comDefault('readingTime'),
        dropcap:         comDefault('dropcap'),
        reviewEngine:    comDefault('reviewEngine'),
        sliderJson:      comDefault('sliderJson'),
        relatedPosts:    comDefault('relatedPosts'),
        contactForm:     comDefault('contactForm'),
        contactFormTitle: typeof m.contactFormTitle === 'string' && m.contactFormTitle.trim()
            ? m.contactFormTitle.trim().substring(0, 60)
            : (nichoDefaults.contactFormTitle || ''),
        popularPostsRanking: comDefault('popularPostsRanking'),
        popularPostsRankingTitle: typeof m.popularPostsRankingTitle === 'string' && m.popularPostsRankingTitle.trim()
            ? m.popularPostsRankingTitle.trim().substring(0, 60)
            : (nichoDefaults.popularPostsRankingTitle || ''),
        appDownloadCta:  comDefault('appDownloadCta'),
        menuDropdownPrefixo: comDefault('menuDropdownPrefixo'),
        // Widgets nativos de sidebar/rodapé conforme nicho, não globais.
        statsWidget:     comDefault('statsWidget'),
        statsWidgetTitle: typeof m.statsWidgetTitle === 'string' && m.statsWidgetTitle.trim()
            ? m.statsWidgetTitle.trim().substring(0, 60)
            : (nichoDefaults.statsWidgetTitle || ''),
        blogArchiveWidget: comDefault('blogArchiveWidget'),
        blogArchiveWidgetTitle: typeof m.blogArchiveWidgetTitle === 'string' && m.blogArchiveWidgetTitle.trim()
            ? m.blogArchiveWidgetTitle.trim().substring(0, 60)
            : (nichoDefaults.blogArchiveWidgetTitle || ''),
        translateWidget: comDefault('translateWidget'),
        featuredPostWidget: comDefault('featuredPostWidget'),
        featuredPostWidgetTitle: typeof m.featuredPostWidgetTitle === 'string' && m.featuredPostWidgetTitle.trim()
            ? m.featuredPostWidgetTitle.trim().substring(0, 60)
            : (nichoDefaults.featuredPostWidgetTitle || ''),
        labelCloudWidget: comDefault('labelCloudWidget'),
        labelCloudWidgetTitle: typeof m.labelCloudWidgetTitle === 'string' && m.labelCloudWidgetTitle.trim()
            ? m.labelCloudWidgetTitle.trim().substring(0, 60)
            : (nichoDefaults.labelCloudWidgetTitle || ''),
        socialLinksWidget: comDefault('socialLinksWidget'),
        socialLinksWidgetTitle: typeof m.socialLinksWidgetTitle === 'string' && m.socialLinksWidgetTitle.trim()
            ? m.socialLinksWidgetTitle.trim().substring(0, 60)
            : (nichoDefaults.socialLinksWidgetTitle || ''),
        mobileMenuType:  MENU_VALIDOS.includes(m.mobileMenuType as string)     ? m.mobileMenuType  : (nichoDefaults.menuType || ''),
        commentsSystem:  COMMENTS_VALIDOS.includes(m.commentsSystem as string) ? m.commentsSystem  : '',
    };
}

export interface BadgeProcessado {
    nome: string;
    bg: string;
    text: string;
}

/**
 * Mantém as entradas legadas: ['FPS'], [{nome,bg,text}] ou {FPS:{bg,text}}.
 * Somente os 8 primeiros badges não vazios entram; cor válida retorna
 * exatamente a string original (sem trim), conforme validarHex legado.
 */
export function normalizarBadgesCategoria(categoryBadges: unknown): BadgeProcessado[] {
    let badgesProcessados: BadgeProcessado[] = [];
    if (categoryBadges) {
        const rawBadges = Array.isArray(categoryBadges)
            ? categoryBadges.map(b => (typeof b === 'string' ? { nome: b } : b))
            : Object.entries(categoryBadges as Record<string, Record<string, unknown>>).map(([nome, cores]) => ({ nome, ...cores }));

        badgesProcessados = rawBadges
            .filter(b => b && b.nome)
            .slice(0, 8)
            .map(b => ({
                nome: sanitizarInput(String(b.nome).substring(0, 40)),
                bg:   validarHex(b.bg)   ? b.bg   : '#3498db',
                text: validarHex(b.text) ? b.text : '#ffffff',
            }));
    }
    return badgesProcessados;
}

export interface WorkerConteudoInput {
    enableSeo?: unknown;
    lazyLoad?: unknown;
    description?: unknown;
    heroTitle?: unknown;
    heroSubtitle?: unknown;
    buttonStyle?: unknown;
}

export interface WorkerFlagsConteudo {
    seoAtivo: boolean;
    lazyLoadAtivo: boolean;
}

export interface WorkerTextosConteudo {
    description: string | null;
    heroTitle: string | null;
    heroSubtitle: string | null;
    buttonStyle: string;
}

/**
 * Mesmos defaults do worker: SEO ligado salvo opt-out estrito; lazyLoad
 * continua usando Boolean(valor), incluindo a string 'false' como true.
 */
export function normalizarFlagsConteudo(body: WorkerConteudoInput): WorkerFlagsConteudo {
    const seoAtivo = !(body.enableSeo === false || body.enableSeo === 'false');
    const lazyLoadAtivo = Boolean(body.lazyLoad === 'true' || body.lazyLoad === true || body.lazyLoad);
    return { seoAtivo, lazyLoadAtivo };
}

/**
 * Texto livre com os mesmos limites do manifesto legado. Não escapa XML
 * aqui: sanitização ocorre na etapa já existente do compilador.
 */
export function normalizarTextosConteudo(body: WorkerConteudoInput): WorkerTextosConteudo {
    const description = typeof body.description === 'string' && body.description.trim()
        ? body.description.trim().substring(0, 240)
        : null;
    const heroTitle = typeof body.heroTitle === 'string' && body.heroTitle.trim()
        ? body.heroTitle.trim().substring(0, 120)
        : null;
    const heroSubtitle = typeof body.heroSubtitle === 'string' && body.heroSubtitle.trim()
        ? body.heroSubtitle.trim().substring(0, 200)
        : null;
    const buttonStyle = typeof body.buttonStyle === 'string' ? body.buttonStyle : 'default';
    return { description, heroTitle, heroSubtitle, buttonStyle };
}

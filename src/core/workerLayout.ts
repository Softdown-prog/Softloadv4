/**
 * Identidade do site e defaults determinísticos de layout.
 * Não valida manifesto HTTP e não altera escolhas explícitas do usuário.
 */

/** Mantém truncamentos em unidades UTF-16 e a normalização NFD legada. */
export function normalizarIdentidadeSite(siteName: unknown): { siteNameBruto: string; slug: string } {
    const siteNameBruto = String(siteName).trim().substring(0, 60);
    const slug = siteNameBruto.toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .substring(0, 40) || 'template';
    return { siteNameBruto, slug };
}

// Duplicação intencional: mesmo mapa legado do compilerWorker; espelha as
// preferências de página do fluxo de chat, mas sem criar dependência circular.
const PAGINA_TIPO_GRID_ALTERNATIVAS: Readonly<Record<string, readonly string[]>> = {
    'portal-noticias':   ['mural', 'revista'],
    'magazine':          ['revista', 'mural'],
    'documentacao':      ['lista', 'dupla'],
    'catalogo-produtos': ['quadrado', 'mural'],
};

export interface WorkerLayoutInputs {
    siteNameBruto: string;
    nichoTema: string | null;
    nichoDefaults: Readonly<{ gridLayout?: string | null }>;
    pageTypeParaNicho: (nicho: string | null) => string | null;
    hashSeed: (seed: string) => number;
}

export interface WorkerLayoutDefaults {
    pageTypeAtual: string | null;
    gridLayoutDefault: string;
    sidebarPositionDefault: string;
}

/**
 * Seeds idênticos ao worker original. Nunca chamar Math.random nem trocar
 * o hash usado pelo blockLibrary; os mesmos sites mantêm a mesma grade.
 */
export function resolverLayoutPadrao(input: WorkerLayoutInputs): WorkerLayoutDefaults {
    const { siteNameBruto, nichoTema, nichoDefaults, pageTypeParaNicho, hashSeed } = input;
    const escolherEntre2PorSeed = (seed: string, papel: string, opcoes: readonly string[]): string =>
        opcoes[hashSeed((seed || '') + ':' + papel) % opcoes.length];

    const seedLayout = siteNameBruto + (nichoTema || '');
    const pageTypeAtual = pageTypeParaNicho(nichoTema);
    const gridAlternativas = PAGINA_TIPO_GRID_ALTERNATIVAS[pageTypeAtual ?? ''];
    const gridLayoutDefault = gridAlternativas
        ? escolherEntre2PorSeed(seedLayout, 'gridlayout', gridAlternativas)
        : (nichoDefaults.gridLayout || 'revista');
    const sidebarPositionDefault = escolherEntre2PorSeed(seedLayout, 'sidebar', ['right', 'left']);
    return { pageTypeAtual, gridLayoutDefault, sidebarPositionDefault };
}

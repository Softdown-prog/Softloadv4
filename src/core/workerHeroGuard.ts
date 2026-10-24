/** Gate determinístico do hero protegido por dossiê; sem I/O ou XML. */
export interface WorkerHeroDossier {
    pecas: readonly { tipo: string; protegida?: boolean }[];
}
export interface WorkerDesignPackageFields {
    heroHtml?: unknown;
    customCss?: unknown;
    svgLogo?: unknown;
    staticSections?: unknown;
    darkTheme?: unknown;
}

export function temHeroProtegido(dossie: WorkerHeroDossier | null | undefined): boolean {
    return !!(dossie && dossie.pecas.some(p => p.tipo === 'hero' && p.protegida));
}

/** Mantém todos os campos; descarta apenas o hero genérico quando protegido. */
export function prepararDesignPackage<T extends WorkerDesignPackageFields>(body: T, protegido: boolean): T {
    return protegido ? { ...body, heroHtml: undefined } : body;
}

/** Exatamente as mesmas cinco condições de ativação do worker legado. */
export function temCamposDesignPackage(body: WorkerDesignPackageFields): boolean {
    const CAMPOS = ['customCss', 'svgLogo', 'heroHtml', 'staticSections', 'darkTheme'] as const;
    return CAMPOS.some(c => body[c] !== undefined && body[c] !== null && body[c] !== '');
}

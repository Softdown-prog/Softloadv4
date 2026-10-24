/**
 * Fronteira de entrada do compilerWorker: verificações e escolhas determinísticas.
 * Não substitui a sanitização nem a normalização mais ampla do manifesto.
 */
export type WorkerEnums = Readonly<Record<string, readonly unknown[]>>;
export type VoiceHints = Readonly<Record<string, string>>;

const ENUM_DEFAULTS_WORKER: Readonly<Record<string, string>> = {
    colorPreset:     'tech-blue',
    typography:      'inter',
    buttonStyle:     'default',
    footerStyle:     'advanced-3-cols',
    designVoice:     'auto',
};

/** Mesmo contrato de erros e mesma ordem do validarManifesto legado. */
export function validarManifesto(body: unknown): string[] {
    const erros: string[] = [];

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        erros.push('Corpo da requisição não é um objeto JSON válido.');
        return erros;
    }

    const { siteName, modules } = body as { siteName?: unknown; modules?: unknown };

    if (!siteName || typeof siteName !== 'string' || siteName.trim().length < 2) {
        erros.push('siteName: obrigatório, mínimo 2 caracteres.');
    }

    if (modules !== undefined && (typeof modules !== 'object' || Array.isArray(modules))) {
        erros.push('modules: deve ser um objeto (ex: { darkMode: true, backToTop: false }).');
    }

    return erros;
}

/** Não antecipa a validação de body; os enums vêm do blueprintSchema legado. */
export function resolverEnum(
    valor: unknown,
    campo: string,
    fallback: string,
    enums: WorkerEnums,
): string {
    const validos = enums[campo];
    if (validos && validos.includes(valor)) return valor as string;
    return ENUM_DEFAULTS_WORKER[campo] ?? fallback;
}

/** Mantém prioridade nicho → paleta → vazio, inclusive 'auto' e entrada inválida. */
export function resolverDesignVoice(
    designVoice: unknown,
    nichoTema: unknown,
    colorPreset: unknown,
    enums: WorkerEnums,
    nichoVoices: VoiceHints,
    colorVoices: VoiceHints,
): string {
    const nichoNorm = typeof nichoTema === 'string' ? nichoTema.replace(/^tema-/, '').toLowerCase() : '';
    const raw = typeof designVoice === 'string' ? designVoice.trim() : 'auto';
    const validos = enums.designVoice || [];

    if (raw && raw !== 'auto' && validos.includes(raw)) return raw;

    return nichoVoices[nichoNorm]
        || colorVoices[colorPreset as string]
        || '';
}

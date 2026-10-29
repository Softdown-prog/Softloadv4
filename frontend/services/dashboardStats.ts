/** Dados da conta expostos pela API. Não transformar falhas em "zero". */
export interface DashboardStats {
    tentativasCompilacao: number;
    storageUsadoMb: number;
    storageLimitMb: number;
    creditos: number;
    creditosCicloTotal: number;
    creditosExpiraEm?: string | number | null;
    totalProjetos: number;
}

function numeroNaoNegativo(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function formatarDataConta(value: unknown): string | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleDateString('pt-BR') : null;
}

/** Não mostrar saldo/projetos fictícios se a API enviar resposta incompleta. */
export function normalizarDashboardStats(raw: unknown): DashboardStats | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const data = raw as Record<string, unknown>;
    const required = ['tentativasCompilacao', 'storageUsadoMb', 'storageLimitMb',
        'creditos', 'creditosCicloTotal', 'totalProjetos'] as const;
    if (!required.every(key => numeroNaoNegativo(data[key]))) return null;
    if (data.creditosExpiraEm !== null && data.creditosExpiraEm !== undefined
        && !formatarDataConta(data.creditosExpiraEm)) return null;
    return {
        tentativasCompilacao: data.tentativasCompilacao as number,
        storageUsadoMb: data.storageUsadoMb as number,
        storageLimitMb: data.storageLimitMb as number,
        creditos: data.creditos as number,
        creditosCicloTotal: data.creditosCicloTotal as number,
        creditosExpiraEm: (data.creditosExpiraEm as string | number | null | undefined) ?? null,
        totalProjetos: data.totalProjetos as number,
    };
}

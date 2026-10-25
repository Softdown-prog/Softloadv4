/** Prévia opt-in dos créditos V2. Jamais substitui o saldo legado. */
export interface CreditosV2Disponiveis {
  creditosDoCiclo: number;
  creditosDisponiveis: number;
  creditosConsumidos: number;
  creditosReservados: number;
  creditosExcedentes: number;
  preliminar: true;
}
export interface ResumoCreditosV2 {
  versao: 2;
  modo: 'previsualizacao';
  cicloExpiraEm: string;
  saldo: CreditosV2Disponiveis;
}
function contador(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}
export function normalizarResumoCreditosV2(raw: unknown): ResumoCreditosV2 | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.versao !== 2 || r.modo !== 'previsualizacao'
    || typeof r.cicloExpiraEm !== 'string' || !Number.isFinite(Date.parse(r.cicloExpiraEm))
    || !r.saldo || typeof r.saldo !== 'object' || Array.isArray(r.saldo)) return null;
  const s = r.saldo as Record<string, unknown>;
  const keys = ['creditosDoCiclo','creditosDisponiveis','creditosConsumidos','creditosReservados','creditosExcedentes'] as const;
  if (!keys.every(k => contador(s[k])) || s.preliminar !== true) return null;
  // API do orçamento usa créditos inteiros; dados inválidos não chegam à tela.
  if (s.creditosDisponiveis > s.creditosDoCiclo) return null;
  return {
    versao: 2, modo: 'previsualizacao', cicloExpiraEm: r.cicloExpiraEm,
    saldo: {
      creditosDoCiclo: s.creditosDoCiclo as number,
      creditosDisponiveis: s.creditosDisponiveis as number,
      creditosConsumidos: s.creditosConsumidos as number,
      creditosReservados: s.creditosReservados as number,
      creditosExcedentes: s.creditosExcedentes as number,
      preliminar: true,
    },
  };
}

/** 404/402/503 e falhas de rede ocultam a prévia, sem afetar o dashboard legado. */
export async function buscarPreviaCreditosV2(fetchImpl: typeof fetch = fetch): Promise<ResumoCreditosV2 | null> {
  try {
    const response = await fetchImpl('/api/ai-credits/v2', {
      credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    return normalizarResumoCreditosV2(await response.json());
  } catch {
    return null;
  }
}

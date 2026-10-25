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
  if ((s.creditosDisponiveis as number) > (s.creditosDoCiclo as number)) return null;
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

export interface LancamentoCreditosV2 {
  id: string;
  ferramenta: 'solaris-chat' | 'solaris-upload';
  modelo: string;
  projeto?: string;
  criadoEm: string;
  creditos: number;
  estimado: boolean;
}
export interface ExtratoCreditosV2 {
  versao: 2;
  modo: 'previsualizacao';
  itens: LancamentoCreditosV2[];
}
/** Estritamente aceita os campos necessários à exibição, sem preços internos ou prompts. */
export function normalizarExtratoCreditosV2(raw: unknown): ExtratoCreditosV2 | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r=raw as Record<string,unknown>;
  if (r.versao !== 2 || r.modo !== 'previsualizacao' || !Array.isArray(r.itens) || r.itens.length > 40) return null;
  const itens: LancamentoCreditosV2[]=[];
  for(const v of r.itens) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const x=v as Record<string,unknown>;
    if (typeof x.id !== 'string' || !/^[a-f0-9]{64}$/.test(x.id)
      || (x.ferramenta !== 'solaris-chat' && x.ferramenta !== 'solaris-upload')
      || typeof x.modelo !== 'string' || !/^gemini-[a-z0-9.-]{3,60}$/.test(x.modelo)
      || typeof x.criadoEm !== 'string' || !Number.isFinite(Date.parse(x.criadoEm))
      || !contador(x.creditos) || typeof x.estimado !== 'boolean'
      || (x.projeto !== undefined && (typeof x.projeto !== 'string' || !/^[A-Za-z0-9_-]{6,80}$/.test(x.projeto)))) return null;
    itens.push({id:x.id,ferramenta:x.ferramenta,modelo:x.modelo,criadoEm:x.criadoEm,
      ...(x.projeto ? {projeto:x.projeto as string} : {}),creditos:x.creditos,estimado:x.estimado});
  }
  return {versao:2,modo:'previsualizacao',itens};
}
export async function buscarExtratoCreditosV2(fetchImpl: typeof fetch = fetch): Promise<ExtratoCreditosV2 | null> {
  try {
    const response=await fetchImpl('/api/ai-credits/v2/history',{
      credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'},
    });
    return response.ok ? normalizarExtratoCreditosV2(await response.json()) : null;
  } catch {
    return null;
  }
}

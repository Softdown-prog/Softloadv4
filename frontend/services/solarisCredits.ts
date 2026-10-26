import { normalizarResumoCreditosV2 } from './creditsV2';

export interface SaldoSolarisVisual {
    fonte: 'legado' | 'v2' | 'indisponivel';
    disponiveis: number;
    total: number;
}
const INDISPONIVEL: SaldoSolarisVisual = { fonte: 'indisponivel', disponiveis: 0, total: 0 };

function valido(n: unknown): n is number {
    return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
}

/**
 * O Solaris pode usar o pool legado ou o orçamento por modelo V2.
 * Nunca exibir crédito legado como se fosse saldo V2 quando a consulta
 * do livro-razão falhar; fallback só com V2 explicitamente desligado
 * ou em modo de prévia (sem cobrar pelo V2).
 */
export async function consultarSaldoSolaris(fetchImpl: typeof fetch = fetch): Promise<SaldoSolarisVisual> {
    try {
        const respostaV2 = await fetchImpl('/api/ai-credits/v2', {
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { Accept: 'application/json' },
        });
        if (respostaV2.ok) {
            const resumo = normalizarResumoCreditosV2(await respostaV2.json());
            if (!resumo) return INDISPONIVEL;
            if (resumo.modo === 'ativo') {
                return { fonte: 'v2', disponiveis: resumo.saldo.creditosDisponiveis, total: resumo.saldo.creditosDoCiclo };
            }
        } else if (respostaV2.status === 404) {
            const detalhe = await respostaV2.json() as { codigo?: string };
            if (detalhe?.codigo !== 'CREDITOS_V2_DESABILITADOS') return INDISPONIVEL;
        } else {
            return INDISPONIVEL;
        }
        const legado = await fetchImpl('/api/chat/status', {
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { Accept: 'application/json' },
        });
        if (!legado.ok) return INDISPONIVEL;
        const dados = await legado.json() as { creditosGemini?: unknown; creditosGeminiTotal?: unknown };
        if (!valido(dados?.creditosGemini) || !valido(dados?.creditosGeminiTotal)) return INDISPONIVEL;
        return { fonte: 'legado', disponiveis: dados.creditosGemini, total: dados.creditosGeminiTotal };
    } catch {
        return INDISPONIVEL;
    }
}

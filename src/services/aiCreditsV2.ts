/**
 * Créditos de uso V2: representação do orçamento de IA em unidades amigáveis.
 * REGRA PROVISÓRIA: 1 crédito = R$ 0,01 do orçamento interno de API.
 * Nunca altera preços, concessões do Mercado Pago nem os créditos legados.
 * O custo da tarefa depende de modelo, input, output, cache e raciocínio.
 */
import { estimarCustoGemini, type UsoGeminiPrecificavel } from './geminiCost';

export const MICRO_BRL_POR_CREDITO_V2 = 10_000 as const;

export interface OrcamentoMicroBrl {
    limiteMicroBrl: number;
    gastoMicroBrl: number;
    reservadoMicroBrl: number;
}
export interface SaldoCreditosV2 {
    creditosDoCiclo: number;
    creditosDisponiveis: number;
    creditosConsumidos: number;
    creditosReservados: number;
    creditosExcedentes: number;
    unidadeMicroBrl: number;
    preliminar: true;
}
export interface PreviewConsumoV2 {
    modelo: string;
    creditosEstimados: number;
    custoMicroBrlEstimado: number;
    preliminar: true;
}
function inteiroNaoNegativo(n: unknown): n is number {
    return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
}
/**
 * Sempre arredonda o custo de uma tarefa para cima na unidade visível.
 * A contabilidade do Firestore permanece em micro-BRL (sem arredondamentos por tarefa).
 */
export function converterCustoEmCreditosV2(custoMicroBrl: number): number | null {
    if (!inteiroNaoNegativo(custoMicroBrl)) return null;
    return Math.ceil(custoMicroBrl / MICRO_BRL_POR_CREDITO_V2);
}

/**
 * Disponíveis usa floor: não promete um crédito inteiro quando o orçamento
 * restante só paga parte dele. Gasto/reservas usam ceil para transparência.
 */
export function converterSaldoEmCreditosV2(orcamento: OrcamentoMicroBrl): SaldoCreditosV2 | null {
    if (!orcamento || !inteiroNaoNegativo(orcamento.limiteMicroBrl)
        || !inteiroNaoNegativo(orcamento.gastoMicroBrl)
        || !inteiroNaoNegativo(orcamento.reservadoMicroBrl)
        || !Number.isSafeInteger(orcamento.gastoMicroBrl + orcamento.reservadoMicroBrl)) return null;
    const { limiteMicroBrl, gastoMicroBrl, reservadoMicroBrl } = orcamento;
    return {
        creditosDoCiclo: Math.floor(limiteMicroBrl / MICRO_BRL_POR_CREDITO_V2),
        creditosDisponiveis: Math.floor(Math.max(0, limiteMicroBrl - gastoMicroBrl - reservadoMicroBrl) / MICRO_BRL_POR_CREDITO_V2),
        creditosConsumidos: Math.ceil(gastoMicroBrl / MICRO_BRL_POR_CREDITO_V2),
        creditosReservados: Math.ceil(reservadoMicroBrl / MICRO_BRL_POR_CREDITO_V2),
        creditosExcedentes: Math.ceil(Math.max(0, gastoMicroBrl - limiteMicroBrl) / MICRO_BRL_POR_CREDITO_V2),
        unidadeMicroBrl: MICRO_BRL_POR_CREDITO_V2,
        preliminar: true,
    };
}
/** Exemplo de custo por tarefa, calculado com as tarifas estimadas da API. */
export function simularConsumoCreditosV2(uso: UsoGeminiPrecificavel): PreviewConsumoV2 | null {
    const custo = estimarCustoGemini(uso);
    if (!custo) return null; // modelos desconhecidos nunca são tratados como gratuitos
    const creditos = converterCustoEmCreditosV2(custo.custoMicroBrl);
    if (creditos === null) return null;
    return {
        modelo: custo.modelo,
        creditosEstimados: creditos,
        custoMicroBrlEstimado: custo.custoMicroBrl,
        preliminar: true,
    };
}

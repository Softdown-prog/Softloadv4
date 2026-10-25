"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MICRO_BRL_POR_CREDITO_V2 = void 0;
exports.converterCustoEmCreditosV2 = converterCustoEmCreditosV2;
exports.converterSaldoEmCreditosV2 = converterSaldoEmCreditosV2;
exports.simularConsumoCreditosV2 = simularConsumoCreditosV2;
/**
 * Créditos de uso V2: representação do orçamento de IA em unidades amigáveis.
 * REGRA PROVISÓRIA: 1 crédito = R$ 0,01 do orçamento interno de API.
 * Nunca altera preços, concessões do Mercado Pago nem os créditos legados.
 * O custo da tarefa depende de modelo, input, output, cache e raciocínio.
 */
const geminiCost_1 = require("./geminiCost");
exports.MICRO_BRL_POR_CREDITO_V2 = 10_000;
function inteiroNaoNegativo(n) {
    return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
}
/**
 * Sempre arredonda o custo de uma tarefa para cima na unidade visível.
 * A contabilidade do Firestore permanece em micro-BRL (sem arredondamentos por tarefa).
 */
function converterCustoEmCreditosV2(custoMicroBrl) {
    if (!inteiroNaoNegativo(custoMicroBrl))
        return null;
    return Math.ceil(custoMicroBrl / exports.MICRO_BRL_POR_CREDITO_V2);
}
/**
 * Disponíveis usa floor: não promete um crédito inteiro quando o orçamento
 * restante só paga parte dele. Gasto/reservas usam ceil para transparência.
 */
function converterSaldoEmCreditosV2(orcamento) {
    if (!orcamento || !inteiroNaoNegativo(orcamento.limiteMicroBrl)
        || !inteiroNaoNegativo(orcamento.gastoMicroBrl)
        || !inteiroNaoNegativo(orcamento.reservadoMicroBrl)
        || !Number.isSafeInteger(orcamento.gastoMicroBrl + orcamento.reservadoMicroBrl))
        return null;
    const { limiteMicroBrl, gastoMicroBrl, reservadoMicroBrl } = orcamento;
    return {
        creditosDoCiclo: Math.floor(limiteMicroBrl / exports.MICRO_BRL_POR_CREDITO_V2),
        creditosDisponiveis: Math.floor(Math.max(0, limiteMicroBrl - gastoMicroBrl - reservadoMicroBrl) / exports.MICRO_BRL_POR_CREDITO_V2),
        creditosConsumidos: Math.ceil(gastoMicroBrl / exports.MICRO_BRL_POR_CREDITO_V2),
        creditosReservados: Math.ceil(reservadoMicroBrl / exports.MICRO_BRL_POR_CREDITO_V2),
        creditosExcedentes: Math.ceil(Math.max(0, gastoMicroBrl - limiteMicroBrl) / exports.MICRO_BRL_POR_CREDITO_V2),
        unidadeMicroBrl: exports.MICRO_BRL_POR_CREDITO_V2,
        preliminar: true,
    };
}
/** Exemplo de custo por tarefa, calculado com as tarifas estimadas da API. */
function simularConsumoCreditosV2(uso) {
    const custo = (0, geminiCost_1.estimarCustoGemini)(uso);
    if (!custo)
        return null; // modelos desconhecidos nunca são tratados como gratuitos
    const creditos = converterCustoEmCreditosV2(custo.custoMicroBrl);
    if (creditos === null)
        return null;
    return {
        modelo: custo.modelo,
        creditosEstimados: creditos,
        custoMicroBrlEstimado: custo.custoMicroBrl,
        preliminar: true,
    };
}

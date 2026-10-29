"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRICES_CENTS = void 0;
exports.approvedPlanForPayment = approvedPlanForPayment;
/**
 * Regras puras de aprovação de plano após confirmação de pagamento.
 * Mantém os preços em centavos, a tolerância numérica histórica e a exigência
 * de status 'approved' e moeda BRL; não realiza chamadas ao Mercado Pago.
 */
exports.PRICES_CENTS = Object.freeze({ starter: 2990, pro: 3990, studio: 5990, essencial: 500 });
/** Retorna o plano recebido somente se o valor aprovado corresponder ao plano pendente. */
function approvedPlanForPayment(payment, pendingPlan) {
    if (!Object.hasOwn(exports.PRICES_CENTS, pendingPlan))
        return null;
    if (payment?.status !== 'approved' || payment?.currency_id !== 'BRL')
        return null;
    const amount = Number(payment.transaction_amount);
    if (!Number.isFinite(amount) || Math.abs(amount * 100 - exports.PRICES_CENTS[pendingPlan]) > 0.000001)
        return null;
    return pendingPlan;
}

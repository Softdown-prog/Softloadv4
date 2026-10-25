/**
 * Regras puras de aprovação de plano após confirmação de pagamento.
 * Mantém os preços em centavos, a tolerância numérica histórica e a exigência
 * de status 'approved' e moeda BRL; não realiza chamadas ao Mercado Pago.
 */
export const PRICES_CENTS = Object.freeze({ starter: 4900, pro: 11900, studio: 24900 });
export type PlanCode = keyof typeof PRICES_CENTS;

export interface PaymentForPlanApproval {
    status?: unknown;
    currency_id?: unknown;
    transaction_amount?: unknown;
}

/** Retorna o plano recebido somente se o valor aprovado corresponder ao plano pendente. */
export function approvedPlanForPayment(
    payment: PaymentForPlanApproval | null | undefined,
    pendingPlan: unknown,
): PlanCode | null {
    if (!Object.hasOwn(PRICES_CENTS, pendingPlan as PropertyKey)) return null;
    if (payment?.status !== 'approved' || payment?.currency_id !== 'BRL') return null;
    const amount = Number(payment.transaction_amount);
    if (!Number.isFinite(amount) || Math.abs(amount * 100 - PRICES_CENTS[pendingPlan as PlanCode]) > 0.000001) return null;
    return pendingPlan as PlanCode;
}

'use strict';

const PRICES_CENTS = Object.freeze({ starter: 4900, pro: 11900, studio: 24900 });

function approvedPlanForPayment(payment, pendingPlan) {
    if (!Object.hasOwn(PRICES_CENTS, pendingPlan)) return null;
    if (payment?.status !== 'approved' || payment?.currency_id !== 'BRL') return null;
    const amount = Number(payment.transaction_amount);
    if (!Number.isFinite(amount) || Math.abs(amount * 100 - PRICES_CENTS[pendingPlan]) > 0.000001) return null;
    return pendingPlan;
}

module.exports = { approvedPlanForPayment, PRICES_CENTS };

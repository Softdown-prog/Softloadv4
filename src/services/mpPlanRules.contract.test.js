'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { approvedPlanForPayment, PRICES_CENTS } = require('./mpPlanRules');

const approved = (amount, overrides = {}) => ({ status: 'approved', currency_id: 'BRL', transaction_amount: amount, ...overrides });

test('preços permanecem congelados, em centavos, e planos só aprovam pelo valor exato', () => {
    assert.deepEqual(PRICES_CENTS, { starter: 2990, pro: 3990, studio: 5990 });
    assert.equal(Object.isFrozen(PRICES_CENTS), true);
    for (const [plan, cents] of Object.entries(PRICES_CENTS)) {
        const amount = cents / 100;
        assert.equal(approvedPlanForPayment(approved(amount), plan), plan);
        assert.equal(approvedPlanForPayment(approved(amount - 1), plan), null);
        assert.equal(approvedPlanForPayment(approved(amount + 1), plan), null);
        assert.equal(approvedPlanForPayment(approved(amount - 0.001), plan), null);
    }
});

test('status, moeda e plano pendente são verificados antes de liberar assinatura', () => {
    for (const status of ['pending', 'cancelled', 'rejected', 'refunded', undefined, null, 'APPROVED']) {
        assert.equal(approvedPlanForPayment(approved(29.90, {status}), 'starter'), null);
    }
    for (const currency_id of ['USD', 'EUR', 'brl', '', null, undefined]) {
        assert.equal(approvedPlanForPayment(approved(29.90, {currency_id}), 'starter'), null);
    }
    for (const plan of ['unknown', '', 'constructor', '__proto__', undefined, null]) {
        assert.equal(approvedPlanForPayment(approved(29.90), plan), null);
    }
    assert.equal(approvedPlanForPayment(approved(29.90), 'pro'), null);
    assert.equal(approvedPlanForPayment(approved(39.90), 'starter'), null);
});

test('rejeita valores não numéricos, infinitos, ausentes ou zero', () => {
    for (const amount of [undefined, 'abc', 'NaN', NaN, Infinity, -Infinity, 0, -29.90, {}, null]) {
        assert.equal(approvedPlanForPayment(approved(amount), 'starter'), null);
    }
    assert.equal(approvedPlanForPayment(null, 'starter'), null);
    assert.equal(approvedPlanForPayment(undefined, 'starter'), null);
});

test('mantém conversão Number e tolerância numérica legadas sem arredondar centavos', () => {
    assert.equal(approvedPlanForPayment(approved('29.9'), 'starter'), 'starter');
    assert.equal(approvedPlanForPayment(approved('29.90'), 'starter'), 'starter');
    assert.equal(approvedPlanForPayment(approved(29.900000001), 'starter'), 'starter');
    assert.equal(approvedPlanForPayment(approved(29.900001), 'starter'), null);
    assert.equal(approvedPlanForPayment(approved(29.899999), 'starter'), null);
});

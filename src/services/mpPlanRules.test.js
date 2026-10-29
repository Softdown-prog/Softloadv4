'use strict';

const assert = require('node:assert/strict');
const { approvedPlanForPayment } = require('./mpPlanRules');

for (const [plan, amount] of [['starter', 29.90], ['pro', 39.90], ['studio', 59.90], ['essencial', 5.00]]) {
    assert.equal(approvedPlanForPayment({ status: 'approved', currency_id: 'BRL', transaction_amount: amount }, plan), plan);
    assert.equal(approvedPlanForPayment({ status: 'approved', currency_id: 'BRL', transaction_amount: amount - 1 }, plan), null);
    assert.equal(approvedPlanForPayment({ status: 'approved', currency_id: 'BRL', transaction_amount: amount - 0.001 }, plan), null);
}
assert.equal(approvedPlanForPayment({ status: 'pending', currency_id: 'BRL', transaction_amount: 29.90 }, 'starter'), null);
assert.equal(approvedPlanForPayment({ status: 'approved', currency_id: 'USD', transaction_amount: 29.90 }, 'starter'), null);
assert.equal(approvedPlanForPayment({ status: 'approved', currency_id: 'BRL', transaction_amount: 29.90 }, 'unknown'), null);
assert.equal(approvedPlanForPayment({ status: 'approved', currency_id: 'BRL', transaction_amount: 29.90 }, undefined), null);
console.log('MP plan validation: approved amount, currency and pending plan checks passed');

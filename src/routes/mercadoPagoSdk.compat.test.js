'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('Mercado Pago SDK v3 keeps checkout and webhook client contract without network access', () => {
  const sdk = require('mercadopago');
  assert.equal(typeof sdk.MercadoPagoConfig, 'function');
  assert.equal(typeof sdk.Payment, 'function');
  assert.equal(typeof sdk.Preference, 'function');
  const client = new sdk.MercadoPagoConfig({ accessToken: 'TEST-OFFLINE-NO-REAL-CREDENTIALS' });
  const payment = new sdk.Payment(client);
  const preference = new sdk.Preference(client);
  assert.equal(typeof payment.get, 'function');
  assert.equal(typeof preference.create, 'function');
  // Never call the methods here: no real payments or third-party requests in CI.
});

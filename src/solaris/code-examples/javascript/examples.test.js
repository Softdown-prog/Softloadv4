'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { retry } = require('./retry-exponencial');
const { mapWithConcurrency } = require('./concorrencia-limitada');
const { paginate } = require('./paginacao-segura');
const { calculateCart } = require('./dinheiro-em-centavos');
const { LruCache } = require('./cache-lru');
const { createEventBus } = require('./emissor-eventos');

test('retry retorna sucesso após falhas transitórias e usa backoff', async () => {
  let calls = 0;
  const intervals = [];
  const value = await retry(() => {
    if (++calls < 3) throw new Error('temporário');
    return 'ok';
  }, { attempts: 4, baseDelayMs: 25, sleep: async ms => { intervals.push(ms); } });
  assert.equal(value, 'ok');
  assert.deepEqual(intervals, [25, 50]);
  await assert.rejects(retry(async () => { throw new Error('permanente'); },
    { attempts: 2, baseDelayMs: 0, sleep: async () => {} }), /permanente/);
  await assert.rejects(retry(async () => 'ok', { attempts: 0 }), /attempts/);
});
test('pool mantém ordem, limita simultaneidade e propaga falhas', async () => {
  let active = 0, max = 0;
  const result = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async value => {
    active++; max = Math.max(max, active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return value * 2;
  });
  assert.deepEqual(result, [2, 4, 6, 8, 10]);
  assert.ok(max <= 2);
  assert.deepEqual(await mapWithConcurrency([], 3, async () => 0), []);
  await assert.rejects(mapWithConcurrency([1], 1, async () => { throw new Error('boom'); }), /boom/);
});
test('paginação previne entradas negativas, incorretas e enormes', () => {
  assert.deepEqual(paginate(), { page: 1, pageSize: 20, limit: 20, offset: 0 });
  assert.deepEqual(paginate({ page: '3', pageSize: '15' }), { page: 3, pageSize: 15, limit: 15, offset: 30 });
  assert.throws(() => paginate({ page: '1abc' }), /page/);
  assert.throws(() => paginate({ pageSize: 101 }), /pageSize/);
  assert.throws(() => paginate({ page: '-1' }), /page/);
  assert.throws(() => paginate({ page: 1e12 }), /page/);
});
test('preço em centavos inclui desconto limitado e valida overflow', () => {
  assert.deepEqual(calculateCart([{ unitPriceCents: 1999, quantity: 2 }, { unitPriceCents: 200, quantity: 1 }], 400),
    { subtotalCents: 4198, appliedDiscountCents: 400, totalCents: 3798 });
  assert.deepEqual(calculateCart([], 100), { subtotalCents: 0, appliedDiscountCents: 0, totalCents: 0 });
  assert.throws(() => calculateCart([{ unitPriceCents: 19.99, quantity: 1 }]), /inválido/);
  assert.throws(() => calculateCart([{ unitPriceCents: Number.MAX_SAFE_INTEGER, quantity: 2 }]), /precisão/);
});
test('LRU mantém capacidade e atualiza recência ao acessar', () => {
  const cache = new LruCache(2);
  cache.set('a', 1).set('b', 2);
  assert.equal(cache.get('a'), 1);
  cache.set('c', 3);
  assert.equal(cache.has('b'), false);
  assert.equal(cache.size, 2);
  assert.equal(cache.get('c'), 3);
  assert.throws(() => new LruCache(0), /capacity/);
});
test('event bus unsubscribe e snapshot de listeners', () => {
  const bus = createEventBus();
  const values = [];
  const off = bus.on('change', value => { values.push(value); off(); });
  const off2 = bus.on('change', value => values.push(value * 10));
  bus.emit('change', 2);
  bus.emit('change', 3);
  assert.deepEqual(values, [2, 20, 30]);
  off2();
  bus.emit('change', 4);
  assert.deepEqual(values, [2, 20, 30]);
});

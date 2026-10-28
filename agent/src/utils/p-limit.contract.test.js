'use strict';
import test from 'node:test';
import assert from 'node:assert/strict';

test('p-limit 7 serializes concurrent Agent tasks without losing order', async () => {
  const { default: pLimit } = await import('p-limit');
  const limit = pLimit(2);
  let active = 0;
  let peak = 0;
  const results = await Promise.all(Array.from({length: 6}, (_, i) => limit(async () => {
    active++;
    peak = Math.max(peak, active);
    try {
      await Promise.resolve();
      await Promise.resolve();
      return i;
    } finally {
      active--;
    }
  })));
  assert.equal(peak, 2);
  assert.equal(active, 0);
  assert.deepEqual(results, [0, 1, 2, 3, 4, 5]);
});

test('p-limit 7 keeps processing queued Agent tasks after one rejection', async () => {
  const { default: pLimit } = await import('p-limit');
  const limit = pLimit(1);
  const results = await Promise.allSettled([
    limit(async () => 'first'),
    limit(async () => { throw new Error('simulated job failure'); }),
    limit(async () => 'third'),
  ]);
  assert.deepEqual(results.map(item => item.status), ['fulfilled', 'rejected', 'fulfilled']);
  assert.equal(results[0].value, 'first');
  assert.match(results[1].reason.message, /simulated job failure/);
  assert.equal(results[2].value, 'third');
  assert.equal(limit.activeCount, 0);
  assert.equal(limit.pendingCount, 0);
});

'use strict';

// Worker pool determinístico: preserva a posição original do item.
async function mapWithConcurrency(items, concurrency, worker) {
  if (!Array.isArray(items) || typeof worker !== 'function') throw new TypeError('parâmetros inválidos');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) throw new RangeError('concorrência inválida');
  const results = new Array(items.length);
  let nextIndex = 0;
  async function runner() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runner));
  return results;
}
module.exports = { mapWithConcurrency };

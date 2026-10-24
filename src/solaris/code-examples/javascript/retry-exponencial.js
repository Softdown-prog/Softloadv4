'use strict';

// Retry somente para operações que podem ser repetidas com segurança.
// Injete sleep nos testes para não depender de relógio real.
async function retry(operation, { attempts = 3, baseDelayMs = 100, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  if (typeof operation !== 'function') throw new TypeError('operation precisa ser função');
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 6) throw new RangeError('attempts entre 1 e 6');
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0 || baseDelayMs > 10000) throw new RangeError('baseDelayMs inválido');
  for (let index = 0; index < attempts; index++) {
    try {
      return await operation(index + 1);
    } catch (error) {
      if (index === attempts - 1) throw error;
      await sleep(baseDelayMs * 2 ** index);
    }
  }
}
module.exports = { retry };

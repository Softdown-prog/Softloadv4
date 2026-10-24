'use strict';
// O sinal externo é combinado ao timeout sem perder cancelamento do usuário.
async function fetchWithTimeout(url, { timeoutMs = 3000, signal, fetchImpl = fetch, ...options } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
    throw new RangeError('timeoutMs fora do intervalo');
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl inválido');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('HTTP timeout')), timeoutMs);
  let onAbort;
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else {
      onAbort = () => controller.abort(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
    }
  }
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
  }
}
module.exports = { fetchWithTimeout };

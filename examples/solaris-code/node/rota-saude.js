'use strict';
const { Router } = require('express');

// A função ready é injetada para permitir testes sem banco real.
function healthRouter({ ready = async () => true } = {}) {
  if (typeof ready !== 'function') throw new TypeError('ready precisa ser função');
  const router = Router();
  router.get('/health/live', (_req, res) => {
    res.set('Cache-Control', 'no-store').status(200).json({ status: 'alive' });
  });
  router.get('/health/ready', async (_req, res) => {
    try {
      const ok = await ready();
      res.set('Cache-Control', 'no-store').status(ok === true ? 200 : 503)
        .json({ status: ok === true ? 'ready' : 'unavailable' });
    } catch {
      res.set('Cache-Control', 'no-store').status(503).json({ status: 'unavailable' });
    }
  });
  return router;
}
module.exports = { healthRouter };

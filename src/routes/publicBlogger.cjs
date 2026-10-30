'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('node:crypto');
const compiler = require('./dashboard_routes/compiler');

const router = express.Router();
const GUEST_LIMIT = 2;
const inProgress = new Set();
const guestThrottle = rateLimit({
  windowMs: 60 * 60 * 1000, limit: 8,
  standardHeaders: 'draft-8', legacyHeaders: false,
  message: 'Limite temporário de solicitações alcançado. Tente novamente mais tarde.'
});
function isSameOrigin(req) {
  const origin = req.get('origin');
  if (!origin) return true; // CSRF token permanece obrigatório mesmo sem Origin.
  try { return new URL(origin).host === req.get('host'); }
  catch { return false; }
}
function tokenValid(expected, received) {
  return typeof expected === 'string' && typeof received === 'string' &&
    /^[a-f0-9]{48}$/.test(expected) && /^[a-f0-9]{48}$/.test(received) &&
    crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
}
function publicOptions(req) {
  const {cores, fontes} = compiler.publicPresets();
  return {
    user: null,
    nichos: compiler.publicCatalog(), cores, fontes, exemplos: compiler.publicExamples(),
    gratuitoLimite: GUEST_LIMIT, guestMode: true, activePage: null,
    guestToken: req.session.bloggerGuestToken, downloadPath: '/criar/download'
  };
}
router.get('/criar', (req, res) => {
  if (req.session?.user) return res.redirect(302, '/dashboard/gerador-blogger');
  if (!req.session) return res.status(503).send('Sessão indisponível. Tente novamente.');
  if (typeof req.session.bloggerGuestToken !== 'string' ||
      !/^[a-f0-9]{48}$/.test(req.session.bloggerGuestToken)) {
    req.session.bloggerGuestToken = crypto.randomBytes(24).toString('hex');
  }
  return res.render('pages/gerador-blogger', publicOptions(req));
});
router.post('/criar/download', guestThrottle, async (req, res) => {
  if (req.session?.user) return res.redirect(303, '/dashboard/gerador-blogger');
  if (!req.session) return res.status(503).send('Sessão indisponível.');
  if (!isSameOrigin(req) || !tokenValid(req.session.bloggerGuestToken, req.body?.guestToken)) {
    return res.status(403).send('Formulário expirado. Reabra o gerador e tente novamente.');
  }
  const sid = req.sessionID;
  if (typeof sid !== 'string' || !sid) return res.status(503).send('Sessão indisponível.');
  if (inProgress.has(sid)) return res.status(429).send('Já existe um download em andamento.');
  inProgress.add(sid);
  try {
    const count = Number.isSafeInteger(req.session.bloggerGuestDownloads) && req.session.bloggerGuestDownloads >= 0
      ? req.session.bloggerGuestDownloads : 0;
    if (count >= GUEST_LIMIT) {
      return res.status(429).send('Seus testes sem cadastro nesta sessão terminaram. Crie uma conta para obter mais opções de uso.');
    }
    let result;
    try { result = compiler.publicCompile(req.body); }
    catch(err) {
      return res.status(422).type('text/plain; charset=utf-8').send(err.message || 'Configuração inválida.');
    }
    // Persistir a cota ANTES de enviar o arquivo, sem gravar usuário anônimo em clientes_premium.
    req.session.bloggerGuestDownloads = count + 1;
    try {
      await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
    } catch(err) {
      req.session.bloggerGuestDownloads = count;
      return res.status(503).send('Não foi possível salvar sua sessão. Nenhum teste foi debitado.');
    }
    const filename = (result.slug || 'blogger').replace(/[^a-z0-9-]/g, '').slice(0,40) || 'blogger';
    return res.status(200).set({
      'Content-Type':'application/xml; charset=utf-8',
      'Content-Disposition':'attachment; filename="' + filename + '.xml"',
      'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'
    }).send(result.xmlFinal);
  } finally { inProgress.delete(sid); }
});
module.exports = router;

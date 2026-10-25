"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cors = require('cors');
const isProd = process.env.NODE_ENV === 'production';
// ── Origens permitidas pelo CORS ─────────────────────────────────────────────
const corsOptions = {
    origin: true,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    optionsSuccessStatus: 200,
};
// ── Security headers manuais (sem Helmet) ────────────────────────────────────
// same-origin-allow-popups: permite janelas de OAuth e Checkout Pro (Mercado Pago)
// sem bloquear o contexto de navegação do opener — ao contrário de 'same-origin'.
function helmetMiddleware(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    if (isProd)
        res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    next();
}
module.exports = {
    helmetMiddleware,
    corsMiddleware: cors(corsOptions),
};

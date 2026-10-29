'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { exigirLogin } = require('../../middlewares/authGuard');
const { executarCompilacao } = require('../../core/compilerWorker');
const { validarXmlCompilado, validarXmlEstrutura, validarSemanticaBlogger } = require('../../core/xmlValidator');
const { COLOR_PRESETS, TYPOGRAPHY_PRESETS } = require('../../core/presets');
const { NICHO_PAGE_TYPE_MAP, PAGE_TYPES_SEM_CHASSIS_DEDICADO } = require('../../core/nichoTaxonomy');
const { db } = require('../../services/firebase');
const NICHO_NOMES = Object.freeze({
    'gamer-playerone': 'Games e reviews', 'pop-retro-pixel': 'Cultura pop e retrô',
    'culinaria-boutique-gourmet': 'Culinária e receitas', 'natureza-bulma-vegan': 'Vegano e natureza',
    'noticias-mag-news': 'Notícias e jornalismo', 'tecnologia-mag-tech': 'Tecnologia e análises',
    'tecnologia-techwind': 'Programação e tecnologia', 'viral-magazine': 'Revista e tendências',
    'saas-nexus': 'Software e negócios', 'brutalista-appcraft': 'Aplicativos e startups',
    'portfolio-minimalista': 'Portfólio minimalista', 'aquarela': 'Portfólio artístico',
    'biolink-social': 'Links e redes sociais', 'elearning-academy': 'Educação e cursos',
    'appstore-bulma-mobile': 'Catálogo de aplicativos'
});
const LAYOUTS = new Set(['lista', 'dupla', 'revista', 'quadrado', 'mural', 'coluna-unica', 'zigzag']);
const SIDEBARS = new Set(['right', 'left', 'none']);
const MAX_FREE_DOWNLOADS = 2;
const limite = rateLimit({ windowMs: 60000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false,
    message: 'Muitas gerações em pouco tempo. Tente novamente mais tarde.' });
function catalogo() {
    return Object.keys(NICHO_PAGE_TYPE_MAP).sort((a, b) => (NICHO_NOMES[a] || a).localeCompare(NICHO_NOMES[b] || b, 'pt-BR')).map(id => ({
        id, nome: NICHO_NOMES[id] || id, pageType: NICHO_PAGE_TYPE_MAP[id],
        aviso: PAGE_TYPES_SEM_CHASSIS_DEDICADO.has(NICHO_PAGE_TYPE_MAP[id])
            ? 'Utiliza a estrutura de blog enquanto não há estrutura dedicada.' : null
    }));
}
function normalizar(body) {
    const nome = typeof body?.siteName === 'string' ? body.siteName.trim() : '';
    if (nome.length < 2 || nome.length > 60)
        throw new Error('Informe um nome com 2 a 60 caracteres.');
    const modo = body?.modo === 'modelo' ? 'modelo' : body?.modo === 'novo' ? 'novo' : null;
    if (!modo)
        throw new Error('Selecione como deseja começar: do zero ou a partir de um nicho.');
    const nicho = body?.nichoTema;
    if (modo === 'modelo' && (typeof nicho !== 'string' || !Object.hasOwn(NICHO_PAGE_TYPE_MAP, nicho)))
        throw new Error('Selecione um nicho válido do catálogo.');
    const cor = typeof body?.colorPreset === 'string' ? body.colorPreset : 'tech-blue';
    if (!Object.hasOwn(COLOR_PRESETS, cor))
        throw new Error('A paleta de cor não é válida.');
    const grade = body?.gridLayout || 'revista';
    const barra = body?.sidebarPosition || 'right';
    const fonte = body?.typography || 'inter';
    if (!LAYOUTS.has(grade) || !SIDEBARS.has(barra) || !Object.hasOwn(TYPOGRAPHY_PRESETS, fonte))
        throw new Error('Uma das opções de layout, fonte ou barra lateral é inválida.');
    return {
        siteName: nome, nichoTema: modo === 'modelo' ? nicho : null, modo,
        colorPreset: cor, gridLayout: grade, sidebarPosition: barra, typography: fonte
    };
}
function compilarSemIa(body) {
    const op = normalizar(body);
    const { xmlFinal, slug } = executarCompilacao({
        siteName: op.siteName, nichoTema: op.nichoTema, colorPreset: op.colorPreset,
        gridLayout: op.gridLayout, sidebarPosition: op.sidebarPosition, typography: op.typography
    });
    const erros = [...validarXmlCompilado(xmlFinal), ...validarXmlEstrutura(xmlFinal).erros,
        ...validarSemanticaBlogger(xmlFinal).erros];
    if (erros.length)
        throw new Error('O XML não passou nas verificações: ' + erros.slice(0, 3).join(' | '));
    if (!xmlFinal.includes("id='Blog1'") && !xmlFinal.includes('id="Blog1"'))
        throw new Error('O XML gerado não contém o widget obrigatório Blog1.');
    return { xmlFinal, slug, op };
}
async function debitarTesteGratuito(user) {
    const email = typeof user?.email === 'string' ? user.email.trim().toLowerCase() : '';
    if (!email)
        throw new Error('Conta não identificada. Entre novamente.');
    const ref = db.collection('clientes_premium').doc(email);
    const hoje = Date.now();
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const dados = snap.exists ? snap.data() || {} : {};
        const venc = Date.parse(dados.premium_ate || '');
        const pago = dados.is_active === true && Number.isFinite(venc) && venc >= hoje &&
            dados.plano !== 'free';
        if (pago)
            return { gratuito: false, restantes: null };
        const usado = Number.isSafeInteger(dados.gerador_sem_ia_testes_usados) &&
            dados.gerador_sem_ia_testes_usados >= 0 ? dados.gerador_sem_ia_testes_usados : 0;
        if (usado >= MAX_FREE_DOWNLOADS) {
            const err = new Error('Você já utilizou seus 2 downloads gratuitos. O plano de R$ 5 está sendo preparado.');
            err.status = 402;
            throw err;
        }
        tx.set(ref, { gerador_sem_ia_testes_usados: usado + 1 }, { merge: true });
        return { gratuito: true, restantes: MAX_FREE_DOWNLOADS - usado - 1 };
    });
}
router.get('/dashboard/gerador-blogger', exigirLogin, (req, res) => {
    res.render('pages/gerador-blogger', { activePage: 'gerador-blogger', user: req.session.user,
        nichos: catalogo(), cores: Object.entries(COLOR_PRESETS).map(([id, p]) => ({ id, nome: p.label })),
        fontes: Object.entries(TYPOGRAPHY_PRESETS).map(([id, p]) => ({ id, nome: p.label })),
        gratuitoLimite: MAX_FREE_DOWNLOADS });
});
router.post('/dashboard/gerador-blogger/download', exigirLogin, limite, async (req, res) => {
    const origin = req.get('origin');
    if (origin) {
        try {
            if (new URL(origin).host !== req.get('host'))
                return res.status(403).send('Origem não autorizada.');
        }
        catch {
            return res.status(403).send('Origem inválida.');
        }
    }
    let resultado;
    try {
        resultado = compilarSemIa(req.body);
    }
    catch (err) {
        return res.status(422).type('text/plain; charset=utf-8').send(err.message || 'Configuração inválida.');
    }
    try {
        await debitarTesteGratuito(req.session.user);
    }
    catch (err) {
        return res.status(err.status || 503).type('text/plain; charset=utf-8')
            .send(err.status === 402 ? err.message : 'Não foi possível verificar a cota de testes. Nenhum download foi cobrado.');
    }
    const filename = (resultado.slug || 'template').replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'template';
    return res.status(200).set({
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': 'attachment; filename="' + filename + '.xml"',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
    }).send(resultado.xmlFinal);
});
router.get('/dashboard/compiler', exigirLogin, (_req, res) => res.redirect(302, '/dashboard/gerador-blogger'));
router.get('/dashboard/compiler-blogger-xml', exigirLogin, (_req, res) => res.redirect(302, '/dashboard/gerador-blogger'));
const forgeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 2, standardHeaders: 'draft-8', legacyHeaders: false,
  message: 'Muitas gerações de assets em pouco tempo. Tente novamente mais tarde.' });
router.get('/dashboard/forge-2d', exigirLogin, (req,res) => require('./forgeStandalone.cjs').show(req,res));
router.post('/dashboard/forge-2d/download', exigirLogin, forgeLimiter, (req,res) => require('./forgeStandalone.cjs').download(req,res));
module.exports = router;

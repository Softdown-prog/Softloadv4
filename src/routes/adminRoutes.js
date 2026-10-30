'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { exigirSuperAdmin } = require('../middlewares/adminGuard');
const { db, admin } = require('../services/firebase');
const { PLAN_CREDITS, concederCreditos, concederCreditosBloggerAi } = require('../services/creditService');
const { obterStatusRecuperacaoCobrancas } = require('../services/billingRecoveryMonitor');
const FV = admin.firestore.FieldValue;
const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false
});
router.use('/eu', adminLimiter);
// ==========================================
// HELPERS
// ==========================================
// Registra ação administrativa em admin_logs (fire-and-forget)
function logAdmin(por, tipo, detalhes = {}) {
    db.collection('admin_logs').add({
        por,
        tipo,
        detalhes,
        criado_em: FV.serverTimestamp(),
    }).catch(e => console.error('[ADMIN-LOG]', e.message));
}
async function calcularKpis() {
    const [totalSnap, premiumSnap] = await Promise.all([
        db.collection('clientes_premium').count().get(),
        db.collection('clientes_premium').where('is_active', '==', true).count().get()
    ]);
    const totalUsuarios = totalSnap.data().count;
    const totalPremium = premiumSnap.data().count;
    // Agrega storage e compilações lendo apenas os campos necessários
    const usersSnap = await db.collection('clientes_premium')
        .select('storage_usado_mb', 'tentativas_compilacao', 'premium_ate', 'criado_em')
        .get();
    let storageTotal = 0;
    let compilacoesTotal = 0;
    let expirando7dias = 0;
    const agora = new Date();
    const em7dias = new Date(agora.getTime() + 7 * 24 * 60 * 60 * 1000);
    for (const doc of usersSnap.docs) {
        const d = doc.data();
        storageTotal += d.storage_usado_mb || 0;
        compilacoesTotal += d.tentativas_compilacao || 0;
        if (d.premium_ate) {
            const venc = new Date(d.premium_ate);
            if (venc > agora && venc <= em7dias)
                expirando7dias++;
        }
    }
    return {
        totalUsuarios,
        totalPremium,
        totalFree: totalUsuarios - totalPremium,
        storageTotal: storageTotal.toFixed(2),
        compilacoesTotal,
        expirando7dias,
        // Receita estimada usando preço médio ponderado (starter 49 + pro 119 + studio 249) / 3
        receitaEstimada: (totalPremium * 139.00).toFixed(2)
    };
}
// Paginação cursor-based (startAfter) — Firestore não suporta offset eficiente
// e cobrava leitura de todos os documentos pulados.
async function listarUsuarios(limit = 50, cursor = null) {
    let query = db.collection('clientes_premium').orderBy('criado_em', 'desc').limit(limit + 1);
    if (cursor) {
        const cursorDoc = await db.collection('clientes_premium').doc(cursor).get();
        if (!cursorDoc.exists)
            return { usuarios: [], nextCursor: null };
        query = query.startAfter(cursorDoc);
    }
    const snap = await query.get();
    const pageDocs = snap.docs.slice(0, limit);
    const usuarios = pageDocs.map(doc => {
        const d = doc.data();
        return {
            email: d.email || doc.id,
            nome: d.nome || '—',
            plano: d.plano || 'free',
            is_active: d.is_active || false,
            storage_usado_mb: (d.storage_usado_mb || 0).toFixed(2),
            tentativas_compilacao: d.tentativas_compilacao || 0,
            creditos: d.creditos ?? 0,
            creditos_gpt: d.creditos_gpt ?? 0,
            criado_em: d.criado_em
                ? new Date(d.criado_em).toLocaleDateString('pt-BR', {
                    day: '2-digit', month: '2-digit', year: 'numeric'
                })
                : '—',
            // A ordenação para paginação usa o snapshot do documento.
        };
    });
    const nextCursor = snap.size > limit && pageDocs.length > 0
        ? pageDocs[pageDocs.length - 1].id
        : null;
    return { usuarios, nextCursor };
}
// ==========================================
// GET /eu — Dashboard principal
//
// Página administrativa EJS nativa; informações vindas de /eu/api/* protegidas.
// ==========================================
router.get('/eu', exigirSuperAdmin, (req, res) => {
    res.render('pages/admin-simples', { adminSection: 'inicio', user: req.session.user });
});
// ==========================================
// GET /eu/usuarios — Gestão de usuários
//
// Lista de contas EJS; mantém endpoint JSON existente e guarda super-admin.
// ==========================================
router.get('/eu/usuarios', exigirSuperAdmin, (req, res) => {
    res.render('pages/admin-simples', { adminSection: 'usuarios', user: req.session.user });
});
// ==========================================
// GET /eu/sol — Chat com o Sol (agente conversacional interno)
//
// Tela informativa: o chat Sol foi aposentado na versão Blogger, sem apagar histórico.
// ==========================================

});
// ==========================================
// GET /eu/api/kpis — Polling de KPIs (JSON)
// ==========================================
router.get('/eu/api/kpis', exigirSuperAdmin, async (req, res) => {
    try {
        const kpis = await calcularKpis();
        res.json(kpis);
    }
    catch (errCaught) {
        const err = errCaught;
        console.error('[ADMIN-API] Erro kpis:', err.message);
        res.status(500).json({ erro: 'Falha ao carregar KPIs.' });
    }
});
// ==========================================
// GET /eu/api/usuarios — Lista JSON paginada
// ==========================================
router.get('/eu/api/usuarios', exigirSuperAdmin, async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
        // O cursor referencia o último documento exibido; nunca compara datas como strings.
        const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null;
        if (cursor && cursor.length > 256)
            return res.status(400).json({ erro: 'Cursor inválido.' });
        const { usuarios, nextCursor } = await listarUsuarios(limit, cursor);
        res.json({ usuarios, nextCursor });
    }
    catch (errCaught) {
        const err = errCaught;
        console.error('[ADMIN-API] Erro usuarios:', err.message);
        res.status(500).json({ erro: 'Falha ao carregar usuários.' });
    }
});
// ==========================================
// POST /eu/api/usuario/:email/premium — Ativar/revogar com plano escolhido
// Body: { ativo: bool, plano: 'starter'|'pro'|'studio' }
// ==========================================
const PLANOS_VALIDOS = ['free', 'starter', 'pro', 'studio', 'premium'];
router.post('/eu/api/usuario/:email/premium', exigirSuperAdmin, async (req, res) => {
    try {
        const emailAlvo = decodeURIComponent(req.params.email).toLowerCase().trim();
        if (!emailAlvo || !emailAlvo.includes('@')) {
            return res.status(400).json({ erro: 'E-mail inválido.' });
        }
        const ref = db.collection('clientes_premium').doc(emailAlvo);
        const doc = await ref.get();
        if (!doc.exists) {
            return res.status(404).json({ erro: 'Usuário não encontrado.' });
        }
        const atual = doc.data();
        // ativo explícito no body → usa esse valor; senão toggle
        const novoEstado = req.body.ativo !== undefined ? Boolean(req.body.ativo) : !atual.is_active;
        const planoReq = req.body.plano;
        const planoAtivado = novoEstado
            ? (PLANOS_VALIDOS.includes(planoReq) ? planoReq : 'pro')
            : 'free';
        const update = {
            is_active: novoEstado,
            plano: planoAtivado,
            ultima_atualizacao: new Date().toISOString(),
        };
        if (novoEstado) {
            const premiumAte = new Date();
            premiumAte.setDate(premiumAte.getDate() + 30);
            update.premium_ate = premiumAte.toISOString();
            update.status = 'ativo';
        }
        else {
            update.status = 'pendente';
        }
        await ref.update(update);
        // Provisiona apenas os serviços que estão disponíveis ao usuário
        if (novoEstado) {
            await Promise.all([
                concederCreditos(emailAlvo, planoAtivado),
                concederCreditosBloggerAi(emailAlvo, planoAtivado),
            ]);
        }
        console.log(`[ADMIN] Toggle premium: ${emailAlvo} → ${novoEstado ? 'ATIVO ' + planoAtivado : 'DESATIVO'} (por ${req.session.user.email})`);
        logAdmin(req.session.user.email, novoEstado ? 'plano_ativado' : 'plano_revogado', { email_alvo: emailAlvo, plano: planoAtivado });
        res.json({
            sucesso: true,
            email: emailAlvo,
            is_active: novoEstado,
            plano: planoAtivado,
        });
    }
    catch (errCaught) {
        const err = errCaught;
        console.error('[ADMIN-API] Erro toggle premium:', err.message);
        res.status(500).json({ erro: 'Falha ao atualizar usuário.' });
    }
});
// ==========================================
// POST /eu/api/usuario/:email/creditos — Define créditos Gemini
// Body: { gemini: number }  (valores absolutos, expira em 30 dias)
// ==========================================
router.post('/eu/api/usuario/:email/creditos', exigirSuperAdmin, async (req, res) => {
    try {
        const emailAlvo = decodeURIComponent(req.params.email).toLowerCase().trim();
        if (!emailAlvo || !emailAlvo.includes('@')) {
            return res.status(400).json({ erro: 'E-mail inválido.' });
        }
        const ref = db.collection('clientes_premium').doc(emailAlvo);
        const doc = await ref.get();
        if (!doc.exists) {
            return res.status(404).json({ erro: 'Usuário não encontrado.' });
        }
        const expira_em = new Date();
        expira_em.setDate(expira_em.getDate() + 30);
        const expiraISO = expira_em.toISOString();
        const patch = { ultima_atualizacao: new Date().toISOString() };
        const geminiVal = req.body.gemini !== undefined && req.body.gemini !== '' ? parseInt(req.body.gemini, 10) : NaN;
        if (!isNaN(geminiVal) && geminiVal >= 0) {
            patch.creditos = geminiVal;
            patch.creditos_ciclo_total = geminiVal;
            patch.creditos_expira_em = expiraISO;
        }
        if (!patch.creditos_expira_em) {
            return res.status(400).json({ erro: 'Informe ao menos um valor de crédito válido (>= 0).' });
        }
        await ref.set(patch, { merge: true });
        console.log(`[ADMIN] Créditos manuais: ${emailAlvo} Gemini=${patch.creditos ?? '—'} (por ${req.session.user.email})`);
        logAdmin(req.session.user.email, 'creditos_atualizados', { email_alvo: emailAlvo, gemini: patch.creditos ?? null });
        res.json({
            sucesso: true,
            email: emailAlvo,
            creditos: patch.creditos ?? null,
        });
    }
    catch (errCaught) {
        const err = errCaught;
        console.error('[ADMIN-API] Erro creditos:', err.message);
        res.status(500).json({ erro: 'Falha ao atualizar créditos.' });
    }
});
// ==========================================
// POST /eu/api/creditos/provisionar — migração: concede créditos a todos os usuários ativos
// ==========================================
router.post('/eu/api/creditos/provisionar', exigirSuperAdmin, async (req, res) => {
    try {
        const snap = await db.collection('clientes_premium')
            .where('is_active', '==', true)
            .get();
        let ok = 0, erros = 0;
        await Promise.all(snap.docs.map(async (doc) => {
            const d = doc.data();
            const email = doc.id;
            const plano = d.plano || 'free';
            try {
                await Promise.all([
                    concederCreditos(email, plano),
                    concederCreditosBloggerAi(email, plano),
                ]);
                ok++;
            }
            catch (eCaught) {
                const e = eCaught;
                console.error(`[ADMIN-MIGR] Falha ${email}:`, e.message);
                erros++;
            }
        }));
        console.log(`[ADMIN] Provisionamento: ${ok} OK, ${erros} erros (por ${req.session.user.email})`);
        res.json({ sucesso: true, provisionados: ok, erros });
    }
    catch (errCaught) {
        const err = errCaught;
        console.error('[ADMIN] Erro provisionamento:', err.message);
        res.status(500).json({ erro: err.message });
    }
});
// APIs antigas de Sol, RAG e Gemini removidas do painel administrativo.
// ==========================================
// GET /eu/api/billing/recuperacao — apenas superadmin; não expõe dados de usuário.
router.get('/eu/api/billing/recuperacao', exigirSuperAdmin, (req, res) => {
    res.setHeader('Cache-Control', 'no-store, private');
    res.json({
        ...obterStatusRecuperacaoCobrancas(),
        webhookConfigurado: !!process.env.BILLING_ALERT_WEBHOOK_URL,
    });
});
// ==========================================
// GET /eu/api/logs — Últimas ações administrativas
// ==========================================
router.get('/eu/api/logs', exigirSuperAdmin, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 30, 100);
        const snap = await db.collection('admin_logs')
            .orderBy('criado_em', 'desc')
            .limit(limit)
            .get();
        const logs = snap.docs.map(doc => {
            const d = doc.data();
            return {
                id: doc.id,
                por: d.por,
                tipo: d.tipo,
                detalhes: d.detalhes || {},
                criado_em: d.criado_em?.toDate?.()?.toISOString() || null,
            };
        });
        res.json({ logs });
    }
    catch (errCaught) {
        const err = errCaught;
        console.error('[ADMIN-API] Erro logs:', err.message);
        res.status(500).json({ erro: err.message });
    }
});
// ==========================================
// ANALYTICS — consumo de créditos por plano
// ==========================================
async function calcularAnalyticsCreditos(diasAtras = 30) {
    const corte = new Date(Date.now() - diasAtras * 24 * 60 * 60 * 1000);
    const ts = admin.firestore.Timestamp.fromDate(corte);
    // 1 — Todos os billing_logs do período via collection group.
    // Requer índice Firestore para o collection group 'billing_logs'.
    // Se o índice ainda não existe, cai na degradação abaixo.
    let logsSnap;
    try {
        logsSnap = await db.collectionGroup('billing_logs')
            .where('criado_em', '>=', ts)
            .get();
    }
    catch (eCaught) {
        const e = eCaught;
        const semIndice = e.code === 9 || (e.message && e.message.includes('index'));
        if (semIndice) {
            console.warn('[ADMIN-ANALYTICS] Índice Firestore ausente para billing_logs.criado_em — retornando dados vazios.');
            return { periodo_dias: diasAtras, por_plano: {}, gerado_em: new Date().toISOString(), semIndice: true };
        }
        throw e;
    }
    if (logsSnap.empty)
        return { periodo_dias: diasAtras, por_plano: {}, gerado_em: new Date().toISOString() };
    // 2 — Agrega por email (email = id do doc pai em clientes_premium)
    const porEmail = {};
    for (const doc of logsSnap.docs) {
        const email = doc.ref.parent.parent.id;
        const d = doc.data();
        if (!porEmail[email])
            porEmail[email] = { creditos: 0, interacoes: 0, tokens: 0 };
        porEmail[email].creditos += d.credits_debited || 0;
        porEmail[email].interacoes += 1;
        porEmail[email].tokens += (d.input_tokens || 0) + (d.output_tokens || 0);
    }
    // 3 — Busca plano de cada email único (batches de 30 — limite do operador 'in')
    const emails = Object.keys(porEmail);
    const planoPorEmail = {};
    for (let i = 0; i < emails.length; i += 30) {
        const lote = emails.slice(i, i + 30);
        const snap = await db.collection('clientes_premium')
            .where(admin.firestore.FieldPath.documentId(), 'in', lote)
            .select('plano')
            .get();
        snap.docs.forEach(d => { planoPorEmail[d.id] = d.data().plano || 'free'; });
    }
    // 4 — Agrupa métricas por plano
    const acc = {};
    for (const [email, stats] of Object.entries(porEmail)) {
        const plano = planoPorEmail[email] || 'free';
        if (!acc[plano])
            acc[plano] = { emails: new Set(), creditos: 0, interacoes: 0, tokens: 0 };
        acc[plano].emails.add(email);
        acc[plano].creditos += stats.creditos;
        acc[plano].interacoes += stats.interacoes;
        acc[plano].tokens += stats.tokens;
    }
    // 5 — Formata resultado
    const ORDEM = ['studio', 'pro', 'premium', 'free'];
    const porPlano = {};
    for (const plano of [...ORDEM, ...Object.keys(acc).filter(p => !ORDEM.includes(p))]) {
        if (!acc[plano])
            continue;
        const a = acc[plano];
        const usuarios = a.emails.size;
        const ciclo = PLAN_CREDITS[plano] ?? PLAN_CREDITS.free;
        const mediaCredUsuario = usuarios > 0 ? Math.round(a.creditos / usuarios) : 0;
        const mediaCredInteracao = a.interacoes > 0 ? +(a.creditos / a.interacoes).toFixed(2) : 0;
        const mediaTokensInteracao = a.interacoes > 0 ? Math.round(a.tokens / a.interacoes) : 0;
        const pctUsoCiclo = ciclo > 0 ? +((mediaCredUsuario / ciclo) * 100).toFixed(1) : 0;
        porPlano[plano] = {
            usuarios_ativos: usuarios,
            total_creditos_debitados: a.creditos,
            total_interacoes: a.interacoes,
            total_tokens: a.tokens,
            media_creditos_por_usuario: mediaCredUsuario,
            media_creditos_por_interacao: mediaCredInteracao,
            media_tokens_por_interacao: mediaTokensInteracao,
            creditos_ciclo: ciclo,
            pct_uso_ciclo: pctUsoCiclo,
        };
    }
    return { periodo_dias: diasAtras, por_plano: porPlano, gerado_em: new Date().toISOString() };
}
// GET /eu/analytics — dashboard de consumo
//
// Consumo histórico em EJS, carregado da API de analytics sem React.
// ==========================================
router.get('/eu/analytics', exigirSuperAdmin, (req, res) => {
    res.render('pages/admin-simples', { adminSection: 'analytics', user: req.session.user });
});
// GET /eu/api/analytics/creditos — JSON para auto-refresh
router.get('/eu/api/analytics/creditos', exigirSuperAdmin, async (req, res) => {
    try {
        const dias = Math.min(parseInt(req.query.dias) || 30, 90);
        res.json(await calcularAnalyticsCreditos(dias));
    }
    catch (errCaught) {
        const err = errCaught;
        console.error('[ADMIN-ANALYTICS-API]', err.message);
        res.status(200).json({ periodo_dias: 30, por_plano: {}, gerado_em: new Date().toISOString(), erro: err.message });
    }
});
module.exports = router;

'use strict';
import type { AccountRecord } from '../contracts/accounts';
import type { RouteRequest, RouteResponse, RouteHandler, RouteRouter, RouteFailure, RouteRateLimit } from '../contracts/routeHttp';
import type { Firestore } from '@google-cloud/firestore';
interface RouteBody { ativo?: unknown; plano: string; nichoTema?: unknown; pedido?: unknown; mensagem?: unknown; sessionId?: string }
declare function require(name: string): unknown;
const express = require('express') as { Router(): RouteRouter<RouteBody> };
const router = express.Router();
const rateLimit = require('express-rate-limit') as RouteRateLimit;
const { exigirSuperAdmin } = require('../middlewares/adminGuard') as { exigirSuperAdmin: RouteHandler<RouteBody> };
const { db, admin } = require('../services/firebase') as { db: Firestore; bucket: import('@google-cloud/storage').Bucket; admin: typeof import('firebase-admin') };


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
function logAdmin(por: string, tipo: string, detalhes: Record<string, unknown> = {}) {
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
        const d = doc.data() as AccountRecord;
        storageTotal += d.storage_usado_mb || 0;
        compilacoesTotal += d.tentativas_compilacao || 0;
        if (d.premium_ate) {
            const venc = new Date(d.premium_ate);
            if (venc > agora && venc <= em7dias) expirando7dias++;
        }
    }

    return {
        totalUsuarios,
        totalPremium,
        totalFree: totalUsuarios - totalPremium,
        storageTotal: storageTotal.toFixed(2),
        compilacoesTotal,
        expirando7dias,
    };
}

// Paginação cursor-based (startAfter) — Firestore não suporta offset eficiente
// e cobrava leitura de todos os documentos pulados.
async function listarUsuarios(limit = 50, cursor: string | null = null) {
    let query = db.collection('clientes_premium').orderBy('criado_em', 'desc').limit(limit + 1);
    if (cursor) {
        const cursorDoc = await db.collection('clientes_premium').doc(cursor).get();
        if (!cursorDoc.exists) return { usuarios: [], nextCursor: null };
        query = query.startAfter(cursorDoc);
    }
    const snap = await query.get();

    const pageDocs = snap.docs.slice(0, limit);
    const usuarios = pageDocs.map(doc => {
        const d = doc.data() as AccountRecord;
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
// GET /eu/api/kpis — Polling de KPIs (JSON)
// ==========================================
router.get('/eu/api/kpis', exigirSuperAdmin, async (req, res) => {
    try {
        const kpis = await calcularKpis();
        res.json(kpis);
    } catch (errCaught) {
        const err = errCaught as RouteFailure;
        console.error('[ADMIN-API] Erro kpis:', err.message);
        res.status(500).json({ erro: 'Falha ao carregar KPIs.' });
    }
});

// ==========================================
// GET /eu/api/usuarios — Lista JSON paginada
// ==========================================
router.get('/eu/api/usuarios', exigirSuperAdmin, async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 50, 1), 100);
        // O cursor referencia o último documento exibido; nunca compara datas como strings.
        const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null;
        if (cursor && cursor.length > 256) return res.status(400).json({ erro: 'Cursor inválido.' });
        const { usuarios, nextCursor } = await listarUsuarios(limit, cursor);
        res.json({ usuarios, nextCursor });
    } catch (errCaught) {
        const err = errCaught as RouteFailure;
        console.error('[ADMIN-API] Erro usuarios:', err.message);
        res.status(500).json({ erro: 'Falha ao carregar usuários.' });
    }
});

// ==========================================
// POST /eu/api/usuario/:email/premium — Ativar/revogar com plano escolhido
// Body: { ativo: bool, plano: 'starter'|'pro'|'studio' }
// ==========================================
const PLANOS_VALIDOS = ['free', 'essencial'];

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

        const atual = doc.data() as AccountRecord;
        // ativo explícito no body → usa esse valor; senão toggle
        const novoEstado = req.body.ativo !== undefined ? Boolean(req.body.ativo) : !atual.is_active;
        const planoReq   = req.body.plano;
        const planoAtivado = novoEstado
            ? (PLANOS_VALIDOS.includes(planoReq) ? planoReq : 'essencial')
            : 'free';

        const update: {is_active: boolean; plano: string; ultima_atualizacao: string; premium_ate?: string; status?: string} = {
            is_active: novoEstado,
            plano: planoAtivado,
            ultima_atualizacao: new Date().toISOString(),
        };

        if (novoEstado) {
            const premiumAte = new Date();
            premiumAte.setDate(premiumAte.getDate() + 30);
            update.premium_ate = premiumAte.toISOString();
            update.status = 'ativo';
        } else {
            update.status = 'pendente';
        }

        await ref.update(update);

        console.log(`[ADMIN] Toggle premium: ${emailAlvo} → ${novoEstado ? 'ATIVO ' + planoAtivado : 'DESATIVO'} (por ${req.session.user.email})`);
        logAdmin(req.session.user.email, novoEstado ? 'plano_ativado' : 'plano_revogado', { email_alvo: emailAlvo, plano: planoAtivado });

        res.json({
            sucesso: true,
            email: emailAlvo,
            is_active: novoEstado,
            plano: planoAtivado,
        });

    } catch (errCaught) {
        const err = errCaught as RouteFailure;
        console.error('[ADMIN-API] Erro toggle premium:', err.message);
        res.status(500).json({ erro: 'Falha ao atualizar usuário.' });
    }
});

// ==========================================
// GET /eu/api/logs — Últimas ações administrativas
// ==========================================
router.get('/eu/api/logs', exigirSuperAdmin, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit as string) || 30, 100);
        const snap = await db.collection('admin_logs')
            .orderBy('criado_em', 'desc')
            .limit(limit)
            .get();

        const logs = snap.docs.map(doc => {
            const d = doc.data() as {por?: string; tipo?: string; detalhes?: unknown; criado_em?: {toDate(): Date}};
            return {
                id:        doc.id,
                por:       d.por,
                tipo:      d.tipo,
                detalhes:  d.detalhes || {},
                criado_em: d.criado_em?.toDate?.()?.toISOString() || null,
            };
        });

        res.json({ logs });
    } catch (errCaught) {
        const err = errCaught as RouteFailure;
        console.error('[ADMIN-API] Erro logs:', err.message);
        res.status(500).json({ erro: err.message });
    }
});

module.exports = router;

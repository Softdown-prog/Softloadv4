'use strict';
import type { AccountRecord } from '../contracts/workspaceRoutes';
import type { RouteRequest, RouteResponse, RouteHandler, RouteRouter, RouteFailure, RouteRateLimit } from '../contracts/routeHttp';
import type { Firestore } from '@google-cloud/firestore';
interface RouteBody { plano: string; aceitePoliticaArmazenamento?: boolean; formData?: Record<string, unknown>; action?: string; type?: string; data?: {id: string}; id: string; query?: unknown; topK?: number; corpus?: string }
declare function require(name: string): unknown;
const express = require('express') as { Router(): RouteRouter<RouteBody> };
const crypto = require('crypto') as typeof import('crypto');
const router = express.Router();
const rateLimit = require('express-rate-limit') as RouteRateLimit;
const { db } = require('../services/firebase') as { db: Firestore; bucket: import('@google-cloud/storage').Bucket; admin: typeof import('firebase-admin') };
const { PLAN_CREDITS, GPT_PLAN_CREDITS, BLOGGERAI_PLAN_CREDITS } = require('../services/creditService') as typeof import('../services/creditService');
const { approvedPlanForPayment, PRICES_CENTS } = require('../services/mpPlanRules') as typeof import('../services/mpPlanRules');
const { STORAGE_LIMITS_MB }               = require('../services/storageService') as typeof import('../services/storageService');
const { enviarPlanoAtivado }              = require('../services/emailService') as typeof import('../services/emailService');
const { MercadoPagoConfig, Payment, Preference } = require('mercadopago') as typeof import('mercadopago');
const { exigirLogin } = require('../middlewares/authGuard') as { exigirLogin: RouteHandler<RouteBody> };
const { apagarProjetosExpirados } = require('../solaris/tools/projectStorage') as typeof import('../solaris/tools/projectStorage');
const { buscarCatalogoLocal } = require('../solaris/rag/ragLocalSearch') as typeof import('../solaris/rag/ragLocalSearch');

const { normalizeSolarisCorpus } = require('../knowledge/ragNamespaces') as typeof import('../knowledge/ragNamespaces');

// Rate limit por IP nas rotas de iniciar pagamento — já exigem login
// (exigirLogin), mas sem limite um usuário autenticado podia disparar
// criação de preferência/pagamento em loop. Resposta em JSON (default do
// express-rate-limit), consistente com o resto destas duas rotas —
// diferente de authRoutes.js, que são POST de formulário HTML.
// Deliberadamente NÃO aplicado no webhook do Mercado Pago: aquele
// endpoint é chamado pelo próprio MP (não por um usuário final), já tem
// verificação de assinatura HMAC fail-closed, e um rate limit por IP ali
// arriscaria descartar notificações legítimas em retry de alto volume.
const pagamentoLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { erro: 'Muitas tentativas de pagamento em pouco tempo. Aguarde alguns minutos e tente novamente.' },
});

const client = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN as string
});
const payment = new Payment(client);
const preference = new Preference(client);

// Contract: Provides the React frontend with context previously injected via res.locals
router.get('/api/app-config', (req, res) => {
    res.json({
        user: req.session.user || null,
        firebaseConfig: {
            apiKey: process.env.FIREBASE_API_KEY,
            appId: process.env.FIREBASE_APP_ID,
        },
        features: {
            mpCheckoutUrl: process.env.MP_CHECKOUT_URL || '#'
        }
    });
});

// ==========================================
// HMAC do webhook do Mercado Pago
// Doc: https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
// Cabeçalho x-signature contém ts=...,v1=<hmac sha256 do manifesto>
// ==========================================
function verificarAssinaturaMP(req: RouteRequest<RouteBody>) {
    const secret = process.env.MP_WEBHOOK_SECRET;
    if (!secret) {
        // Sem secret configurado, recusa por padrão (fail-closed) em produção
        if (process.env.NODE_ENV === 'production') {
            console.warn('[MP] MP_WEBHOOK_SECRET não configurado — webhook recusado em produção.');
            return false;
        }
        // Em dev/staging, sem secret, aceita para não quebrar testes locais
        console.warn('[MP] MP_WEBHOOK_SECRET não configurado — verificação de assinatura desativada.');
        return true;
    }

    const signature = req.headers['x-signature'];
    const requestId = req.headers['x-request-id'];
    if (!signature || typeof signature !== 'string') return false;

    // Extrai ts e v1 do header (formato "ts=...,v1=...")
    const partes = Object.fromEntries(
        signature.split(',').map(p => {
            const i = p.indexOf('=');
            return i === -1 ? [p.trim(), ''] : [p.slice(0, i).trim(), p.slice(i + 1).trim()];
        })
    );
    const ts = partes.ts;
    const v1 = partes.v1;
    if (!ts || !v1) return false;

    // O id no manifesto é o data.id passado na query string (?data.id=...) ou no body
    const dataId = req.query?.['data.id'] || req.body?.data?.id || req.body?.id;
    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
    const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

    try {
        return crypto.timingSafeEqual(Buffer.from(v1, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
        return false;
    }
}

// ==========================================
// POST /dashboard/checkout-create — Cria preferência de pagamento
// ==========================================

router.post('/dashboard/checkout-create', exigirLogin, pagamentoLimiter, async (req, res) => {
    try {
        const user = req.session.user;
        const { plano } = req.body;
        if (plano === 'essencial' && req.body?.aceitePoliticaArmazenamento !== true) {
            return res.status(400).json({ erro: 'Confirme a política de armazenamento e exclusão antes de pagar.' });
        }

        if (!user || !user.email) {
            return res.status(401).json({ erro: 'Usuário não autenticado' });
        }

        const PLANOS: Record<string, {titulo: string; preco: number; creditos: number}> = {
            starter: { titulo: 'Plano Starter — Softload Engine', preco: PRICES_CENTS.starter / 100, creditos: PLAN_CREDITS.starter },
            pro:     { titulo: 'Plano Pro — Softload Engine',     preco: PRICES_CENTS.pro / 100, creditos: PLAN_CREDITS.pro },
            studio:  { titulo: 'Plano Studio — Softload Engine',  preco: PRICES_CENTS.studio / 100, creditos: PLAN_CREDITS.studio },
            essencial: { titulo: 'Softload Blogger — Acesso 30 dias', preco: PRICES_CENTS.essencial / 100, creditos: 0 },
        };

        if (!PLANOS[plano]) {
            return res.status(400).json({ erro: 'Plano inválido. Escolha o plano essencial de R$ 5 ou um plano legado.' });
        }

        // O preço de R$5 só será oferecido após validar cota procedural e webhook.
        if (plano === 'essencial' && process.env.BLOGGER_ESSENCIAL_CHECKOUT_ENABLED !== 'true') {
            return res.status(503).json({ erro: 'O plano Essencial está em homologação. Os testes gratuitos continuam disponíveis.' });
        }
        const planoConfig = PLANOS[plano];

        // Salva o plano pendente para o webhook recuperar após pagamento aprovado.
        // set+merge cria o doc se não existir — .update() lançaria NOT_FOUND para usuários novos.
        try {
            await db.collection('clientes_premium').doc(user.email.toLowerCase()).set({
                plano_pendente: plano,
                ...(plano === 'essencial' ? { essencial_storage_aceite_em: new Date().toISOString() } : {}),
            }, { merge: true });
        } catch (eCaught) {
        const e = eCaught as RouteFailure;
            console.warn('[MP] Falha ao salvar plano_pendente:', e.message);
            if (plano === 'essencial') return res.status(503).json({ erro: 'Não foi possível registrar o aceite do armazenamento. Tente novamente.' });
        }

        // Base URL: deriva do próprio request (Cloud Run → https + domínio real).
        // Remove dependência de BASE_URL e evita localhost ser enviado ao MP.
        const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
        const ehHttps = baseUrl.startsWith('https://');

        // Configura a preferência de pagamento
        const preferenceData: Omit<import('mercadopago/dist/clients/preference/commonTypes').PreferenceRequest, 'items'> & {items: Array<{title: string; description: string; quantity: number; unit_price: number}>} = {
            items: [
                {
                    title:       planoConfig.titulo,
                    description: plano === 'essencial' ? 'Gerador de templates Blogger sem IA. Acesso por 30 dias.' : `${planoConfig.creditos} créditos de IA por mês. Válido por 30 dias.`,
                    quantity:    1,
                    unit_price:  planoConfig.preco,
                }
            ],
            payer: {
                email: user.email,
                name: user.nome || 'Cliente'
            },
            external_reference: user.email, // Para identificar o usuário no webhook
            back_urls: {
                success: process.env.CALLBACK_URL_SUCCESS || `${baseUrl}/dashboard/upgrade?status=success`,
                failure: process.env.CALLBACK_URL_FAILURE || `${baseUrl}/dashboard/upgrade?status=failure`,
                pending: process.env.CALLBACK_URL_PENDING || `${baseUrl}/dashboard/upgrade?status=pending`
            },
        };

        // auto_return e notification_url só são aceitos pelo MP com URL HTTPS pública.
        // Em localhost (dev) são omitidos para não fazer o MP rejeitar a preferência.
        if (ehHttps) {
            preferenceData.auto_return     = 'approved';
            preferenceData.notification_url = `${baseUrl}/webhook/mercado-pago`;
        }

        // Cria a preferência no Mercado Pago
        // O SDK exige item.id no tipo; o endpoint aceita itens identificados pelo título.
        const response = await preference.create({ body: preferenceData as Parameters<typeof preference.create>[0]['body'] });

        if (!response.init_point) {
            console.error('[MP] Resposta sem init_point:', JSON.stringify(response));
            return res.status(500).json({ erro: 'Falha ao gerar link de pagamento' });
        }

        console.log(`[MP] Preferência criada para ${user.email} — ID: ${response.id} — baseUrl=${baseUrl}`);

        res.json({
            sucesso: true,
            checkoutUrl: response.init_point,
            preferenceId: response.id
        });

    } catch (errorCaught) {
        const error = errorCaught as RouteFailure;
        // Surfacing detalhado: o SDK do MP traz a causa real em error.cause ou error.message
        const detalheMp = error?.cause?.[0]?.description
            || error?.cause?.message
            || error?.message
            || 'erro desconhecido';
        console.error('[MP] Erro ao criar preferência:', detalheMp, '| status:', error?.status || error?.statusCode || '');
        res.status(500).json({ erro: `Falha ao gerar pagamento: ${detalheMp}` });
    }
});

// ==========================================
// POST /dashboard/payment/process — Checkout Bricks
// Recebe formData tokenizado do Brick, cria o pagamento na API do MP
// e retorna o resultado (aprovado, pendente Pix/boleto ou rejeitado).
// A ativação real do plano acontece via webhook (fluxo assíncrono).
// ==========================================
router.post('/dashboard/payment/process', exigirLogin, pagamentoLimiter, async (req, res) => {
    try {
        const { formData, plano } = req.body || {};
        if (plano === 'essencial' && req.body?.aceitePoliticaArmazenamento !== true) {
            return res.status(400).json({ erro: 'Confirme a política de armazenamento e exclusão antes de pagar.' });
        }
        if (plano === 'essencial' && process.env.BLOGGER_ESSENCIAL_CHECKOUT_ENABLED !== 'true') {
            return res.status(503).json({ erro: 'O plano Essencial está em homologação.' });
        }
        const user = req.session.user;

        // Fonte única de preços, compartilhada com checkout-create e webhook.
        // Object.hasOwn impede aceitar chaves herdadas (constructor, toString etc.).
        if (typeof plano !== 'string' || !Object.hasOwn(PRICES_CENTS, plano)) {
            return res.status(400).json({ erro: 'Plano inválido.' });
        }
        if (!formData || typeof formData !== 'object') {
            return res.status(400).json({ erro: 'Dados de pagamento inválidos.' });
        }

        // Persiste plano_pendente para o webhook ler após confirmação
        try {
            await db.collection('clientes_premium').doc(user.email.toLowerCase()).update({
                plano_pendente: plano,
                ...(plano === 'essencial' ? { essencial_storage_aceite_em: new Date().toISOString() } : {}),
            });
        } catch (eCaught) {
        const e = eCaught as RouteFailure;
            console.warn('[MP] Falha ao salvar plano_pendente:', e.message);
        }

        const paymentBody = {
            ...formData,
            transaction_amount: PRICES_CENTS[plano as keyof typeof PRICES_CENTS] / 100,
            description:        `Softload Engine — Plano ${plano.charAt(0).toUpperCase() + plano.slice(1)}`,
            external_reference: user.email.toLowerCase(),
        };

        const result = await payment.create({ body: paymentBody });

        console.log(`[MP-BRICKS] Pagamento criado: id=${result.id} status=${result.status} plano=${plano} email=${user.email}`);

        // Pix — retorna QR code para o front exibir
        if (result.payment_method_id === 'pix' || result.status === 'pending') {
            const pix = result.point_of_interaction?.transaction_data;
            return res.json({
                status:       result.status,
                id:           result.id,
                pixQrCode:    pix?.qr_code      || null,
                pixQrBase64:  pix?.qr_code_base64 || null,
                boletoUrl:    result.transaction_details?.external_resource_url || null,
            });
        }

        // Aprovado ou rejeitado direto
        res.json({ status: result.status, id: result.id });

    } catch (errorCaught) {
        const error = errorCaught as RouteFailure;
        console.error('[MP-BRICKS] Erro ao processar pagamento:', error.message);
        res.status(500).json({ erro: 'Falha ao processar pagamento. Tente novamente.' });
    }
});

// ==========================================
// WEBHOOK MERCADO PAGO
// ==========================================

router.post('/webhook/mercado-pago', async (req, res) => {
    // Recusa assinaturas inválidas — bloqueia ataques de webhook forjado
    if (!verificarAssinaturaMP(req)) {
        console.warn('[MP] Assinatura HMAC inválida — possível tentativa de fraude.');
        return res.status(403).send('Forbidden');
    }

    try {
        const { action, type, data } = req.body;

        if (action === 'payment.created' || type === 'payment' || action === 'payment.updated') {
            const paymentId = data ? data.id : req.body.id;

            console.log(`[MP] Verificando pagamento: ${paymentId}`);

            // Consulta back-channel — nunca confia no body
            const paymentDetails = await payment.get({ id: paymentId });

            if (paymentDetails.status === 'approved') {
                const emailCliente = paymentDetails.external_reference?.trim().toLowerCase();

                if (!emailCliente) {
                    console.warn('[MP] Pagamento aprovado mas sem external_reference (e-mail).');
                    return res.status(200).send('OK');
                }

                console.log(`[MP] Pagamento aprovado: ${emailCliente}`);

                // Busca o usuário pelo campo email (compatível com doc ID = email ou UID)
                const query = await db.collection('clientes_premium')
                    .where('email', '==', emailCliente)
                    .limit(1)
                    .get();

                if (query.empty) {
                    console.warn(`[MP] Usuário ${emailCliente} não encontrado na base.`);
                    return res.status(200).send('OK');
                }

                const userRef = query.docs[0].ref;
                const id = String(paymentId);
                if (!/^\d+$/.test(id)) {
                    console.warn('[MP] ID de pagamento inválido.');
                    return res.status(200).send('OK');
                }

                // O recibo e os três saldos são gravados na MESMA transação.
                // Webhooks repetidos ou simultâneos não podem renovar o plano de novo.
                const receiptRef = db.collection('softload_mp_payments').doc(id);
                const premiumAte = new Date();
                premiumAte.setDate(premiumAte.getDate() + 30);
                const expiresAt = premiumAte.toISOString();
                const result = await db.runTransaction(async (tx) => {
                    const [receipt, user] = await Promise.all([tx.get(receiptRef), tx.get(userRef)]);
                    if (receipt.exists || user.data()?.mp_payment_id === id) return { duplicate: true };
                    if (!user.exists) return { missingUser: true };

                    const userData = user.data() as AccountRecord;
                    const plan = approvedPlanForPayment(paymentDetails, userData.plano_pendente);
                    if (!plan) return { invalidPlanOrAmount: true };

                    tx.create(receiptRef, {
                        payment_id: id,
                        user_email: emailCliente,
                        plan,
                        amount: paymentDetails.transaction_amount,
                        currency: paymentDetails.currency_id,
                        processed_at: new Date().toISOString(),
                    });
                    tx.update(userRef, {
                        plano: plan,
                        is_active: true,
                        status: 'ativo',
                        premium_ate: expiresAt,
                        ...(plan === 'essencial' ? { essencial_storage_expira_em: expiresAt } : {}),
                        mp_payment_id: id,
                        plano_pendente: null,
                        ultima_atualizacao: new Date().toISOString(),
                        creditos: PLAN_CREDITS[plan],
                        creditos_ciclo_total: PLAN_CREDITS[plan],
                        creditos_expira_em: expiresAt,
                        creditos_gpt: GPT_PLAN_CREDITS[plan],
                        creditos_gpt_ciclo_total: GPT_PLAN_CREDITS[plan],
                        creditos_gpt_expira_em: expiresAt,
                        creditos_bloggerai: BLOGGERAI_PLAN_CREDITS[plan],
                        creditos_bloggerai_ciclo_total: BLOGGERAI_PLAN_CREDITS[plan],
                        creditos_bloggerai_expira_em: expiresAt,
                    });
                    return { activated: true, plan, name: userData.nome || '' };
                });

                if (result.duplicate) {
                    console.log(`[MP] Pagamento ${id} já processado. Ignorando.`);
                    return res.status(200).send('OK');
                }
                if (!result.activated) {
                    console.error(`[MP] Pagamento ${id} sem usuário, plano ou valor válido; não ativado.`);
                    return res.status(200).send('OK');
                }

                const planoAtivado = result.plan;
                enviarPlanoAtivado(emailCliente, result.name, planoAtivado, PLAN_CREDITS[planoAtivado], expiresAt)
                    .catch(e => console.error('[EMAIL] Plano ativado falhou:', e.message));

                // Atualiza qualquer sessão ativa do usuário no Firestore — UX:
                // o cliente que está logado vê o premium ser liberado sem precisar deslogar.
                try {
                    const sessionsSnap = await db.collection('sessions')
                        .where('sess.user.email', '==', emailCliente)
                        .get();
                    if (!sessionsSnap.empty) {
                        const batch = db.batch();
                        sessionsSnap.docs.forEach(sDoc => {
                            const sess = (sDoc.data() as AccountRecord).sess;
                            if (sess && sess.user) {
                                sess.user.plano = planoAtivado;
                                sess.user.is_active = true;
                                sess.user.premium_ate = expiresAt;
                                batch.update(sDoc.ref, { sess });
                            }
                        });
                        await batch.commit();
                    }
                } catch (sessErrCaught) {
        const sessErr = sessErrCaught as RouteFailure;
                    console.warn('[MP] Falha ao atualizar sessões ativas:', sessErr.message);
                }

                console.log(`[MP] ${emailCliente} ativado como ${planoAtivado.toUpperCase()} até ${premiumAte.toDateString()}`);
            }
        }

        res.status(200).send('OK');

    } catch (errorCaught) {
        const error = errorCaught as RouteFailure;
        console.error('[MP] Erro no webhook:', error.message);
        // Uma falha inesperada não deve confirmar ao MP um pagamento que
        // talvez não tenha sido creditado. O recibo transacional torna o retry seguro.
        res.status(500).send('Erro ao processar notificação');
    }
});

// ==========================================
// Limpeza interna — TTL de projetos Solaris persistidos
// Chamado por Cloud Scheduler (ou manualmente/`npm run
// solaris:limpar-projetos-expirados`) — nunca por usuário final. Sem
// corpo assinável vindo do Scheduler (diferente do webhook do MP acima),
// então a autenticação é por secret compartilhado num header fixo —
// mesma postura fail-closed em produção.
// ==========================================
function verificarSegredoLimpezaSolaris(req: RouteRequest<RouteBody>) {
    const secret = process.env.SOLARIS_CLEANUP_SECRET;
    if (!secret) {
        if (process.env.NODE_ENV === 'production') {
            console.warn('[SOLARIS-CLEANUP] SOLARIS_CLEANUP_SECRET não configurado — recusado em produção.');
            return false;
        }
        console.warn('[SOLARIS-CLEANUP] SOLARIS_CLEANUP_SECRET não configurado — verificação desativada (dev).');
        return true;
    }

    const recebido = req.headers['x-solaris-cleanup-secret'];
    if (typeof recebido !== 'string' || recebido.length !== secret.length) return false;
    return crypto.timingSafeEqual(Buffer.from(recebido), Buffer.from(secret));
}

router.post('/internal/solaris/limpar-projetos-expirados', async (req, res) => {
    if (!verificarSegredoLimpezaSolaris(req)) {
        return res.status(403).send('Forbidden');
    }

    try {
        const diasArg = Number(req.query.dias);
        const opcoes = Number.isFinite(diasArg) && diasArg > 0 ? { diasParaExpirar: diasArg } : {};
        const resultado = await apagarProjetosExpirados(opcoes);
        console.log(`[SOLARIS-CLEANUP] ${resultado.apagados.length} projeto(s) expirado(s) removido(s), ${resultado.erros.length} erro(s).`);
        res.status(200).json(resultado);
    } catch (errCaught) {
        const err = errCaught as RouteFailure;
        console.error('[SOLARIS-CLEANUP] falhou:', err.message);
        res.status(500).json({ erro: 'Falha ao limpar projetos expirados.' });
    }
});

// ==========================================
// Busca semântica interna — catálogo RAG do Solaris (embeddings)
// Chamado pela capability knowledge.search do agent/ (Worker) --
// nunca por usuário final direto. Mesma postura fail-closed em
// produção de verificarSegredoLimpezaSolaris acima, secret dedicado
// (não reaproveita SOLARIS_CLEANUP_SECRET -- são ações diferentes,
// cada endpoint interno com seu próprio segredo evita que revogar um
// afete o outro).
// ==========================================
function verificarSegredoRagBusca(req: RouteRequest<RouteBody>) {
    const secret = process.env.SOLARIS_RAG_SEARCH_SECRET;
    if (!secret) {
        if (process.env.NODE_ENV === 'production') {
            console.warn('[SOLARIS-RAG-BUSCA] SOLARIS_RAG_SEARCH_SECRET não configurado — recusado em produção.');
            return false;
        }
        console.warn('[SOLARIS-RAG-BUSCA] SOLARIS_RAG_SEARCH_SECRET não configurado — verificação desativada (dev).');
        return true;
    }

    const recebido = req.headers['x-solaris-rag-search-secret'];
    if (typeof recebido !== 'string' || recebido.length !== secret.length) return false;
    return crypto.timingSafeEqual(Buffer.from(recebido), Buffer.from(secret));
}

router.post('/internal/solaris/rag/buscar', async (req, res) => {
    if (!verificarSegredoRagBusca(req)) {
        return res.status(403).send('Forbidden');
    }

    const { query, topK, corpus = 'catalogo' } = req.body || {};
    if (typeof query !== 'string' || query.trim() === '') {
        return res.status(400).json({ erro: 'query (string não vazia) é obrigatório' });
    }
    // O endpoint do Agent é exclusivo do Solaris. Nunca roteia para o
    // conhecimento filesystem do Especialista Blogger.
    try {
        normalizeSolarisCorpus(corpus);
    } catch (errorCaught) {
        const error = errorCaught as RouteFailure;
        return res.status(400).json({ erro: error.message });
    }
    // Sem modelos de embeddings, o catálogo opera por palavras-chave,
    // utilizando os JSON versionados. Índice vetorial de código fica indisponível.
    if (corpus === 'codigo') {
        return res.status(503).json({ erro: 'Busca vetorial de código desativada: serviço de embeddings retirado.' });
    }
    try {
        const resultado = await buscarCatalogoLocal({ query, topK });
        res.status(200).json(resultado);
    } catch (errCaught) {
        const err = errCaught as RouteFailure;
        console.error('[SOLARIS-RAG-BUSCA] falha na busca local:', err.message);
        res.status(500).json({ erro: 'Falha ao buscar no catálogo RAG local.' });
    }
});

/*
 * GET /api/dashboard/stats
 * Dados utilizados pelo Dashboard React.
 */
router.get('/api/dashboard/stats', exigirLogin, async (req, res) => {
    const user = req.session.user;
    const email = user.email.toLowerCase();

    let creditos = 0;
    let creditosCicloTotal = PLAN_CREDITS[user.plano] ?? PLAN_CREDITS.free;
    let creditosExpiraEm = null;
    let totalProjetos = 0;
    let storageUsadoMb = 0;
    let tentativasCompilacao = 0;

    try {
        const [userSnap, projetosSnap] = await Promise.all([
            db.collection('clientes_premium')
                .doc(email)
                .get(),

            db.collection('clientes_premium')
                .doc(email)
                .collection('projetos')
                .count()
                .get(),
        ]);

        if (userSnap.exists) {
            const d = userSnap.data() as AccountRecord;

            creditos = d.creditos ?? 0;
            creditosCicloTotal =
                d.creditos_ciclo_total ?? creditosCicloTotal;

            creditosExpiraEm =
                d.creditos_expira_em ?? null;

            storageUsadoMb = d.storage_usado_mb ?? 0;
            tentativasCompilacao = d.tentativas_compilacao ?? 0;
        }

        totalProjetos =
            projetosSnap.data().count ?? 0;

    } catch (eCaught) {
        const e = eCaught as RouteFailure;
        console.warn(
            '[API DASHBOARD] Falha ao buscar estatísticas:',
            e.message
        );
    }

    res.json({
        creditos,
        creditosCicloTotal,
        creditosExpiraEm,
        totalProjetos,
        storageUsadoMb,
        tentativasCompilacao,
        storageLimitMb: STORAGE_LIMITS_MB[user.plano] ?? STORAGE_LIMITS_MB.free,
    });
});

module.exports = router;

'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { db } = require('../services/firebase');
const { approvedPlanForPayment, PRICES_CENTS } = require('../services/mpPlanRules');
const { enviarPlanoAtivado } = require('../services/emailService');
const { MercadoPagoConfig, Payment, Preference } = require('mercadopago');
const { exigirSuperAdmin } = require('../middlewares/adminGuard');
const { exigirLogin } = require('../middlewares/authGuard');
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
    accessToken: process.env.MP_ACCESS_TOKEN
});
const payment = new Payment(client);
const preference = new Preference(client);
async function criarIntencaoBlogger(user, canal) {
    if (!user?.email || !user.uid)
        return null;
    const email = user.email.toLowerCase();
    const query = await db.collection('clientes_premium').where('email', '==', email).limit(1).get();
    if (query.empty || query.docs[0].data()?.uid !== user.uid)
        return null;
    const id = crypto.randomUUID();
    const aceiteEm = new Date().toISOString();
    // Não grava no campo mutável plano_pendente: duas compras simultâneas
    // precisam continuar independentes até serem liquidadas.
    await db.collection('softload_mp_intents').doc(id).create({
        version: 1, email, uid: user.uid, plano: 'essencial',
        precoCentavos: PRICES_CENTS.essencial, canal,
        aceiteEm, status: 'created',
        criadoEm: aceiteEm,
    });
    return { id, externalReference: 'slb:' + id };
}
function verificarAssinaturaMP(req) {
    const secret = process.env.MP_WEBHOOK_SECRET;
    // Nenhum ambiente recebe webhook sem assinatura válida (inclusive staging).
    if (!secret) {
        console.warn('[MP] Webhook secret ausente; notificação rejeitada.');
        return false;
    }
    const signature = req.headers['x-signature'];
    const requestId = req.headers['x-request-id'];
    if (!signature || typeof signature !== 'string')
        return false;
    // Extrai ts e v1 do header (formato "ts=...,v1=...")
    const partes = Object.fromEntries(signature.split(',').map(p => {
        const i = p.indexOf('=');
        return i === -1 ? [p.trim(), ''] : [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }));
    const ts = partes.ts;
    const v1 = partes.v1;
    if (!ts || !v1)
        return false;
    // O id no manifesto é o data.id passado na query string (?data.id=...) ou no body
    const dataId = req.query?.['data.id'] || req.body?.data?.id;
    const normalizedId = String(dataId ?? '');
    if (!/^\d{1,30}$/.test(normalizedId) || typeof requestId !== 'string' || !requestId.trim())
        return false;
    if (req.body?.data?.id != null && String(req.body.data.id) !== normalizedId)
        return false;
    const manifest = `id:${normalizedId};request-id:${requestId};ts:${ts};`;
    const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
    try {
        return crypto.timingSafeEqual(Buffer.from(v1, 'hex'), Buffer.from(expected, 'hex'));
    }
    catch {
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
        if (plano !== 'essencial' && Object.hasOwn(PRICES_CENTS, plano)) {
            return res.status(410).json({ erro: 'Este plano não está mais à venda.' });
        }
        const PLANOS = {
            essencial: { titulo: 'Softload Blogger — Acesso 30 dias', preco: PRICES_CENTS.essencial / 100, creditos: 0 },
        };
        if (!PLANOS[plano]) {
            return res.status(400).json({ erro: 'Plano inválido. Escolha o plano essencial de R$ 5 .' });
        }
        // O preço de R$5 só será oferecido após validar cota procedural e webhook.
        if (plano === 'essencial' && process.env.BLOGGER_ESSENCIAL_CHECKOUT_ENABLED !== 'true') {
            return res.status(503).json({ erro: 'O plano Essencial está em homologação. Os testes gratuitos continuam disponíveis.' });
        }
        // A oferta atual vende somente Blogger. Preservar os planos antigos na
        // tabela APENAS para reconhecimento de pagamentos já iniciados.
        if (plano !== 'essencial') {
            return res.status(410).json({ erro: 'Os planos antigos com IA não estão mais à venda. Use o Essencial Blogger.' });
        }
        const planoConfig = PLANOS[plano];
        // Cria a intenção vinculada ao UID ANTES de emitir o link de pagamento.
        // Se o Firestore falhar, nenhuma preferência externa será criada.
        let intent;
        try {
            intent = await criarIntencaoBlogger(user, 'checkout-pro');
            if (!intent)
                return res.status(503).json({ erro: 'Não foi possível confirmar sua conta para pagamento.' });
        }
        catch (eCaught) {
            const e = eCaught;
            console.warn('[MP] Falha ao criar intenção:', e.message);
            return res.status(503).json({ erro: 'Não foi possível registrar sua compra. Tente novamente.' });
        }
        // Base URL: deriva do próprio request (Cloud Run → https + domínio real).
        // Remove dependência de BASE_URL e evita localhost ser enviado ao MP.
        const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
        const ehHttps = baseUrl.startsWith('https://');
        // Configura a preferência de pagamento
        const preferenceData = {
            items: [
                {
                    title: planoConfig.titulo,
                    description: plano === 'essencial' ? 'Gerador de templates Blogger sem IA. Acesso por 30 dias.' : `${planoConfig.creditos} créditos de IA por mês. Válido por 30 dias.`,
                    quantity: 1,
                    unit_price: planoConfig.preco,
                }
            ],
            payer: {
                email: user.email,
                name: user.nome || 'Cliente'
            },
            external_reference: intent.externalReference, // Identificador único desta tentativa
            back_urls: {
                success: process.env.CALLBACK_URL_SUCCESS || `${baseUrl}/dashboard/upgrade?status=success`,
                failure: process.env.CALLBACK_URL_FAILURE || `${baseUrl}/dashboard/upgrade?status=failure`,
                pending: process.env.CALLBACK_URL_PENDING || `${baseUrl}/dashboard/upgrade?status=pending`
            },
        };
        // auto_return e notification_url só são aceitos pelo MP com URL HTTPS pública.
        // Em localhost (dev) são omitidos para não fazer o MP rejeitar a preferência.
        if (ehHttps) {
            preferenceData.auto_return = 'approved';
            preferenceData.notification_url = `${baseUrl}/webhook/mercado-pago`;
        }
        // Cria a preferência no Mercado Pago
        // O SDK exige item.id no tipo; o endpoint aceita itens identificados pelo título.
        const response = await preference.create({ body: preferenceData });
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
    }
    catch (errorCaught) {
        const error = errorCaught;
        // Surfacing detalhado: o SDK do MP traz a causa real em error.cause ou error.message
        const detalheMp = error?.cause?.[0]?.description
            || error?.cause?.message
            || error?.message
            || 'erro desconhecido';
        console.error('[MP] Erro ao criar preferência:', detalheMp, '| status:', error?.status || error?.statusCode || '');
        res.status(503).json({ erro: 'Não foi possível iniciar o Mercado Pago. Tente novamente.' });
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
        if (plano !== 'essencial' && typeof plano === 'string' && Object.hasOwn(PRICES_CENTS, plano)) {
            return res.status(410).json({ erro: 'Os planos antigos com IA não estão mais à venda.' });
        }
        // Fonte única de preços, compartilhada com checkout-create e webhook.
        // Object.hasOwn impede aceitar chaves herdadas (constructor, toString etc.).
        if (typeof plano !== 'string' || !Object.hasOwn(PRICES_CENTS, plano)) {
            return res.status(400).json({ erro: 'Plano inválido.' });
        }
        if (!formData || typeof formData !== 'object') {
            return res.status(400).json({ erro: 'Dados de pagamento inválidos.' });
        }
        let intent;
        try {
            intent = await criarIntencaoBlogger(user, 'bricks');
            if (!intent)
                return res.status(503).json({ erro: 'Não foi possível confirmar sua conta para pagamento.' });
        }
        catch (eCaught) {
            const e = eCaught;
            console.warn('[MP] Falha ao criar intenção Bricks:', e.message);
            return res.status(503).json({ erro: 'Não foi possível registrar sua compra. Tente novamente.' });
        }
        const paymentBody = {
            ...formData,
            transaction_amount: PRICES_CENTS[plano] / 100,
            description: 'Softload Blogger — Acesso de 30 dias',
            external_reference: intent.externalReference,
        };
        const result = await payment.create({ body: paymentBody, requestOptions: { idempotencyKey: intent.id } });
        console.log(`[MP-BRICKS] Pagamento criado: id=${result.id} status=${result.status} plano=${plano} email=${user.email}`);
        // Pix — retorna QR code para o front exibir
        if (result.payment_method_id === 'pix' || result.status === 'pending') {
            const pix = result.point_of_interaction?.transaction_data;
            return res.json({
                status: result.status,
                id: result.id,
                pixQrCode: pix?.qr_code || null,
                pixQrBase64: pix?.qr_code_base64 || null,
                boletoUrl: result.transaction_details?.external_resource_url || null,
            });
        }
        // Aprovado ou rejeitado direto
        res.json({ status: result.status, id: result.id });
    }
    catch (errorCaught) {
        const error = errorCaught;
        console.error('[MP-BRICKS] Erro ao processar pagamento:', error.message);
        res.status(500).json({ erro: 'Falha ao processar pagamento. Tente novamente.' });
    }
});
async function processarPagamento(paymentId, recovery) {
    // A origem do pedido nunca fornece valor, status ou referência do pagamento.
    const paymentDetails = await payment.get({ id: paymentId });
    if (paymentDetails.id != null && String(paymentDetails.id) !== paymentId)
        return { kind: 'not-linked' };
    const mpStatus = String(paymentDetails.status || '');
    const mpStatusDetail = String(paymentDetails.status_detail || '');
    const requiresReview = mpStatus === 'refunded' || mpStatus === 'charged_back' ||
        mpStatus === 'in_mediation' || (mpStatus === 'approved' && mpStatusDetail === 'partially_refunded');
    if (requiresReview) {
        // O webhook mantém o registro de estornos e disputas para tratamento manual.
        if (!recovery) {
            const caseRef = db.collection('softload_mp_reconciliations').doc(paymentId);
            const receiptRef = db.collection('softload_mp_payments').doc(paymentId);
            await db.runTransaction(async (tx) => {
                const existingCase = await tx.get(caseRef);
                const receipt = await tx.get(receiptRef);
                if (existingCase.exists &&
                    existingCase.data()?.status === mpStatus &&
                    existingCase.data()?.status_detail === mpStatusDetail)
                    return;
                const record = {
                    payment_id: paymentId,
                    status: mpStatus,
                    status_detail: mpStatusDetail,
                    receipt_exists: receipt.exists,
                    needs_manual_review: true,
                    observed_at: new Date().toISOString(),
                };
                if (existingCase.exists)
                    tx.update(caseRef, record);
                else
                    tx.create(caseRef, { ...record, created_at: new Date().toISOString() });
            });
            console.warn('[MP] Pagamento em estorno ou disputa; conciliação manual pendente:', paymentId);
        }
        return { kind: 'review' };
    }
    if (mpStatus !== 'approved')
        return { kind: 'not-approved' };
    const externalReference = String(paymentDetails.external_reference || '').trim();
    const intentId = externalReference.startsWith('slb:') ? externalReference.slice(4) : null;
    // O painel recupera somente compras com intenção rastreável do Blogger.
    // Webhooks antigos continuam compatíveis com a referência por e-mail.
    if ((recovery && intentId === null) ||
        (intentId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(intentId))) {
        return { kind: 'not-linked' };
    }
    const intentRef = intentId ? db.collection('softload_mp_intents').doc(intentId) : null;
    const intentSnapshot = intentRef ? await intentRef.get() : null;
    if (intentRef && !intentSnapshot?.exists)
        return { kind: 'not-linked' };
    const emailCliente = intentRef
        ? String(intentSnapshot?.data()?.email || '').toLowerCase()
        : externalReference.toLowerCase();
    if (!emailCliente.includes('@'))
        return { kind: 'not-linked' };
    if (recovery && emailCliente !== recovery.expectedEmail)
        return { kind: 'wrong-account' };
    const query = await db.collection('clientes_premium').where('email', '==', emailCliente).limit(1).get();
    if (query.empty)
        return { kind: 'account-missing' };
    const userRef = query.docs[0].ref;
    const receiptRef = db.collection('softload_mp_payments').doc(paymentId);
    // O recibo, o acesso e o log da recuperação são gravados juntos.
    // O webhook e o painel disputam o mesmo recibo em caso de concorrência.
    const result = await db.runTransaction(async (tx) => {
        const receipt = await tx.get(receiptRef);
        const user = await tx.get(userRef);
        const liveIntent = intentRef ? await tx.get(intentRef) : null;
        if (receipt.exists) {
            if (recovery && receipt.data()?.user_email !== recovery.expectedEmail) {
                return { kind: 'wrong-account' };
            }
            return { kind: 'duplicate' };
        }
        if (!user.exists)
            return { kind: 'account-missing' };
        const userData = user.data();
        if (userData.mp_payment_id === paymentId)
            return { kind: 'duplicate' };
        const intentData = liveIntent?.data();
        if (intentRef && (!liveIntent?.exists || intentData?.status !== 'created' ||
            typeof intentData?.uid !== 'string' || !intentData.uid || intentData.uid !== userData.uid ||
            intentData.email !== emailCliente || typeof intentData.aceiteEm !== 'string' ||
            intentData?.plano !== 'essencial' || intentData?.precoCentavos !== PRICES_CENTS.essencial)) {
            return { kind: 'not-linked' };
        }
        const plan = approvedPlanForPayment(paymentDetails, intentRef ? intentData?.plano : userData.plano_pendente);
        if (!plan)
            return { kind: 'not-linked' };
        const now = Date.now();
        const currentExpiry = Date.parse(userData.premium_ate || '');
        const base = plan === 'essencial' && userData.plano === 'essencial' &&
            userData.is_active === true && currentExpiry > now ? currentExpiry : now;
        const expiresAt = new Date(base + 30 * 24 * 60 * 60 * 1000).toISOString();
        const updatedAt = new Date(now).toISOString();
        tx.create(receiptRef, {
            payment_id: paymentId,
            user_email: emailCliente,
            plan,
            amount: paymentDetails.transaction_amount,
            currency: paymentDetails.currency_id,
            processed_at: updatedAt,
            ...(intentRef ? { intent_id: intentId } : {}),
        });
        tx.update(userRef, {
            plano: plan,
            is_active: true,
            status: 'ativo',
            premium_ate: expiresAt,
            ...(plan === 'essencial' ? { essencial_storage_expira_em: expiresAt } : {}),
            mp_payment_id: paymentId,
            ...(intentRef ? { essencial_storage_aceite_em: intentData.aceiteEm } : { plano_pendente: null }),
            ultima_atualizacao: updatedAt,
            creditos_expira_em: expiresAt,
            creditos_gpt_expira_em: expiresAt,
            creditos_bloggerai_expira_em: expiresAt,
        });
        if (intentRef)
            tx.update(intentRef, {
                status: 'approved', mp_payment_id: paymentId, processadoEm: updatedAt,
            });
        if (recovery)
            tx.create(db.collection('admin_logs').doc('mp-recovery-' + paymentId), {
                por: recovery.operator,
                tipo: 'pagamento_recuperado',
                detalhes: { email_alvo: emailCliente, pagamento_id: paymentId, premium_ate: expiresAt },
                criado_em: new Date(now),
            });
        return { kind: 'applied', plan, name: userData.nome || '', expiresAt };
    });
    if (result.kind !== 'applied')
        return result;
    enviarPlanoAtivado(emailCliente, result.name, result.plan, result.expiresAt)
        .catch(e => console.error('[EMAIL] Plano ativado falhou:', e.message));
    try {
        const sessionsSnap = await db.collection('sessions').where('sess.user.email', '==', emailCliente).get();
        if (!sessionsSnap.empty) {
            const batch = db.batch();
            for (const sDoc of sessionsSnap.docs) {
                if (!sDoc.data().sess?.user)
                    continue;
                batch.update(sDoc.ref, {
                    'sess.user.plano': result.plan,
                    'sess.user.is_active': true,
                    'sess.user.premium_ate': result.expiresAt,
                });
            }
            await batch.commit();
        }
    }
    catch (sessErr) {
        console.warn('[MP] Falha ao atualizar sessões ativas:', sessErr.message);
    }
    return { kind: 'applied', expiresAt: result.expiresAt };
}
router.post('/webhook/mercado-pago', async (req, res) => {
    if (!verificarAssinaturaMP(req)) {
        console.warn('[MP] Assinatura HMAC inválida.');
        return res.status(403).send('Forbidden');
    }
    try {
        const { action, type, data } = req.body;
        if (action === 'payment.created' || type === 'payment' || action === 'payment.updated') {
            const paymentId = String(req.query?.['data.id'] || data?.id || '');
            const result = await processarPagamento(paymentId);
            if (result.kind === 'account-missing')
                return res.status(503).send('Conta não encontrada para conciliação');
            if (result.kind === 'not-linked')
                return res.status(503).send('Pagamento requer conciliação');
        }
        return res.status(200).send('OK');
    }
    catch (e) {
        console.error('[MP] Erro no webhook:', e.message);
        return res.status(500).send('Erro ao processar notificação');
    }
});
const recuperarPagamentoLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { erro: 'Aguarde alguns minutos antes de tentar recuperar mais pagamentos.' },
});
router.post('/eu/api/pagamentos/recuperar', exigirSuperAdmin, recuperarPagamentoLimiter, async (req, res) => {
    // O CORS geral é permissivo. Esta ação administrativa só aceita o POST
    // JSON da origem do próprio painel, inclusive quando há cookies de sessão.
    if (!req.get('host') || req.get('origin') !== req.protocol + '://' + req.get('host') ||
        req.get('sec-fetch-site') === 'cross-site' ||
        !/^application\/json(?:;|$)/i.test(req.get('content-type') || '')) {
        return res.status(403).json({ erro: 'Abra o painel no próprio site para recuperar um pagamento.' });
    }
    const paymentId = typeof req.body?.pagamentoId === 'string' ? req.body.pagamentoId.trim() : '';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!/^\d{1,30}$/.test(paymentId) || email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email)) {
        return res.status(400).json({ erro: 'Informe o e-mail da conta e o ID numérico do pagamento.' });
    }
    try {
        const result = await processarPagamento(paymentId, { expectedEmail: email, operator: req.session.user.email });
        switch (result.kind) {
            case 'applied':
                return res.json({ status: 'recuperado', premium_ate: result.expiresAt });
            case 'duplicate':
                return res.json({ status: 'ja_processado' });
            case 'wrong-account':
                return res.status(409).json({ erro: 'O pagamento pertence a outra conta.' });
            case 'account-missing':
                return res.status(404).json({ erro: 'A conta desse pagamento não está cadastrada.' });
            case 'not-approved':
                return res.status(409).json({ erro: 'O Mercado Pago ainda não confirmou a aprovação.' });
            case 'review':
                return res.status(409).json({ erro: 'O pagamento está em estorno ou disputa e exige análise.' });
            case 'not-linked':
                return res.status(409).json({ erro: 'O pagamento não corresponde a uma compra válida do Essencial.' });
        }
    }
    catch (e) {
        const error = e;
        if (error.status === 404)
            return res.status(404).json({ erro: 'Pagamento não encontrado no Mercado Pago.' });
        console.error('[ADMIN] Falha ao recuperar pagamento:', error.message);
        return res.status(503).json({ erro: 'Não foi possível verificar o pagamento. A mesma operação pode ser repetida com segurança.' });
    }
});
// Roteamento exclusivamente Blogger: integração Solaris desativada e removida.
/*
 * GET /api/dashboard/stats
 * Dados utilizados pelo Dashboard React.
 */
module.exports = router;

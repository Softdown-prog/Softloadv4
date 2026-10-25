"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BLOGGERAI_PLAN_CREDITS = exports.GPT_PLAN_CREDITS = exports.PLAN_CREDITS = void 0;
exports.calcularCreditos = calcularCreditos;
exports.concederCreditos = concederCreditos;
exports.debitarCreditos = debitarCreditos;
exports.concederCreditosGpt = concederCreditosGpt;
exports.debitarCreditosGpt = debitarCreditosGpt;
exports.concederCreditosBloggerAi = concederCreditosBloggerAi;
exports.debitarCreditosBloggerAi = debitarCreditosBloggerAi;
const { db, admin } = require('./firebase');
const FV = admin.firestore.FieldValue;
const TOKENS_POR_CREDITO = 1000;
const EXPIRY_DAYS = 30;
// Créditos Gemini por plano por ciclo de 30 dias
exports.PLAN_CREDITS = {
    free: 5,
    starter: 500,
    pro: 2000,
    studio: 5500,
    premium: 2000, // backward compat — usuários existentes com plano='premium'
};
// Provedor externo temporariamente sem orçamento de API.
// Manter o contrato para registros legados, mas não conceder novas cotas.
exports.GPT_PLAN_CREDITS = {
    free: 0,
    starter: 0,
    pro: 0,
    studio: 0,
    premium: 0,
};
// Créditos do Gerador de Templates IA por plano por ciclo de 30 dias
// Campo Firestore: creditos_bloggerai — mesmo pool do Gemini, contabilizado separado
// Free = 0 (gerador exige plano pago)
exports.BLOGGERAI_PLAN_CREDITS = {
    free: 0,
    starter: 500,
    premium: 2000,
    pro: 2000,
    studio: 5500,
};
function calcularCreditos(inputTokens, outputTokens) {
    return Math.ceil((inputTokens + outputTokens) / TOKENS_POR_CREDITO);
}
function dataExpiracao() {
    const d = new Date();
    d.setDate(d.getDate() + EXPIRY_DAYS);
    return d.toISOString();
}
// Aloca créditos do plano e define nova expiração (chamado no webhook de pagamento e no cadastro)
async function concederCreditos(email, plano) {
    const creditos = exports.PLAN_CREDITS[plano] ?? exports.PLAN_CREDITS.free;
    const expira_em = dataExpiracao();
    await db.collection('clientes_premium').doc(email.toLowerCase()).update({
        creditos,
        creditos_ciclo_total: creditos,
        creditos_expira_em: expira_em,
    });
    return { creditos, expira_em };
}
async function debitarCreditos(email, inputTokens, outputTokens) {
    if (!inputTokens && !outputTokens)
        return 0;
    const creditosADebitar = calcularCreditos(inputTokens, outputTokens);
    const userRef = db.collection('clientes_premium').doc(email.toLowerCase());
    await db.runTransaction(async (tx) => {
        const doc = await tx.get(userRef);
        if (!doc.exists)
            throw new Error('Usuário não encontrado');
        const dados = doc.data();
        // Assinantes ativos: créditos são contadores de analytics — nunca bloqueia por saldo
        if (!dados.is_active) {
            const expirado = dados.creditos_expira_em && new Date(dados.creditos_expira_em) < new Date();
            const saldo = expirado ? 0 : (dados.creditos ?? 0);
            if (saldo < creditosADebitar)
                throw new Error('Créditos insuficientes');
        }
        tx.update(userRef, { creditos: FV.increment(-creditosADebitar) });
    });
    userRef.collection('billing_logs').add({
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        credits_debited: creditosADebitar,
        criado_em: FV.serverTimestamp(),
    }).catch(e => console.error('[BILLING] log error:', e.message));
    return creditosADebitar;
}
// ── GPT 5.4 credit functions ──────────────────────────────────────────────
async function concederCreditosGpt(email, plano) {
    const creditos = exports.GPT_PLAN_CREDITS[plano] ?? 0;
    if (creditos === 0)
        return { creditos: 0, expira_em: null };
    const expira_em = dataExpiracao();
    // set+merge: cria o doc se não existir (.update() lançava NOT_FOUND para usuários novos)
    await db.collection('clientes_premium').doc(email.toLowerCase()).set({
        creditos_gpt: creditos,
        creditos_gpt_ciclo_total: creditos,
        creditos_gpt_expira_em: expira_em,
    }, { merge: true });
    return { creditos, expira_em };
}
async function debitarCreditosGpt(email, inputTokens, outputTokens) {
    if (!inputTokens && !outputTokens)
        return 0;
    const creditosADebitar = calcularCreditos(inputTokens, outputTokens);
    const userRef = db.collection('clientes_premium').doc(email.toLowerCase());
    await db.runTransaction(async (tx) => {
        const doc = await tx.get(userRef);
        // Doc ausente = usuário sem campo creditos_gpt — debita silenciosamente (analytics apenas)
        if (!doc.exists)
            return;
        const dados = doc.data();
        // Campo ausente = créditos nunca provisionados — não bloqueia, só loga
        if (dados.creditos_gpt === undefined)
            return;
        const expirado = dados.creditos_gpt_expira_em && new Date(dados.creditos_gpt_expira_em) < new Date();
        const saldo = expirado ? 0 : (dados.creditos_gpt ?? 0);
        if (saldo < creditosADebitar)
            return; // saldo insuficiente — não bloqueia (fire-and-forget)
        tx.update(userRef, { creditos_gpt: FV.increment(-creditosADebitar) });
    });
    userRef.collection('billing_logs').add({
        modelo: 'gpt-5.4-nano',
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        credits_debited: creditosADebitar,
        criado_em: FV.serverTimestamp(),
    }).catch(e => console.error('[BILLING-GPT] log error:', e.message));
    return creditosADebitar;
}
// ── Gerador de Templates IA credit functions ──────────────────────────────
async function concederCreditosBloggerAi(email, plano) {
    const creditos = exports.BLOGGERAI_PLAN_CREDITS[plano] ?? 0;
    if (creditos === 0)
        return { creditos: 0, expira_em: null };
    const expira_em = dataExpiracao();
    await db.collection('clientes_premium').doc(email.toLowerCase()).set({
        creditos_bloggerai: creditos,
        creditos_bloggerai_ciclo_total: creditos,
        creditos_bloggerai_expira_em: expira_em,
    }, { merge: true });
    return { creditos, expira_em };
}
async function debitarCreditosBloggerAi(email, inputTokens, outputTokens) {
    if (!inputTokens && !outputTokens)
        return 0;
    const creditosADebitar = calcularCreditos(inputTokens, outputTokens);
    const userRef = db.collection('clientes_premium').doc(email.toLowerCase());
    await db.runTransaction(async (tx) => {
        const doc = await tx.get(userRef);
        if (!doc.exists)
            throw new Error('Usuário não encontrado');
        const dados = doc.data();
        // Assinantes ativos: créditos são analytics — nunca bloqueia por saldo
        if (!dados.is_active) {
            const expirado = dados.creditos_bloggerai_expira_em && new Date(dados.creditos_bloggerai_expira_em) < new Date();
            const saldo = expirado ? 0 : (dados.creditos_bloggerai ?? 0);
            if (saldo < creditosADebitar)
                throw new Error('Créditos BloggerAI insuficientes');
        }
        tx.update(userRef, { creditos_bloggerai: FV.increment(-creditosADebitar) });
    });
    userRef.collection('billing_logs').add({
        tipo: 'bloggerai',
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        credits_debited: creditosADebitar,
        criado_em: FV.serverTimestamp(),
    }).catch(e => console.error('[BILLING-BLOGGERAI] log error:', e.message));
    return creditosADebitar;
}

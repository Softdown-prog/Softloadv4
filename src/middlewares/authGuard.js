"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * MIDDLEWARES DE PROTEÇÃO DE ROTAS
 *
 * Regras de acesso:
 * - Qualquer pessoa pode se registrar e entrar no dashboard
 * - Usuário FREE: entra no dashboard, vê as ferramentas mas não usa
 * - Ao tentar usar qualquer ferramenta, cai na página de planos
 * - Usuário PREMIUM: acesso total + 100MB no Cloud Storage
 */
const { db } = require('../services/firebase');
// Consulta o Firestore para confirmar o status real da assinatura.
// Usado quando o premium_ate da SESSÃO parece vencido antes de bloquear —
// a sessão dura até 24h e não é atualizada automaticamente quando o webhook
// do Mercado Pago renova o plano em background. Sem esta checagem, um usuário
// que renovou após o login (mas antes do cookie expirar) via "Sua assinatura
// expirou" mesmo com a assinatura ativa e paga no banco.
async function buscarStatusPremiumAtual(email) {
    try {
        const emailKey = (email || '').toLowerCase();
        if (!emailKey)
            return null;
        const snap = await db.collection('clientes_premium').doc(emailKey).get();
        return snap.exists ? snap.data() : null;
    }
    catch (err) {
        console.warn('[AUTH] Falha ao verificar status premium no DB:', err.message);
        return null;
    }
}
// Retorna true e atualiza a sessão se o DB confirmar assinatura ativa e não vencida.
function assinaturaRenovada(dados) {
    return !!(dados && dados.is_active === true && dados.premium_ate && new Date(dados.premium_ate) >= new Date());
}
function aplicarRenovacaoNaSessao(req, dados) {
    req.session.user.is_active = true;
    req.session.user.plano = dados.plano || req.session.user.plano;
    req.session.user.premium_ate = dados.premium_ate;
}
// Exige apenas estar logado (free ou premium)
function exigirLogin(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    }
    if (ehRequisicaoApi(req)) {
        return res.status(401).json({ error: 'Sessão expirada. Recarregue a página e faça login novamente.' });
    }
    res.redirect('/login?erro=Faça login para continuar.');
}
// Detecta se o request espera JSON (XHR/fetch) ou navegação HTML normal.
// Necessário para que rotas /api/* bloqueadas devolvam 403 JSON em vez de
// um redirect 302 → HTML, o que quebra o parser response.json() do front-end.
function ehRequisicaoApi(req) {
    if (req.path && req.path.startsWith('/api/'))
        return true;
    const accept = (req.get('accept') || '').toLowerCase();
    if (accept.includes('application/json'))
        return true;
    if ((req.get('x-requested-with') || '').toLowerCase() === 'xmlhttprequest')
        return true;
    return false;
}
function bloquearAcesso(req, res, motivo) {
    if (ehRequisicaoApi(req)) {
        return res.status(403).json({
            erro: motivo || 'Recurso disponível apenas no plano Premium. Acesse /dashboard/upgrade.',
            plano_necessario: 'premium'
        });
    }
    return res.redirect('/dashboard/upgrade');
}
// Exige plano premium ativo
// Usuários free são redirecionados para /dashboard/upgrade (ou recebem 403 JSON em rotas /api/*)
async function exigirPlanoAtivo(req, res, next) {
    if (!req.session || !req.session.user) {
        if (ehRequisicaoApi(req)) {
            return res.status(401).json({ erro: 'Sessão expirada. Faça login novamente.' });
        }
        return res.redirect('/login?erro=Faça login para continuar.');
    }
    const user = req.session.user;
    // Verifica expiração em tempo real — sessões duram 24h e podem ficar
    // ativas após o vencimento se o usuário não fizer logout.
    if (user.premium_ate) {
        const venc = new Date(user.premium_ate);
        if (!isNaN(venc.getTime()) && venc < new Date()) {
            // Sessão pode estar desatualizada (renovação via webhook após o login) —
            // confirma no DB antes de bloquear.
            const dados = await buscarStatusPremiumAtual(user.email);
            if (assinaturaRenovada(dados)) {
                aplicarRenovacaoNaSessao(req, dados);
                return next();
            }
            req.session.user.is_active = false;
            req.session.user.plano = 'free';
            return bloquearAcesso(req, res, 'Sua licença Premium expirou. Renove em /dashboard/upgrade.');
        }
    }
    if (!user.is_active) {
        // Sessão pode estar desatualizada após pagamento aprovado pelo webhook.
        // Consulta o DB para confirmar o status real antes de bloquear o acesso.
        // user.email vem da sessão e pode estar com case misto — lowercase no lookup
        // garante consistência com o doc ID salvo pelo registerService.
        try {
            const emailKey = (user.email || '').toLowerCase();
            if (emailKey) {
                const snap = await db.collection('clientes_premium').doc(emailKey).get();
                if (snap.exists) {
                    const dados = snap.data();
                    if (dados.is_active === true) {
                        req.session.user.is_active = true;
                        req.session.user.plano = dados.plano || 'premium';
                        if (dados.premium_ate)
                            req.session.user.premium_ate = dados.premium_ate;
                        return next();
                    }
                }
            }
        }
        catch (err) {
            // Falha de DB nunca deve virar 500 — degradamos para o bloqueio padrão
            console.warn('[AUTH] Falha ao verificar status no DB:', err.message);
        }
        return bloquearAcesso(req, res);
    }
    next();
}
// Controle de acesso para rotas de IA:
// - Assinante ativo (is_active): verifica expiração da assinatura + saldo
//   real do pool de crédito do modelo pedido (Gemini/GPT, decidido pelo
//   body da própria requisição) — bloqueia ao zerar. Antes disso, créditos
//   de assinante ativo eram só contador (nunca bloqueavam), o que deixava
//   custo de API sem teto pra quem consumisse muito além do esperado do
//   plano; corrigido a pedido explícito do dono do produto.
// - Usuário free: bloqueado ao esgotar os 5 créditos do plano grátis
async function verificarSaldo(req, res, next) {
    const user = req.session?.user;
    if (!user?.email)
        return res.status(401).json({ erro: 'Sessão expirada. Faça login novamente.' });
    if (user.is_active) {
        // Verifica expiração da assinatura
        if (user.premium_ate) {
            const venc = new Date(user.premium_ate);
            if (!isNaN(venc.getTime()) && venc < new Date()) {
                // Sessão pode estar desatualizada (renovação via webhook após o login) —
                // confirma no DB antes de bloquear. Evita o falso "assinatura expirou"
                // enquanto o usuário ainda tem créditos/plano ativo no banco.
                const dados = await buscarStatusPremiumAtual(user.email);
                if (assinaturaRenovada(dados)) {
                    aplicarRenovacaoNaSessao(req, dados);
                    // Continua para a conferência do saldo no Firestore.
                }
                else {
                    req.session.user.is_active = false;
                    return res.status(402).json({
                        erro: 'Sua assinatura expirou. Renove em /dashboard/upgrade.',
                        codigo: 'ASSINATURA_EXPIRADA',
                    });
                }
            }
        }
        // Saldo real do pool relevante — mesmo campo que debitarCreditos/
        // debitarCreditosGpt (creditService.js) debitam. "gpt-5.4" é o
        // mesmo literal já usado em chat.js/workspaceChat.js pra decidir
        // isGpt a partir de req.body.model.
        try {
            const isGpt = req.body?.model === 'gpt-5.4';
            const campoSaldo = isGpt ? 'creditos_gpt' : 'creditos';
            const campoExpira = isGpt ? 'creditos_gpt_expira_em' : 'creditos_expira_em';
            const nomeModelo = isGpt ? 'GPT' : 'Gemini';
            const snap = await db.collection('clientes_premium').doc(user.email.toLowerCase()).get();
            if (!snap.exists) {
                return res.status(402).json({ erro: 'Conta sem créditos cadastrados.', codigo: 'SEM_CREDITOS' });
            }
            {
                const dados = snap.data() || {};
                if (dados[campoExpira] && new Date(dados[campoExpira]) < new Date()) {
                    return res.status(402).json({
                        erro: `Seus créditos ${nomeModelo} deste ciclo expiraram. Aguarde a renovação do ciclo ou fale com o suporte.`,
                        codigo: 'CREDITOS_EXPIRADOS',
                    });
                }
                const saldo = dados[campoSaldo] ?? 0;
                if (typeof saldo !== 'number' || !Number.isFinite(saldo) || saldo <= 0) {
                    return res.status(402).json({
                        erro: `Seus créditos ${nomeModelo} deste ciclo acabaram. Aguarde a renovação do ciclo ou fale com o suporte.`,
                        codigo: 'SEM_CREDITOS',
                    });
                }
            }
        }
        catch (err) {
            // Consultas indisponíveis não autorizam chamadas pagas ao Gemini/GPT.
            console.warn('[AUTH] Falha ao verificar saldo de assinante ativo:', err.message);
            return res.status(503).json({ erro: 'Não foi possível confirmar seus créditos. Tente novamente.', codigo: 'SALDO_INDISPONIVEL' });
        }
        return next();
    }
    // Usuário free — verifica saldo dos 5 créditos gratuitos
    try {
        const snap = await db.collection('clientes_premium').doc(user.email.toLowerCase()).get();
        // Sem carteira criada, não existe saldo confirmado para uma chamada paga.
        if (!snap.exists)
            return res.status(402).json({ erro: 'Conta sem créditos cadastrados.', codigo: 'SEM_CREDITOS' });
        const dados = snap.data();
        // Pode ter sido ativado via webhook sem sessão atualizada
        if (dados.is_active === true) {
            req.session.user.is_active = true;
            // Continua para conferir o saldo antes de liberar o provedor.
        }
        // Créditos expirados — zera e bloqueia
        if (dados.creditos_expira_em && new Date(dados.creditos_expira_em) < new Date()) {
            await snap.ref.update({ creditos: 0, creditos_expira_em: null });
            return res.status(402).json({
                erro: 'Seus créditos gratuitos expiraram. Assine um plano em /dashboard/upgrade.',
                codigo: 'CREDITOS_EXPIRADOS',
            });
        }
        const saldo = dados.creditos ?? 0;
        if (typeof saldo !== 'number' || !Number.isFinite(saldo) || saldo <= 0) {
            return res.status(402).json({
                erro: 'Seus 5 créditos gratuitos acabaram. Assine um plano em /dashboard/upgrade.',
                codigo: 'SEM_CREDITOS',
            });
        }
    }
    catch (err) {
        console.warn('[AUTH] Falha ao verificar créditos free:', err.message);
        return res.status(503).json({ erro: 'Não foi possível confirmar seus créditos. Tente novamente.', codigo: 'SALDO_INDISPONIVEL' });
    }
    next();
}
// Exige plano studio ativo.
// Redireciona para /dashboard/upgrade em páginas HTML; retorna 403 JSON em /api/*.
async function exigirPlanoStudio(req, res, next) {
    if (!req.session || !req.session.user) {
        if (ehRequisicaoApi(req)) {
            return res.status(401).json({ erro: 'Sessão expirada. Faça login novamente.' });
        }
        return res.redirect('/login?erro=Faça login para continuar.');
    }
    const user = req.session.user;
    // Verifica expiração antes de checar plano
    if (user.premium_ate) {
        const venc = new Date(user.premium_ate);
        if (!isNaN(venc.getTime()) && venc < new Date()) {
            req.session.user.is_active = false;
            req.session.user.plano = 'free';
            if (ehRequisicaoApi(req)) {
                return res.status(403).json({ erro: 'Sua licença expirou. Renove em /dashboard/upgrade.', plano_necessario: 'studio' });
            }
            return res.redirect('/dashboard/upgrade');
        }
    }
    // Sessão pode estar desatualizada — confirma plano no DB
    const planoSessao = (user.plano || '').toLowerCase();
    if (planoSessao !== 'studio') {
        try {
            const emailKey = (user.email || '').toLowerCase();
            if (emailKey) {
                const snap = await db.collection('clientes_premium').doc(emailKey).get();
                if (snap.exists) {
                    const dados = snap.data();
                    if ((dados.plano || '').toLowerCase() === 'studio' && dados.is_active === true) {
                        req.session.user.plano = dados.plano;
                        req.session.user.is_active = true;
                        if (dados.premium_ate)
                            req.session.user.premium_ate = dados.premium_ate;
                        return next();
                    }
                }
            }
        }
        catch (err) {
            console.warn('[AUTH] Falha ao verificar plano studio no DB:', err.message);
        }
        if (ehRequisicaoApi(req)) {
            return res.status(403).json({ erro: 'Workspace disponível apenas no plano Studio. Acesse /dashboard/upgrade.', plano_necessario: 'studio' });
        }
        return res.redirect('/dashboard/upgrade');
    }
    next();
}
// Controle de acesso para o Gerador de Templates IA (blogger-ai):
// - Free (is_active=false ou plano='free'): bloqueado — gerador é premium+
// - Assinante ativo com plano pago: verifica expiração + saldo real de
//   creditos_bloggerai — mesmo racional e mesmo padrão de verificarSaldo()
//   (Gemini/GPT): crédito de assinante ativo não é mais só contador.
async function verificarSaldoBloggerAi(req, res, next) {
    const user = req.session?.user;
    if (!user?.email)
        return res.status(401).json({ erro: 'Sessão expirada. Faça login novamente.' });
    const plano = (user.plano || '').toLowerCase();
    // Se sessão indicar free ou inativo, confirma no DB antes de bloquear
    if (!user.is_active || plano === 'free' || plano === '') {
        let renovado = false;
        try {
            const emailKey = (user.email || '').toLowerCase();
            if (emailKey) {
                const snap = await db.collection('clientes_premium').doc(emailKey).get();
                if (snap.exists) {
                    const dados = snap.data();
                    const planoDb = (dados.plano || '').toLowerCase();
                    if (dados.is_active === true && planoDb !== 'free' && planoDb !== '') {
                        req.session.user.is_active = true;
                        req.session.user.plano = dados.plano;
                        if (dados.premium_ate)
                            req.session.user.premium_ate = dados.premium_ate;
                        renovado = true;
                    }
                }
            }
        }
        catch (err) {
            console.warn('[AUTH] verificarSaldoBloggerAi DB check err:', err.message);
        }
        if (!renovado)
            return res.status(403).json({
                erro: 'O Gerador de Templates IA é exclusivo para planos pagos. Acesse /dashboard/upgrade.',
                codigo: 'PLANO_INSUFICIENTE',
                plano_necessario: 'premium',
            });
    }
    // Assinante ativo — verifica apenas expiração da assinatura
    if (user.premium_ate) {
        const venc = new Date(user.premium_ate);
        if (!isNaN(venc.getTime()) && venc < new Date()) {
            // Sessão pode estar desatualizada (renovação via webhook após o login) —
            // confirma no DB antes de bloquear.
            const dados = await buscarStatusPremiumAtual(user.email);
            if (assinaturaRenovada(dados)) {
                aplicarRenovacaoNaSessao(req, dados);
            }
            else {
                req.session.user.is_active = false;
                req.session.user.plano = 'free';
                return res.status(402).json({
                    erro: 'Sua assinatura expirou. Renove em /dashboard/upgrade.',
                    codigo: 'ASSINATURA_EXPIRADA',
                });
            }
        }
    }
    // Saldo real do Gerador de Templates IA — mesmo campo que
    // debitarCreditosBloggerAi (creditService.js) debita.
    try {
        const snap = await db.collection('clientes_premium').doc(user.email.toLowerCase()).get();
        if (!snap.exists)
            return res.status(402).json({ erro: 'Conta sem créditos Blogger IA cadastrados.', codigo: 'SEM_CREDITOS' });
        {
            const dados = snap.data() || {};
            if (dados.creditos_bloggerai_expira_em && new Date(dados.creditos_bloggerai_expira_em) < new Date()) {
                return res.status(402).json({
                    erro: 'Seus créditos do Gerador de Templates IA deste ciclo expiraram. Aguarde a renovação do ciclo ou fale com o suporte.',
                    codigo: 'CREDITOS_EXPIRADOS',
                });
            }
            const saldo = dados.creditos_bloggerai ?? 0;
            if (typeof saldo !== 'number' || !Number.isFinite(saldo) || saldo <= 0) {
                return res.status(402).json({
                    erro: 'Seus créditos do Gerador de Templates IA deste ciclo acabaram. Aguarde a renovação do ciclo ou fale com o suporte.',
                    codigo: 'SEM_CREDITOS',
                });
            }
        }
    }
    catch (err) {
        console.warn('[AUTH] Falha ao verificar saldo bloggerai de assinante ativo:', err.message);
        return res.status(503).json({ erro: 'Não foi possível confirmar seus créditos Blogger IA.', codigo: 'SALDO_INDISPONIVEL' });
    }
    next();
}
module.exports = { exigirLogin, exigirPlanoAtivo, exigirPlanoStudio, verificarSaldo, verificarSaldoBloggerAi };

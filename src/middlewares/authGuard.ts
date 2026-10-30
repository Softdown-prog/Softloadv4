export interface AuthGuardUser { email: string; uid?: string; plano?: string; is_active?: boolean; premium_ate?: string | null }
export interface AuthGuardRequest {
    path?: string; get(name: string): string | undefined;
    session?: { user?: AuthGuardUser };
}
export interface AuthGuardResponse { status(code: number): AuthGuardResponse; json(body: Record<string, unknown>): unknown; redirect(url: string): unknown }
export type AuthGuardNext = () => unknown;
interface AuthCustomer {
    is_active?: boolean; plano?: string; premium_ate?: string | null;
}
interface AuthDatabase { collection(name: string): { doc(id: string): { get(): Promise<{
    exists: boolean; data(): AuthCustomer; ref: { update(data: Record<string, unknown>): Promise<unknown> };
}> } } }

/**
 * MIDDLEWARES DE PROTEÇÃO DE ROTAS
 *
 * Regras de acesso:
 * - Qualquer pessoa pode se registrar e entrar no dashboard
 * - Usuário FREE: entra no dashboard, vê as ferramentas mas não usa
 * - Ao tentar usar qualquer ferramenta, cai na página de planos
 * - Usuário PREMIUM: acesso total + 100MB no Cloud Storage
 */

const { db } = require('../services/firebase') as { db: AuthDatabase };

// Consulta o Firestore para confirmar o status real da assinatura.
// Usado quando o premium_ate da SESSÃO parece vencido antes de bloquear —
// a sessão dura até 24h e não é atualizada automaticamente quando o webhook
// do Mercado Pago renova o plano em background. Sem esta checagem, um usuário
// que renovou após o login (mas antes do cookie expirar) via "Sua assinatura
// expirou" mesmo com a assinatura ativa e paga no banco.
async function buscarStatusPremiumAtual(email: string | null | undefined): Promise<AuthCustomer | null> {
    try {
        const emailKey = (email || '').toLowerCase();
        if (!emailKey) return null;
        const snap = await db.collection('clientes_premium').doc(emailKey).get();
        return snap.exists ? snap.data() : null;
    } catch (err) {
        console.warn('[AUTH] Falha ao verificar status premium no DB:', (err as Error).message);
        return null;
    }
}

// Retorna true e atualiza a sessão se o DB confirmar assinatura ativa e não vencida.
function assinaturaRenovada(dados: AuthCustomer | null): dados is AuthCustomer & { premium_ate: string; is_active: true } {
    return !!(dados && dados.is_active === true && dados.premium_ate && new Date(dados.premium_ate) >= new Date());
}

function aplicarRenovacaoNaSessao(req: AuthGuardRequest, dados: AuthCustomer) {
    req.session!.user!.is_active   = true;
    req.session!.user!.plano       = dados.plano || req.session!.user!.plano;
    req.session!.user!.premium_ate = dados.premium_ate;
}

// Exige apenas estar logado (free ou premium)
function exigirLogin(req: AuthGuardRequest, res: AuthGuardResponse, next: AuthGuardNext) {
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
function ehRequisicaoApi(req: AuthGuardRequest): boolean {
    if (req.path && req.path.startsWith('/api/')) return true;
    const accept = (req.get('accept') || '').toLowerCase();
    if (accept.includes('application/json')) return true;
    if ((req.get('x-requested-with') || '').toLowerCase() === 'xmlhttprequest') return true;
    return false;
}

function bloquearAcesso(req: AuthGuardRequest, res: AuthGuardResponse, motivo?: string) {
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
async function exigirPlanoAtivo(req: AuthGuardRequest, res: AuthGuardResponse, next: AuthGuardNext) {
    if (!req.session || !req.session.user) {
        if (ehRequisicaoApi(req)) {
            return res.status(401).json({ erro: 'Sessão expirada. Faça login novamente.' });
        }
        return res.redirect('/login?erro=Faça login para continuar.');
    }

    const user = req.session!.user!;

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
            req.session!.user!.is_active = false;
            req.session!.user!.plano = 'free';
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
                        req.session!.user!.is_active = true;
                        req.session!.user!.plano = dados.plano || 'premium';
                        if (dados.premium_ate) req.session!.user!.premium_ate = dados.premium_ate;
                        return next();
                    }
                }
            }
        } catch (err) {
            // Falha de DB nunca deve virar 500 — degradamos para o bloqueio padrão
            console.warn('[AUTH] Falha ao verificar status no DB:', (err as Error).message);
        }
        return bloquearAcesso(req, res);
    }

    next();
}

module.exports = { exigirLogin, exigirPlanoAtivo };
export type AuthGuardHandler = (req: AuthGuardRequest, res: AuthGuardResponse, next: AuthGuardNext) => unknown;

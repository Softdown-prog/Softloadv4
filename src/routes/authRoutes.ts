// Contratos explícitos para a API pública de autenticação.
interface AuthUser {
    uid: string; email: string; nome: string; plano: string; is_active: boolean;
    is_super_admin: boolean; dominios: string[]; tentativas_compilacao: number;
    storage_usado_mb: number; premium_ate: string | null;
}
interface AuthSession {
    user?: AuthUser;
    save(callback: (err?: Error | null) => void): void;
    destroy(callback: (err?: Error | null) => void): void;
}
interface AuthRequest {
    session: AuthSession;
    body: { name: string; email: string; password: string };
}
interface AuthResponse {
    redirect(path: string): void;
    render(view: string, locals?: Record<string, string>): void;
}
type AuthHandler = (req: AuthRequest, res: AuthResponse) => unknown;
interface AuthRouter {
    get(path: string, handler: AuthHandler): void;
    post(path: string, limiter: AuthHandler, handler: AuthHandler): void;
}
interface RateLimitOptions {
    windowMs: number; max: number; standardHeaders: boolean; legacyHeaders: boolean;
    handler: AuthHandler;
}
interface UserRecord {
    nome?: string; plano?: string; is_active?: boolean; premium_ate?: string | null;
    is_super_admin?: boolean; dominios?: string[]; tentativas_compilacao?: number;
    storage_usado_mb?: number;
}
interface UserRef {
    get(): Promise<{ exists: boolean; data(): UserRecord }>;
    update(fields: Record<string, unknown>): Promise<void>;
    set(fields: Record<string, unknown>): Promise<void>;
}
interface UserQuery { empty: boolean; docs: Array<{ ref: UserRef; data(): UserRecord }> }
interface UsersCollection {
    doc(id: string): UserRef;
    where(field: string, op: '==', value: string): { limit(count: number): { get(): Promise<UserQuery> } };
}
interface FirebaseDeps {
    db: { collection(name: string): UsersCollection };
    admin: { auth(): { generatePasswordResetLink(email: string, options: {url: string}): Promise<string> } };
}
interface IdentityResponse { localId: string; error: {message: string} }
declare const require: (id: string) => unknown;
declare const module: { exports: unknown };

const express = require('express') as { Router(): AuthRouter };
const router = express.Router();
const rateLimit = require('express-rate-limit') as (options: RateLimitOptions) => AuthHandler;
const { db, admin } = require('../services/firebase') as FirebaseDeps;
const { enviarBoasVindas, enviarRecuperacaoSenha } = require('../services/emailService') as {
    enviarBoasVindas(email: string, name: string): Promise<void>;
    enviarRecuperacaoSenha(email: string, name: string, resetLink: string): Promise<void>;
};

// Rate limit por IP — sem isso, login/registro/recuperação ficam abertos
// a força bruta e criação em massa de contas (mesmo padrão de handler já
// usado em contatoRoutes.js: redireciona com ?erro= em vez do JSON 429
// padrão, porque essas rotas são POST de formulário HTML, não fetch/API).
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        res.redirect('/login?erro=Muitas tentativas de login. Aguarde alguns minutos e tente novamente.');
    },
});
const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        res.redirect('/register?erro=Muitas tentativas de cadastro. Aguarde uma hora e tente novamente.');
    },
});
const recoverLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        res.redirect('/recover?erro=Muitas tentativas de recuperação. Aguarde alguns minutos e tente novamente.');
    },
});

// ==========================================
// HELPER: busca usuário pelo campo email
// (ID do documento pode ser uid ou email — busca pelo campo garante compatibilidade)
// ==========================================
async function buscarUsuarioPorEmail(email: string): Promise<{ref: UserRef; data: UserRecord} | null> {
    const query = await db.collection('clientes_premium')
        .where('email', '==', email.toLowerCase())
        .limit(1)
        .get();

    if (query.empty) return null;
    return { ref: query.docs[0].ref, data: query.docs[0].data() };
}

// ==========================================
// 1. ROTAS VISUAIS (GET)
// ==========================================

// Telas públicas de autenticação renderizadas com EJS sem bundle React.
// O POST e os controles do Firebase permanecem compatíveis. Feedback
// ?erro= e ?sucesso= é exibido via textContent no HTML, sem injeção de conteúdo.
router.get('/login', (req, res) => {
    if (req.session && req.session.user) return res.redirect('/dashboard');
    res.render('pages/auth-simples', { authMode: 'login' });
});

router.get('/register', (req, res) => {
    if (req.session && req.session.user) return res.redirect('/dashboard');
    res.render('pages/auth-simples', { authMode: 'register' });
});

router.get('/recover', (req, res) => {
    if (req.session && req.session.user) return res.redirect('/dashboard');
    res.render('pages/auth-simples', { authMode: 'recover' });
});

// ==========================================
// 2. REGISTRO MANUAL
// ==========================================

router.post('/register', registerLimiter, async (req, res) => {
    try {
        const { name, email, password } = req.body;
        console.log(`[AUTH] Registrando: ${email}`);

        const apiKey = process.env.FIREBASE_API_KEY;

        const authResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, returnSecureToken: true })
        });

        const authData = await authResponse.json() as IdentityResponse;

        if (!authResponse.ok) {
            throw new Error(authData.error.message || 'Erro desconhecido na API');
        }

        // Novos usuários: ID do documento = email (padrão novo)
        await db.collection('clientes_premium').doc(email.toLowerCase()).set({
            uid: authData.localId,
            nome: name,
            email: email.toLowerCase(),
            plano: 'free',
            is_active: false,
            status: 'pendente',
            dominios: [],
            tentativas_compilacao: 0,
            premium_ate: null,
            storage_usado_mb: 0,
            creditos: 5,
            creditos_ciclo_total: 5,
            creditos_expira_em: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            criado_em: new Date().toISOString()
        });

        console.log(`✅ [AUTH] Registrado: ${email}`);

        // Email de boas-vindas — fire-and-forget (falha não bloqueia o cadastro)
        enviarBoasVindas(email.toLowerCase(), name)
            .catch(e => console.error('[EMAIL] Boas-vindas falhou:', e.message));

        res.redirect('/login?sucesso=Conta criada! Faça login para entrar.');
    } catch (error) {
        console.error('🚨 [REGISTRO]:', (error as Error).message);
        let msgErro = 'Erro ao criar conta. Verifique os dados.';
        if ((error as Error).message.includes('EMAIL_EXISTS')) msgErro = 'Este e-mail já possui uma conta.';
        if ((error as Error).message.includes('WEAK_PASSWORD')) msgErro = 'A senha deve ter no mínimo 6 caracteres.';
        if ((error as Error).message.includes('INVALID_EMAIL')) msgErro = 'O formato do e-mail é inválido.';
        res.redirect(`/register?erro=${encodeURIComponent(msgErro)}`);
    }
});

// ==========================================
// 3. LOGIN MANUAL
// ==========================================

router.post('/login', loginLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        const apiKey = process.env.FIREBASE_API_KEY;

        console.log(`[AUTH] Login: ${email}`);

        const authResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, returnSecureToken: true })
        });

        const authData = await authResponse.json() as IdentityResponse;

        if (!authResponse.ok) {
            console.error('[AUTH] Credenciais inválidas:', authData.error.message);
            return res.redirect('/login?erro=E-mail ou senha incorretos.');
        }

        // Busca pelo campo email — funciona independente do ID do documento
        const usuario = await buscarUsuarioPorEmail(email);

        if (!usuario) {
            console.error(`[AUTH] Usuário não encontrado no Firestore: ${email}`);
            return res.redirect('/login?erro=Conta não encontrada. Faça o registro primeiro.');
        }

        const userData = usuario.data;

        // Verifica se assinatura premium ainda é válida
        let isActive = userData.is_active || false;
        let planoAtual = userData.plano || 'free';

        if (isActive && userData.premium_ate) {
            const vencimento = new Date(userData.premium_ate);
            if (vencimento < new Date()) {
                isActive = false;
                planoAtual = 'free';
                await usuario.ref.update({
                    plano: 'free',
                    is_active: false,
                    status: 'pendente',
                    ultima_atualizacao: new Date().toISOString()
                });
                console.log(`[AUTH] Assinatura vencida: ${email} → rebaixado para free.`);
            }
        }

        req.session.user = {
            uid: authData.localId,
            email: email.toLowerCase(),
            nome: userData.nome || 'Usuário',
            plano: planoAtual,
            is_active: isActive,
            is_super_admin: userData.is_super_admin || false,
            dominios: userData.dominios || [],
            tentativas_compilacao: userData.tentativas_compilacao || 0,
            storage_usado_mb: userData.storage_usado_mb || 0,
            // premium_ate na sessão habilita verificação de expiração em tempo real
            // no middleware exigirPlanoAtivo
            premium_ate: userData.premium_ate || null
        };

        req.session.save((err) => {
            if (err) {
                console.error('🚨 [AUTH] Falha ao salvar sessão:', err.message);
                return res.redirect('/login?erro=Erro ao criar sessão. Tente novamente.');
            }
            console.log(`✅ [AUTH] Login OK: ${email} | Plano: ${planoAtual}`);
            res.redirect('/dashboard');
        });

    } catch (error) {
        console.error('🚨 [LOGIN]:', (error as Error).message);
        res.redirect('/login?erro=Erro interno. Tente novamente.');
    }
});

// ==========================================
// 4. RECUPERAÇÃO DE SENHA
// ==========================================

router.post('/recover', recoverLimiter, async (req, res) => {
    // Resposta sempre genérica para não revelar se o e-mail existe (anti-enumeração)
    const SUCESSO = '/recover?sucesso=Se o e-mail existir, o link foi enviado.';

    try {
        const email = (req.body.email || '').trim().toLowerCase();
        if (!email) return res.redirect('/recover?erro=O e-mail é obrigatório.');

        // Gera o link de reset via Admin SDK (não envia o email do Firebase)
        // Se o usuário não existir no Auth, generatePasswordResetLink lança USER_NOT_FOUND
        let resetLink;
        try {
            resetLink = await admin.auth().generatePasswordResetLink(email, {
                url: `${process.env.BASE_URL || 'https://softload.analysepro.com'}/login`,
            });
        } catch (authErr) {
            // USER_NOT_FOUND ou qualquer outro erro → retorna genérico (segurança)
            console.warn('[RECOVER] Firebase auth err:', (authErr as {code?: string; message?: string}).code || (authErr as Error).message, 'para:', email);
            return res.redirect(SUCESSO);
        }

        // Busca nome do usuário para personalizar o email
        const snap  = await db.collection('clientes_premium').doc(email).get();
        const nome  = snap.exists ? (snap.data().nome || '') : '';

        enviarRecuperacaoSenha(email, nome, resetLink)
            .catch(e => console.error('[EMAIL] Recuperação falhou:', e.message));

        res.redirect(SUCESSO);
    } catch (error) {
        console.error('[RECOVER] Erro inesperado:', (error as Error).message);
        res.redirect('/recover?erro=Erro no servidor. Tente novamente.');
    }
});

// ==========================================
// 6. LOGOUT
// ==========================================

router.get('/logout', (req, res) => {
    if (!req.session) return res.redirect('/login');
    req.session.destroy((err) => {
        if (err) console.error('[AUTH] Erro ao destruir sessão:', err);
        res.redirect('/login?sucesso=Sessão encerrada com segurança.');
    });
});

module.exports = router;

export {};

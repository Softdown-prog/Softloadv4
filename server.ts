import type { Bucket } from '@google-cloud/storage';
import type { SentinelWorker } from './src/services/sentinelWorker';
export interface PersistedServerSession { cookie?: { expires?: string | Date | null }; [field: string]: unknown }
interface ServerSessionRecord { sess: PersistedServerSession; expires?: number }
interface ServerDocument {
    get(): Promise<{ exists: boolean; data(): ServerSessionRecord }>;
    set(data: { sess: PersistedServerSession; expires: number }): Promise<unknown>;
    delete(): Promise<unknown>;
}
interface ServerCollection { doc(id: string): ServerDocument; limit(count: number): { get(): Promise<unknown> } }
interface ServerDatabase { collection(name: string): ServerCollection }
interface ServerRequest { path: string; get(name: string): string | undefined; session: { user?: unknown } }
interface ServerResponse {
    locals: Record<string, unknown>;
    set(name: string, value: string): unknown;
    setHeader(name: string, value: string): unknown;
    status(code: number): ServerResponse;
    json(body: Record<string, unknown>): unknown;
    render(view: string): unknown;
    redirect(code: number, path: string): unknown;
}
interface ServerFailure extends Error { status?: number; code?: string }
interface ServerApp {
    set(name: string, value: unknown): unknown;
    use(...args: unknown[]): unknown;
    get(path: string, handler: (req: ServerRequest, res: ServerResponse) => unknown): unknown;
    listen(port: number | string, host: string, callback: () => void): unknown;
}
interface ServerExpress {
    (): ServerApp;
    urlencoded(options: { extended: boolean }): unknown;
    json(): unknown;
    static(root: string, options: { maxAge: string; immutable: boolean; setHeaders(res: ServerResponse, path: string): void }): unknown;
}
interface SessionModule {
    (options: { store: object; secret: string | undefined; resave: boolean; saveUninitialized: boolean; proxy: boolean; cookie: { secure: boolean; httpOnly: boolean; sameSite: string; maxAge: number } }): unknown;
    Store: new () => object;
}
type SessionReadCallback = (error: unknown, session?: PersistedServerSession | null) => void;
type SessionWriteCallback = (error: unknown) => void;

const express = require('express') as ServerExpress;
const path = require('path') as typeof import('node:path');
const dotenv = require('dotenv') as typeof import('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

const { validarEnvBoot } = require('./src/services/envBoot') as typeof import('./src/services/envBoot');
const envCheck = validarEnvBoot();
if (!envCheck.ok) {
    console.error(`🚨 Boot abortado — env vars obrigatórias ausentes: ${envCheck.faltandoObrigatorias.join(', ')}`);
    process.exit(1);
}
if (envCheck.faltandoOpcionais.length) {
    console.warn(`⚠️  Env vars opcionais ausentes (features associadas ficam degradadas): ${envCheck.faltandoOpcionais.join(', ')}`);
}

const session = require('express-session') as SessionModule;
const { db, bucket } = require('./src/services/firebase') as { db: ServerDatabase; bucket: Bucket };
const { helmetMiddleware, corsMiddleware } = require('./src/middlewares/security') as { helmetMiddleware: unknown; corsMiddleware: unknown };
const authRoutes              = require('./src/routes/authRoutes');
const dashboardRoutes         = require('./src/routes/dashboardRoutes');
const contatoRoutes           = require('./src/routes/contatoRoutes');
const apiRoutes               = require('./src/routes/apiRoutes');
const adminRoutes             = require('./src/routes/adminRoutes');
const workersRoutes           = require('./src/routes/workersRoutes');
const sentinelWorker = require('./src/services/sentinelWorker') as SentinelWorker;
const errorLogWorker = require('./src/services/errorLogWorker') as { start(): void };
const { setPublicStaticHeaders } = require('./scripts/vendorCachePolicy') as typeof import('./scripts/vendorCachePolicy');
const buildInfo = require('./src/services/buildInfo') as typeof import('./src/services/buildInfo');
// Inicia captura de erros silenciosos imediatamente — antes de qualquer require
// que possa gerar warnings/erros durante a inicialização dos serviços.
errorLogWorker.start();

// ── FirestoreSessionStore ────────────────────────────────────────────────────
// Substitui o store in-memory padrão, que era perdido a cada reinício do
// Cloud Run. Sessões agora persistem na coleção Firestore "sessions".
class FirestoreSessionStore extends session.Store {
    col: ServerCollection;
    constructor() {
        super();
        this.col = db.collection('sessions');
    }

    async get(sid: string, cb: SessionReadCallback) {
        try {
            const doc = await this.col.doc(sid).get();
            if (!doc.exists) return cb(null, null);
            const { sess, expires } = doc.data();
            if (expires && Date.now() > expires) {
                await this.col.doc(sid).delete().catch(() => {});
                return cb(null, null);
            }
            cb(null, sess);
        } catch (e) {
            console.error('[SESSION] Erro ao ler sessão:', (e as Error).message);
            cb(null, null);
        }
    }

    async set(sid: string, sess: PersistedServerSession, cb: SessionWriteCallback) {
        try {
            const expires = sess.cookie?.expires
                ? new Date(sess.cookie.expires).getTime()
                : Date.now() + 24 * 60 * 60 * 1000;
            // JSON round-trip remove undefined e prototype methods que o Firestore rejeita
            const sessPlain = JSON.parse(JSON.stringify(sess));
            await this.col.doc(sid).set({ sess: sessPlain, expires });
            cb(null);
        } catch (e) {
            console.error('[SESSION] Erro ao salvar sessão:', (e as Error).message);
            cb(e);
        }
    }

    async destroy(sid: string, cb: SessionWriteCallback) {
        try { await this.col.doc(sid).delete(); } catch {}
        cb(null);
    }
}

const app = express();
const isProd = process.env.NODE_ENV === 'production';

// Necessário para Cloud Run: o Load Balancer do Google é um proxy
app.set('trust proxy', 1);

// Segurança: Helmet (CSP, X-Frame-Options, HSTS…) + CORS
// Devem vir antes de qualquer rota ou middleware que produza resposta.
app.use(helmetMiddleware);
app.use(corsMiddleware);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Os chunks versionados permanecem cacheáveis. O entrypoint /dist/assets/main.js
// tem nome fixo e precisa ser revalidado em todo acesso: caches de borda que
// ignoram querystrings não podem manter uma interface antiga por um ano.
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1y', immutable: true,
    setHeaders(res, filePath) {
        setPublicStaticHeaders(res, filePath, path.join(__dirname, 'public'));
    },
}));

// Sem isso, nem o navegador nem o Cloudflare (proxy na frente do domínio de
// produção) tinham qualquer sinal de que o HTML renderizado no servidor
// (EJS) não deve ser cacheado — visitantes recorrentes (típico em mobile)
// podiam continuar recebendo uma página antiga inteira, com as tags
// <script>/<link> apontando pro ?v=<gitSha> de um deploy anterior, e nunca
// chegavam a pedir os assets novos pro servidor. Pior: sem isso, uma página
// renderizada com dado de UMA sessão logada podia em tese ser cacheada pelo
// Cloudflare e servida pra outro visitante da mesma URL. Roda antes das
// rotas — como express.static() já respondeu e encerrou a cadeia pros
// arquivos estáticos que bate, isso só afeta páginas/APIs dinâmicas.
app.use((req: ServerRequest, res: ServerResponse, next: () => void) => {
    res.set('Cache-Control', 'no-store');
    next();
});

app.use(session({
    store: new FirestoreSessionStore(),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
        secure: isProd,
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// Injeta variáveis globais em todas as views
app.use((req: ServerRequest, res: ServerResponse, next: () => void) => {
    res.locals.user           = req.session.user || null;
    res.locals.currentPath    = req.path;
    res.locals.firebaseApiKey = process.env.FIREBASE_API_KEY;
    res.locals.firebaseAppId  = process.env.FIREBASE_APP_ID;
    res.locals.bloggerCheckoutEnabled = process.env.BLOGGER_ESSENCIAL_CHECKOUT_ENABLED === 'true';
    res.locals.bloggerFilesEnabled = process.env.SOFTLOAD_LITE_FILES_ENABLED === 'true';
    res.locals.mpCheckoutUrl  = process.env.MP_CHECKOUT_URL || '#';
    res.locals.gitSha         = buildInfo.gitSha;
    next();
});


// Migrado pro app React (frontend/pages/Landing.jsx) — mesmo raciocínio
// já usado nas outras bridges: o único local que a landing dependia
// (query.conta === 'apagada', pro toast de conta excluída) é lido
// client-side via useSearchParams em vez de vir do EJS.
app.get('/', (req, res) => res.render('pages/landing-blogger'));
app.get('/termos-de-uso', (req, res) => res.render('pages/termos-de-uso'));
app.get('/privacidade', (req, res) => res.render('pages/privacidade'));
app.use('/', authRoutes);
// Ferramenta Blogger pública; login só para ampliar a cota e acessar arquivos.
app.use('/', require('./src/routes/publicBlogger.cjs'));
app.use('/', dashboardRoutes);
app.use('/', contatoRoutes);
app.use('/', apiRoutes);
app.use('/', adminRoutes);
app.use('/', workersRoutes);
// URL antiga agora leva ao gerador procedural Blogger, não a um chat removido.
app.get('/dashboard/blogger-ai', (req, res) => res.redirect(301, '/dashboard/gerador-blogger'));

// Endpoint de diagnóstico — acesso público, sem dados sensíveis
app.get('/health', async (req, res) => {
    const envs = {
        FIREBASE_API_KEY: !!process.env.FIREBASE_API_KEY,
        FIREBASE_APP_ID: !!process.env.FIREBASE_APP_ID,
        SESSION_SECRET: !!process.env.SESSION_SECRET,
        RESEND_API_KEY: !!process.env.RESEND_API_KEY,
        MP_ACCESS_TOKEN: !!process.env.MP_ACCESS_TOKEN,
        GCS_BUCKET_NAME: !!process.env.GCS_BUCKET_NAME,
    };

    let firestoreOk = false;
    try {
        await db.collection('sessions').limit(1).get();
        firestoreOk = true;
    } catch (e) {
        // falha silenciosa — resultado refletido em firestoreOk
    }

    const allEnvsOk = Object.values(envs).every(Boolean);
    res.status(200).json({
        status: 'ok',
        envs,
        firestore: firestoreOk,
        sentinel: sentinelWorker.getStatus(),
        // Confirma qual commit está de fato rodando neste container — grava
        // em /health porque o próprio pipeline de deploy não é confiável
        // hoje (ver /eu, deploy.yml). "dev-local" fora de um build Docker.
        deploy: {
            gitSha:    buildInfo.gitSha,
            gitDate:   buildInfo.gitDate,
            buildTime: buildInfo.buildTime,
        },
    });
});

app.use((req: ServerRequest, res: ServerResponse) => res.status(404).render('pages/404'));

// Global error handler — evita 500 silencioso (tela branca) quando next(err) é chamado.
// Rotas /api/* recebem JSON; navegação HTML recebe a página 404 genérica com status 500.
app.use((err: ServerFailure, req: ServerRequest, res: ServerResponse, next: () => void) => { // eslint-disable-line no-unused-vars
    console.error('[SERVER] Erro não tratado:', err.message);
    const isApi = req.path.startsWith('/api/') ||
        (req.get('accept') || '').includes('application/json') ||
        (req.get('x-requested-with') || '').toLowerCase() === 'xmlhttprequest';
    if (isApi) {
        return res.status(err.status || 500).json({ erro: 'Erro interno do servidor. Tente novamente.' });
    }
    res.status(err.status || 500).render('pages/404');
});

// Verificação agregada da outbox GCS. Jamais expor emails ou conteúdo de recibos.
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    if (isProd) {
        console.log(`🚀 Motor Online em https://softload.analysepro.com`);
    } else {
        console.log(`🛠️  Motor Local em http://localhost:${PORT}`);
    }

    // Iniciar Sentinel Worker — monitora saúde da aplicação
    sentinelWorker.start(60000); // Executar a cada 60 segundos
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('⚠️  SIGTERM recebido — encerrando gracefully');
    sentinelWorker.stop();
    process.exit(0);
});

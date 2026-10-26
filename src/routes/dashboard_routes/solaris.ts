'use strict';
import type { SolarisGeminiClient } from '../../solaris/llm/modelRouter';
import type { SolarisChat } from '../../solaris/chat/solarisChat';
import type { RouteRequest, RouteResponse, RouteHandler, RouteRouter, RouteFailure, RouteRateLimit } from '../../contracts/routeHttp';
import type { Firestore } from '@google-cloud/firestore';
interface RouteBody { message?: string; history?: unknown; sessionId?: unknown; requestId?: unknown; tool?: unknown; githubRepository?: string; repository?: string; action?: string; url?: unknown; device?: unknown }
interface MulterFactory {
    (options: {storage: unknown; limits: {fileSize: number; files: number}; fileFilter(req: RouteRequest<RouteBody>, file: {originalname?: string}, cb: (error: Error | null, accept?: boolean) => void): void}): import('../../solaris/http/solarisUploadHandler').SolarisUploadHandlerDependencies['upload'];
    memoryStorage(): unknown;
}
declare function require(name: string): unknown;
const express = require('express') as { Router(): RouteRouter<RouteBody> };
const router  = express.Router();
const fs      = require('fs') as typeof import('fs');
const os      = require('os') as typeof import('os');
const path    = require('path') as typeof import('path');
const multer  = require('multer') as MulterFactory;
const rateLimit = require('express-rate-limit') as RouteRateLimit;

const { exigirLogin, verificarSaldo } = require('../../middlewares/authGuard') as { exigirLogin: RouteHandler<RouteBody>; verificarSaldo: RouteHandler<RouteBody> };
const chatStorage       = require('../../services/chatStorageService') as typeof import('../../services/chatStorageService');
const { db, admin }     = require('../../services/firebase') as { db: Firestore; bucket: import('@google-cloud/storage').Bucket; admin: typeof import('firebase-admin') };
const { debitarCreditos, PLAN_CREDITS } = require('../../services/creditService') as typeof import('../../services/creditService');
const { criarSolarisChat } = require('../../solaris/chat/solarisChat') as typeof import('../../solaris/chat/solarisChat');
const { detectarMarcador, removerMarcadorTruncado } = require('../../solaris/chat/solarisGenerationTrigger') as typeof import('../../solaris/chat/solarisGenerationTrigger');
const { criarOrquestrador } = require('../../solaris/pipeline/orchestrator') as typeof import('../../solaris/pipeline/orchestrator');
const { buscarConhecimentoMisto } = require('../../../scripts/codeCorpus/codeSearchService') as typeof import('../../../scripts/codeCorpus/codeSearchService');
const { criarModelRouter, MODEL_PRO, MODEL_FLASH } = require('../../solaris/llm/modelRouter') as typeof import('../../solaris/llm/modelRouter');
const { criarLivroRazaoIa } = require('../../services/aiBudgetLedger') as typeof import('../../services/aiBudgetLedger');
const { criarClienteGeminiComOrcamento } = require('../../services/aiBudgetGeminiClient') as typeof import('../../services/aiBudgetGeminiClient');
const { modoCreditosSolarisV2, criarGateCreditosSolarisV2, debitoLegadoSolaris } = require('../../services/aiCreditsV2Mode') as typeof import('../../services/aiCreditsV2Mode');
const { criarHandlerResumoCreditosV2, criarHandlerHistoricoCreditosV2 } = require('../../services/aiCreditsV2Http') as typeof import('../../services/aiCreditsV2Http');
const { createGithubAppService } = require('../../services/solarisGithubApp') as typeof import('../../services/solarisGithubApp');
const { createGithubOperations, GithubOperationError } = require('../../services/solarisGithubOperations') as typeof import('../../services/solarisGithubOperations');
const { createSolarisGithubAgent } = require('../../services/solarisGithubAgent') as typeof import('../../services/solarisGithubAgent');
const { createSolarisGithubMcp } = require('../../services/solarisGithubMcp') as import('../../services/solarisGithubMcp').RouteExports;
const { resolveGithubChatAccess } = require('../../services/solarisGithubReadiness') as typeof import('../../services/solarisGithubReadiness');
const { contextoRepositorioPublico } = require('../../solaris/tools/solarisToolModes') as import('../../solaris/tools/solarisToolModes').RouteExports;
const { GoogleGenAI } = require('@google/genai') as typeof import('@google/genai');
const { getAgent }          = require('../../services/agentBridge') as import('../../services/agentBridge').RouteExports;
const { inspecionarProjeto } = require('../../solaris/pipeline/projectInspector') as typeof import('../../solaris/pipeline/projectInspector');
const { responderOuEditarProjeto } = require('../../solaris/pipeline/projectEditor') as typeof import('../../solaris/pipeline/projectEditor');
const { criarZip, criarArquivo, deletarArquivo, listarProjeto, lerArquivo } = require('../../solaris/tools/fileTools') as typeof import('../../solaris/tools/fileTools');
const { extrairZipViaSandbox } = require('../../solaris/tools/archiveExtractClient') as typeof import('../../solaris/tools/archiveExtractClient');
const { detectarFramework } = require('../../solaris/tools/frameworkDetector') as typeof import('../../solaris/tools/frameworkDetector');
const { salvarProjeto, carregarProjeto } = require('../../solaris/tools/projectStorage') as typeof import('../../solaris/tools/projectStorage');
const { lerProjetoParaPersistir } = require('../../solaris/tools/fileTools') as typeof import('../../solaris/tools/fileTools');
const { criarHandlerChatSolaris } = require('../../solaris/http/solarisChatHandler') as typeof import('../../solaris/http/solarisChatHandler');
const { criarOrquestradorComMedicao } = require('../../solaris/http/solarisProUsage') as import('../../solaris/http/solarisProUsage').RouteExports;
const { criarHandlerUploadSolaris } = require('../../solaris/http/solarisUploadHandler') as typeof import('../../solaris/http/solarisUploadHandler');
const { criarHandlerVisual } = require('../../solaris/visual/visualReview') as typeof import('../../solaris/visual/visualReview');
const { browserSandboxReady } = require('../../solaris/visual/browserReadiness') as typeof import('../../solaris/visual/browserReadiness');

// ──────────────────────────────────────────────────────────────────────────
// CHAT DO SOLARIS CODE — rota + view próprias, motor totalmente separado
// do Blogger Engine (ver src/solaris/README.md). Mesma separação
// estrutural que o Sol (/eu/sol, admin) e o Especialista Blogger
// (/dashboard/chat) já têm — sem misturar histórico/contexto entre eles.
//
// Créditos: Solaris é Gemini-only (mesmo pool "creditos"/"creditos_expira_em"
// do Especialista Blogger) — verificarSaldo já resolve o pool certo sozinho
// (só olha req.body.model === 'gpt-5.4', que o Solaris nunca envia). Cobra
// pelos tokens reais do usageMetadata do Gemini (mesma fonte de
// src/services/geminiService.js), nunca por chamada fixa.
//
// Fase 3: confirmação do manifesto → geração de verdade. O marcador
// [[SOLARIS_GERAR:{...}]] (ver solarisGenerationTrigger.js) dispara
// orchestrator.gerarProjeto() num diretório temporário — o ZIP resultante
// volta em base64 no evento "done" (projetos do Solaris são pequenos o
// bastante pra isso, sem precisar de upload/rota de download própria) e
// nunca é persistido em disco além do request (fs.rmSync no finally do
// diretório temp). Sem link de download no histórico — a sessão salva só
// o texto da conversa, mesmo escopo documentado em src/solaris/README.md.
// ──────────────────────────────────────────────────────────────────────────
const SOLARIS_CHAT_SESSION_TYPE = 'solaris-chat';

// Sem URL do serviço de embeddings, o RAG por palavras-chave continua sozinho.
const buscarConhecimento = process.env.EMBEDDINGS_SERVICE_URL
    ? ({ query, topK }: {query: string; topK: number}) => buscarConhecimentoMisto({ query, topK, db, codeSearchEnabled: process.env.SOLARIS_CODE_SEARCH_ENABLED === 'true' }) as Promise<import('../../solaris/rag/ragPromptContext').RagContextSearchResponse>
    : null;
const solarisChat = criarSolarisChat({ buscarConhecimento });
const modelRouter  = criarModelRouter();
const orquestrador = criarOrquestrador({ modelRouter, buscarConhecimento });

// A reserva financeira é ativada SOMENTE por opção explícita na VPS.
// Enquanto desligada, o fluxo usa os mesmos objetos singleton de antes.
const livroOrcamento = criarLivroRazaoIa(db as unknown as Parameters<typeof criarLivroRazaoIa>[0]);
const githubApp = createGithubAppService(db);
const githubOperations = createGithubOperations(githubApp);
const githubMcp = process.env.SOLARIS_GITHUB_MCP_ENABLED === 'true' ? createSolarisGithubMcp(githubApp) : null;
const githubAgent = createSolarisGithubAgent(db, githubApp, githubOperations, githubMcp);
// A V2, quando explicitamente ativada, consulta o livro-razão antes de enviar
// ao modelo e não confia no contador legado nem no body HTTP para orçamento.
const verificarCreditosSolaris = criarGateCreditosSolarisV2({
    verificarLegado: verificarSaldo,
    consultar: (email) => livroOrcamento.consultar(email),
});
// Só as chamadas do Solaris migram: outros serviços seguem seu próprio gate.
const debitarSomenteSeLegado = (...args: Parameters<typeof debitarCreditos>) =>
    debitoLegadoSolaris(modoCreditosSolarisV2(), debitarCreditos)(...args);
function dependenciasPorRequisicao(req: RouteRequest<RouteBody>, ferramenta: 'solaris-chat' | 'solaris-upload' | 'solaris-visual' = 'solaris-chat') {
    if (process.env.SOLARIS_AI_BUDGET_ENFORCE !== 'true') {
        return { modelRouter, solarisChat, orquestrador };
    }
    // Identidade vem da sessão validada por exigirLogin, jamais do body HTTP.
    const email = req.session?.user?.email;
    if (!email) {
        const erro = new Error('Sessão expirada. Faça login novamente.') as RouteFailure;
        erro.status = 401;
        throw erro;
    }
    const protegida = criarClienteGeminiComOrcamento(() => {
        if (!process.env.GEMINI_API_KEY) {
            throw new Error('[SOLARIS-LLM] GEMINI_API_KEY não configurada no ambiente.');
        }
        return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) as unknown as SolarisGeminiClient;
    }, {
        email, livro: livroOrcamento, modeloPro: MODEL_PRO, ferramenta,
        // Identificador da sessão, nunca texto do prompt ou conteúdo de arquivo.
        projeto: typeof req.body?.sessionId === 'string' && /^[A-Za-z0-9_-]{6,80}$/.test(req.body.sessionId)
            ? req.body.sessionId : undefined,
        modeloFlash: MODEL_FLASH,
        protegerFlash: process.env.SOLARIS_AI_BUDGET_FLASH === 'true',
    });
    const routerUsuario = criarModelRouter(protegida);
    return {
        modelRouter: routerUsuario,
        solarisChat: criarSolarisChat({ modelRouter: routerUsuario, buscarConhecimento }),
        orquestrador: criarOrquestrador({ modelRouter: routerUsuario, buscarConhecimento }),
    };
}

let solarisAgent: Awaited<ReturnType<typeof getAgent>> | null = null;
async function getSolarisAgent() {
    if (!solarisAgent) {
        solarisAgent = await getAgent('solaris-chat');
        await solarisAgent.start();
    }
    return solarisAgent;
}

// Prévia opt-in: read-only; não substitui /api/dashboard/stats nem debita créditos legados.
router.get('/api/ai-credits/v2', exigirLogin, criarHandlerResumoCreditosV2({
    consultarSaldo: (email) => livroOrcamento.consultar(email),
    habilitado: () => process.env.AI_CREDITS_V2_PREVIEW === 'true' || modoCreditosSolarisV2() === 'ativo',
}));
router.get('/api/ai-credits/v2/history', exigirLogin, criarHandlerHistoricoCreditosV2({
    listar: (email, cursor) => livroOrcamento.listarExtratoPagina(email, 20, cursor),
    habilitado: () => process.env.AI_CREDITS_V2_PREVIEW === 'true' || modoCreditosSolarisV2() === 'ativo',
}));

// GitHub App: autorização individual de cada usuário. Nunca usar token da Softload
// nem pedir PAT pela UI. A App GitHub precisa ser instalada/autorizada uma vez.
const githubLimiter = rateLimit({windowMs: 15 * 60 * 1000,max: 20,
    standardHeaders: 'draft-7',legacyHeaders: false});
function mesmaOrigemGithub(req: RouteRequest<RouteBody>, res: RouteResponse, next: () => void) {
    const origin = req.get('origin');
    // Apenas requests do frontend local; POST/DELETE cross-site falham fechados.
    const esperado = (process.env.BASE_URL || 'https://softload.analysepro.com').replace(/\/$/, '');
    if (!origin || origin !== esperado) return res.status(403).json({erro:'Origem da requisição inválida.'});
    next();
}
router.get('/dashboard/solaris/github/status', exigirLogin, async (req,res)=>{
    res.set('Cache-Control','no-store, private');
    try { return res.json(await githubApp.status(req.session.user.uid)); }
    catch (_Caught) {
        const _ = _Caught as RouteFailure; return res.status(503).json({erro:'Não foi possível consultar conexão GitHub.'}); }
});
router.get('/dashboard/solaris/github/connect', exigirLogin, githubLimiter, async(req,res)=>{
    try { return res.redirect(await githubApp.begin(req)); }
    catch (_Caught) {
        const _ = _Caught as RouteFailure; return res.redirect('/dashboard/solaris?github=setup'); }
});
router.get('/dashboard/solaris/github/install', exigirLogin, githubLimiter, (req,res)=>{
    const url = githubApp.installUrl();
    if (!url) return res.redirect('/dashboard/solaris?github=setup');
    return res.redirect(url);
});
router.get('/dashboard/solaris/github/callback', exigirLogin, githubLimiter, async(req,res)=>{
    try {
        if (req.query.error) return res.redirect('/dashboard/solaris?github=denied');
        await githubApp.finish(req, req.query as {state: unknown; code: unknown});
        return res.redirect('/dashboard/solaris?github=connected');
    } catch (_Caught) {
        const _ = _Caught as RouteFailure; return res.redirect('/dashboard/solaris?github=error'); }
});
router.get('/dashboard/solaris/github/repositories', exigirLogin, githubLimiter, async(req,res)=>{
    res.set('Cache-Control','no-store, private');
    try { return res.json(await githubApp.listRepos(req.session.user.uid)); }
    catch (_Caught) {
        const _ = _Caught as RouteFailure; return res.status(503).json({erro:'Não foi possível listar os repositórios autorizados da GitHub App.'}); }
});
router.post('/dashboard/solaris/github/repository', exigirLogin, githubLimiter, mesmaOrigemGithub, async(req,res)=>{
    res.set('Cache-Control','no-store, private');
    try { const repository = await githubApp.selectRepo(req.session.user.uid,req.body?.repository as string);
        return res.json({ok:true,repository}); }
    catch (_Caught) {
        const _ = _Caught as RouteFailure; return res.status(400).json({erro:'Verifique o repositório e as permissões da GitHub App.'}); }
});
router.delete('/dashboard/solaris/github/disconnect', exigirLogin, githubLimiter, mesmaOrigemGithub, async(req,res)=>{
    res.set('Cache-Control','no-store, private');
    try { await githubApp.disconnect(req.session.user.uid);return res.json({ok:true}); }
    catch (_Caught) {
        const _ = _Caught as RouteFailure; return res.status(503).json({erro:'Não foi possível desconectar GitHub.'}); }
});

// Gateway de ferramentas: vinculado ao UID da sessão, nunca aceita token/repo do corpo.
router.post('/dashboard/solaris/github/action', exigirLogin, githubLimiter, mesmaOrigemGithub, async(req,res)=>{
    res.set('Cache-Control','no-store, private');
    try {
        // Ações de escrita só pelo endpoint de aprovação humana da proposta
        // armazenada no Firestore. Nunca confie em confirm:true no body do cliente.
        if (!['repository_get','file_read','pull_requests_list'].includes(req.body?.action as string))
            return res.status(403).json({ok:false,erro:'Gravações exigem aprovação de proposta no painel.'});
        const result = await githubOperations.execute(req.session.user.uid, req.body as import('../../services/solarisGithubOperations').GithubOperationInput);
        return res.json({ok:true,result});
    } catch (errCaught) {
        const err = errCaught as RouteFailure;
        const status = err instanceof GithubOperationError ? err.status : 503;
        return res.status(status).json({ok:false,erro:status===503
            ? 'Serviço GitHub indisponível no momento.' : err.message});
    }
});

// Aprovação isolada do modelo: nunca aceita conteúdo/caminho/branch do browser.
router.get('/dashboard/solaris/github/pending', exigirLogin, async(req,res)=>{
    res.set('Cache-Control','no-store, private');
    try { return res.json(await githubAgent.pending(req.session.user.uid)); }
    catch (_Caught) {
        const _ = _Caught as RouteFailure; return res.status(503).json({erro:'Não foi possível carregar a proposta GitHub.'}); }
});
router.post('/dashboard/solaris/github/approve', exigirLogin, githubLimiter, mesmaOrigemGithub, async(req,res)=>{
    res.set('Cache-Control','no-store, private');
    try { return res.json(await githubAgent.approve(req.session.user.uid)); }
    catch (errCaught) {
        const err = errCaught as RouteFailure; const status = err instanceof GithubOperationError ? err.status : 503;
        return res.status(status).json({erro:status===503
            ? 'Falha ao publicar. Verifique a branch de trabalho antes de tentar novamente.' : err.message}); }
});
router.delete('/dashboard/solaris/github/pending', exigirLogin, githubLimiter, mesmaOrigemGithub, async(req,res)=>{
    res.set('Cache-Control','no-store, private');
    try { return res.json(await githubAgent.reject(req.session.user.uid)); }
    catch (_Caught) {
        const _ = _Caught as RouteFailure; return res.status(503).json({erro:'Não foi possível cancelar a proposta.'}); }
});

router.get('/dashboard/solaris', exigirLogin, (req, res) => {
    res.render('pages/react-test', {
        activePage: 'solaris',
        user: req.session.user
    });
});

// Análise de layout OPT-IN: chama o sandbox isolado (sem usar o Agent
// em modo full e sem conceder acesso à shell). Uma única foto por pedido.
// Sem SOLARIS_VISUAL_REVIEW_ENABLED e SOLARIS_AI_BUDGET_ENFORCE,
// a rota é desativada e não provoca gastos automáticos.
// A auditoria visual tem reserva orçamentária própria (Flash) mesmo
// quando o enforcement das outras operações está desligado. Habilita
// apenas se app -> sandbox autenticado e chave de IA existem.
// Pode desligar imediatamente com SOLARIS_VISUAL_REVIEW_ENABLED=false.
// Sem lista na VPS, só o domínio público da própria Softload é aceito.
const VISUAL_PREVIEW_ORIGINS = (process.env.SOLARIS_VISUAL_PREVIEW_ORIGINS || '').trim()
    || 'https://softload.analysepro.com';
const VISUAL_ENABLED = process.env.SOLARIS_VISUAL_REVIEW_ENABLED !== 'false'
    && Boolean(process.env.GEMINI_API_KEY)
    && Boolean(process.env.SANDBOX_BROWSER_SERVICE_URL || process.env.SANDBOX_SERVICE_URL)
    && Boolean(process.env.SANDBOX_BROWSER_SHARED_SECRET || process.env.SANDBOX_SHARED_SECRET);
router.get('/dashboard/solaris/visual-review/status', exigirLogin, async (_req, res) => {
    // O fato de haver env vars não garante que o container tenha browser.
    // Testa /health do destino real, rejeitando sandbox offline, legado
    // ou archive-only ANTES de liberar o botão no frontend.
    res.setHeader('Cache-Control', 'no-store, private');
    const ready = VISUAL_ENABLED && await browserSandboxReady(
        process.env.SANDBOX_BROWSER_SERVICE_URL || process.env.SANDBOX_SERVICE_URL,
    );
    res.status(200).json({
        enabled: Boolean(ready),
        origins: VISUAL_PREVIEW_ORIGINS.split(',').map(s => s.trim()).filter(Boolean),
        maxRequestsPerTenMinutes: 3,
    });
});
const visualLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: req => req.session?.user?.uid || req.ip,
    handler: (_req, res) => res.status(429).json({error:'Limite de auditorias visuais atingido. Tente mais tarde.'}),
});
async function capturarParaVisual({ url, device }: {url: string; device: 'desktop' | 'android-mobile'}) {
    const serviceUrl = process.env.SANDBOX_BROWSER_SERVICE_URL || process.env.SANDBOX_SERVICE_URL;
    const secret = process.env.SANDBOX_BROWSER_SHARED_SECRET || process.env.SANDBOX_SHARED_SECRET;
    if (!serviceUrl || !secret) throw new Error('Sandbox visual sem URL/segredo configurados.');
    const response = await fetch(serviceUrl.replace(/[/]+$/, '') + '/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-sandbox-secret': secret },
        body: JSON.stringify({
            url, device, browser: 'chromium', screenshot: true,
            screenshotDelivery: 'inline', screenshotMode: 'viewport',
            accessibility: false, timeout: 20000,
        }),
        signal: AbortSignal.timeout(35000),
    });
    // A fronteira HTTP pode conter imagem em base64: limite antes de parsear.
    const sizeHeader = Number(response.headers.get('content-length'));
    if (sizeHeader > 900000) throw new Error('Resposta do sandbox excedeu limite visual.');
    if (!response.ok) throw new Error('Captura no sandbox falhou.');
    const text = await response.text();
    if (text.length > 900000) throw new Error('Resposta do sandbox excedeu limite visual.');
    return JSON.parse(text);
}
const visualHandler = criarHandlerVisual({
    enabled: VISUAL_ENABLED,
    origins: VISUAL_PREVIEW_ORIGINS,
    capturar: capturarParaVisual,
    criarRouter: req => {
        const protegida = criarClienteGeminiComOrcamento(() => {
            if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY ausente.');
            return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) as unknown as SolarisGeminiClient;
        }, {
            email: (req as RouteRequest<RouteBody>).session.user.email,
            livro: livroOrcamento,
            modeloPro: MODEL_FLASH,
            ferramenta: 'solaris-visual',
            maxOutputTokens: 1024,
        });
        return criarModelRouter(protegida);
    },
    debitarCreditos: debitarSomenteSeLegado,
});
router.post('/dashboard/solaris/visual-review', exigirLogin, (req, res, next) => {
    if (!VISUAL_ENABLED) {
        return res.status(404).json({error:'visual_review_disabled'});
    }
    return next();
}, visualLimiter, verificarCreditosSolaris, visualHandler);

// ──────────────────────────────────────────────────────────────────────────
// POST /dashboard/solaris/chat/stream — mesmo protocolo de eventos SSE
// genérico usado em todo o projeto (status/chunk/done/error). Streaming
// real (Fase 2) via solarisChat.perguntarStream — cada trecho de texto
// do Gemini vira um evento "chunk" assim que chega.
// ──────────────────────────────────────────────────────────────────────────
const depsChatSolaris = {
    chatStorage, db, admin, debitarCreditos, solarisChat, modelRouter, orquestrador,
    carregarProjeto, salvarProjeto, lerProjetoParaPersistir, deletarArquivo,
    criarArquivo, listarProjeto, criarZip, responderOuEditarProjeto, removerMarcadorTruncado, detectarMarcador,
};
const chatSolarisSemOrcamento = criarHandlerChatSolaris(depsChatSolaris);
router.post('/dashboard/solaris/chat/stream', exigirLogin, verificarCreditosSolaris, (req, res) => {
    const deps = dependenciasPorRequisicao(req);
    // Contabilizar cada chamada de arquitetura Pro desta requisição,
    // separada das outras conversas (singleton não pode compartilhar tokens).
    const usoPro = criarOrquestradorComMedicao({
        modelRouter: deps.modelRouter, buscarConhecimento, criarOrquestrador,
    });
    const ghMode = req.body?.tool === 'github';
    // O handler SSE continua responsável por requestId, histórico e cobrança.
    // Este wrapper injeta o loop Gemini com ferramentas SOMENTE para uma conta
    // GitHub conectada; sem conexão preserva a análise pública anterior.
    const githubChat: Pick<SolarisChat, 'perguntarStream'> = ghMode ? {
        async *perguntarStream(contextAndMessage, history, tokensRef) {
            const uid = req.session?.user?.uid;
            if (!uid) throw Error('Sessão expirada.');
            const status = await githubApp.status(uid);
            const access = resolveGithubChatAccess(status, req.body.githubRepository as string);
            if (access.mode === 'public-readonly') {
                yield* deps.solarisChat.perguntarStream(contextAndMessage, history, tokensRef);
                return;
            }
            const result = await githubAgent.prepare({
                uid, repository:req.body.githubRepository as string, message:req.body.message as string,
                history,context:contextAndMessage,modelRouter:deps.modelRouter
            });
            Object.assign(tokensRef as NonNullable<typeof tokensRef>, result.tokens);
            yield result.text;
        }
    } : deps.solarisChat;
    return criarHandlerChatSolaris({ ...depsChatSolaris, ...deps,
        orquestrador: usoPro.orquestrador,
        geracaoTokens: usoPro.contagem,
        solarisChat: githubChat,
        debitarCreditos: process.env.SOLARIS_AI_BUDGET_ENFORCE === 'true'
            ? debitarSomenteSeLegado : debitarCreditos,
        contextoRepositorioPublico: async (repo) => {
            const uid = req.session?.user?.uid;
            if (!uid) throw Error('Sessão expirada.');
            const status = await githubApp.status(uid);
            const access = resolveGithubChatAccess(status, repo);
            return access.mode === 'agent' ? githubApp.repoContext(uid, access.repository) : contextoRepositorioPublico(repo);
        },
    })(req, res);
});

// ──────────────────────────────────────────────────────────────────────────
// POST /dashboard/solaris/upload — detector de framework a partir de
// upload (ver src/solaris/README.md). Princípio de segurança: todo
// arquivo enviado pelo usuário é tratado como malicioso até prova em
// contrário — o conteúdo extraído NUNCA é executado, NUNCA passa por
// eval/require/child_process. Ele só vira TEXTO puro, lido como string
// pra alimentar frameworkDetector.js (regex/sinal estrutural, mesmo
// jeito que um humano leria o código colado num chat). O diretório
// temporário de extração é sempre apagado no finally, nunca persiste
// além da vida do request — mesmo padrão já usado pro ZIP de geração
// (Fase 3, ver mais acima neste arquivo).
//
// multer (memoryStorage) faz o parse do multipart — nunca escreve o
// upload bruto em disco antes da validação. Quem de fato decide se o
// conteúdo é seguro é o serviço isolado sandbox-efemoro/ (via
// tools/archiveExtractClient.js, POST /extract-zip): o parsing do ZIP
// não-confiável roda FORA do processo do app principal, no container
// separado que já faz essa validação pro agent/ (mesmo endpoint, ver
// agent/src/capabilities/archive.js) — zip-slip, zip bomb, symlink,
// profundidade, tamanho/contagem, tudo antes de qualquer byte voltar
// pra cá. Os arquivos de texto extraídos voltam prontos (não é mais
// preciso escrever em disco pra depois ler de volta) e são gravados no
// baseDir local via criarArquivo() só pra manter o resto do pipeline
// (listarProjeto/lerArquivo/detectarFramework/inspecionarProjeto)
// funcionando exatamente como antes, sem precisar mudar nada nele.
//
// Fase 2b: depois da detecção determinística, um loop de tool-calling
// (pipeline/projectInspector.js, Gemini Pro) lê/lista/busca de verdade
// nos arquivos extraídos — SOMENTE LEITURA, mesmo baseDir, mesma vida
// de requisição — e devolve um resumo em texto (`analiseIA`). Cobra
// crédito real (verificarSaldo/debitarCreditos, mesmo pool do resto do
// Solaris) só quando a inspeção de fato roda; falha da IA nunca derruba
// a resposta — a detecção de framework é sempre determinística.
// ──────────────────────────────────────────────────────────────────────────
const UPLOAD_MAX_BYTES = 15 * 1024 * 1024; // 15MB no arquivo .zip em si (compactado)

const uploadLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error: 'Muitos envios. Aguarde alguns minutos antes de tentar de novo.' }),
});

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: UPLOAD_MAX_BYTES, files: 1 },
    fileFilter: (req, file, cb) => {
        // Gate de UX, não de segurança — mimetype/nome vêm do cliente,
        // trivialmente falsificável. A validação de verdade é o serviço
        // isolado sandbox-efemoro/ tentando abrir o buffer como zip real.
        if (!/\.zip$/i.test(file.originalname || '')) {
            cb(new Error('Envie um arquivo .zip.'));
            return;
        }
        cb(null, true);
    },
});

const depsUploadSolaris = {
    upload, chatStorage, extrairZipViaSandbox, criarArquivo, listarProjeto, lerArquivo, detectarFramework,
    inspecionarProjeto, modelRouter, debitarCreditos, salvarProjeto,
};
const uploadSolarisSemOrcamento = criarHandlerUploadSolaris(depsUploadSolaris);
router.post('/dashboard/solaris/upload', exigirLogin, uploadLimiter, verificarCreditosSolaris, (req, res) => {
    if (process.env.SOLARIS_AI_BUDGET_ENFORCE !== 'true') {
        return uploadSolarisSemOrcamento(req, res);
    }
    const { modelRouter: routerUsuario } = dependenciasPorRequisicao(req, 'solaris-upload');
    return criarHandlerUploadSolaris({ ...depsUploadSolaris, modelRouter: routerUsuario,
        debitarCreditos: debitarSomenteSeLegado,
    })(req, res);
});

router.SOLARIS_CHAT_SESSION_TYPE = SOLARIS_CHAT_SESSION_TYPE;
module.exports = router;

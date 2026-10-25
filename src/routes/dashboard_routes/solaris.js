'use strict';
const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const os      = require('os');
const path    = require('path');
const multer  = require('multer');
const rateLimit = require('express-rate-limit');

const { exigirLogin, verificarSaldo } = require('../../middlewares/authGuard');
const chatStorage       = require('../../services/chatStorageService');
const { db, admin }     = require('../../services/firebase');
const { debitarCreditos, PLAN_CREDITS } = require('../../services/creditService');
const { criarSolarisChat } = require('../../solaris/chat/solarisChat');
const { detectarMarcador, removerMarcadorTruncado } = require('../../solaris/chat/solarisGenerationTrigger');
const { criarOrquestrador } = require('../../solaris/pipeline/orchestrator');
const { buscarConhecimentoMisto } = require('../../../scripts/codeCorpus/codeSearchService');
const { criarModelRouter, MODEL_PRO, MODEL_FLASH } = require('../../solaris/llm/modelRouter');
const { criarLivroRazaoIa } = require('../../services/aiBudgetLedger');
const { criarClienteGeminiComOrcamento } = require('../../services/aiBudgetGeminiClient');
const { criarHandlerResumoCreditosV2 } = require('../../services/aiCreditsV2Http');
const { GoogleGenAI } = require('@google/genai');
const { getAgent }          = require('../../services/agentBridge');
const { inspecionarProjeto } = require('../../solaris/pipeline/projectInspector');
const { responderOuEditarProjeto } = require('../../solaris/pipeline/projectEditor');
const { criarZip, criarArquivo, deletarArquivo, listarProjeto, lerArquivo } = require('../../solaris/tools/fileTools');
const { extrairZipViaSandbox } = require('../../solaris/tools/archiveExtractClient');
const { detectarFramework } = require('../../solaris/tools/frameworkDetector');
const { salvarProjeto, carregarProjeto } = require('../../solaris/tools/projectStorage');
const { lerProjetoParaPersistir } = require('../../solaris/tools/fileTools');
const { criarHandlerChatSolaris } = require('../../solaris/http/solarisChatHandler');
const { criarHandlerUploadSolaris } = require('../../solaris/http/solarisUploadHandler');
const { criarHandlerVisual } = require('../../solaris/visual/visualReview');

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
    ? ({ query, topK }) => buscarConhecimentoMisto({ query, topK, db, codeSearchEnabled: process.env.SOLARIS_CODE_SEARCH_ENABLED === 'true' })
    : null;
const solarisChat = criarSolarisChat({ buscarConhecimento });
const modelRouter  = criarModelRouter();
const orquestrador = criarOrquestrador({ modelRouter, buscarConhecimento });

// A reserva financeira é ativada SOMENTE por opção explícita na VPS.
// Enquanto desligada, o fluxo usa os mesmos objetos singleton de antes.
const livroOrcamento = criarLivroRazaoIa(db);
function dependenciasPorRequisicao(req) {
    if (process.env.SOLARIS_AI_BUDGET_ENFORCE !== 'true') {
        return { modelRouter, solarisChat, orquestrador };
    }
    // Identidade vem da sessão validada por exigirLogin, jamais do body HTTP.
    const email = req.session?.user?.email;
    if (!email) {
        const erro = new Error('Sessão expirada. Faça login novamente.');
        erro.status = 401;
        throw erro;
    }
    const protegida = criarClienteGeminiComOrcamento(() => {
        if (!process.env.GEMINI_API_KEY) {
            throw new Error('[SOLARIS-LLM] GEMINI_API_KEY não configurada no ambiente.');
        }
        return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    }, { email, livro: livroOrcamento, modeloPro: MODEL_PRO });
    const routerUsuario = criarModelRouter(protegida);
    return {
        modelRouter: routerUsuario,
        solarisChat: criarSolarisChat({ modelRouter: routerUsuario, buscarConhecimento }),
        orquestrador: criarOrquestrador({ modelRouter: routerUsuario, buscarConhecimento }),
    };
}

let solarisAgent = null;
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
}));

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
const visualLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: req => req.session?.user?.uid || req.ip,
    handler: (_req, res) => res.status(429).json({error:'Limite de auditorias visuais atingido. Tente mais tarde.'}),
});
async function capturarParaVisual({ url, device }) {
    const serviceUrl = process.env.SANDBOX_BROWSER_SERVICE_URL || process.env.SANDBOX_SERVICE_URL;
    const secret = process.env.SANDBOX_BROWSER_SHARED_SECRET || process.env.SANDBOX_SHARED_SECRET;
    if (!serviceUrl || !secret) throw new Error('Sandbox visual sem URL/segredo configurados.');
    const response = await fetch(serviceUrl.replace(/[/]+$/, '') + '/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-sandbox-secret': secret },
        body: JSON.stringify({
            url, device, browser: 'chromium', screenshot: true,
            screenshotDelivery: 'inline', accessibility: false, timeout: 20000,
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
    enabled: process.env.SOLARIS_VISUAL_REVIEW_ENABLED === 'true'
        && process.env.SOLARIS_AI_BUDGET_ENFORCE === 'true',
    origins: process.env.SOLARIS_VISUAL_PREVIEW_ORIGINS || '',
    capturar: capturarParaVisual,
    criarRouter: req => {
        const protegida = criarClienteGeminiComOrcamento(() => {
            if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY ausente.');
            return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        }, {
            email: req.session.user.email,
            livro: livroOrcamento,
            modeloPro: MODEL_FLASH,
            maxOutputTokens: 1024,
        });
        return criarModelRouter(protegida);
    },
    debitarCreditos,
});
router.post('/dashboard/solaris/visual-review', exigirLogin, (req, res, next) => {
    if (process.env.SOLARIS_VISUAL_REVIEW_ENABLED !== 'true'
        || process.env.SOLARIS_AI_BUDGET_ENFORCE !== 'true') {
        return res.status(404).json({error:'visual_review_disabled'});
    }
    return next();
}, visualLimiter, verificarSaldo, visualHandler);

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
router.post('/dashboard/solaris/chat/stream', exigirLogin, verificarSaldo, (req, res) => {
    if (process.env.SOLARIS_AI_BUDGET_ENFORCE !== 'true') {
        return chatSolarisSemOrcamento(req, res);
    }
    const deps = dependenciasPorRequisicao(req);
    return criarHandlerChatSolaris({ ...depsChatSolaris, ...deps })(req, res);
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
router.post('/dashboard/solaris/upload', exigirLogin, uploadLimiter, verificarSaldo, (req, res) => {
    if (process.env.SOLARIS_AI_BUDGET_ENFORCE !== 'true') {
        return uploadSolarisSemOrcamento(req, res);
    }
    const { modelRouter: routerUsuario } = dependenciasPorRequisicao(req);
    return criarHandlerUploadSolaris({ ...depsUploadSolaris, modelRouter: routerUsuario })(req, res);
});

router.SOLARIS_CHAT_SESSION_TYPE = SOLARIS_CHAT_SESSION_TYPE;
module.exports = router;


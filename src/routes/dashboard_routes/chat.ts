'use strict';
import type { AccountRecord } from '../../contracts/workspaceRoutes';
import type { RouteRequest, RouteResponse, RouteHandler, RouteRouter, RouteFailure, RouteRateLimit } from '../../contracts/routeHttp';
import type { Firestore } from '@google-cloud/firestore';
interface RouteBody { message?: string; history?: unknown; sessionId?: string; requestId?: unknown; model?: unknown }
declare function require(name: string): unknown;
const express   = require('express') as { Router(): RouteRouter<RouteBody> };
const router    = express.Router();

const { exigirLogin, verificarSaldo }         = require('../../middlewares/authGuard') as { exigirLogin: RouteHandler<RouteBody>; verificarSaldo: RouteHandler<RouteBody> };
const chatStorage                             = require('../../services/chatStorageService') as typeof import('../../services/chatStorageService');
const { db, admin }                           = require('../../services/firebase') as { db: Firestore; bucket: import('@google-cloud/storage').Bucket; admin: typeof import('firebase-admin') };
const { debitarCreditos } = require('../../services/creditService') as typeof import('../../services/creditService');

const { gerarComPossivelTemplate } = require('./chat/chatGenerationFlow') as import('./chat/chatGenerationFlow').RouteExports;
const { montarHistoricoSeguro }    = require('./chat/chatHistory') as import('./chat/chatHistory').RouteExports;
const { apagarProjeto }            = require('../../solaris/tools/projectStorage') as typeof import('../../solaris/tools/projectStorage');
// Fonte única do valor — dashboard_routes/index.js já monta ambos os
// routers de forma independente (sem require cruzado entre eles), então
// importar daqui não cria ciclo; usado só pra decidir se uma sessão
// apagada tem projeto anexado pra limpar junto (ver DELETE
// /api/chat/sessions/:sessionId abaixo).
const { SOLARIS_CHAT_SESSION_TYPE } = require('./solaris') as { SOLARIS_CHAT_SESSION_TYPE: string };

router.get('/dashboard/chat', exigirLogin, (req, res) => {
    if (req.query.wsSession && req.query.projeto) {
        return res.redirect(`/dashboard/workspace/chat?wsSession=${encodeURIComponent(req.query.wsSession)}&projeto=${encodeURIComponent(req.query.projeto)}`);
    }
    res.render('pages/react-test', {
        activePage: 'chat',
        user: req.session.user
    });
});

router.get('/api/chat/status', exigirLogin, async (req, res) => {
    const planoSessao = req.session.user?.plano || 'free';
    const { PLAN_CREDITS } = require('../../services/creditService') as typeof import('../../services/creditService');
    let creditosGemini      = PLAN_CREDITS[planoSessao]     ?? PLAN_CREDITS.free;
    let creditosGeminiTotal = creditosGemini;

    const emailGet = req.session.user?.email;
    if (emailGet) {
        try {
            const snap = await db.collection('clientes_premium').doc(emailGet.toLowerCase()).get();
            if (snap.exists) {
                const d = snap.data() as AccountRecord;
                if (d.creditos !== undefined) {
                    const expirado = d.creditos_expira_em && new Date(d.creditos_expira_em) < new Date();
                    creditosGemini = expirado ? 0 : d.creditos;
                }
                if (d.creditos_ciclo_total !== undefined) creditosGeminiTotal = d.creditos_ciclo_total;
            }
        } catch (_Caught) {
        const _ = _Caught as RouteFailure;}
    }

    res.json({
        creditosGemini,
        creditosGeminiTotal,
        user: req.session.user
    });
});


// ──────────────────────────────────────────────────────────────────────────
// POST /dashboard/chat/stream — SSE streaming
// Protocolo de eventos:
//   data: {"type":"status","label":"..."}   — indicador de progresso
//   data: {"type":"chunk","text":"..."}     — fragmento de texto
//   data: {"type":"done","reply":"..."}     — resposta completa
//   data: {"type":"error","message":"..."}  — erro
// ──────────────────────────────────────────────────────────────────────────
// A API OpenAI permanece configurada, mas sem orçamento para atendimento.
// Impedir requisições legadas do React antigo ANTES da verificação de créditos
// e de qualquer chamada ao provedor externo.
function somenteGemini(req: RouteRequest<RouteBody>, res: RouteResponse, next: () => void) {
    if (req.body?.model && req.body.model !== 'gemini-flash') {
        return res.status(503).json({ error: 'Este modelo está indisponível. Atualize a página e utilize Gemini Flash.', codigo: 'MODELO_INDISPONIVEL' });
    }
    next();
}
router.post('/dashboard/chat/stream', exigirLogin, somenteGemini, verificarSaldo, async (req, res) => {
    const { message, history, sessionId: clientSessionId, model } = req.body;

    if (!message || !message.trim()) {
        return res.status(400).json({ error: 'Mensagem não pode estar vazia.' });
    }
    if (message.trim().length > 2000) {
        return res.status(400).json({ error: 'Mensagem muito longa. Máximo 2000 caracteres.' });
    }

    const msg       = message.trim();
    const uid       = req.session.user?.uid;
    const email     = req.session.user?.email || '';
    const isGpt     = false; // Gemini é o único provedor ativo neste chat.
    const sessionId = clientSessionId || chatStorage.newSessionId();
    // Chave gerada no servidor por geração; nunca aceitar ID controlado pelo cliente.
    const billingOperationId = (require('node:crypto') as typeof import('node:crypto')).randomUUID();

    const safeHistory = montarHistoricoSeguro(history, 10);

    if (req.body.requestId === undefined) {
        return res.status(400).json({
            error: 'Identificador de envio obrigatório. Atualize a página antes de continuar.',
            codigo: 'REQUEST_ID_OBRIGATORIO',
        });
    }
    if (req.body.requestId !== undefined) {
        if (!uid) return res.status(401).json({ error: 'Usuário não autenticado.' });
        let gateStatus;
        try {
            const { registrarRequisicaoChat } = require('../../services/chatRequestGate') as import('../../services/chatRequestGate').RouteExports;
            gateStatus = await registrarRequisicaoChat(db, uid, 'especialista', req.body.requestId, { message: msg, sessionId: clientSessionId || null, history: safeHistory });
        } catch (errCaught) {
        const err = errCaught as RouteFailure;
            console.error('[CHAT-REQUEST] Falha ao registrar envio:', err);
            return res.status(503).json({ error: 'Não foi possível iniciar a geração. Tente novamente.' });
        }
        if (gateStatus !== 'accepted') {
            return res.status(gateStatus === 'invalid' ? 400 : 409).json({
                error: gateStatus === 'duplicate' ? 'Este envio já foi recebido; consulte o histórico antes de tentar novamente.'
                    : gateStatus === 'mismatch' ? 'Identificador de envio reutilizado com outra mensagem.'
                    : 'Identificador de envio inválido.',
            });
        }
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    let fullText  = '';
    let tokensRef = { total: 0, input: 0, output: 0 };
    let doneEvent = null;

    try {
        // permitirGeracao:false — o Especialista nunca compila/gera template
        // (nem Gemini nem GPT); isso é exclusivo do chat do Workspace agora
        // (workspaceChat.js). Ver chatSystemPrompt.js/chatGenerationFlow.js.
        const resultado = await gerarComPossivelTemplate({
            msg, safeHistory, isGpt, wsSnapshot: null, email, uid, user: req.session.user,
            sendEvent, tokensRef, permitirGeracao: false,
        });
        fullText = resultado.fullText;

        // O frontend consulta o histórico e os créditos quando recebe done.
        // Adiar o evento até as gravações terminarem evita uma atualização vazia.
        doneEvent = {
            type:      'done',
            reply:     fullText,
            sessionId,
            tokens:    tokensRef,
            ...(resultado.codeValidation ? { codeValidation: resultado.codeValidation } : {}),
        };

    } catch (errCaught) {
        const err = errCaught as RouteFailure;
        const detalhe  = err.cause?.message ? ` | causa: ${err.cause.message}` : '';
        // O marcarErroGemini wrapa o erro perdendo o .status — buscamos no err.cause também
        const httpStatus = err.status || err.statusCode || err.cause?.status || err.cause?.statusCode || 0;
        console.error(`[ESPECIALISTA] status=${httpStatus} type=${err.type || '—'} msg=${err.message}${detalhe}`);

        const allErrMsg   = (err.message || '') + (err.type || '') + (err.cause?.message || '');
        const isCota      = httpStatus === 429 || allErrMsg.includes('429') || allErrMsg.includes('rate_limit') || allErrMsg.includes('RESOURCE_EXHAUSTED') || /too many requests/i.test(allErrMsg) || allErrMsg.includes('quota');
        const isSeguranca = allErrMsg.includes('filtro de segurança') || allErrMsg.includes('SAFETY') || allErrMsg.includes('content_filter');
        const isModelo    = httpStatus === 404 || allErrMsg.includes('not found') || allErrMsg.includes('MODEL_NOT_FOUND') || allErrMsg.includes('model_not_found') || allErrMsg.includes('does not exist');
        const isChave     = httpStatus === 401 || allErrMsg.includes('API_KEY') || allErrMsg.includes('UNAUTHENTICATED') || allErrMsg.includes('Incorrect API key') || allErrMsg.includes('invalid_api_key') || allErrMsg.includes('não configurada');
        const isParam     = httpStatus === 400 || allErrMsg.includes('BadRequest') || allErrMsg.includes('invalid_request') || allErrMsg.includes('max_tokens') || allErrMsg.includes('unsupported') || allErrMsg.includes('unknown_parameter');
        const chaveNome   = isGpt ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY';

        // Qualquer erro inesperado → registra em admin_logs para diagnóstico
        if (isChave || isModelo || isParam) {
            db.collection('admin_logs').add({
                por:       'sistema',
                tipo:      isGpt ? 'erro_gpt' : 'erro_gemini',
                detalhes:  { email: email || 'desconhecido', status: httpStatus, erro: err.message?.slice(0, 300), categoria: isChave ? 'chave' : isModelo ? 'modelo' : 'parametro' },
                criado_em: admin.firestore.FieldValue.serverTimestamp(),
            }).catch(() => {});
        }

        sendEvent({
            type:    'error',
            message: isCota      ? 'Alto volume de acessos ao Gemini. Aguarde e tente mais tarde; se persistir, avise o suporte.'
                   : isSeguranca ? 'Mensagem não pôde ser processada. Reformule e tente novamente.'
                   : isModelo    ? 'O serviço de IA não encontrou o modelo ou recurso configurado. Avise o suporte da Softload.'
                   : isChave     ? `Chave de API inválida ou expirada. Verifique ${chaveNome} no servidor.`
                   : isParam     ? 'A API de IA recebeu um parâmetro incompatível. Avise o suporte da Softload.'
                   :               `Especialista temporariamente indisponível. (${httpStatus || 'err'}) Tente novamente.`,
        });
    } finally {
        let historicoSalvo = false;
        let debitoConfirmado = true;

        if (fullText && uid) {
            const ts = new Date().toISOString();
            const messages = [
                ...safeHistory,
                { role: 'user', content: msg, ts },
                { role: 'assistant', content: fullText, ts, tokens: tokensRef },
            ];
            // O Especialista não gera templates: nenhuma mudança em meta.
            const cotaChat = { email, plano: req.session.user?.plano || 'free' };
            try {
                const session = await chatStorage.saveSession(uid, 'chat-suporte', sessionId, {
                    messages, tokens: tokensRef, meta: {},
                }, cotaChat);
                historicoSalvo = true;
                // Memória secundária não impede o histórico principal.
                Promise.resolve().then(() => chatStorage.updateMemoryFromSession(uid, session, cotaChat))
                    .catch(e => console.error(`[CHAT-STORAGE] especialista memory err: ${e.message}`));
            } catch (eCaught) {
        const e = eCaught as RouteFailure;
                console.error(`[CHAT-STORAGE] especialista save err: ${e.message}`);
            }
        }

        // Contabilizar antes de liberar o frontend para ler o saldo novo.
        // O débito não depende de o GCS estar disponível.
        if (email && fullText) {
            const inputToks = tokensRef.input > 0 ? tokensRef.input : Math.ceil(msg.length / 3.5);
            const outputToks = tokensRef.output > 0 ? tokensRef.output : Math.ceil(fullText.length / 3.5);
            try {
                await debitarCreditos(email, inputToks, outputToks, billingOperationId);
            } catch (eCaught) {
        const e = eCaught as RouteFailure;
                debitoConfirmado = false;
                console.error(`[BILLING] chat debit err: ${e.message}`);
            }
        }

        try {
            if (doneEvent && !res.destroyed) {
                if (!historicoSalvo) {
                    doneEvent.reply += '\n\n⚠️ Não consegui salvar esta conversa no histórico. Copie a resposta antes de sair.';
                }
                if (!debitoConfirmado) {
                    doneEvent.reply += '\n\n⚠️ Não foi possível confirmar a atualização dos créditos.';
                }
                sendEvent(doneEvent);
            }
        } finally {
            res.end();
        }
    }
});

// ──────────────────────────────────────────────────────────────────────────
// GET /api/chat/sessions — lista sessões de um tipo
// ──────────────────────────────────────────────────────────────────────────
router.get('/api/chat/sessions', exigirLogin, async (req, res) => {
    const uid  = req.session.user?.uid;
    const type = req.query.type || 'chat-suporte';
    try {
        const sessions = await chatStorage.listSessions(uid, type);
        res.json({ sessions });
    } catch (errCaught) {
        const err = errCaught as RouteFailure;
        console.error('[CHAT-API] listSessions err:', err.message);
        res.status(500).json({ erro: 'Erro ao listar sessões.' });
    }
});

// ──────────────────────────────────────────────────────────────────────────
// GET /api/chat/sessions/:sessionId — carrega sessão completa
// ──────────────────────────────────────────────────────────────────────────
router.get('/api/chat/sessions/:sessionId', exigirLogin, async (req, res) => {
    const uid       = req.session.user?.uid;
    const type      = req.query.type || 'chat-suporte';
    const { sessionId } = req.params;
    try {
        const session = await chatStorage.loadSession(uid, type, sessionId);
        if (!session) return res.status(404).json({ erro: 'Sessão não encontrada.' });
        res.json({ session });
    } catch (errCaught) {
        const err = errCaught as RouteFailure;
        console.error('[CHAT-API] loadSession err:', err.message);
        res.status(500).json({ erro: 'Erro ao carregar sessão.' });
    }
});

// ──────────────────────────────────────────────────────────────────────────
// DELETE /api/chat/sessions/:sessionId — remove sessão
// ──────────────────────────────────────────────────────────────────────────
router.delete('/api/chat/sessions/:sessionId', exigirLogin, async (req, res) => {
    const uid       = req.session.user?.uid;
    const type      = req.query.type || 'chat-suporte';
    const { sessionId } = req.params;
    try {
        await chatStorage.deleteSession(uid, type, sessionId, {
            email: req.session.user.email,
            plano: req.session.user?.plano || 'free',
        });

        // Sessão do Solaris apagada pode ter um projeto anexado
        // (tools/projectStorage.js, chave = sessionId) — sem isso o projeto
        // ficava órfão no GCS, contando cota pra sempre mesmo com a
        // conversa já apagada (gap documentado em src/solaris/README.md).
        // apagarProjeto() já degrada de forma segura se não houver nada
        // pra apagar; nunca deixa a exclusão da sessão falhar por causa
        // disso.
        if (type === SOLARIS_CHAT_SESSION_TYPE) {
            await apagarProjeto(uid, sessionId).catch((err) => {
                console.warn('[CHAT-API] apagarProjeto (limpeza pós-deleteSession) falhou:', err.message);
            });
        }

        res.json({ sucesso: true });
    } catch (errCaught) {
        const err = errCaught as RouteFailure;
        console.error('[CHAT-API] deleteSession err:', err.message);
        res.status(500).json({ erro: 'Erro ao remover sessão.' });
    }
});

module.exports = router;

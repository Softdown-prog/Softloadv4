'use strict';
const express   = require('express');
const router    = express.Router();

const { exigirLogin, verificarSaldo }         = require('../../middlewares/authGuard');
const chatStorage                             = require('../../services/chatStorageService');
const { db, admin }                           = require('../../services/firebase');
const { debitarCreditos } = require('../../services/creditService');

const { gerarComPossivelTemplate } = require('./chat/chatGenerationFlow');
const { montarHistoricoSeguro }    = require('./chat/chatHistory');
const { apagarProjeto }            = require('../../solaris/tools/projectStorage');
// Fonte única do valor — dashboard_routes/index.js já monta ambos os
// routers de forma independente (sem require cruzado entre eles), então
// importar daqui não cria ciclo; usado só pra decidir se uma sessão
// apagada tem projeto anexado pra limpar junto (ver DELETE
// /api/chat/sessions/:sessionId abaixo).
const { SOLARIS_CHAT_SESSION_TYPE } = require('./solaris');

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
    const { PLAN_CREDITS } = require('../../services/creditService');
    let creditosGemini      = PLAN_CREDITS[planoSessao]     ?? PLAN_CREDITS.free;
    let creditosGeminiTotal = creditosGemini;

    const emailGet = req.session.user?.email;
    if (emailGet) {
        try {
            const snap = await db.collection('clientes_premium').doc(emailGet.toLowerCase()).get();
            if (snap.exists) {
                const d = snap.data();
                if (d.creditos !== undefined) {
                    const expirado = d.creditos_expira_em && new Date(d.creditos_expira_em) < new Date();
                    creditosGemini = expirado ? 0 : d.creditos;
                }
                if (d.creditos_ciclo_total !== undefined) creditosGeminiTotal = d.creditos_ciclo_total;
            }
        } catch (_) {}
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
function somenteGemini(req, res, next) {
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

    const safeHistory = montarHistoricoSeguro(history, 10);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    let fullText  = '';
    let tokensRef = { total: 0, input: 0, output: 0 };

    try {
        // permitirGeracao:false — o Especialista nunca compila/gera template
        // (nem Gemini nem GPT); isso é exclusivo do chat do Workspace agora
        // (workspaceChat.js). Ver chatSystemPrompt.js/chatGenerationFlow.js.
        const resultado = await gerarComPossivelTemplate({
            msg, safeHistory, isGpt, wsSnapshot: null, email, uid, user: req.session.user,
            sendEvent, tokensRef, permitirGeracao: false,
        });
        fullText = resultado.fullText;

        sendEvent({
            type:      'done',
            reply:     fullText,
            sessionId,
            tokens:    tokensRef,
            ...(resultado.codeValidation ? { codeValidation: resultado.codeValidation } : {}),
        });

    } catch (err) {
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
            message: isCota      ? 'Alto volume de acessos. Aguarde 1 minuto e tente novamente.'
                   : isSeguranca ? 'Mensagem não pôde ser processada. Reformule e tente novamente.'
                   : isModelo    ? `Modelo de IA não encontrado. Verifique a configuração ${isGpt ? 'GPT_MODEL_NAME' : 'GEMINI_MODEL_NAME'} no servidor.`
                   : isChave     ? `Chave de API inválida ou expirada. Verifique ${chaveNome} no servidor.`
                   : isParam     ? `Parâmetro inválido na requisição. Verifique configuração do modelo ${process.env.GPT_MODEL_NAME || 'gpt-5.4-nano'}.`
                   :               `Especialista temporariamente indisponível. (${httpStatus || 'err'}) Tente novamente.`,
        });
    } finally {
        res.end();

        if (fullText && uid) {
            const ts       = new Date().toISOString();
            const messages = [
                ...safeHistory,
                { role: 'user',      content: msg,      ts },
                { role: 'assistant', content: fullText,  ts, tokens: tokensRef },
            ];
            // Sem meta.commandJson aqui — o Especialista não gera templates
            // (permitirGeracao:false), então não há lastTemplate pra
            // capturar pra memória persistente nesta rota.
            const cotaChat = { email, plano: req.session.user?.plano || 'free' };
            chatStorage.saveSession(uid, 'chat-suporte', sessionId, {
                messages,
                tokens: tokensRef,
                meta:   {},
            }, cotaChat)
            .then(session => chatStorage.updateMemoryFromSession(uid, session, cotaChat))
            .catch(e => console.error(`[CHAT-STORAGE] especialista save err: ${e.message}`));
        }

        // Débito separado do save — roda sempre que houver resposta e email.
        if (email && fullText) {
            const inputToks  = tokensRef.input  > 0 ? tokensRef.input  : Math.ceil(msg.length / 3.5);
            const outputToks = tokensRef.output > 0 ? tokensRef.output : Math.ceil(fullText.length / 3.5);
            debitarCreditos(email, inputToks, outputToks)
                .catch(e => console.error(`[BILLING] chat debit err: ${e.message}`));
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
    } catch (err) {
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
    } catch (err) {
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
        await chatStorage.deleteSession(uid, type, sessionId);

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
    } catch (err) {
        console.error('[CHAT-API] deleteSession err:', err.message);
        res.status(500).json({ erro: 'Erro ao remover sessão.' });
    }
});

module.exports = router;

'use strict';
import type { WorkspaceRecord, WorkspaceSnapshot, WorkspaceManifest } from '../../contracts/workspaceRoutes';
import type { RouteRequest, RouteResponse, RouteHandler, RouteRouter, RouteFailure, RouteRateLimit } from '../../contracts/routeHttp';
import type { Firestore } from '@google-cloud/firestore';
interface RouteBody { message?: string; history?: unknown; sessionId?: string; requestId?: unknown; model?: unknown; wsSessionId?: string; wsProjetoId?: string }
declare function require(name: string): unknown;
const express   = require('express') as { Router(): RouteRouter<RouteBody> };
const router    = express.Router();

const { exigirLogin } = require('../../middlewares/authGuard') as { exigirLogin: RouteHandler<RouteBody> };
const { criarGateCreditosWorkspace } = require('../../middlewares/workspaceCreditGate') as import('../../middlewares/workspaceCreditGate').RouteExports;
const chatStorage                             = require('../../services/chatStorageService') as typeof import('../../services/chatStorageService');
const { db, admin }                           = require('../../services/firebase') as { db: Firestore; bucket: import('@google-cloud/storage').Bucket; admin: typeof import('firebase-admin') };
const verificarCreditosWorkspace = criarGateCreditosWorkspace({db});
const { PLAN_CREDITS } = require('../../services/creditService') as typeof import('../../services/creditService');
const {reservarWorkspace,iniciarWorkspace,liquidarWorkspace} = require('../../services/workspaceCreditReservations') as typeof import('../../services/workspaceCreditReservations');

const { processarEdicaoDeTemplate } = require('./chat/chatEditFlow') as import('./chat/chatEditFlow').RouteExports;
const { gerarComPossivelTemplate }  = require('./chat/chatGenerationFlow') as import('./chat/chatGenerationFlow').RouteExports;
const { montarHistoricoSeguro }     = require('./chat/chatHistory') as import('./chat/chatHistory').RouteExports;
const { carregarManifesto }         = require('../../services/storageService') as typeof import('../../services/storageService');

// ──────────────────────────────────────────────────────────────────────────
// CHAT DEDICADO DO WORKSPACE — rota + view próprias, separadas do
// Especialista Blogger e do Solaris (mesma separação estrutural que o Sol já
// tem em /eu/sol). Sem wsSessionId/wsProjetoId na query, cria projeto+sessão
// vazios na hora (entrada rápida "Novo Projeto IA"/"Chat IA" do Workspace) —
// depois disso a rota só existe pra conversar sobre o template de UMA sessão
// específica.
//
// Roteamento (sem fallback pro chat geral):
//   - já existe manifesto na sessão → modo EDIÇÃO, 100% agêntico
//     (chatEditFlow.js/templateEditAgent.js) — o agente sempre responde
//     algo útil, mesmo pra assunto fora de escopo.
//   - ainda não existe manifesto     → modo GERAÇÃO, o mesmo fluxo de
//     marcador [[TEMPLATE:{...}]] que o Especialista usa
//     (chatGenerationFlow.js), preservado sem mudanças.
// ──────────────────────────────────────────────────────────────────────────
const WORKSPACE_CHAT_SESSION_TYPE = 'workspace-chat';

function projetosRef(email: string) {
    return db.collection('clientes_premium').doc(email).collection('projetos');
}
function sessoesRef(email: string, projetoId: string) {
    return projetosRef(email).doc(projetoId).collection('sessoes');
}

router.get('/dashboard/workspace/chat', exigirLogin, async (req, res) => {
    const email       = req.session.user.email.toLowerCase();
    const wsSessionId = req.query.wsSession || null;
    const wsProjetoId = req.query.projeto   || null;

    if (!wsSessionId || !wsProjetoId) {
        // Entrada rápida "Chat IA"/"Novo Projeto IA" (link no Workspace, sem
        // projeto ou sessão escolhidos) — cria um projeto + sessão vazios
        // (sem snapshot) na hora e redireciona pra cá com os IDs. Sessão sem
        // snapshot já cai automaticamente no modo geração do chat (mesmo
        // comportamento de qualquer sessão nova via "Novo Projeto"/"Criar
        // Sessão") — não depende de já existir um template compilado.
        // Mesma lógica de GET /api/workspace/chat/info abaixo, duplicada de
        // propósito aqui: essa rota também precisa funcionar fora do SPA
        // (acesso direto pela URL, refresh), onde o React nunca chega a
        // rodar pra chamar a API.
        try {
            const agora       = admin.firestore.FieldValue.serverTimestamp();
            const nomeProjeto = `Chat IA — ${new Date().toLocaleDateString('pt-BR')}`;
            const projetoRef  = await projetosRef(email).add({
                nome:              nomeProjeto,
                criadoEm:          agora,
                ultimaAtualizacao: agora,
            });
            const sessaoRef = await sessoesRef(email, projetoRef.id).add({
                nome:          'Conversa inicial',
                snapshot:      null,
                criadoEm:      agora,
                chatSessionId: null,
            });
            return res.redirect(`/dashboard/workspace/chat?wsSession=${sessaoRef.id}&projeto=${projetoRef.id}`);
        } catch (errCaught) {
        const err = errCaught as RouteFailure;
            console.error('[WORKSPACE-CHAT] criar sessão rápida (GET página) err:', err.message);
            return res.redirect('/dashboard/workspace');
        }
    }

    res.render('pages/react-test', {
        activePage: 'workspace',
        user: req.session.user
    });
});

router.get('/api/workspace/chat/info', exigirLogin, async (req, res) => {
    const email       = req.session.user.email.toLowerCase();
    const wsSessionId = req.query.wsSession || null;
    const wsProjetoId = req.query.projeto   || null;

    if (!wsSessionId || !wsProjetoId) {
        // Entrada rápida "Chat IA" (link na página do Workspace, sem projeto ou
        // sessão escolhidos) — cria um projeto + sessão vazios (sem snapshot) na
        // hora e retorna os novos IDs para o cliente redirecionar/carregar.
        try {
            const agora       = admin.firestore.FieldValue.serverTimestamp();
            const nomeProjeto = `Chat IA — ${new Date().toLocaleDateString('pt-BR')}`;
            const projetoRef  = await projetosRef(email).add({
                nome:              nomeProjeto,
                criadoEm:          agora,
                ultimaAtualizacao: agora,
            });
            const sessaoRef = await sessoesRef(email, projetoRef.id).add({
                nome:          'Conversa inicial',
                snapshot:      null,
                criadoEm:      agora,
                chatSessionId: null,
            });
            return res.json({ redirect: `/dashboard/workspace/chat?wsSession=${sessaoRef.id}&projeto=${projetoRef.id}` });
        } catch (errCaught) {
        const err = errCaught as RouteFailure;
            console.error('[WORKSPACE-CHAT] criar sessão rápida err:', err.message);
            return res.status(500).json({ erro: 'Falha ao iniciar chat do workspace.' });
        }
    }

    try {
        const sessaoRef  = sessoesRef(email, wsProjetoId).doc(wsSessionId);
        const sessaoDoc  = await sessaoRef.get();
        if (!sessaoDoc.exists) {
            return res.status(404).json({ erro: 'Sessão não encontrada.' });
        }
        const sessaoData = (sessaoDoc.data() as WorkspaceRecord);
        let snapshot = sessaoData.snapshot || null;

        // Backfill do manifesto se necessário
        if (snapshot && snapshot.compilacaoId && (!snapshot.manifesto || !snapshot.xmlPath)) {
            try {
                const compSnap = await db.collection('clientes_premium').doc(email)
                    .collection('compilacoes').doc(snapshot.compilacaoId).get();
                if (compSnap.exists) {
                    const compData = (compSnap.data() as WorkspaceRecord);
                    const patch: Partial<WorkspaceSnapshot> = {};
                    if (!snapshot.manifesto) {
                        const manifestoResolvido = compData.manifesto
                            || (compData.manifestoPath ? await carregarManifesto(compData.manifestoPath).catch(() => null) : null);
                        if (manifestoResolvido) patch.manifesto = manifestoResolvido as WorkspaceManifest;
                    }
                    if (!snapshot.xmlPath && compData.xmlPath) patch.xmlPath = compData.xmlPath;
                    if (!snapshot.gcPath && compData.gcPath) patch.gcPath = compData.gcPath;
                    if (Object.keys(patch).length > 0) {
                        snapshot = { ...snapshot, ...patch };
                        await sessaoRef.update({ snapshot });
                    }
                }
            } catch (errCaught) {
        const err = errCaught as RouteFailure;
                console.warn('[WORKSPACE-CHAT] backfill manifesto api err:', err.message);
            }
        }

        const planoSessao = req.session.user?.plano || 'free';
        let creditosGemini      = 0;
        let creditosGeminiTotal = creditosGemini;
        try {
            const contaSnap = await db.collection('clientes_premium').doc(email).get();
            if (contaSnap.exists) {
                const d = (contaSnap.data() as WorkspaceRecord);
                if (d.creditos !== undefined) {
                    const expirado = d.creditos_expira_em && new Date(d.creditos_expira_em) < new Date();
                    creditosGemini = expirado ? 0 : d.creditos;
                }
                if (d.creditos_ciclo_total !== undefined) creditosGeminiTotal = d.creditos_ciclo_total;
            }
        } catch (_Caught) {
        const _ = _Caught as RouteFailure;}

        // A sessão é gravada pelo chatStorageService no GCS. Ler a mesma
        // fonte evita restaurar [] de uma coleção Firestore que não recebe
        // essas mensagens e quebrar o histórico depois do reload.
        let messages: import('../../services/chatStorageService').ChatStoredMessage[] = [];
        if (sessaoData.chatSessionId && req.session.user?.uid) {
            try {
                const chatDoc = await chatStorage.loadSession(
                    req.session.user.uid, WORKSPACE_CHAT_SESSION_TYPE, sessaoData.chatSessionId
                );
                if (Array.isArray(chatDoc?.messages)) {
                    messages = chatDoc.messages;
                }
            } catch (errCaught) {
        const err = errCaught as RouteFailure;
                console.warn('[WORKSPACE-CHAT] carregar mensagens persistidas err:', err.message);
            }
        }

        res.json({
            user: req.session.user,
            creditosGemini,
            creditosGeminiTotal,
            snapshot,
            wsSessionId,
            wsProjetoId,
            sessionId: sessaoData.chatSessionId || null,
            messages
        });
    } catch (eCaught) {
        const e = eCaught as RouteFailure;
        console.error('[WORKSPACE-CHAT] info api err:', e.message);
        res.status(500).json({ erro: 'Falha ao carregar informações do chat.' });
    }
});

// ──────────────────────────────────────────────────────────────────────────
// POST /dashboard/workspace/chat/stream — SSE streaming
// Mesmo protocolo de eventos genérico usado em todo o projeto:
//   data: {"type":"status","label":"..."}
//   data: {"type":"chunk","text":"..."}
//   data: {"type":"done","reply":"..."}
//   data: {"type":"error","message":"..."}
// ──────────────────────────────────────────────────────────────────────────
router.post('/dashboard/workspace/chat/stream', exigirLogin, verificarCreditosWorkspace, async (req, res) => {
    const { message, history, sessionId: clientSessionId,
            wsSessionId, wsProjetoId } = req.body;

    if (!message || !message.trim()) {
        return res.status(400).json({ error: 'Mensagem não pode estar vazia.' });
    }
    if (message.trim().length > 2000) {
        return res.status(400).json({ error: 'Mensagem muito longa. Máximo 2000 caracteres.' });
    }
    if (!wsSessionId || !wsProjetoId) {
        return res.status(400).json({ error: 'Sessão do Workspace não informada.' });
    }

    const msg       = message.trim();
    const uid       = req.session.user?.uid;
    const email     = req.session.user?.email || '';
    // Chat do Workspace é Gemini-only — qualquer valor de `model` no body é
    // ignorado (defesa em profundidade; a view nem envia outro valor).
    const isGpt     = false;
    const sessionId = clientSessionId || chatStorage.newSessionId();
    const billingOperationId = (require('node:crypto') as typeof import('node:crypto')).randomUUID(); // chave exclusiva do servidor

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
            gateStatus = await registrarRequisicaoChat(db, uid, 'workspace', req.body.requestId, { message: msg, sessionId: clientSessionId || null, history: safeHistory, wsSessionId, wsProjetoId });
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

    // Reserva transacional de créditos antes de qualquer chamada ao Gemini.
    let creditoReservado;
    try {
        creditoReservado = await reservarWorkspace(email,billingOperationId);
    } catch (eCaught) {
        const e = eCaught as RouteFailure;
        return res.status(e.status || 503).json({
            erro: e.status === 402 ? e.message : 'Não foi possível reservar créditos do Workspace.',
            codigo: e.code || 'FALHA_RESERVA',
        });
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    let fullText     = '';
    let tokensRef    = { total: 0, input: 0, output: 0 };
    let novoSnapshot = null;
    let provedorIniciado = false; // guarda que nenhuma IA é chamada sem reserva
    let falhaDebito = false;
    let doneEvent = null; // emitido só após salvar a sessão e contabilizar os créditos

    let wsSnapshot: WorkspaceSnapshot | null = null;
    let edicaoPendente: WorkspaceRecord['edicaoPendente'] = null;
    let preview: Awaited<ReturnType<import('./chat/chatEditFlow').RouteExports['processarEdicaoDeTemplate']>>['preview'] = null;
    const sessaoRef = db.collection('clientes_premium').doc(email.toLowerCase())
        .collection('projetos').doc(wsProjetoId)
        .collection('sessoes').doc(wsSessionId);
    try {
        const sessaoSnap = await sessaoRef.get();
        if (sessaoSnap.exists) {
            const d = (sessaoSnap.data() as WorkspaceRecord);
            wsSnapshot = d.snapshot || null;
            edicaoPendente = d.edicaoPendente || null;
            // TTL leve — descarta pendência esquecida há mais de 30min
            if (edicaoPendente?.criadoEm?.toMillis && Date.now() - edicaoPendente.criadoEm.toMillis() > 30 * 60 * 1000) {
                edicaoPendente = null;
            }

            // Backfill: sessões criadas via "criar sessão"/"importar" gravam
            // um snapshot só com campos resumidos, sem `manifesto` — mesmo
            // quando o `compilacaoId` aponta pra um doc de `compilacoes` que
            // TEM o manifesto completo (finalizarCompilacao sempre grava).
            // Sem isso, o modo edição nunca engatava pra essas sessões (caía
            // sempre no modo geração, oferecendo "criar um template novo" em
            // vez de editar o existente). Mesmo backfill cobre `xmlPath`/
            // `gcPath` ausentes (bug histórico: _snapshotDeManifesto nunca
            // gravava esses campos antes desta correção) — sem eles, o botão
            // "Ver Demo" do Workspace falha com "Snapshot sem xmlPath" mesmo
            // em sessões já editadas depois do fix. Backfill acontece uma vez
            // e é persistido de volta na sessão — próximas mensagens não
            // pagam essa leitura extra de novo.
            if (wsSnapshot && wsSnapshot.compilacaoId && (!wsSnapshot.manifesto || !wsSnapshot.xmlPath)) {
                try {
                    const compSnap = await db.collection('clientes_premium').doc(email.toLowerCase())
                        .collection('compilacoes').doc(wsSnapshot.compilacaoId).get();
                    if (compSnap.exists) {
                        const compData = (compSnap.data() as WorkspaceRecord);
                        const patch: Partial<WorkspaceSnapshot> = {};
                        if (!wsSnapshot.manifesto) {
                            // Docs antigos têm `manifesto` embutido; docs novos só têm
                            // `manifestoPath` (GCS) — ver storageService.salvarCompilacao.
                            const manifestoResolvido = compData.manifesto
                                || (compData.manifestoPath ? await carregarManifesto(compData.manifestoPath).catch(() => null) : null);
                            if (manifestoResolvido) patch.manifesto = manifestoResolvido as WorkspaceManifest;
                        }
                        if (!wsSnapshot.xmlPath && compData.xmlPath) patch.xmlPath = compData.xmlPath;
                        if (!wsSnapshot.gcPath && compData.gcPath) patch.gcPath = compData.gcPath;
                        if (Object.keys(patch).length > 0) {
                            wsSnapshot = { ...wsSnapshot, ...patch };
                            sessaoRef.update({ snapshot: wsSnapshot }).catch(e =>
                                console.warn('[WORKSPACE-CHAT] backfill manifesto persist err:', e.message));
                        }
                    }
                } catch (errCaught) {
        const err = errCaught as RouteFailure;
                    console.warn('[WORKSPACE-CHAT] backfill manifesto err:', err.message);
                }
            }
        }
    } catch (errCaught) {
        const err = errCaught as RouteFailure;
        console.warn('[WORKSPACE-CHAT] leitura sessão workspace err:', err.message);
    }

    try {
        if (wsSnapshot && wsSnapshot.manifesto) {
            // ── MODO EDIÇÃO — 100% agêntico, sem fallback ──────────────────
            await iniciarWorkspace(email,billingOperationId);
            provedorIniciado = true;
            const resultado = await processarEdicaoDeTemplate({
                msg, wsSnapshot: wsSnapshot as WorkspaceSnapshot & {manifesto: WorkspaceManifest}, edicaoPendente, sessaoRef, user: req.session.user, sendEvent,
                historico: safeHistory, wsProjetoId, wsSessionId, billingOperationId,
                cobrarDiretamente: false, tokensRef,
                maxOutputTokens: Math.max(256,Math.min(1024,creditoReservado.creditosReservados*500)),
            });
            fullText = resultado.fullText;
            preview  = resultado.preview || null;
        } else {
            // ── MODO GERAÇÃO — fluxo de marcador preservado como está ──────
            // permitirGeracao:true — único lugar do projeto onde o pipeline
            // determinístico de geração roda (Especialista é sempre false,
            // ver chat.js). isGpt aqui já é sempre false (rota Gemini-only),
            // mas o parâmetro é explícito mesmo assim — não depende de
            // adivinhar a partir de outro estado.
            await iniciarWorkspace(email,billingOperationId);
            provedorIniciado = true;
            const resultado = await gerarComPossivelTemplate({
                msg, safeHistory, isGpt, wsSnapshot, email, uid, user: req.session.user,
                sendEvent, tokensRef, wsProjetoId, wsSessionId, permitirGeracao: true,
                maxOutputTokens:Math.max(256,Math.min(8192,creditoReservado.creditosReservados*1000-3000)),
            });
            fullText     = resultado.fullText;
            novoSnapshot = resultado.novoSnapshot;
        }

        // Sem downloadUrl no evento SSE — o chat do Workspace não tem botão
        // de download avulso na bolha (esse era o ponto de conflito com o
        // Histórico de Versões, único lugar de download agora). O texto do
        // agente já referencia o histórico (SYSTEM_PROMPT do templateEditAgent
        // e a instrução de contexto de gerarComPossivelTemplate cuidam disso).
        //
        // `preview` é diferente de downloadUrl: não baixa nada, só deixa a UI
        // oferecer "ver a alteração aplicada" (mesmo endpoint /api/workspace/
        // set-preview + /dashboard/preview/session já usado pelo botão "Ver
        // Demo" da tela principal do Workspace). Achado real (usuário relatou
        // "chat só promete e diz que mudou"): sem isso, a única confirmação
        // de uma edição aplicada era texto — nenhuma forma de ver o resultado
        // sem sair do chat e caçar a aba Histórico de Versões manualmente.
        doneEvent = {
            type:      'done',
            reply:     fullText,
            sessionId,
            tokens:    tokensRef,
            preview,
        };

    } catch (errCaught) {
        const err = errCaught as RouteFailure;
        const detalhe  = err.cause?.message ? ` | causa: ${err.cause.message}` : '';
        const httpStatus = err.status || err.statusCode || err.cause?.status || err.cause?.statusCode || 0;
        console.error(`[WORKSPACE-CHAT] status=${httpStatus} type=${err.type || '—'} msg=${err.message}${detalhe}`);

        const allErrMsg   = (err.message || '') + (err.type || '') + (err.cause?.message || '');
        const isCota      = httpStatus === 429 || allErrMsg.includes('429') || allErrMsg.includes('rate_limit') || allErrMsg.includes('RESOURCE_EXHAUSTED') || /too many requests/i.test(allErrMsg) || allErrMsg.includes('quota');
        const isSeguranca = allErrMsg.includes('filtro de segurança') || allErrMsg.includes('SAFETY') || allErrMsg.includes('content_filter');
        const isModelo    = httpStatus === 404 || allErrMsg.includes('not found') || allErrMsg.includes('MODEL_NOT_FOUND') || allErrMsg.includes('model_not_found') || allErrMsg.includes('does not exist');
        const isChave     = httpStatus === 401 || allErrMsg.includes('API_KEY') || allErrMsg.includes('UNAUTHENTICATED') || allErrMsg.includes('Incorrect API key') || allErrMsg.includes('invalid_api_key') || allErrMsg.includes('não configurada');
        const isParam     = httpStatus === 400 || allErrMsg.includes('BadRequest') || allErrMsg.includes('invalid_request') || allErrMsg.includes('max_tokens') || allErrMsg.includes('unsupported') || allErrMsg.includes('unknown_parameter');
        const chaveNome   = isGpt ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY';

        if (isChave || isModelo || isParam) {
            db.collection('admin_logs').add({
                por:       'sistema',
                tipo:      isGpt ? 'erro_gpt' : 'erro_gemini',
                detalhes:  { email: email || 'desconhecido', status: httpStatus, erro: err.message?.slice(0, 300), categoria: isChave ? 'chave' : isModelo ? 'modelo' : 'parametro', origem: 'workspace-chat' },
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
                   :               `Assistente temporariamente indisponível. (${httpStatus || 'err'}) Tente novamente.`,
        });
    } finally {
        // O frontend consulta créditos e histórico ao receber `done`.
        // Confirmar as operações aqui (ANTES de `done` e res.end) evita
        // respostas visíveis cuja sessão ainda não existe no GCS ou cujos
        // créditos ainda não foram debitados.
        let historicoSalvo = false;
        let vinculoSalvo = false;
        if (fullText && uid) {
            const ts = new Date().toISOString();
            const messages = [
                ...safeHistory,
                { role: 'user', content: msg, ts },
                { role: 'assistant', content: fullText, ts, tokens: tokensRef },
            ];
            const meta = novoSnapshot
                ? { commandJson: {
                    siteName: novoSnapshot.siteName,
                    colorPreset: novoSnapshot.colorPreset,
                    gridLayout: novoSnapshot.gridLayout,
                    heroSection: novoSnapshot.manifesto?.heroSection || null,
                } }
                : {};
            const cotaChat = { email, plano: req.session.user?.plano || 'free' };
            try {
                const session = await chatStorage.saveSession(
                    uid, WORKSPACE_CHAT_SESSION_TYPE, sessionId,
                    { messages, tokens: tokensRef, meta }, cotaChat
                );
                historicoSalvo = true;
                try {
                    await chatStorage.updateMemoryFromSession(uid, session, cotaChat);
                } catch (eCaught) {
        const e = eCaught as RouteFailure;
                    console.error(`[CHAT-STORAGE] workspace-chat memory err: ${e.message}`);
                }
            } catch (eCaught) {
        const e = eCaught as RouteFailure;
                console.error(`[CHAT-STORAGE] workspace-chat save err: ${e.message}`);
            }
        }

        // Vincular a sessão apenas se os dados existirem no GCS. Se houve
        // geração, o novo snapshot ainda precisa ser salvo separadamente.
        if (fullText && email) {
            const updateData: {chatSessionId?: string; snapshot?: WorkspaceSnapshot} = {};
            if (historicoSalvo) updateData.chatSessionId = sessionId;
            if (novoSnapshot) updateData.snapshot = novoSnapshot;
            if (Object.keys(updateData).length) {
                try {
                    await sessaoRef.update(updateData);
                    vinculoSalvo = historicoSalvo;
                } catch (eCaught) {
        const e = eCaught as RouteFailure;
                    console.error(`[CHAT-STORAGE] ws chatSessionId update err: ${e.message}`);
                }
            }
        }

        // Liquidação única para geração e edição. Uso confirmado devolve a
        // diferença; resultado ambíguo mantém o valor reservado como estimativa.
        try {
            const cobrança = await liquidarWorkspace(email,billingOperationId,{
                input: Number.isSafeInteger(tokensRef.input) ? tokensRef.input : 0,
                output: Number.isSafeInteger(tokensRef.output) ? tokensRef.output : 0,
            });
            if(cobrança.descobertos > 0) {
                falhaDebito = true;
                console.error('[BILLING] Workspace excedeu reserva: '+cobrança.descobertos+' crédito(s) de custo não coberto');
            }
        } catch (eCaught) {
        const e = eCaught as RouteFailure;
            falhaDebito = true;
            console.error('[BILLING] Workspace settlement falhou:', e.message);
        }

        try {
            if (doneEvent && !res.destroyed) {
                if (falhaDebito) doneEvent.reply += '\n\n⚠️ Não foi possível confirmar o débito desta chamada. O sistema tentará reconciliar a cobrança.';
                if (!historicoSalvo || !vinculoSalvo) {
                    doneEvent.reply += '\n\n⚠️ Não consegui salvar esta conversa no histórico. Copie a resposta antes de sair da página.';
                }
                sendEvent(doneEvent);
            }
        } finally {
            res.end();
        }
    }
});

module.exports = router;

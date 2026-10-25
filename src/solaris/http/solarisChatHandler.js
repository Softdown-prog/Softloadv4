"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.criarHandlerChatSolaris = criarHandlerChatSolaris;
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizarUsoTokensSolaris, calcularDebitoChatSolaris } = require('./solarisBilling');
const { validarMensagemSolaris, validarSessaoSolaris, sanitizarHistoricoSolaris, historicoParaMotorSolaris, serializarEventoSseSolaris } = require('./solarisHttpProtocol');
const SOLARIS_CHAT_SESSION_TYPE = 'solaris-chat';
function criarHandlerChatSolaris(deps) {
    const { chatStorage, db, admin, debitarCreditos, solarisChat, modelRouter, orquestrador, carregarProjeto, salvarProjeto, lerProjetoParaPersistir, deletarArquivo, criarArquivo, listarProjeto, criarZip, responderOuEditarProjeto, removerMarcadorTruncado, detectarMarcador } = deps;
    return async (req, res) => {
        const { message, history, sessionId: clientSessionId } = req.body;
        const entrada = validarMensagemSolaris(message);
        if (!entrada.ok)
            return res.status(400).json({ error: entrada.erro });
        const sessaoCliente = validarSessaoSolaris(clientSessionId);
        if (!sessaoCliente.ok)
            return res.status(400).json({ error: sessaoCliente.erro });
        const msg = entrada.mensagem;
        const uid = req.session.user?.uid;
        const email = req.session.user?.email || '';
        const sessionId = sessaoCliente.sessionId || chatStorage.newSessionId();
        const billingOperationId = require('node:crypto').randomUUID(); // chave independente por geração
        const safeHistory = sanitizarHistoricoSolaris(history);
        const historicoSolaris = historicoParaMotorSolaris(safeHistory);
        if (req.body.requestId !== undefined) {
            if (!uid)
                return res.status(401).json({ error: 'Usuário não autenticado.' });
            let gateStatus;
            try {
                const { registrarRequisicaoChat } = require('../../services/chatRequestGate');
                gateStatus = await registrarRequisicaoChat(db, uid, 'solaris', req.body.requestId, {
                    message: msg, sessionId: sessaoCliente.sessionId, history: safeHistory,
                });
            }
            catch (err) {
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
        const sendEvent = (data) => res.write(serializarEventoSseSolaris(data));
        let fullText = '';
        let tokensRef = { total: 0, input: 0, output: 0 };
        let replyFinal = '';
        let zipInfo = null;
        let doneEvent = null;
        let tokensGeracao = { input: 0, output: 0 }; // estimativa — ver comentário abaixo
        // Propostas de mudança de arquivo pendentes de confirmação (Fase 2d,
        // ver pipeline/projectEditor.js) — carregadas do meta da sessão
        // ANTERIOR dentro do bloco de projeto abaixo, e regravadas no `finally`
        // no fim da função. Continua [] o turno inteiro se não há projeto
        // anexado (nunca existiu proposta pra essa sessão).
        let propostasPendentes = [];
        try {
            // Fase 2c/2d: se a sessão tem um projeto anexado (upload anterior
            // persistido no GCS via tools/projectStorage.js), o turno inteiro
            // passa pro editor agêntico (leitura + proposta/aplicação de
            // mudança de arquivo — ver pipeline/projectEditor.js) em vez do
            // chat normal. Tentativa SEMPRE que uid existe (nunca depende de o
            // cliente avisar que anexou algo — evita todo o bug de "esqueceu
            // de mandar a flag"); custo é só um GET no GCS quando não há
            // projeto (404 rápido). Sem streaming token-a-token nesse caminho
            // (executarTarefaComFerramentas não é streaming) — manda a
            // resposta inteira num único evento "chunk", mesmo protocolo SSE,
            // só sem o efeito de digitação.
            let usouProjeto = false;
            if (uid) {
                const baseDirProjeto = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-projeto-anexado-'));
                try {
                    const projeto = await carregarProjeto(uid, sessionId, baseDirProjeto);
                    if (projeto) {
                        try {
                            const sessaoAnterior = await chatStorage.loadSession(uid, SOLARIS_CHAT_SESSION_TYPE, sessionId);
                            const propostasSalvas = sessaoAnterior?.meta?.edicaoProjetoPendente;
                            propostasPendentes = Array.isArray(propostasSalvas)
                                ? propostasSalvas.filter((p) => p != null && typeof p.caminho === 'string' && typeof p.operacao === 'string')
                                : [];
                        }
                        catch (e) {
                            console.warn(`[SOLARIS-CHAT] falha carregando propostas pendentes: ${e.message}`);
                        }
                        const aplicarMudancasReal = async (mudancas) => {
                            for (const m of mudancas) {
                                if (m.operacao === 'deletar')
                                    deletarArquivo(baseDirProjeto, m.caminho);
                                else
                                    criarArquivo(baseDirProjeto, m.caminho, m.conteudoNovo);
                            }
                            const arquivosAtualizados = lerProjetoParaPersistir(baseDirProjeto);
                            // Mesmo padrão de substituição da rota de upload
                            // (salvarProjeto versionado) — reusa a cota já
                            // testada em vez de inventar escrita cirúrgica por
                            // arquivo no GCS (projeto Solaris é pequeno, poucas
                            // dezenas de arquivo de texto, ver README).
                            await salvarProjeto({ uid, email, plano: req.session.user?.plano || 'free', sessionId, framework: projeto.framework, arquivos: arquivosAtualizados, expectedVersion: projeto.versao });
                        };
                        sendEvent({ type: 'status', label: 'Consultando o projeto anexado...' });
                        const resposta = await responderOuEditarProjeto({
                            baseDir: baseDirProjeto,
                            framework: projeto.framework,
                            arquivos: projeto.arquivos,
                            mensagem: msg,
                            historico: historicoSolaris,
                            propostasPendentes,
                            modelRouter,
                            aplicarMudancasReal,
                        });
                        if (resposta.ok) {
                            fullText = resposta.resposta;
                            sendEvent({ type: 'chunk', text: fullText });
                            tokensRef = normalizarUsoTokensSolaris(resposta.tokens);
                            usouProjeto = true;
                            propostasPendentes = resposta.propostasFinais;
                            // Achado real testando a Fase 2d: mudancasAplicadas
                            // era calculado por projectEditor.js mas nunca
                            // chegava ao usuário — mesma classe de bug já
                            // corrigida no chat de edição do Workspace ("só
                            // promete e diz que mudou"). baseDirProjeto já
                            // reflete o estado atualizado (aplicarMudancasReal
                            // grava nele antes de persistir no GCS), então dá
                            // pra reusar o MESMO mecanismo de download que
                            // "projeto gerado" já usa (event.zip no 'done') —
                            // zero mudança de frontend necessária.
                            if (resposta.mudancasAplicadas.length > 0) {
                                try {
                                    const zipBuffer = await criarZip(baseDirProjeto);
                                    zipInfo = {
                                        base64: zipBuffer.toString('base64'),
                                        nome: 'projeto-solaris-atualizado.zip',
                                        totalArquivos: listarProjeto(baseDirProjeto).length,
                                    };
                                }
                                catch (e) {
                                    console.warn(`[SOLARIS-CHAT] falha gerando ZIP do projeto editado: ${e.message}`);
                                }
                            }
                        }
                        else {
                            console.warn(`[SOLARIS-CHAT] responderOuEditarProjeto indisponível: ${resposta.motivo}`);
                        }
                    }
                }
                catch (e) {
                    // Se o projeto está ocupado, não fingir que a edição caiu no chat comum.
                    if (e.code === 'SOLARIS_PROJECT_BUSY' || e.code === 'SOLARIS_PROJECT_STALE')
                        throw e;
                    console.warn(`[SOLARIS-CHAT] falha carregando projeto anexado: ${e.message}`);
                }
                finally {
                    fs.rmSync(baseDirProjeto, { recursive: true, force: true });
                }
            }
            if (!usouProjeto) {
                sendEvent({ type: 'status', label: 'Consultando o Solaris...' });
                for await (const pedaco of solarisChat.perguntarStream(msg, historicoSolaris, tokensRef)) {
                    fullText += pedaco;
                    sendEvent({ type: 'chunk', text: pedaco });
                }
            }
            // Nunca deixa um marcador cortado no meio (usuário parou a geração,
            // ou o teto de tokens cortou a resposta) vazar pro texto exibido.
            fullText = removerMarcadorTruncado(fullText);
            const marcador = detectarMarcador(fullText);
            replyFinal = fullText;
            if (marcador) {
                replyFinal = marcador.textoVisivel;
                if (marcador.erro) {
                    // Marcador malformado (JSON inválido/campo ausente) — não
                    // trava a conversa, só não dispara geração nenhuma.
                    console.error(`[SOLARIS-CHAT] marcador de geração malformado: ${marcador.erro}`);
                }
                else {
                    sendEvent({ type: 'status', label: 'Gerando o projeto...' });
                    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-projeto-'));
                    try {
                        const resultado = await orquestrador.gerarProjeto({
                            objetivo: marcador.objetivo,
                            framework: marcador.framework,
                            baseDir,
                        });
                        if (resultado.ok && resultado.zipBuffer) {
                            // Keep generated game assets available to the editor on
                            // the next turn, even on another Cloud Run instance.
                            if (uid && resultado.assets?.length) {
                                try {
                                    await salvarProjeto({ uid, email, plano: req.session.user?.plano || 'free', sessionId,
                                        framework: resultado.manifesto.framework, arquivos: lerProjetoParaPersistir(baseDir) });
                                }
                                catch (e) {
                                    console.warn(`[SOLARIS-FORGE] persistência indisponível: ${e.message}`);
                                    replyFinal += '\n\nO ZIP está pronto, mas não consegui guardar o projeto nesta sessão. Baixe o arquivo para preservá-lo.';
                                }
                            }
                            zipInfo = {
                                base64: resultado.zipBuffer.toString('base64'),
                                nome: 'projeto-solaris.zip',
                                totalArquivos: listarProjeto(baseDir).length,
                            };
                            // orchestrator.js ainda não expõe usageMetadata real por
                            // chamada de arquitetura (Pro) pro caller — estimativa
                            // pela mesma heurística de caracteres já usada como
                            // fallback no resto do projeto, pra nunca deixar o custo
                            // real de Pro (manifesto + 1 chamada por arquivo) sem
                            // cobrança nenhuma.
                            const textoGerado = resultado.arquivos.map((a) => a.conteudo || '').join('');
                            tokensGeracao.output = Math.ceil(textoGerado.length / 3.5);
                            tokensGeracao.input = Math.ceil((marcador.objetivo.length + marcador.framework.length) / 3.5) * (1 + resultado.arquivos.length);
                        }
                        else {
                            replyFinal += '\n\n⚠️ Não consegui empacotar o projeto — algum arquivo não passou na validação automática. Me diga o que você quer ajustar e eu tento de novo.';
                        }
                    }
                    finally {
                        fs.rmSync(baseDir, { recursive: true, force: true });
                    }
                }
            }
            // Confirmar o histórico e o saldo antes de sinalizar fim da geração.
            doneEvent = { type: 'done', reply: replyFinal, sessionId, tokens: tokensRef, zip: zipInfo };
        }
        catch (err) {
            const erroHttp = err;
            const httpStatus = erroHttp.status || erroHttp.statusCode || 0;
            console.error(`[SOLARIS-CHAT] status=${httpStatus} msg=${err.message}`);
            const allErrMsg = erroHttp.message || '';
            const isProjetoOcupado = erroHttp.code === 'SOLARIS_PROJECT_BUSY';
            const isProjetoDesatualizado = erroHttp.code === 'SOLARIS_PROJECT_STALE';
            const isCota = httpStatus === 429 || allErrMsg.includes('429') || allErrMsg.includes('RESOURCE_EXHAUSTED') || allErrMsg.includes('quota');
            const isSeguranca = allErrMsg.includes('SAFETY') || allErrMsg.includes('content_filter');
            const isChave = httpStatus === 401 || allErrMsg.includes('API_KEY') || allErrMsg.includes('UNAUTHENTICATED') || allErrMsg.includes('não configurada');
            if (isChave) {
                db.collection('admin_logs').add({
                    por: 'sistema',
                    tipo: 'erro_solaris',
                    detalhes: { email: email || 'desconhecido', status: httpStatus, erro: erroHttp.message?.slice(0, 300) },
                    criado_em: admin.firestore.FieldValue.serverTimestamp(),
                }).catch(() => { });
            }
            sendEvent({
                type: 'error',
                message: isProjetoDesatualizado ? 'O projeto mudou enquanto eu preparava a edição. Nenhuma alteração foi salva. Reenvie o pedido para usar a versão mais recente.'
                    : isProjetoOcupado ? 'Este projeto está sendo atualizado em outra solicitação. Aguarde alguns instantes e tente novamente.'
                        : isCota ? 'Alto volume de acessos. Aguarde 1 minuto e tente novamente.'
                            : isSeguranca ? 'Mensagem não pôde ser processada. Reformule e tente novamente.'
                                : isChave ? 'Chave de API inválida ou expirada. Verifique GEMINI_API_KEY no servidor.'
                                    : `Solaris temporariamente indisponível. (${httpStatus || 'err'}) Tente novamente.`,
            });
        }
        finally {
            // Se algo quebrou antes do marcador ser resolvido, replyFinal pode
            // ainda estar vazio — cai pro fullText bruto (já sem marcador
            // truncado, ver removerMarcadorTruncado acima) pra nunca perder o
            // texto que o usuário efetivamente recebeu via streaming.
            const textoParaSalvar = replyFinal || fullText;
            let historicoSalvo = false;
            let debitoConfirmado = true;
            if (textoParaSalvar && uid) {
                const ts = new Date().toISOString();
                const messages = [
                    ...safeHistory,
                    { role: 'user', content: msg, ts },
                    { role: 'assistant', content: textoParaSalvar, ts },
                ];
                // meta.edicaoProjetoPendente: propostas de mudança de arquivo
                // ainda não confirmadas (ver pipeline/projectEditor.js) —
                // precisam sobreviver pro próximo turno decidir se aplica ou
                // cancela. [] na maioria das sessões (nunca houve projeto
                // anexado, ou não há nada pendente agora).
                const meta = propostasPendentes.length ? { edicaoProjetoPendente: propostasPendentes } : {};
                try {
                    await chatStorage.saveSession(uid, SOLARIS_CHAT_SESSION_TYPE, sessionId, { messages, tokens: tokensRef, meta }, { email, plano: req.session.user?.plano || 'free' });
                    historicoSalvo = true;
                }
                catch (e) {
                    console.error(`[CHAT-STORAGE] solaris-chat save err: ${e instanceof Error ? e.message : String(e)}`);
                }
            }
            // Débito separado do save — roda sempre que houver resposta e email
            // (mesmo padrão de chat.js/workspaceChat.js). tokensRef vem do
            // usageMetadata real do Gemini (ver modelRouter.executarTriagemStream);
            // heurística de caracteres só entra se por algum motivo a API não
            // devolveu usageMetadata nenhum (fallback, não o caminho normal).
            // tokensGeracao (Pro, manifesto + arquivos) é sempre estimativa —
            // ver comentário na chamada de gerarProjeto — somado no mesmo débito
            // pra nunca deixar o custo real de geração sem cobrança.
            if (email && textoParaSalvar) {
                const debito = calcularDebitoChatSolaris(msg, textoParaSalvar, tokensRef, tokensGeracao);
                try {
                    await debitarCreditos(email, debito.input, debito.output, billingOperationId);
                }
                catch (e) {
                    debitoConfirmado = false;
                    console.error(`[BILLING] solaris-chat debit err: ${e instanceof Error ? e.message : String(e)}`);
                }
            }
            try {
                if (doneEvent) {
                    if (!historicoSalvo) {
                        doneEvent.reply += '\n\n⚠️ Não consegui salvar esta conversa no histórico. Copie a resposta antes de sair.';
                    }
                    if (!debitoConfirmado) {
                        doneEvent.reply += '\n\n⚠️ Não foi possível confirmar a atualização dos créditos.';
                    }
                    sendEvent(doneEvent);
                }
            }
            finally {
                res.end();
            }
        }
    };
}

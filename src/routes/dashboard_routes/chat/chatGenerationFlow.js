'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const { gerarChatStream } = require('../../../services/geminiService');
const { gerarChatGptStream } = require('../../../services/openaiService');
const { loadForGeminiSync, rotearPergunta } = require('../../../rag/ragLoader');
const chatStorage = require('../../../services/chatStorageService');
const { _validarECorrigir } = require('./chatCodeValidator');
const { _compilarParaChat } = require('./chatTemplateCompiler');
const { buscarRagRelevante, montarContextoRag } = require('./chatRag');
const { buscarRagGpt, montarContextoRagGpt } = require('./chatRagGpt');
const { buscarContextoTemplate, montarContextoTemplate, precisaContextoTemplate } = require('./chatTemplateContext');
const { montarContextoWorkspace } = require('./chatWorkspaceContext');
const { SISTEMA_GERACAO, SISTEMA_SUPORTE } = require('./chatSystemPrompt');
// ──────────────────────────────────────────────────────────────────────────
// FLUXO DE GERAÇÃO DE TEMPLATE VIA CHAT — marcador embutido na resposta
// do modelo. Formato: [[TEMPLATE:{...json...}]]. O backend detecta,
// compila e devolve downloadUrl.
//
// Extraído verbatim de dashboard_routes/chat.js (rota do Especialista) pra
// ser reutilizado também pelo chat dedicado do Workspace, no modo "ainda
// não existe manifesto pra editar" — decisão do produto: esse fluxo NÃO
// vira ferramenta de agente, continua exatamente como já era.
// ──────────────────────────────────────────────────────────────────────────
const TEMPLATE_MARKER_RE = /\[\[TEMPLATE:([\s\S]+?)\]\]/;
/**
 * @param {object} opcoes
 * @param {string}  opcoes.msg           — mensagem já trimada do usuário
 * @param {Array}   opcoes.safeHistory   — histórico recente (mesmo shape usado em gerarChatStream)
 * @param {boolean} opcoes.isGpt
 * @param {boolean} [opcoes.permitirGeracao=false] — só true no chat dedicado
 *   do Workspace (workspaceChat.js, modo geração). Decide qual SISTEMA usar
 *   (SISTEMA_GERACAO vs SISTEMA_SUPORTE) e, em código — não só no prompt —
 *   se a detecção do marcador [[TEMPLATE:{...}]] roda. O Especialista
 *   (chat.js) nunca passa true: geração de template é exclusiva do
 *   Workspace, que por sua vez já é Gemini-only.
 * @param {object|null} opcoes.wsSnapshot — snapshot da sessão de workspace, se houver (pode não ter manifesto)
 * @param {string}  opcoes.email
 * @param {string}  opcoes.uid
 * @param {object}  opcoes.user          — req.session.user
 * @param {Function} opcoes.sendEvent    — (data) => void, eventos SSE
 * @param {object}  opcoes.tokensRef     — {total,input,output}, mutado pelo stream
 * @param {string|null} [opcoes.wsProjetoId]
 * @param {string|null} [opcoes.wsSessionId]
 * @returns {Promise<{ fullText: string, downloadUrl: string|null, novoSnapshot: object|null, codeValidation: object|null }>}
 */
async function gerarComPossivelTemplate({ msg, safeHistory, isGpt, wsSnapshot, email, uid, user, sendEvent, tokensRef, wsProjetoId = null, wsSessionId = null, permitirGeracao = false, }) {
    let fullText = '';
    let downloadUrl = null;
    let novoSnapshot = null;
    let sistemaFinal = permitirGeracao ? SISTEMA_GERACAO : SISTEMA_SUPORTE;
    // Memória persistente entre conversas (lifetime do usuário, não só da
    // sessão atual) — injeta preferências/últimos templates acumulados via
    // chatStorage.updateMemoryFromSession. Falha de leitura nunca derruba o
    // chat (mesmo princípio de degradação silenciosa do resto deste fluxo).
    if (uid) {
        try {
            const memoria = await chatStorage.loadMemory(uid);
            const contextoMemoria = chatStorage.formatMemoryForPrompt(memoria);
            if (contextoMemoria)
                sistemaFinal = sistemaFinal + contextoMemoria;
        }
        catch (memErr) {
            console.warn('[CHAT-MEMORY] loadMemory err:', memErr.message);
        }
    }
    // Chamado a partir do chat dedicado do Workspace (sempre tem os dois
    // IDs — a rota exige — diferente do Especialista, que nunca os passa).
    // Nesse contexto não existe botão de download avulso na bolha do chat
    // (workspaceChat.js não repassa downloadUrl no evento SSE "done") — o
    // template gerado vira automaticamente a versão 1 no Histórico de
    // Versões, mesmo lugar de onde toda edição subsequente também sai.
    // Sem isso, a IA seguiria a instrução padrão de SISTEMA ("seu download
    // aparecerá aqui em instantes") e prometeria um botão que não existe.
    const contextoWorkspace = !!(wsProjetoId && wsSessionId);
    if (contextoWorkspace) {
        sistemaFinal = sistemaFinal +
            `\n\n---\n## SOBRESCREVE A INSTRUÇÃO DE MENSAGEM PÓS-MARCADOR\n` +
            `Esta conversa é do chat dedicado do Workspace, que tem histórico de versões próprio. Quando emitir o marcador [[TEMPLATE:{...}]], IGNORE a instrução anterior de dizer "seu download aparecerá aqui em instantes" — em vez disso, diga algo como "Pronto! Seu template foi gerado e já está salvo como a primeira versão do seu projeto — você pode baixá-lo quando quiser na aba Histórico de Versões." Nunca prometa ou mencione um botão de download na própria mensagem; ele não existe aqui, o download já fica disponível automaticamente no histórico.`;
    }
    // Workspace context: injetado SEMPRE no system prompt (não gateado por palavra-chave)
    // Acumula sobre o que já foi montado (memória, override acima) — reatribuir
    // a partir de SISTEMA aqui descartaria os dois silenciosamente.
    if (wsSnapshot) {
        sendEvent({ type: 'status', label: 'Revisando seu projeto...' });
        sistemaFinal = sistemaFinal + montarContextoWorkspace(wsSnapshot);
    }
    // Injeta conhecimento técnico RAG relevante à mensagem (suporte, widgets, engenharia)
    const ragArquivos = buscarRagRelevante(msg);
    if (ragArquivos.length) {
        sendEvent({ type: 'status', label: 'Organizando ideias...' });
        const ragParaUsar = isGpt ? ragArquivos.slice(0, 1) : ragArquivos;
        sistemaFinal = sistemaFinal + montarContextoRag(ragParaUsar);
    }
    // Para geração de templates: injeta instrucoes + tema do nicho do pipeline RAG.
    // O ramo de pipeline só roda quando permitirGeracao (Workspace) — o
    // Especialista (chat.js) nunca precisa desse contexto, já que não emite
    // o marcador. O fallback de suporte abaixo continua valendo pros dois,
    // já que é sobre responder dúvida, não gerar template.
    // Para suporte: injeta conhecimento estruturado via ragLoader quando buscarRagRelevante
    // não encontrou ficheiros (fallback garante carregamento do topicos).
    if (!isGpt) {
        // Mensagens ANTERIORES do usuário — dão contexto de nicho/rota a
        // refinamentos ("deixa mais escuro") e confirmações ("pode gerar
        // agora") que não repetem o nicho na mensagem atual.
        const historicoUser = safeHistory
            .filter(m => m.role === 'user')
            .map(m => m.content);
        const rota = rotearPergunta(msg, historicoUser);
        if (permitirGeracao && rota === 'rag-ia-compiler/pipeline') {
            const isConfirmacao = /\b(gerar?\s+o?\s*template|cri[ae]r?\s+o?\s*template|montar?\s+o?\s*template|pode\s+(gerar|criar|montar)|gera\s+agora|faz\s+agora|envia\s+o?\s*template|confirmo|quero\s+ver\s+o\s*template)\b/i.test(msg);
            const pipelineRag = loadForGeminiSync(msg, { metaOnly: !isConfirmacao, historico: historicoUser });
            if (pipelineRag.sucesso && pipelineRag.contextoStr) {
                sendEvent({ type: 'status', label: 'Identificando padrões do nicho...' });
                sistemaFinal = sistemaFinal +
                    `\n\n---\n## BLUEPRINT DE NICHO (RAG PIPELINE)\n${pipelineRag.contextoStr}`;
            }
        }
        else if (ragArquivos.length === 0) {
            // Suporte/ia-de-balcao sem hit no buscarRagRelevante: usa ragLoader para
            // injetar o ficheiro de tópicos (fallback automático do selecionarFicheiros).
            const suporteRag = loadForGeminiSync(msg);
            if (suporteRag.sucesso && suporteRag.contextoStr) {
                sendEvent({ type: 'status', label: 'Consultando base de suporte...' });
                sistemaFinal = sistemaFinal +
                    `\n\n---\n## SUPORTE TÉCNICO BLOGGER\n${suporteRag.contextoStr}`;
            }
        }
    }
    // GPT EXCLUSIVO: injeta os padrões de alto nível da pasta gpt-5-4/
    // (conduta sênior, escrita de código, tutoriais, artigos, parceria).
    // A fundação entra sempre; até 2 ficheiros temáticos por palavra-chave.
    if (isGpt) {
        const gptRag = buscarRagGpt(msg);
        if (gptRag.length) {
            sendEvent({ type: 'status', label: 'Aplicando padrões de alto nível...' });
            sistemaFinal = sistemaFinal + montarContextoRagGpt(gptRag);
        }
    }
    // Injeta contexto do último template quando não há contexto de workspace
    // e a mensagem pede código/personalização visual
    if (!wsSnapshot && precisaContextoTemplate(msg) && email) {
        sendEvent({ type: 'status', label: 'Consultando contexto anterior...' });
        const templateData = await buscarContextoTemplate(email);
        if (templateData) {
            sendEvent({ type: 'status', label: 'Analisando estilo visual...' });
            sistemaFinal = sistemaFinal + montarContextoTemplate(templateData);
        }
    }
    // GPT: 2048 tokens de output é suficiente para suporte/snippets
    // Gemini Flash: mantém 8192 (modelo barato, respostas longas são OK)
    const maxOutput = isGpt ? 2048 : 8192;
    const streamSource = isGpt
        ? gerarChatGptStream(safeHistory, msg, sistemaFinal, { maxOutputTokens: maxOutput, tokensRef })
        : gerarChatStream(safeHistory, msg, sistemaFinal, { maxOutputTokens: maxOutput, tokensRef });
    for await (const chunk of streamSource) {
        fullText += chunk;
        sendEvent({ type: 'chunk', text: chunk });
    }
    // ── Validação de sintaxe dos blocos de código ────────────────────────
    // Roda após o stream completo; não bloqueia respostas sem código.
    // Se encontrar erro: 1 retry focado → substitui o bloco na resposta.
    // Qualquer falha no validator é silenciosa (não derruba a resposta).
    let codeValidation = null;
    try {
        const cvResult = await _validarECorrigir(fullText, msg, isGpt, tokensRef, sendEvent);
        fullText = cvResult.finalText;
        codeValidation = cvResult.validation;
        if (codeValidation.checked > 0) {
            console.log(`[CODE-VALIDATOR] ${codeValidation.checked} bloco(s) | ok=${codeValidation.ok} | retried=${codeValidation.retried} | fixApplied=${codeValidation.fixApplied}`);
        }
    }
    catch (cvErr) {
        console.warn('[CODE-VALIDATOR] erro inesperado:', cvErr.message);
    }
    // ── Detecta marcador [[TEMPLATE:{...}]] embutido pelo Gemini ────────
    // Se encontrado: extrai blueprint, remove marcador do texto visível,
    // compila o template e devolve downloadUrl no evento "done".
    // Se falhar em qualquer etapa: ignora silenciosamente, sem crash.
    // Gate em código, não só no prompt (SISTEMA_SUPORTE já instrui o modelo
    // a nunca emitir o marcador) — mesmo que o modelo ignore a instrução e
    // emita o marcador por conta própria, o pipeline determinístico de
    // compilação só roda quando permitirGeracao=true (Workspace) e o
    // modelo é Gemini (isGpt=false).
    const markerMatch = (permitirGeracao && !isGpt) ? fullText.match(TEMPLATE_MARKER_RE) : null;
    if (markerMatch && uid && email) {
        fullText = fullText.replace(TEMPLATE_MARKER_RE, '').trim();
        // Define expectativa de tempo ANTES do primeiro status real do pipeline
        // (refinamento + compilação + validação + upload envolvem chamadas de
        // IA e I/O real — não é instantâneo). Esse status fica visível como a
        // primeira pill da sequência (showStatus() no client empilha as
        // anteriores, esmaecidas) durante toda a geração.
        sendEvent({ type: 'status', label: 'Montando seu template completo — isso pode levar alguns minutos, não feche esta aba...' });
        try {
            const blueprint = JSON.parse(markerMatch[1]);
            const resultado = await _compilarParaChat(blueprint, user, sendEvent, { wsProjetoId, wsSessionId });
            downloadUrl = resultado.downloadUrl;
            novoSnapshot = resultado.snapshot;
            console.log(`[CHAT-TEMPLATE] OK | ${email} | ${blueprint.siteName || '?'} | ${downloadUrl}`);
        }
        catch (tplErr) {
            console.error('[CHAT-TEMPLATE] Falha ao compilar marcador:', tplErr.message);
            // fullText, neste ponto, já teve o marcador removido mas ainda
            // carrega a promessa de download que o modelo escreveu antes de
            // saber que a compilação ia falhar (ex: "seu download aparecerá
            // aqui em instantes") — sem isso o usuário nunca sabe que nada
            // foi gerado. Substitui pela mensagem real, honesta, convidando
            // a tentar de novo — mesmo canal 'done'/reply que já funciona
            // sem mudança de frontend nos dois chats.
            fullText = 'Consegui montar o plano do seu template, mas a compilação falhou (erro técnico registrado). '
                + 'Pode pedir de novo — se persistir, me diga exatamente o que você quer que eu tento de um jeito diferente.';
        }
    }
    // Fallback: remove marcador truncado (sem ]] de fechamento) para nunca vazar ao usuário
    if (fullText.includes('[[TEMPLATE:')) {
        fullText = fullText.replace(/\[\[TEMPLATE:[\s\S]*/g, '').trim();
    }
    return { fullText, downloadUrl, novoSnapshot, codeValidation };
}
module.exports = { gerarComPossivelTemplate, TEMPLATE_MARKER_RE };

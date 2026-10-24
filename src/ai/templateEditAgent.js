"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEMPLATE_EDIT_TOOL_DECLARATIONS = void 0;
exports.processarEdicaoAgentica = processarEdicaoAgentica;
exports.criarExecutorDeFerramentas = criarExecutorDeFerramentas;
exports._labelParaFerramentaEdicao = _labelParaFerramentaEdicao;
exports._extrairBlocosScript = _extrairBlocosScript;
exports._validarCamposLivres = _validarCamposLivres;
// ============================================================
// TEMPLATE EDIT AGENT — agente conversacional do chat do Workspace
// (Gemini + function-calling), dedicado a EDITAR o template do usuário
// que já está carregado na sessão.
//
// Espelha a FORMA do Sol (src/ai/solAgent.js — mesmo padrão de loop
// agêntico, mesmo TokenBudget importado de ../rag/ragAgent, mesmo uso de
// GoogleGenAI com tools:[...], mesmo onProgress pra status em
// tempo real), mas é um módulo TOTALMENTE independente: ferramentas
// próprias, prompt próprio, nenhuma importação de solAgent.js. Sol tem
// ferramentas de leitura do código-fonte da própria Softload — isso
// NUNCA pode ficar acessível a um cliente pagante no chat do Workspace,
// por isso os dois agentes não compartilham tools nem prompt.
//
// Escopo travado: as únicas ferramentas aqui operam sobre o `manifesto`
// (mesmo shape de _blueprintParaManifesto) e a proposta de edição em
// memória do turno — nada de filesystem, nada de código-fonte, nada de
// outro usuário. Reaproveita GEMINI_EDIT_RESPONSE_SCHEMA/validarEdicao
// de templateEditSchema.js (sem nenhuma mudança) como o `parameters` da
// tool propor_edicao e o validador dos argumentos que o modelo mandar.
//
// Aplicar de verdade (recompilar + persistir + debitar crédito) SEMPRE
// exige confirmação numa mensagem seguinte — nunca na mesma resposta em
// que o modelo acabou de propor. Essa garantia é reforçada em CÓDIGO
// (ver `propostaFoiCriadaNesteTurno` abaixo), não só no prompt: mesmo
// que o modelo tente, aplicar_edicao_pendente recusa nesse caso.
// ============================================================
const { GoogleGenAI, HarmCategory, HarmBlockThreshold } = require('@google/genai');
const { TokenBudget } = require('../rag/ragAgent');
const { GEMINI_EDIT_RESPONSE_SCHEMA, validarEdicao } = require('./templateEditSchema');
const { _resumirManifesto } = require('../core/templateEditWorker');
const { carregarNichoDossie } = require('../core/compilerEngine/dossieLoader');
const { _tokensExternos } = require('../core/compilerEngine/pecaOrchestrator');
const { validarTokensCss } = require('../core/compilerEngine/workers/cssWorker');
const { validarEscopoGlobal } = require('../core/compilerEngine/workers/jsWorker');
const MODEL_NAME = process.env.GEMINI_LITE_MODEL || 'gemini-2.5-flash-lite';
const MAX_TOOL_CALLS = 5;
const BUDGET_TOKENS = parseInt(process.env.TEMPLATE_EDIT_AGENT_BUDGET || '6000', 10);
const SAFETY_SETTINGS = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
];
const SYSTEM_PROMPT = `Você é o assistente de edição de templates do Workspace da Softload Engine.
Seu único trabalho é ver e editar o template Blogger que o usuário já tem carregado nesta sessão — nada além disso. Você não tem acesso a código-fonte, arquivos do servidor, nem dados de outro usuário; suas ferramentas só enxergam o template atual desta sessão.

Se a mensagem não tiver nada a ver com ver ou editar o template atual (pergunta geral, bate-papo, dúvida sobre Blogger em geral), NÃO chame nenhuma ferramenta — responda de verdade, em 1-2 frases: explique que este chat é dedicado a editar o template atual do usuário (cor, tipografia, textos, layout, CSS/JS) e que pra outros assuntos (suporte geral, dúvidas sobre Blogger, SEO etc) ele deve usar o Especialista Blogger geral no menu do painel. Seja direto e gentil — essa resposta é a única coisa que o usuário vê, então nunca deixe a conversa sem uma resposta útil.

Pra propor uma mudança, chame propor_edicao com os campos que devem mudar e um "resumoMudancas" curto e amigável em PT-BR. Nunca invente campo fora do schema da ferramenta — se o pedido não corresponder a nenhum campo conhecido, a ferramenta avisa e você explica a limitação ao usuário.

Depois de propor com sucesso, SEMPRE pergunte se pode aplicar — nunca chame aplicar_edicao_pendente na mesma resposta em que você acabou de propor (o sistema bloqueia isso de qualquer forma, então nem tente). Só chame aplicar_edicao_pendente quando o usuário confirmar CLARAMENTE, numa mensagem SEGUINTE, que quer aplicar a proposta pendente (ex: "sim", "pode aplicar", "confirmo", "manda ver", "isso mesmo", "bora"). Se a resposta for ambígua, pergunte de novo em vez de aplicar. Se o usuário rejeitar ou desistir, chame cancelar_edicao_pendente. Se ele pedir uma mudança diferente da proposta pendente, chame propor_edicao de novo — isso substitui a proposta anterior.

Depois que aplicar_edicao_pendente tiver sucesso, mencione brevemente que a mudança foi salva como uma nova versão no histórico do projeto (aba "Histórico de Versões" no Workspace) e que dá pra reverter a qualquer momento se não gostar do resultado — isso não é opcional, é sempre verdade (toda edição aplicada vira uma versão nova, nada é sobrescrito ou perdido). Não precisa repetir isso em respostas que só propõem ou só respondem pergunta, só quando de fato aplicar.

Use ver_template_atual quando precisar saber o valor de um campo antes de decidir o que propor, ou pra responder uma pergunta informativa sobre o template (ex: "que cor eu escolhi?", "qual a tipografia atual?") sem propor nada. Use ver_proposta_pendente se não tiver certeza do que já está pendente.

Responda sempre em português do Brasil, tom direto e amigável, sem inflar a resposta.`;
// ──────────────────────────────────────────────────────────────────────────
// DECLARAÇÕES DE FERRAMENTAS
// ──────────────────────────────────────────────────────────────────────────
const TEMPLATE_EDIT_TOOL_DECLARATIONS = {
    functionDeclarations: [
        {
            name: 'ver_template_atual',
            description: 'Mostra o estado atual (resumido) do template do usuário — todos os campos configuráveis e seus valores hoje. Use antes de propor uma mudança em cima de um valor que você não sabe, ou pra responder pergunta informativa sobre o template atual.',
            parameters: { type: 'object', properties: {} },
        },
        {
            name: 'ver_proposta_pendente',
            description: 'Mostra a proposta de edição pendente de confirmação nesta sessão, se houver — os campos e o resumo. Use se não tiver certeza do que já está pendente antes de aplicar ou cancelar.',
            parameters: { type: 'object', properties: {} },
        },
        {
            name: 'propor_edicao',
            description: 'Propõe uma mudança no template — monta a proposta mas NÃO aplica (não recompila, não persiste, não gasta crédito). Substitui qualquer proposta pendente anterior. Só inclua os campos que devem mudar.',
            parameters: GEMINI_EDIT_RESPONSE_SCHEMA,
        },
        {
            name: 'aplicar_edicao_pendente',
            description: 'Aplica de verdade a proposta pendente: recompila o template e persiste o resultado. SÓ chame isso depois que o usuário confirmar claramente, numa mensagem seguinte à proposta — nunca na mesma resposta em que a proposta foi criada (o sistema recusa nesse caso).',
            parameters: { type: 'object', properties: {} },
        },
        {
            name: 'cancelar_edicao_pendente',
            description: 'Descarta a proposta de edição pendente sem aplicar — use quando o usuário rejeitar ou desistir da mudança proposta.',
            parameters: { type: 'object', properties: {} },
        },
    ],
};
exports.TEMPLATE_EDIT_TOOL_DECLARATIONS = TEMPLATE_EDIT_TOOL_DECLARATIONS;
// ──────────────────────────────────────────────────────────────
// _labelParaFerramentaEdicao — rótulo curto em PT-BR pra mostrar em
// tempo real qual ferramenta o agente está executando (onProgress).
// Mesmo padrão de _labelParaFerramenta em solAgent.js.
// ──────────────────────────────────────────────────────────────
function _labelParaFerramentaEdicao(name) {
    switch (name) {
        case 'ver_template_atual': return 'Vendo o template atual...';
        case 'ver_proposta_pendente': return 'Conferindo a proposta pendente...';
        case 'propor_edicao': return 'Montando a proposta de edição...';
        case 'aplicar_edicao_pendente': return 'Aplicando as alterações e recompilando...';
        case 'cancelar_edicao_pendente': return 'Cancelando a proposta pendente...';
        default: return `Executando ${name}...`;
    }
}
// ──────────────────────────────────────────────────────────────
// _extrairBlocosScript — extrai o conteúdo de tags <script> de um HTML
// solto (heroHtml/staticSections vindo do chat). Regex simples de propósito
// único (não é um parser de HTML de verdade) — suficiente pra achar JS
// embutido sem puxar dependência nova; a validação de markup em si (tags
// não fechadas etc) fica fora do escopo do item 3, adiada pro trabalho de
// parsers reais (Fase 2).
// ──────────────────────────────────────────────────────────────
function _extrairBlocosScript(html) {
    if (!html || typeof html !== 'string')
        return [];
    const blocos = [];
    const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
        const conteudo = m[1].trim();
        if (conteudo)
            blocos.push(conteudo);
    }
    return blocos;
}
// ──────────────────────────────────────────────────────────────
// _validarCamposLivres — roda os workers determinísticos já usados na
// validação de peças de dossiê (cssWorker/jsWorker) sobre os campos
// livres que o chat pode alterar (customCss/heroHtml/staticSections),
// ANTES da proposta ser aceita. Fecha o mesmo gap que motiva
// validarPecaGerada em pecaOrchestrator.js — só que aqui a "peça"
// candidata vem de um pedido em linguagem natural no Workspace, não de
// geração de IA no pipeline de compilação. htmlWorker.validarDomIds fica
// de fora deliberadamente: precisa de um domIds contrato pré-definido que
// conteúdo solto de chat não tem.
// Retorna string[] de erros (vazio = ok). Nunca lança.
// ──────────────────────────────────────────────────────────────
function _validarCamposLivres(camposAlterados, manifestoAtual) {
    const erros = [];
    const dossie = carregarNichoDossie(manifestoAtual && manifestoAtual.nichoTema);
    const jsExistenteDossie = dossie ? dossie.pecas.map(p => p.js).filter(Boolean) : [];
    if (typeof camposAlterados.customCss === 'string') {
        const tokensExternos = _tokensExternos((dossie && dossie.tokensCss));
        const resultado = validarTokensCss(camposAlterados.customCss, { tokensExternos });
        if (!resultado.ok) {
            resultado.erros.forEach(e => erros.push(`customCss: ${e}`));
        }
    }
    for (const campo of ['heroHtml', 'staticSections']) {
        const valor = camposAlterados[campo];
        if (typeof valor !== 'string')
            continue;
        const blocosNovos = _extrairBlocosScript(valor);
        if (blocosNovos.length === 0)
            continue;
        const resultado = validarEscopoGlobal([...jsExistenteDossie, ...blocosNovos]);
        if (!resultado.ok) {
            erros.push(`${campo}: colisão/erro de escopo JS — ${resultado.erro}`);
        }
    }
    return erros;
}
/**
 * criarExecutorDeFerramentas — fecha sobre o estado do turno (manifesto
 * atual, proposta em memória, handler de aplicação real) e devolve o
 * executor async de ferramentas. Separado da função principal só pra
 * ficar testável isoladamente (mesmo racional de executeSolTool ser
 * exportado à parte em solAgent.js).
 *
 * @param {object}   manifestoAtual
 * @param {object|null} propostaInicial — {campos, resumo} | null
 * @param {Function} aplicarEdicaoReal  — async (campos, resumoMudancas) => {downloadUrl, manifesto}
 * @returns {{ executar: Function, estado: object }}
 *   `estado` é mutado pelo executor — o chamador lê o valor final depois do loop.
 */
function criarExecutorDeFerramentas(manifestoAtual, propostaInicial, aplicarEdicaoReal) {
    const estado = {
        propostaAtual: propostaInicial || null,
        propostaFoiCriadaNesteTurno: false,
        downloadUrlAplicado: null,
        xmlPathAplicado: null,
        gcPathAplicado: null,
        manifestoFinalAplicado: null,
    };
    async function executar(name, args) {
        switch (name) {
            case 'ver_template_atual':
                return { manifesto: _resumirManifesto(manifestoAtual) };
            case 'ver_proposta_pendente':
                return estado.propostaAtual
                    ? { pendente: true, resumo: estado.propostaAtual.resumo, campos: estado.propostaAtual.campos }
                    : { pendente: false };
            case 'propor_edicao': {
                const { erros, camposAlterados, resumoMudancas } = validarEdicao(args);
                const vazio = !resumoMudancas || Object.keys(camposAlterados).length === 0;
                if (vazio) {
                    return {
                        erro: 'Nenhum campo reconhecido pra esse pedido — não dá pra propor uma edição a partir disso.',
                        avisos: erros.length ? erros : undefined,
                    };
                }
                const errosValidacao = _validarCamposLivres(camposAlterados, manifestoAtual);
                if (errosValidacao.length > 0) {
                    return {
                        erro: 'A mudança proposta não passou na validação técnica — não foi aplicada nem fica pendente.',
                        detalhes: errosValidacao,
                    };
                }
                estado.propostaAtual = { campos: camposAlterados, resumo: resumoMudancas };
                estado.propostaFoiCriadaNesteTurno = true;
                return {
                    sucesso: true,
                    resumo: resumoMudancas,
                    camposAceitos: Object.keys(camposAlterados),
                    avisos: erros.length ? erros : undefined,
                };
            }
            case 'aplicar_edicao_pendente': {
                if (!estado.propostaAtual) {
                    return { erro: 'Não há nenhuma proposta pendente pra aplicar.' };
                }
                if (estado.propostaFoiCriadaNesteTurno) {
                    return {
                        erro: 'Essa proposta acabou de ser criada agora mesmo, nesta mesma conversa — não pode ser aplicada ainda. Pergunte ao usuário se ele confirma; só chame esta ferramenta de novo depois que ele responder numa mensagem seguinte.',
                    };
                }
                try {
                    const resumoAplicado = estado.propostaAtual.resumo;
                    const { downloadUrl, xmlPath, gcPath, manifesto } = await aplicarEdicaoReal(estado.propostaAtual.campos, resumoAplicado);
                    estado.downloadUrlAplicado = downloadUrl;
                    estado.xmlPathAplicado = xmlPath || null;
                    estado.gcPathAplicado = gcPath || null;
                    estado.manifestoFinalAplicado = manifesto;
                    estado.propostaAtual = null;
                    return { sucesso: true, downloadUrl, resumo: resumoAplicado };
                }
                catch (err) {
                    return { erro: `Falha ao aplicar a edição: ${err.message}` };
                }
            }
            case 'cancelar_edicao_pendente': {
                if (!estado.propostaAtual) {
                    return { erro: 'Não há nenhuma proposta pendente pra cancelar.' };
                }
                estado.propostaAtual = null;
                return { sucesso: true };
            }
            default:
                return { erro: `Ferramenta desconhecida: ${name}` };
        }
    }
    return { executar, estado };
}
// ──────────────────────────────────────────────────────────────────────────
// processarEdicaoAgentica — loop agêntico principal. Mesmo formato de
// perguntarAoSol() (TokenBudget, MAX_TOOL_CALLS local, onProgress antes
// de cada tool call), ferramentas e prompt próprios.
//
// @param {Array<{role,content}>} historico — mensagens recentes da sessão
//   (mesmo shape de safeHistory em chat.js). Necessário pra refinações em
//   linguagem natural sem palavra-chave (ex: responder "azul escuro" a
//   "qual cor?" feita no turno anterior).
// @param {string} mensagem — mensagem atual do usuário
// @param {object} opcoes.manifestoAtual   — manifesto completo (snapshot.manifesto)
// @param {object|null} opcoes.propostaPendente — {campos, resumo} | null, carregada do Firestore
// @param {Function} opcoes.aplicarEdicaoReal — async (campos, resumoMudancas) => {downloadUrl, manifesto}
// @param {Function} [opcoes.onProgress]   — (evento) => void, status em tempo real
// @returns {Promise<{ resposta, engajou, propostaFinal, downloadUrl, xmlPath, gcPath, manifestoFinal, tokens, iteracoes, ms }>}
//   engajou=false → o modelo decidiu que a mensagem não é sobre o template
//   atual e não chamou nenhuma ferramenta; `resposta`, nesse caso, já é uma
//   explicação de escopo pronta pra mostrar ao usuário (não é descartável —
//   ver 2º parágrafo do SYSTEM_PROMPT). `engajou` fica no retorno só pra
//   log/telemetria, não controla mais nenhum fallback do chamador.
// ──────────────────────────────────────────────────────────────────────────
async function processarEdicaoAgentica(historico, mensagem, opcoes = {}) {
    const t0 = Date.now();
    const hist = historico || [];
    const manifestoAtual = opcoes.manifestoAtual;
    const aplicarEdicaoReal = opcoes.aplicarEdicaoReal;
    if (!manifestoAtual || typeof manifestoAtual !== 'object') {
        throw new Error('[TEMPLATE-EDIT-AGENT] opcoes.manifestoAtual é obrigatório.');
    }
    if (typeof aplicarEdicaoReal !== 'function') {
        throw new Error('[TEMPLATE-EDIT-AGENT] opcoes.aplicarEdicaoReal é obrigatório.');
    }
    const onProgress = typeof opcoes.onProgress === 'function'
        ? (evento) => { try {
            opcoes.onProgress(evento);
        }
        catch (e) { /* progresso é cosmético */ } }
        : () => { };
    const key = process.env.GEMINI_API_KEY;
    if (!key)
        throw new Error('[TEMPLATE-EDIT-AGENT] GEMINI_API_KEY não configurada.');
    const { executar, estado } = criarExecutorDeFerramentas(manifestoAtual, opcoes.propostaPendente || null, aplicarEdicaoReal);
    const contextoPendente = estado.propostaAtual
        ? `\n\nProposta de edição pendente de confirmação nesta sessão: "${estado.propostaAtual.resumo}".`
        : '\n\nNenhuma proposta de edição pendente no momento.';
    const budget = new TokenBudget(opcoes.budgetTokens || BUDGET_TOKENS);
    let tokensInput = 0;
    let tokensOutput = 0;
    const trackUsage = (usageMetadata) => {
        tokensInput += usageMetadata?.promptTokenCount ?? 0;
        tokensOutput += usageMetadata?.candidatesTokenCount ?? 0;
        budget.track(usageMetadata?.totalTokenCount ?? 0);
    };
    const genAI = new GoogleGenAI({ apiKey: key });
    const chat = genAI.chats.create({
        model: MODEL_NAME,
        config: {
            tools: [TEMPLATE_EDIT_TOOL_DECLARATIONS],
            temperature: opcoes.temperature ?? 0.2,
            maxOutputTokens: opcoes.maxOutputTokens ?? 1024,
            safetySettings: SAFETY_SETTINGS,
            systemInstruction: SYSTEM_PROMPT + contextoPendente,
        },
        history: hist.map(m => ({
            role: m.role === 'assistant' ? 'model' : m.role,
            parts: [{ text: m.content }],
        })),
    });
    let iteracoes = 0;
    let respostaFinal = null;
    let engajou = false;
    while (iteracoes <= MAX_TOOL_CALLS) {
        iteracoes++;
        const msgParaEnviar = iteracoes === 1
            ? mensagem
            : '[sistema] Continue com base nos resultados das ferramentas.';
        const response = await chat.sendMessage({ message: msgParaEnviar });
        trackUsage(response.usageMetadata);
        const candidate = response.candidates?.[0];
        if (!candidate) {
            respostaFinal = '';
            break;
        }
        const parts = candidate.content?.parts || [];
        const toolCallParts = parts.filter(p => p.functionCall);
        const textParts = parts.filter(p => p.text);
        if (toolCallParts.length === 0) {
            respostaFinal = textParts.map(p => p.text).join('');
            break;
        }
        engajou = true;
        if (budget.isExhausted()) {
            respostaFinal = 'Essa alteração ficou complexa demais pra eu resolver numa mensagem — tente pedir de um jeito mais direto.';
            break;
        }
        toolCallParts.forEach(part => {
            onProgress({ type: 'status', label: _labelParaFerramentaEdicao(part.functionCall.name) });
        });
        const toolResults = [];
        for (const part of toolCallParts) {
            const resultadoFerramenta = await executar(part.functionCall.name, part.functionCall.args);
            toolResults.push({ functionResponse: { name: part.functionCall.name, response: resultadoFerramenta } });
        }
        // SDK nova recusa array cru de parts functionResponse — precisa vir
        // envolvido num Content explícito ({role,parts}).
        const toolResult = await chat.sendMessage({ message: [{ role: 'user', parts: toolResults }] });
        trackUsage(toolResult.usageMetadata);
        const toolResponseParts = toolResult.candidates?.[0]?.content?.parts || [];
        const finalTextParts = toolResponseParts.filter(p => p.text && !p.functionCall);
        if (finalTextParts.length > 0) {
            respostaFinal = finalTextParts.map(p => p.text).join('');
            break;
        }
        const maisToolCalls = toolResponseParts.filter(p => p.functionCall);
        if (maisToolCalls.length === 0) {
            respostaFinal = toolResponseParts.map(p => p.text || '').join('') || 'Prontinho.';
            break;
        }
        // senão, o loop continua pro próximo ciclo (mesmo padrão de solAgent.js)
    }
    if (respostaFinal === null) {
        respostaFinal = engajou
            ? 'Não consegui concluir essa alteração agora — pode tentar de novo?'
            : '';
    }
    const ms = Date.now() - t0;
    console.warn(`[TEMPLATE-EDIT-AGENT] OK | ${ms}ms | iteracoes=${iteracoes} | engajou=${engajou} | tokens=${tokensInput + tokensOutput} | aplicou=${!!estado.downloadUrlAplicado}`);
    return {
        resposta: respostaFinal,
        engajou,
        propostaFinal: estado.propostaAtual,
        downloadUrl: estado.downloadUrlAplicado,
        xmlPath: estado.xmlPathAplicado,
        gcPath: estado.gcPathAplicado,
        manifestoFinal: estado.manifestoFinalAplicado,
        tokens: { input: tokensInput, output: tokensOutput, total: tokensInput + tokensOutput },
        iteracoes,
        ms,
    };
}
module.exports = {
    processarEdicaoAgentica,
    criarExecutorDeFerramentas, // exportado só pra teste unitário
    _labelParaFerramentaEdicao,
    _extrairBlocosScript, // exportado só pra teste unitário
    _validarCamposLivres, // exportado só pra teste unitário
    TEMPLATE_EDIT_TOOL_DECLARATIONS,
};

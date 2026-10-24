'use strict';

// ============================================================
// GEMINI SERVICE — Camada de acesso à API Google Generative AI
// ============================================================
// Centraliza autenticação, geração de texto, JSON estruturado
// e chat conversacional com histórico.
//
// MONITORAMENTO (/workers > Error Log):
//   - Toda falha da API é logada via console.error com tag [GEMINI]
//   - Toda chamada bem-sucedida é logada via console.warn com tag [GEMINI]
//   - Chamadas lentas (>6s) recebem aviso adicional "LENTO"
//   - O errorLogWorker intercepta console.error e console.warn automaticamente
//   - Em /workers, clique no chip "GEMINI" para filtrar só atividade da IA
//
// FLUXO DE ERRO:
//   gerarChat() → throw → marcarErroGemini() → console.error + throw [GEMINI]
//   A rota que chamou a função deve ter seu próprio catch para logar contexto
//   adicional ([CHAT-IA], [BLOGGER-AI], etc.)
// ============================================================

const { GoogleGenAI, HarmCategory, HarmBlockThreshold } = require('@google/genai');
const { GEMINI_PECA_RESPONSE_SCHEMA, validarPeca } = require('../ai/pecaRequestSchema');
const { padroesVisuaisParaPrompt } = require('../rag/design-rules/padroesVisuais');

// Dois modelos com papéis distintos:
// FLASH  → conversação e streaming (chat + compilador) — mais capaz
// LITE   → geração de JSON estruturado — mais rápido e barato
const MODEL_FLASH = process.env.GEMINI_FLASH_MODEL || 'gemini-2.5-flash';
const MODEL_LITE  = process.env.GEMINI_LITE_MODEL  || 'gemini-2.5-flash-lite';

// Singleton do cliente — reutiliza a mesma instância durante toda a vida do processo.
// Inicializado na primeira chamada para não falhar no boot se a chave estiver ausente.
let _genAI = null;

// BLOCK_ONLY_HIGH em todas as categorias: evita que jargão técnico legítimo (ex: "exploit",
// "injeção SQL", "ataque XSS" em contexto de suporte) dispare o filtro padrão BLOCK_MEDIUM_AND_ABOVE.
const SAFETY_SETTINGS = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
];

function getClient() {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('[GEMINI] GEMINI_API_KEY não configurada no ambiente.');
    if (!_genAI) _genAI = new GoogleGenAI({ apiKey: key });
    return _genAI;
}

// ──────────────────────────────────────────────────────────────────────────
// marcarErroGemini — Loga e re-lança erros com tag padronizada [GEMINI].
//
// Por que logamos AQUI e não só no catch da rota?
//   O catch da rota recebe o erro já wrappado ([GEMINI] ...). Sem este log,
//   o HTTP status original do SDK (429, 503, 404) e a causa encadeada seriam
//   perdidos. Este log preserva todos os detalhes técnicos da camada de SDK.
//
// `contexto` exemplo: "gerarChat 823ms hist=4"
//   → aparece em /workers como: [GEMINI] 429 Too Many Requests — gerarChat 823ms hist=4 | HTTP 429
// ──────────────────────────────────────────────────────────────────────────
function marcarErroGemini(err, contexto) {
    const msg = err && err.message ? err.message : 'Erro desconhecido na IA';

    // Status HTTP do SDK: 429=quota excedida, 503=indisponível, 404=modelo não encontrado
    const httpStatus = err?.status || err?.statusCode || '';

    // Causa encadeada — preserva a mensagem original antes do wrapping
    const causa = err?.cause?.message || '';

    const partes  = [contexto, httpStatus && `HTTP ${httpStatus}`, causa && `causa: ${causa}`].filter(Boolean);
    const sufixo  = partes.length ? ' — ' + partes.join(' | ') : '';

    if (msg.startsWith('[GEMINI]')) {
        // Erro já tem tag (ex: parse error de JSON) — loga com contexto e relança
        console.error(`${msg}${sufixo}`);
        throw err;
    }

    // Loga com tag [GEMINI] completa e cria novo Error padronizado para os callers
    console.error(`[GEMINI] ${msg}${sufixo}`);
    const e = new Error(`[GEMINI] ${msg}`);
    e.cause = err;
    throw e;
}

// ──────────────────────────────────────────────────────────────────────────
// checarFinishReason — Inspeciona por que o modelo parou de gerar.
//
// finishReason esperado: 'STOP' (geração completa e normal).
// SAFETY    → conteúdo bloqueado — lança erro imediatamente (não deve chamar .text()).
// MAX_TOKENS → resposta truncada — fatal para JSON; aceitável para texto/chat.
// Outros    → loga aviso mas não bloqueia (ex: RECITATION).
//
// Retorna { truncado: boolean } — o caller decide se retorna parcialmente ou aborta.
// ──────────────────────────────────────────────────────────────────────────
function checarFinishReason(response, contexto) {
    const candidates = response.candidates || [];
    if (candidates.length === 0) return { truncado: false };

    const reason = candidates[0].finishReason;
    if (!reason || reason === 'STOP') return { truncado: false };

    if (reason === 'SAFETY') {
        const e = new Error(`[GEMINI] Resposta bloqueada pelo filtro de segurança — ${contexto}`);
        console.error(e.message);
        throw e;
    }

    if (reason === 'MAX_TOKENS') {
        console.warn(`[GEMINI] Resposta truncada (MAX_TOKENS) — ${contexto}`);
        return { truncado: true };
    }

    // RECITATION, OTHER, etc.
    console.warn(`[GEMINI] finishReason inesperado "${reason}" — ${contexto}`);
    return { truncado: false };
}

// ──────────────────────────────────────────────────────────────────────────
// gerarTexto — Geração simples de texto (sem JSON, sem histórico).
// Usado raramente — prefira gerarChat para qualquer diálogo.
// ──────────────────────────────────────────────────────────────────────────
async function gerarTexto(prompt) {
    const t0 = Date.now();
    try {
        const response = await getClient().models.generateContent({
            model:    MODEL_FLASH,
            contents: prompt,
            config:   { safetySettings: SAFETY_SETTINGS },
        });

        checarFinishReason(response, 'gerarTexto');

        const texto  = response.text;
        const ms     = Date.now() - t0;
        const tokens = response.usageMetadata?.totalTokenCount ?? '?';

        console.warn(`[GEMINI] gerarTexto OK: ${ms}ms | tokens=${tokens} | resposta=${texto.length}c`);
        return texto;
    } catch (err) {
        marcarErroGemini(err, `gerarTexto ${Date.now() - t0}ms`);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// gerarJson — Geração de JSON estruturado via responseMimeType.
// SDK 0.24.x+ suporta responseMimeType:'application/json' — o modelo retorna
// JSON puro sem markdown fencing. Use quando precisar de dados parseáveis.
//
// opcoes.maxOutputTokens: limita tokens de saída para controle de cota.
//   Ex: { maxOutputTokens: 200 } para seleção de preset com 4 campos.
//
// MAX_TOKENS é fatal para JSON (JSON truncado não é parseável) — lança erro.
// ──────────────────────────────────────────────────────────────────────────
async function gerarJson(prompt, sistemaPrompt, opcoes = {}) {
    const t0 = Date.now();
    try {
        const config = { responseMimeType: 'application/json', safetySettings: SAFETY_SETTINGS };
        if (opcoes.maxOutputTokens) config.maxOutputTokens = opcoes.maxOutputTokens;
        if (sistemaPrompt) config.systemInstruction = sistemaPrompt;

        const response = await getClient().models.generateContent({ model: MODEL_LITE, contents: prompt, config });

        // MAX_TOKENS é fatal para JSON — resposta truncada não é parseável
        const { truncado } = checarFinishReason(response, 'gerarJson');
        if (truncado) {
            const e = new Error('[GEMINI] JSON truncado por MAX_TOKENS — resposta incompleta não é parseável');
            console.error(e.message);
            throw e;
        }

        const text   = response.text;

        try {
            const parsed = JSON.parse(text);
            const ms     = Date.now() - t0;
            const tokens = response.usageMetadata?.totalTokenCount ?? '?';

            console.warn(`[GEMINI] gerarJson OK: ${ms}ms | tokens=${tokens} | resposta=${text.length}c`);
            return parsed;
        } catch (parseErr) {
            // Modelo não retornou JSON válido apesar do responseMimeType.
            // marcarErroGemini vai logar e relançar — aparece em /workers como [GEMINI].
            const e = new Error(`[GEMINI] Resposta não é JSON válido: ${text.substring(0, 120)}`);
            e.cause = parseErr;
            throw e;
        }
    } catch (err) {
        marcarErroGemini(err, `gerarJson ${Date.now() - t0}ms`);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// gerarChat — Chat conversacional com histórico de mensagens.
//
// historico: [{ role: 'user'|'assistant', content: string }]
//   Passado pelo frontend e validado na rota antes de chegar aqui.
//   'assistant' é mapeado para 'model' (formato exigido pelo SDK Gemini).
//
// opcoes.maxOutputTokens: limita tokens para respostas de suporte curtas.
//   Ex: { maxOutputTokens: 350 } no Chat IA de Suporte.
// opcoes.temperature: sobrescreve o padrão 0.3 (ex: 0.7 para respostas mais criativas).
//
// MAX_TOKENS em chat: retorna o texto parcial com aviso em vez de lançar —
//   uma resposta cortada é melhor que silêncio para o usuário.
//
// IMPORTANTE: esta função é usada pelo Chat IA de Suporte (/dashboard/chat).
// ──────────────────────────────────────────────────────────────────────────
async function gerarChat(historico, mensagem, sistemaPrompt, opcoes = {}) {
    const t0   = Date.now();
    const hist = historico || [];
    try {
        // temperature 0.3: respostas técnicas consistentes e menos "criativas".
        // Valor mais baixo que o padrão (1.0) reduz alucinações em suporte técnico.
        const config = { temperature: opcoes.temperature ?? 0.3, safetySettings: SAFETY_SETTINGS };
        if (opcoes.maxOutputTokens) config.maxOutputTokens = opcoes.maxOutputTokens;
        if (sistemaPrompt) config.systemInstruction = sistemaPrompt;

        const chat = getClient().chats.create({
            model: MODEL_FLASH,
            config,
            // Mapeia role 'assistant' → 'model' (exigido pelo SDK do Gemini)
            history: hist.map(m => ({
                role: m.role === 'assistant' ? 'model' : m.role,
                parts: [{ text: m.content }],
            })),
        });

        const response = await chat.sendMessage({ message: mensagem });

        // MAX_TOKENS em chat: retorna parcialmente — resposta cortada é melhor que silêncio
        checarFinishReason(response, `gerarChat hist=${hist.length}`);

        const texto  = response.text;
        const ms     = Date.now() - t0;
        const tokens = response.usageMetadata?.totalTokenCount ?? '?';

        // Log de sucesso — aparece em /workers com chip "GEMINI" em Top Fontes.
        // Inclui aviso LENTO para chamadas que possam ter causado timeout no usuário.
        const aviso = ms > 6000 ? ' ⚠️ LENTO' : '';
        console.warn(`[GEMINI] gerarChat OK: ${ms}ms${aviso} | tokens=${tokens} | hist=${hist.length} msgs | resposta=${texto.length}c`);
        return texto;
    } catch (err) {
        marcarErroGemini(err, `gerarChat ${Date.now() - t0}ms hist=${hist.length}`);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// gerarChatStream — Versão streaming de gerarChat. Async generator.
//
// Cede cada chunk de texto à medida que o Gemini o gera.
// O caller itera com `for await (const chunk of gerarChatStream(...))` e
// escreve cada chunk para SSE imediatamente.
//
// MAX_TOKENS em stream: retorna o texto parcial gerado até o corte —
// melhor que silêncio total ao utilizador.
// ──────────────────────────────────────────────────────────────────────────
async function* gerarChatStream(historico, mensagem, sistemaPrompt, opcoes = {}) {
    const t0   = Date.now();
    const hist = historico || [];
    try {
        const config = { temperature: opcoes.temperature ?? 0.3, safetySettings: SAFETY_SETTINGS };
        if (opcoes.maxOutputTokens) config.maxOutputTokens = opcoes.maxOutputTokens;
        if (sistemaPrompt) config.systemInstruction = sistemaPrompt;

        const chat = getClient().chats.create({
            model: MODEL_FLASH,
            config,
            history: hist.map(m => ({
                role:  m.role === 'assistant' ? 'model' : m.role,
                parts: [{ text: m.content }],
            })),
        });

        const stream = await chat.sendMessageStream({ message: mensagem });

        // usageMetadata só vem completo no(s) último(s) chunk(s) do stream —
        // não existe mais um "result.response" agregado à parte na SDK nova.
        let lastChunkUsage = null;
        for await (const chunk of stream) {
            const text = chunk.text;
            if (text) yield text;
            if (chunk.usageMetadata) lastChunkUsage = chunk.usageMetadata;
        }

        const usage      = lastChunkUsage || {};
        const ms         = Date.now() - t0;
        const totalTok   = usage.totalTokenCount        ?? 0;
        const inputTok   = usage.promptTokenCount       ?? 0;
        const outputTok  = usage.candidatesTokenCount   ?? 0;
        const aviso      = ms > 6000 ? ' ⚠️ LENTO' : '';
        console.warn(`[GEMINI] gerarChatStream OK: ${ms}ms${aviso} | tokens=${totalTok} (in=${inputTok} out=${outputTok}) | hist=${hist.length} msgs`);

        // Popula ref externa se o caller quiser os dados de uso
        if (opcoes.tokensRef) {
            opcoes.tokensRef.total  = totalTok;
            opcoes.tokensRef.input  = inputTok;
            opcoes.tokensRef.output = outputTok;
        }

    } catch (err) {
        marcarErroGemini(err, `gerarChatStream ${Date.now() - t0}ms hist=${hist.length}`);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// gerarPeca — gera UMA peça de dossiê (hero/widget/modulo) sob demanda, pra
// pecaOrchestrator.js (RAG Agent de peças). Chamado só quando a peça pedida
// NÃO existe no dossiê do nicho nem na biblioteca RAG cross-nicho — o
// orquestrador decide a sequência, esta função só gera conteúdo restrito
// pelo schema (mesmo padrão de responseSchema fechado usado em toda geração
// restrita do projeto — ver src/ai/templateEditSchema.js/pecaRequestSchema.js).
//
// `erroAnterior` (opcional): quando o orquestrador reprova a peça anterior
// nos workers determinísticos (cssWorker/jsWorker/htmlWorker), ele chama de
// novo com o erro concreto no prompt — mesmo padrão de retry-com-correção já
// usado em chatCodeValidator._validarECorrigir.
// ──────────────────────────────────────────────────────────────────────────
const PECA_SYSTEM_PROMPT = `Você gera UMA peça de dossiê (hero, widget ou modulo) pro compilador determinístico do Softload Engine, pra sites Blogger com Bootstrap 5.
Regras técnicas obrigatórias:
- CSS: use apenas variáveis CSS que você mesmo declarar no próprio css da peça, OU as variáveis de tokensCss do nicho informadas no pedido — nunca invente var(--x) sem declarar --x em algum lugar.
- JS: nunca declare identificador global (const/let/function/class no escopo de topo) com nome genérico que provavelmente colide com outro script da página (ex: "init", "handleClick") — prefixe com algo específico da peça.
- HTML: todo id usado no html deve aparecer em domIds.
- tipo "modulo": não tem html próprio (string vazia) — só css/js que afeta elemento já existente no chassis.

Padrões visuais comprovados (extraídos de comparação real entre templates hand-built e a saída do compilador — use como referência de acabamento, não como obrigação rígida pra toda peça):
${padroesVisuaisParaPrompt()}

Devolva APENAS o JSON conforme o schema.`;

async function gerarPeca(especificacao, opcoes = {}) {
    const t0 = Date.now();

    try {
        const partes = [
            `Especificação da peça pedida: ${especificacao.pedido}`,
            `Nicho: ${especificacao.nichoTema || 'genérico'}`,
        ];
        if (especificacao.tokensCss) {
            partes.push(`Tokens CSS disponíveis no nicho (use var() com estes, não invente novos): ${JSON.stringify(especificacao.tokensCss)}`);
        }
        if (opcoes.erroAnterior) {
            partes.push(`ATENÇÃO: a tentativa anterior falhou na validação determinística com este erro — corrija: ${opcoes.erroAnterior}`);
        }
        const prompt = partes.join('\n\n');

        const config = {
            responseMimeType:  'application/json',
            responseSchema:    GEMINI_PECA_RESPONSE_SCHEMA,
            temperature:       0,
            maxOutputTokens:   opcoes.maxOutputTokens || 2048,
            safetySettings:    SAFETY_SETTINGS,
            systemInstruction: PECA_SYSTEM_PROMPT,
        };

        const response = await getClient().models.generateContent({ model: MODEL_LITE, contents: prompt, config });

        const { truncado } = checarFinishReason(response, 'gerarPeca');
        if (truncado) {
            throw new Error('[GEMINI] Peça truncada por MAX_TOKENS — JSON incompleto.');
        }

        const text = response.text;
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch (parseErr) {
            const e = new Error(`[GEMINI] Peça não é JSON válido: ${text.substring(0, 120)}`);
            e.cause = parseErr;
            throw e;
        }

        const { valido, erros, peca } = validarPeca(parsed);

        const ms     = Date.now() - t0;
        const tokens = {
            total:  response.usageMetadata?.totalTokenCount     ?? 0,
            input:  response.usageMetadata?.promptTokenCount    ?? 0,
            output: response.usageMetadata?.candidatesTokenCount ?? 0,
        };
        const aviso = ms > 6000 ? ' ⚠️ LENTO' : '';
        console.warn(`[GEMINI] gerarPeca ${valido ? 'OK' : 'INVÁLIDA'}: ${ms}ms${aviso} | tokens=${tokens.total}${erros.length ? ` | ${erros.length} aviso(s): ${erros.join(' | ')}` : ''}`);

        return { valido, erros, peca, tokens };

    } catch (err) {
        marcarErroGemini(err, `gerarPeca ${Date.now() - t0}ms`);
    }
}

module.exports = { gerarTexto, gerarJson, gerarChat, gerarChatStream, gerarPeca };

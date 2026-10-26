import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Part, Content, GenerateContentResponse } from '@google/genai';
interface RagModelChat { sendMessage(input: { message: string | Content[] }): Promise<GenerateContentResponse> }
interface RagModelConfig {
    tools: typeof RAG_TOOL_DECLARATIONS[]; temperature: number; maxOutputTokens: number;
    safetySettings: { category: string; threshold: string }[]; systemInstruction?: string;
}
// Preserve the payload accepted by the existing agent transport, including
// lowercase JSON-schema types and wrapped function-response Content objects.
const { GoogleGenAI, HarmCategory, HarmBlockThreshold } = require('@google/genai') as {
    GoogleGenAI: new (options: { apiKey: string }) => { chats: { create(options: {
        model: string; config: RagModelConfig; history: Content[];
    }): RagModelChat } };
    HarmCategory: Record<string, string>; HarmBlockThreshold: Record<string, string>;
};
export interface RagChatMessage { role: string; content: string }
export interface RagChatOptions { budgetTokens?: number; temperature?: number; maxOutputTokens?: number }
export type SchemaValidation = { valid: true; campos: number } | { valid: false; erros: string[] };
type RagToolArgs = { pasta?: string; arquivo?: string; schema_json?: string };
'use strict';

// ============================================================
// RAG AGENT — Agentic RAG com function calling (Gemini Tools)
// ============================================================
//
// STATUS: reservado, não conectado a nenhuma rota hoje (sem chamador em
// src/). Não é código órfão — é a base de tool-calling planejada para o
// "Softload Assistant": um modelo local (3-7B), especialista em Blogger/
// Bootstrap/CSS/JS/SEO/Adsense/Compiler Softload via RAG + contexto do
// workspace, atuando como orquestrador de workers (Validator, SEO,
// Performance, Accessibility, Compiler, Deploy...) dentro do Workspace —
// não um chat genérico, um gerente de agentes. Este arquivo já resolve a
// mecânica de tool-calling (rag_load_index/rag_load_file/validate_schema);
// falta plugar um modelo local + os workers como tools reais.
//
// DIFERENÇA DO ragLoader.js (RAG passivo):
//   ragLoader: Claude/rota decide o que carregar → injeta no prompt
//   ragAgent:  O Gemini decide o que carregar → chama ferramentas em runtime
//
// FLUXO AGÊNTICO:
//   1. Gemini recebe mensagem + lista de tools disponíveis
//   2. Gemini chama rag_load_index("pipeline/temas") → recebe o índice
//   3. Gemini escolhe: "preciso do tema-viral-magazine.json"
//   4. Gemini chama rag_load_file("pipeline/temas/tema-viral-magazine.json")
//   5. Gemini valida compatibilidade com validate_schema({...})
//   6. Gemini emite resposta final com o compile command
//
// CONTROLO DE ORÇAMENTO:
//   TokenBudget rastreia tokens por chamada e bloqueia se exceder o limite.
//   Max tool calls por sessão: 8 (evita loops infinitos).
//   Timeout por iteração: não implementado aqui — responsabilidade da rota.
//
// PREPARAÇÃO PARA PRODUÇÃO:
//   agenticChat() tem a mesma assinatura que gerarChat() do geminiService.
//   Para activar nas rotas: substituir gerarChat() por ragAgent.agenticChat().
//   Feature flag: RAG_AGENT_ENABLED=true no .env
// ============================================================





const RAG_ROOT      = path.join(__dirname);
const MODEL_NAME    = process.env.GEMINI_FLASH_MODEL || process.env.GEMINI_MODEL_NAME || 'gemini-2.5-flash';
const MAX_TOOL_CALLS = 8;
const BUDGET_TOKENS  = parseInt(process.env.RAG_AGENT_BUDGET || '10000', 10);

// ──────────────────────────────────────────────────────────────────────────
// SAFETY SETTINGS — idêntico ao geminiService.js
// ──────────────────────────────────────────────────────────────────────────
const SAFETY_SETTINGS = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
];

// ──────────────────────────────────────────────────────────────────────────
// DECLARAÇÕES DE FERRAMENTAS — o Gemini vê estas descrições e decide quando
// chamar cada função. A precisão da descrição determina a qualidade da decisão.
// ──────────────────────────────────────────────────────────────────────────
export const RAG_TOOL_DECLARATIONS = {
    functionDeclarations: [
        {
            name: 'rag_load_index',
            description: [
                'Carrega o index.json de uma subpasta RAG para descobrir quais ficheiros estão disponíveis.',
                'Usa ANTES de rag_load_file para saber o que existe e qual ficheiro é mais relevante.',
                'Pastas disponíveis (compiler): rag-ia-compiler/pipeline/instrucoes | rag-ia-compiler/pipeline/engenharia | rag-ia-compiler/pipeline/temas | rag-ia-compiler/pipeline/widgets',
                'Pastas disponíveis (suporte): rag-ia-suporte/suporte | rag-ia-suporte/ia-de-balcao',
            ].join(' '),
            parameters: {
                type: 'object',
                properties: {
                    pasta: {
                        type: 'string',
                        description: 'Caminho relativo ao src/rag/. Compiler: rag-ia-compiler/pipeline/instrucoes, rag-ia-compiler/pipeline/engenharia, rag-ia-compiler/pipeline/temas, rag-ia-compiler/pipeline/widgets. Suporte: rag-ia-suporte/suporte, rag-ia-suporte/ia-de-balcao',
                    },
                },
                required: ['pasta'],
            },
        },
        {
            name: 'rag_load_file',
            description: [
                'Carrega o conteúdo completo de um ficheiro RAG específico.',
                'Use depois de consultar o index para confirmar qual ficheiro é relevante.',
                'Exemplo compiler: rag_load_file("rag-ia-compiler/pipeline/temas/tema-viral-magazine.json")',
                'Exemplo suporte: rag_load_file("rag-ia-suporte/suporte/ia-balcao-suporte-dominio-https.json")',
                'Máximo 4 chamadas por sessão para controlar orçamento de tokens.',
            ].join(' '),
            parameters: {
                type: 'object',
                properties: {
                    arquivo: {
                        type: 'string',
                        description: 'Caminho relativo ao diretório src/rag/ (ex: pipeline/temas/tema-viral-magazine.json)',
                    },
                },
                required: ['arquivo'],
            },
        },
        {
            name: 'validate_schema',
            description: [
                'Valida se o JSON do template tem todos os 15 campos obrigatórios com valores permitidos.',
                'Chama OBRIGATORIAMENTE antes de emitir o comando softload-worker compile.',
                'Retorna lista de erros ou { valid: true } se tudo está correto.',
            ].join(' '),
            parameters: {
                type: 'object',
                properties: {
                    schema_json: {
                        type: 'string',
                        description: 'O JSON do template serializado como string',
                    },
                },
                required: ['schema_json'],
            },
        },
        {
            name: 'check_token_budget',
            description: 'Verifica quantos tokens restam no orçamento desta sessão antes de carregar mais contexto.',
            parameters: {
                type: 'object',
                properties: {},
            },
        },
    ],
};

// ──────────────────────────────────────────────────────────────────────────
// TOKEN BUDGET — rastreia consumo e bloqueia se exceder o limite
// ──────────────────────────────────────────────────────────────────────────
export class TokenBudget {
    max: number;
    maxToolCalls: number;
    used: number;
    toolCalls: number;
    filesLoaded: string[];
    log: { label: string; tokens: number; total: number }[];
    // `maxToolCalls` é opcional e default pro MAX_TOOL_CALLS deste módulo —
    // preserva o comportamento de sempre pra quem não passa (ragAgent.js e
    // templateEditAgent.js, cujo próprio limite de 5 já fica abaixo de 8
    // mesmo). Existe pra permitir que outro agente (ex: solAgent.js) use seu
    // PRÓPRIO limite de tool calls sem ficar preso ao valor deste módulo —
    // antes disso, qualquer agente que importasse TokenBudget tinha o
    // isExhausted()/canLoadFile() travando em MAX_TOOL_CALLS=8 daqui,
    // mesmo que o próprio loop do agente permitisse mais (bug real: Sol
    // configurava MAX_TOOL_CALLS=10 no próprio arquivo, mas na prática
    // sempre parava em 8 por causa desse acoplamento escondido).
    constructor(max = BUDGET_TOKENS, maxToolCalls = MAX_TOOL_CALLS) {
        this.max          = max;
        this.maxToolCalls = maxToolCalls;
        this.used         = 0;
        this.toolCalls    = 0;
        this.filesLoaded  = [];
        this.log          = [];
    }

    track(tokens: number, label = '') {
        this.used += tokens;
        if (label) this.log.push({ label, tokens, total: this.used });
        return this;
    }

    remaining() {
        return Math.max(0, this.max - this.used);
    }

    percentUsed() {
        return ((this.used / this.max) * 100).toFixed(1);
    }

    isExhausted() {
        return this.used >= this.max || this.toolCalls >= this.maxToolCalls;
    }

    canLoadFile() {
        // Estimativa conservadora: um ficheiro RAG médio usa ~800 tokens
        return this.remaining() >= 800 && this.toolCalls < this.maxToolCalls;
    }

    summary() {
        return {
            tokensUsados:      this.used,
            tokensMaximos:     this.max,
            tokensPorcentagem: this.percentUsed() + '%',
            tokensRestantes:   this.remaining(),
            toolCallsTotal:    this.toolCalls,
            toolCallsMaximos:  this.maxToolCalls,
            ficheirosCarregados: this.filesLoaded,
        };
    }
}

// ──────────────────────────────────────────────────────────────────────────
// SCHEMA VALIDATOR — valida o JSON do template antes de compilar
// ──────────────────────────────────────────────────────────────────────────
const SCHEMA_VALID_VALUES = {
    headerStyle:    ['sticky', 'transparent-scroll', 'default'],
    menuType:       ['simple', 'mega-menu', 'offcanvas'],
    sidebarPosition:['right', 'left', 'none'],
    heroSection:    ['carousel', 'grid-mosaic', 'static-banner', 'none'],
    gridLayout:     ['lista', 'dupla', 'revista', 'quadrado', 'mural'],
    paginationStyle:['ajax-load-more', 'infinite-scroll', 'classic-numbers'],
    commentSystem:  ['blogger-native'],
    colorPreset:    ['tech-blue', 'neon-orange', 'midnight-purple', 'rose-gold', 'gamer-dark', 'warm-amber', 'carbon-dark', 'luxury-purple', 'forest-green'],
    darkMode:       ['disabled', 'toggle-btn', 'auto-system'],
    typography:     ['inter', 'roboto-slab', 'playfair', 'space-grotesk', 'oswald', 'pt-sans'],
    elementRadius:  ['rounded', 'square'],
    footerStyle:    ['simple-copyright', 'advanced-3-cols', 'newsletter-integrated'],
};

const VALID_POST_MODULES   = ['author-box', 'floating-share', 'related-posts', 'reading-time'];
const VALID_CORE_FEATURES  = ['seo-premium', 'lazy-load', 'minify-assets', 'anti-copy'];
const REQUIRED_FIELDS      = Object.keys(SCHEMA_VALID_VALUES).concat(['siteName', 'postModules', 'adSlots', 'coreFeatures']);

export function validateTemplateSchema(jsonString: string): SchemaValidation {
    let obj: Record<string, unknown>;
    try {
        obj = JSON.parse(jsonString);
    } catch (e) {
        return { valid: false, erros: ['JSON inválido: ' + (e as Error).message] };
    }

    const erros = [];

    // Campos obrigatórios
    for (const campo of REQUIRED_FIELDS) {
        if (obj[campo] === undefined || obj[campo] === null) {
            erros.push(`Campo obrigatório ausente: ${campo}`);
        }
    }

    // Valores permitidos para enums
    for (const [campo, valores] of Object.entries(SCHEMA_VALID_VALUES)) {
        if (obj[campo] !== undefined && !valores.includes(obj[campo] as string)) {
            erros.push(`${campo}: "${obj[campo]}" não é permitido. Valores: ${valores.join(', ')}`);
        }
    }

    // Arrays
    if (obj.postModules !== undefined) {
        if (!Array.isArray(obj.postModules)) {
            erros.push('postModules deve ser um array');
        } else {
            const invalidos = obj.postModules.filter(m => !VALID_POST_MODULES.includes(m));
            if (invalidos.length) erros.push(`postModules: valores inválidos: ${invalidos.join(', ')}`);
        }
    }
    if (obj.coreFeatures !== undefined) {
        if (!Array.isArray(obj.coreFeatures)) {
            erros.push('coreFeatures deve ser um array');
        } else {
            const invalidos = obj.coreFeatures.filter(f => !VALID_CORE_FEATURES.includes(f));
            if (invalidos.length) erros.push(`coreFeatures: valores inválidos: ${invalidos.join(', ')}`);
        }
    }

    if (typeof obj.adSlots !== 'boolean') {
        erros.push('adSlots deve ser boolean (true ou false)');
    }
    if (typeof obj.siteName !== 'string' || obj.siteName.trim().length < 2) {
        erros.push('siteName: string obrigatória com mínimo 2 caracteres');
    }

    return erros.length === 0
        ? { valid: true, campos: Object.keys(obj).length }
        : { valid: false, erros };
}

// ──────────────────────────────────────────────────────────────────────────
// EXECUTOR DE FERRAMENTAS — recebe a tool call do Gemini e executa
// ──────────────────────────────────────────────────────────────────────────
function executeRagTool(name: string | undefined, args: RagToolArgs, budget: TokenBudget) {
    budget.toolCalls++;

    switch (name) {

        case 'rag_load_index': {
            const pasta = (args.pasta || '').replace(/\.\./g, ''); // path traversal guard
            const indexPath = path.join(RAG_ROOT, pasta, 'index.json');

            if (!indexPath.startsWith(RAG_ROOT)) {
                return { erro: 'Acesso negado: pasta fora do RAG_ROOT' };
            }

            try {
                const conteudo = fs.readFileSync(indexPath, 'utf-8');
                const index    = JSON.parse(conteudo);
                const tokens   = Math.ceil(conteudo.length / 4);
                budget.track(tokens, `index:${pasta}`);

                console.warn(`[RAG-AGENT] rag_load_index: ${pasta} | ${tokens} tokens estimados`);
                return { index, pasta, tokensEstimados: tokens, orcamentoRestante: budget.remaining() };
            } catch (e) {
                return { erro: `index.json não encontrado em "${pasta}": ${(e as Error).message}` };
            }
        }

        case 'rag_load_file': {
            const arquivo = (args.arquivo || '').replace(/\.\./g, '');
            const filePath = path.join(RAG_ROOT, arquivo);

            if (!filePath.startsWith(RAG_ROOT)) {
                return { erro: 'Acesso negado: arquivo fora do RAG_ROOT' };
            }

            if (!budget.canLoadFile()) {
                return {
                    erro: 'Orçamento de tokens insuficiente para carregar este ficheiro.',
                    orcamentoRestante: budget.remaining(),
                    toolCallsRestantes: MAX_TOOL_CALLS - budget.toolCalls,
                };
            }

            try {
                const conteudo = fs.readFileSync(filePath, 'utf-8');
                const tokens   = Math.ceil(conteudo.length / 4);
                budget.track(tokens, `file:${arquivo}`);
                budget.filesLoaded.push(arquivo);

                console.warn(`[RAG-AGENT] rag_load_file: ${arquivo} | ${tokens} tokens | total usado: ${budget.used}`);
                return {
                    arquivo,
                    conteudo: JSON.parse(conteudo),
                    tokensUsados: tokens,
                    orcamentoRestante: budget.remaining(),
                };
            } catch (e) {
                return { erro: `Ficheiro não encontrado "${arquivo}": ${(e as Error).message}` };
            }
        }

        case 'validate_schema': {
            const result = validateTemplateSchema(args.schema_json || '{}');
            console.warn(`[RAG-AGENT] validate_schema: ${result.valid ? 'VÁLIDO' : 'INVÁLIDO — ' + result.erros.join('; ')}`);
            return result;
        }

        case 'check_token_budget': {
            return budget.summary();
        }

        default:
            return { erro: `Ferramenta desconhecida: ${name}` };
    }
}

// ──────────────────────────────────────────────────────────────────────────
// AGENTIC LOOP — loop principal de tool calling
//
// Assinatura idêntica a gerarChat() para fácil substituição:
//   gerarChat(historico, mensagem, systemPrompt, opcoes)
//   agenticChat(historico, mensagem, systemPrompt, opcoes)
//
// Retorna: { resposta, budget, iteracoes }
// ──────────────────────────────────────────────────────────────────────────
export async function agenticChat(historico: RagChatMessage[] | null | undefined, mensagem: string, systemPrompt?: string, opcoes: RagChatOptions = {}) {
    const t0     = Date.now();
    const hist   = historico || [];
    const budget = new TokenBudget(opcoes.budgetTokens || BUDGET_TOKENS);

    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('[GEMINI] GEMINI_API_KEY não configurada.');

    const genAI = new GoogleGenAI({ apiKey: key });

    const chat = genAI.chats.create({
        model: MODEL_NAME,
        config: {
            tools: [RAG_TOOL_DECLARATIONS],
            temperature:       opcoes.temperature ?? 0.3,
            maxOutputTokens:   opcoes.maxOutputTokens ?? 2000,
            safetySettings:    SAFETY_SETTINGS,
            systemInstruction: systemPrompt || undefined,
        },
        history: hist.map(m => ({
            role: m.role === 'assistant' ? 'model' : m.role,
            parts: [{ text: m.content }],
        })),
    });

    let iteracoes = 0;
    let respostaFinal = null;

    // Loop agêntico — máx iterações = MAX_TOOL_CALLS + 1 (última é a resposta)
    while (iteracoes <= MAX_TOOL_CALLS) {
        iteracoes++;

        const msgParaEnviar = iteracoes === 1
            ? mensagem
            : '[sistema] Continue com base nos resultados das ferramentas.';

        const response  = await chat.sendMessage({ message: msgParaEnviar });
        const candidate = response.candidates?.[0];

        if (!candidate) {
            respostaFinal = '[AGENTE] Sem resposta do modelo.';
            break;
        }

        const parts         = candidate.content?.parts || [];
        const toolCallParts = parts.filter((p): p is Part & { functionCall: NonNullable<Part['functionCall']> } => !!p.functionCall);
        const textParts     = parts.filter(p => p.text);

        // Se há texto E tool calls, o texto é parcial — esperar o loop de tool calls resolver
        if (toolCallParts.length === 0) {
            // Sem tool calls → resposta final
            respostaFinal = textParts.map(p => p.text).join('');
            const tokens  = response.usageMetadata?.totalTokenCount ?? 0;
            budget.track(tokens, 'resposta-final');
            break;
        }

        if (budget.isExhausted()) {
            respostaFinal = '[AGENTE] Orçamento de tokens esgotado. Por favor, reformule o pedido.';
            break;
        }

        // Executa todas as tool calls desta iteração
        const toolResults = toolCallParts.map(part => ({
            functionResponse: {
                name:     part.functionCall.name,
                response: executeRagTool(part.functionCall.name, (part.functionCall.args || {}) as RagToolArgs, budget),
            },
        }));

        // Envia resultados de volta para o Gemini — SDK nova recusa array
        // cru de parts functionResponse, precisa vir envolvido num Content
        // explícito ({role,parts}).
        const toolResult = await chat.sendMessage({ message: [{ role: 'user', parts: toolResults }] });
        const toolTokens = toolResult.usageMetadata?.totalTokenCount ?? 0;
        budget.track(toolTokens, `tool-response-${iteracoes}`);

        // Verifica se a resposta às tool calls já tem texto final
        const toolResponseParts = toolResult.candidates?.[0]?.content?.parts || [];
        const finalTextParts    = toolResponseParts.filter(p => p.text && !p.functionCall);

        if (finalTextParts.length > 0) {
            respostaFinal = finalTextParts.map(p => p.text).join('');
            break;
        }

        // Se ainda tem tool calls na resposta, o loop continua
        const maisToolCalls = toolResponseParts.filter(p => p.functionCall);
        if (maisToolCalls.length === 0) {
            respostaFinal = toolResponseParts.map(p => p.text || '').join('') || '[AGENTE] Processamento concluído.';
            break;
        }
    }

    const ms = Date.now() - t0;
    console.warn(
        `[RAG-AGENT] OK | ${ms}ms | iteracoes=${iteracoes} | ` +
        `tokens=${budget.used}/${budget.max} (${budget.percentUsed()}%) | ` +
        `files=${budget.filesLoaded.length}`
    );

    return {
        resposta:  respostaFinal || '[AGENTE] Sem resposta.',
        budget:    budget.summary(),
        iteracoes,
        ms,
    };
}

// ──────────────────────────────────────────────────────────────────────────
// WRAPPER COMPATÍVEL — drop-in replacement de gerarChat() para as rotas.
// Activa-se com RAG_AGENT_ENABLED=true no .env.
// Sem essa flag, a rota continua a usar gerarChat() da geminiService.js.
// ──────────────────────────────────────────────────────────────────────────
export async function agenticChatCompat(historico: RagChatMessage[] | null | undefined, mensagem: string, systemPrompt?: string, opcoes: RagChatOptions = {}) {
    const result = await agenticChat(historico, mensagem, systemPrompt, opcoes);
    // Devolve só a string de resposta para ser drop-in de gerarChat()
    return result.resposta;
}

export const isEnabled = () => process.env.RAG_AGENT_ENABLED === 'true';

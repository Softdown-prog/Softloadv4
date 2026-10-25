'use strict';
interface GptMessage { role: 'user' | 'assistant' | 'system'; content: string }
interface GptTokenUsage { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
interface GptChunk { choices: Array<{ delta?: { content?: string | null } }>; usage?: GptTokenUsage }
interface GptRequest {
    model: string; messages: GptMessage[]; stream: true;
    stream_options: { include_usage: true }; max_completion_tokens: number;
    temperature?: number;
}
interface GptApiClient {
    chat: { completions: { create(params: GptRequest): Promise<AsyncIterable<GptChunk>> } };
}
interface GptStreamOptions { maxOutputTokens?: number; tokensRef?: { input?: number; output?: number; total?: number } }
declare const require: (path: string) => unknown;
declare const module: { exports: unknown };
declare const process: { env: Record<string, string | undefined> };

const OpenAI = require('openai') as new (options: { apiKey: string }) => GptApiClient;

const MODEL_NAME = process.env.GPT_MODEL_NAME || 'gpt-5.4-nano';

// Modelos de raciocínio (o-series) não aceitam temperature nem max_tokens
const REASONING_MODELS = ['o1', 'o1-mini', 'o1-preview', 'o3', 'o3-mini', 'o4-mini'];
const isReasoningModel = REASONING_MODELS.some(m => MODEL_NAME.startsWith(m));

let _client: GptApiClient | null = null;
function getClient(): GptApiClient {
    if (!_client) {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) throw new Error('OPENAI_API_KEY não configurada');
        _client = new OpenAI({ apiKey });
    }
    return _client;
}

/**
 * Async generator — yields string chunks as they arrive from the OpenAI stream.
 * Mutates tokensRef with .input, .output, .total when the stream ends.
 * Interface-compatible with geminiService.gerarChatStream.
 */
async function* gerarChatGptStream(history: readonly GptMessage[], userMessage: string, systemPrompt: string, options: GptStreamOptions = {}): AsyncGenerator<string, void, unknown> {
    const { maxOutputTokens = 4096, tokensRef = {} } = options;
    const t0     = Date.now();
    const client = getClient();

    const messages: GptMessage[] = [
        { role: 'system', content: systemPrompt },
        ...history.map((m): GptMessage => ({
            role:    m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content,
        })),
        { role: 'user', content: userMessage },
    ];

    const reqParams: GptRequest = {
        model:          MODEL_NAME,
        messages,
        stream:         true,
        stream_options: { include_usage: true },
        // max_completion_tokens é o parâmetro correto nos modelos atuais
        // (max_tokens foi depreciado e causa 400 em modelos mais novos)
        max_completion_tokens: maxOutputTokens,
    };

    if (!isReasoningModel) {
        reqParams.temperature = 0.7;
    }

    const stream = await client.chat.completions.create(reqParams);

    for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) yield delta;

        if (chunk.usage) {
            tokensRef.input  = chunk.usage.prompt_tokens     || 0;
            tokensRef.output = chunk.usage.completion_tokens || 0;
            tokensRef.total  = chunk.usage.total_tokens      || 0;
        }
    }

    const ms = Date.now() - t0;
    console.warn(`[GPT] gerarChatGptStream OK: ${ms}ms | model=${MODEL_NAME} | tokens=${tokensRef.total} (in=${tokensRef.input} out=${tokensRef.output})`);
}

module.exports = { gerarChatGptStream };

export {};

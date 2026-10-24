/** Contratos para o serviço HTTP de embeddings do Solaris, sem rede em testes. */
export type EmbeddingsTaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';
export interface EmbeddingsHttpBody {
    error?: string;
    embeddings?: number[][];
    [key: string]: unknown;
}
export interface EmbeddingsHttpResponse {
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
}
export interface EmbeddingsHeaders {
    Authorization?: string | null;
    authorization?: string | null;
    get?(header: string): string | null;
}
export interface EmbeddingsHttpOptions {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
}
export type EmbeddingsFetch = (url: string, options: EmbeddingsHttpOptions) => Promise<EmbeddingsHttpResponse>;
export type EmbeddingsDelay = (ms: number) => Promise<void>;
export interface GerarEmbeddingsOptions {
    textos: string[];
    taskType?: EmbeddingsTaskType;
    fetchImpl?: EmbeddingsFetch;
    aguardar?: EmbeddingsDelay;
    obterTokenIdentidade?: (url: string) => Promise<string>;
}
export interface EmbeddingsConfig {
    url: string;
    segredo: string | null;
}
declare function require(name: string): unknown;

const { GoogleAuth } = require('google-auth-library') as {
    GoogleAuth: new () => {
        getIdTokenClient(audience: string): Promise<{
            getRequestHeaders(): Promise<EmbeddingsHeaders>;
        }>;
    };
};

// ============================================================
// CLIENTE HTTP DO SERVIÇO DE EMBEDDINGS (Embedings-python/server.py)
// ============================================================
// Fala com o serviço isolado de embeddings via HTTP -- mesmo padrão de
// acoplamento que agent/ já usa com sandbox-efemoro/ (serviço Cloud Run
// separado, credenciais próprias, chamado via HTTP com segredo
// compartilhado no header). Este módulo NÃO chama a API Gemini
// diretamente e NÃO sabe nada sobre Firestore -- só orquestra a
// chamada HTTP e o batching de textos já fatiados (ver ragChunker.js).
// ============================================================

// Mesmo teto de Embedings-python/server.py (MAX_TEXTS_PER_REQUEST) --
// duplicado aqui de propósito (o cliente não pode confiar que o
// serviço remoto sempre valida antes; fatiar em lotes menores do lado
// de cá evita mandar uma requisição que o serviço só rejeitaria).
export const MAX_TEXTOS_POR_REQUISICAO = 20;
const MAX_RETRIES = 3;
const TASK_TYPES_VALIDOS = new Set<EmbeddingsTaskType>(['RETRIEVAL_DOCUMENT', 'RETRIEVAL_QUERY']);
const googleAuth = new GoogleAuth();

export class ErroServicoEmbeddings extends Error {
    readonly retryable: boolean;

    constructor(message: string, { retryable = false }: { retryable?: boolean } = {}) {
        super(message);
        this.name = 'ErroServicoEmbeddings';
        this.retryable = retryable;
    }
}

function _config(): EmbeddingsConfig {
    const url = process.env.EMBEDDINGS_SERVICE_URL;
    if (!url) {
        throw new Error(
            'EMBEDDINGS_SERVICE_URL não configurada no ambiente -- defina a URL do serviço Cloud Run de embeddings (Embedings-python/).',
        );
    }
    return {
        url: url.replace(/\/+$/, ''),
        segredo: process.env.EMBEDDINGS_SHARED_SECRET || null,
    };
}

export function _lerAutorizacao(headers: EmbeddingsHeaders): string | null | undefined {
    return headers.Authorization
        || headers.authorization
        || (typeof headers.get === 'function' ? headers.get('authorization') : null);
}

async function _obterTokenIdentidade(url: string): Promise<string> {
    const audience = new URL(url).origin;
    const cliente = await googleAuth.getIdTokenClient(audience);
    const headers = await cliente.getRequestHeaders();
    const authorization = _lerAutorizacao(headers);
    if (!authorization) {
        throw new Error('Não foi possível obter um ID token para o serviço de embeddings');
    }
    return authorization;
}

async function _chamarComRetry(fetchImpl: EmbeddingsFetch, url: string, opcoes: EmbeddingsHttpOptions, aguardar: EmbeddingsDelay): Promise<EmbeddingsHttpResponse> {
    let ultimoErro: unknown;
    for (let tentativa = 0; tentativa < MAX_RETRIES; tentativa++) {
        try {
            const resp = await fetchImpl(url, opcoes);
            if (resp.ok) return resp;

            if (resp.status >= 400 && resp.status < 500) {
                const corpo = (await resp.json().catch(() => ({}))) as EmbeddingsHttpBody;
                throw new ErroServicoEmbeddings(
                    `embeddings-service respondeu ${resp.status}: ${corpo.error || 'erro desconhecido'}`,
                    { retryable: false },
                );
            }
            ultimoErro = new ErroServicoEmbeddings(`embeddings-service respondeu ${resp.status}`, { retryable: true });
        } catch (err) {
            if (err instanceof ErroServicoEmbeddings && !err.retryable) throw err;
            ultimoErro = err;
        }
        if (tentativa < MAX_RETRIES - 1) {
            await aguardar(2 ** tentativa * 1000);
        }
    }
    throw ultimoErro;
}

/**
 * Gera embeddings para uma lista de textos via o serviço isolado
 * (Embedings-python/server.py), respeitando o batching máximo do
 * serviço. Cada texto já deve vir fatiado em até 250 palavras (ver
 * ragChunker.chunkarTexto) -- este cliente não fatia nada sozinho.
 *
 * @param {object} params
 * @param {string[]} params.textos
 * @param {'RETRIEVAL_DOCUMENT'|'RETRIEVAL_QUERY'} [params.taskType]
 * @param {Function} [params.fetchImpl] - injetável para teste (default: fetch global).
 * @param {Function} [params.aguardar] - injetável para teste (default: setTimeout real).
 * @returns {Promise<number[][]>} Um vetor de embedding por texto, na mesma ordem de entrada.
 */
export async function gerarEmbeddings({
    textos,
    taskType = 'RETRIEVAL_DOCUMENT',
    fetchImpl = fetch,
    aguardar = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    obterTokenIdentidade = _obterTokenIdentidade,
}: GerarEmbeddingsOptions): Promise<number[][]> {
    if (!Array.isArray(textos) || textos.length === 0) {
        throw new Error('gerarEmbeddings: "textos" deve ser um array não vazio');
    }
    if (!TASK_TYPES_VALIDOS.has(taskType)) {
        throw new Error(`gerarEmbeddings: "taskType" deve ser um de ${[...TASK_TYPES_VALIDOS].join(', ')}`);
    }

    const { url, segredo } = _config();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (segredo) headers['x-embeddings-secret'] = segredo;
    if (process.env.EMBEDDINGS_IAM_AUTH === 'true') {
        // Cloud Run obtém o token pela metadata server. No Cloud Build, o
        // token é emitido antes da etapa Node via IAM e entregue apenas no
        // ambiente efêmero deste processo (ver cloudbuild-rag-index.yaml).
        const tokenPronto = process.env.EMBEDDINGS_ID_TOKEN;
        headers.Authorization = tokenPronto
            ? (tokenPronto.startsWith('Bearer ') ? tokenPronto : `Bearer ${tokenPronto}`)
            : await obterTokenIdentidade(url);
    }

    const embeddings: number[][] = [];
    for (let i = 0; i < textos.length; i += MAX_TEXTOS_POR_REQUISICAO) {
        const lote = textos.slice(i, i + MAX_TEXTOS_POR_REQUISICAO);
        const resp = await _chamarComRetry(
            fetchImpl,
            `${url}/embed`,
            {
                method: 'POST',
                headers,
                body: JSON.stringify({ texts: lote, taskType }),
            },
            aguardar,
        );
        const corpo = (await resp.json()) as EmbeddingsHttpBody;
        if (!Array.isArray(corpo.embeddings) || corpo.embeddings.length !== lote.length) {
            throw new Error('embeddings-service retornou um número de embeddings diferente do esperado');
        }
        embeddings.push(...corpo.embeddings);
    }

    return embeddings;
}


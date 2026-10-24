"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErroServicoEmbeddings = exports.MAX_TEXTOS_POR_REQUISICAO = void 0;
exports._lerAutorizacao = _lerAutorizacao;
exports.gerarEmbeddings = gerarEmbeddings;
const { GoogleAuth } = require('google-auth-library');
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
exports.MAX_TEXTOS_POR_REQUISICAO = 20;
const MAX_RETRIES = 3;
const TASK_TYPES_VALIDOS = new Set(['RETRIEVAL_DOCUMENT', 'RETRIEVAL_QUERY']);
const googleAuth = new GoogleAuth();
class ErroServicoEmbeddings extends Error {
    retryable;
    constructor(message, { retryable = false } = {}) {
        super(message);
        this.name = 'ErroServicoEmbeddings';
        this.retryable = retryable;
    }
}
exports.ErroServicoEmbeddings = ErroServicoEmbeddings;
function _config() {
    const url = process.env.EMBEDDINGS_SERVICE_URL;
    if (!url) {
        throw new Error('EMBEDDINGS_SERVICE_URL não configurada no ambiente -- defina a URL do serviço Cloud Run de embeddings (Embedings-python/).');
    }
    return {
        url: url.replace(/\/+$/, ''),
        segredo: process.env.EMBEDDINGS_SHARED_SECRET || null,
    };
}
function _lerAutorizacao(headers) {
    return headers.Authorization
        || headers.authorization
        || (typeof headers.get === 'function' ? headers.get('authorization') : null);
}
async function _obterTokenIdentidade(url) {
    const audience = new URL(url).origin;
    const cliente = await googleAuth.getIdTokenClient(audience);
    const headers = await cliente.getRequestHeaders();
    const authorization = _lerAutorizacao(headers);
    if (!authorization) {
        throw new Error('Não foi possível obter um ID token para o serviço de embeddings');
    }
    return authorization;
}
async function _chamarComRetry(fetchImpl, url, opcoes, aguardar) {
    let ultimoErro;
    for (let tentativa = 0; tentativa < MAX_RETRIES; tentativa++) {
        try {
            const resp = await fetchImpl(url, opcoes);
            if (resp.ok)
                return resp;
            if (resp.status >= 400 && resp.status < 500) {
                const corpo = (await resp.json().catch(() => ({})));
                throw new ErroServicoEmbeddings(`embeddings-service respondeu ${resp.status}: ${corpo.error || 'erro desconhecido'}`, { retryable: false });
            }
            ultimoErro = new ErroServicoEmbeddings(`embeddings-service respondeu ${resp.status}`, { retryable: true });
        }
        catch (err) {
            if (err instanceof ErroServicoEmbeddings && !err.retryable)
                throw err;
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
async function gerarEmbeddings({ textos, taskType = 'RETRIEVAL_DOCUMENT', fetchImpl = fetch, aguardar = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), obterTokenIdentidade = _obterTokenIdentidade, }) {
    if (!Array.isArray(textos) || textos.length === 0) {
        throw new Error('gerarEmbeddings: "textos" deve ser um array não vazio');
    }
    if (!TASK_TYPES_VALIDOS.has(taskType)) {
        throw new Error(`gerarEmbeddings: "taskType" deve ser um de ${[...TASK_TYPES_VALIDOS].join(', ')}`);
    }
    const { url, segredo } = _config();
    const headers = { 'Content-Type': 'application/json' };
    if (segredo)
        headers['x-embeddings-secret'] = segredo;
    if (process.env.EMBEDDINGS_IAM_AUTH === 'true') {
        // Cloud Run obtém o token pela metadata server. No Cloud Build, o
        // token é emitido antes da etapa Node via IAM e entregue apenas no
        // ambiente efêmero deste processo (ver cloudbuild-rag-index.yaml).
        const tokenPronto = process.env.EMBEDDINGS_ID_TOKEN;
        headers.Authorization = tokenPronto
            ? (tokenPronto.startsWith('Bearer ') ? tokenPronto : `Bearer ${tokenPronto}`)
            : await obterTokenIdentidade(url);
    }
    const embeddings = [];
    for (let i = 0; i < textos.length; i += exports.MAX_TEXTOS_POR_REQUISICAO) {
        const lote = textos.slice(i, i + exports.MAX_TEXTOS_POR_REQUISICAO);
        const resp = await _chamarComRetry(fetchImpl, `${url}/embed`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ texts: lote, taskType }),
        }, aguardar);
        const corpo = (await resp.json());
        if (!Array.isArray(corpo.embeddings) || corpo.embeddings.length !== lote.length) {
            throw new Error('embeddings-service retornou um número de embeddings diferente do esperado');
        }
        embeddings.push(...corpo.embeddings);
    }
    return embeddings;
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOP_K_MAXIMO = exports.TOP_K_PADRAO = void 0;
exports.buscarNoCatalogo = buscarNoCatalogo;
// ============================================================
// SERVIÇO DE BUSCA SEMÂNTICA NO CATÁLOGO RAG
// ============================================================
// Camada fina entre a rota HTTP interna (src/routes/apiRoutes.js,
// POST /internal/solaris/rag/buscar) e o pipeline de embeddings já
// existente (ragEmbeddingsClient.gerarEmbeddings +
// ragVectorStore.buscarSimilares). `db`/`gerarEmbeddingsFn`/
// `buscarSimilaresFn` são sempre injetáveis (mesmo padrão de
// scripts/ragGenerate.js/ragEmbedIndex.js) — permite testar sem
// tocar Firestore/Gemini reais.
// ============================================================
const { gerarEmbeddings } = require('./ragEmbeddingsClient');
const { buscarSimilares } = require('./ragVectorStore');
exports.TOP_K_PADRAO = 5;
exports.TOP_K_MAXIMO = 20;
/**
 * Busca as entradas do catálogo RAG mais similares semanticamente a
 * `query`, via embeddings (não palavra-chave).
 *
 * @param {object} params
 * @param {string} params.query
 * @param {number} [params.topK]
 * @param {FirebaseFirestore.Firestore} params.db
 * @param {Function} [params.gerarEmbeddingsFn] - default: ragEmbeddingsClient.gerarEmbeddings.
 * @param {Function} [params.buscarSimilaresFn] - default: ragVectorStore.buscarSimilares.
 * @returns {Promise<{ query: string, resultados: Array }>}
 */
async function buscarNoCatalogo({ query, topK, db, gerarEmbeddingsFn = gerarEmbeddings, buscarSimilaresFn = buscarSimilares, }) {
    if (typeof query !== 'string' || query.trim() === '') {
        throw new Error('buscarNoCatalogo: "query" é obrigatório e deve ser uma string não vazia');
    }
    if (!db) {
        throw new Error('buscarNoCatalogo: "db" é obrigatório');
    }
    // Mesmo critério de clamp já usado em outras entradas deste
    // pipeline (ex.: MAX_TEXTOS_POR_REQUISICAO) -- nunca confia
    // cegamente num valor vindo de fora.
    const k = Number.isInteger(topK) && topK > 0
        ? Math.min(topK, exports.TOP_K_MAXIMO)
        : exports.TOP_K_PADRAO;
    const [queryEmbedding] = await gerarEmbeddingsFn({
        textos: [query.trim()],
        taskType: 'RETRIEVAL_QUERY',
    });
    const encontrados = await buscarSimilaresFn({ db, queryEmbedding, topK: k });
    // Não expor vetores legados enquanto uma reindexação completa do catálogo
    // ainda não removeu a entrada descontinuada do Firestore.
    const resultados = encontrados.filter((item) => item?.entryId !== 'supabase-chatgpt-integration');
    return { query, resultados };
}

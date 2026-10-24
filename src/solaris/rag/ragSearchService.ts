import type { RagSearchHit, RagVectorDb } from './ragVectorStore';

export interface RagCatalogSearchOptions {
    query: string;
    topK?: number;
    db: RagVectorDb;
    gerarEmbeddingsFn?: (request: { textos: string[]; taskType: 'RETRIEVAL_QUERY' }) => Promise<number[][]>;
    buscarSimilaresFn?: (request: { db: RagVectorDb; queryEmbedding: number[]; topK: number }) => Promise<RagSearchHit[]>;
}
export interface RagCatalogSearchResponse {
    query: string;
    resultados: RagSearchHit[];
}
declare function require(id: string): unknown;

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

const { gerarEmbeddings } = require('./ragEmbeddingsClient') as {
    gerarEmbeddings(request: { textos: string[]; taskType: 'RETRIEVAL_QUERY' }): Promise<number[][]>;
};
const { buscarSimilares } = require('./ragVectorStore') as {
    buscarSimilares(request: { db: RagVectorDb; queryEmbedding: number[]; topK: number }): Promise<RagSearchHit[]>;
};

export const TOP_K_PADRAO = 5;
export const TOP_K_MAXIMO = 20;

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
export async function buscarNoCatalogo({
    query,
    topK,
    db,
    gerarEmbeddingsFn = gerarEmbeddings,
    buscarSimilaresFn = buscarSimilares,
}: RagCatalogSearchOptions): Promise<RagCatalogSearchResponse> {
    if (typeof query !== 'string' || query.trim() === '') {
        throw new Error('buscarNoCatalogo: "query" é obrigatório e deve ser uma string não vazia');
    }
    if (!db) {
        throw new Error('buscarNoCatalogo: "db" é obrigatório');
    }

    // Mesmo critério de clamp já usado em outras entradas deste
    // pipeline (ex.: MAX_TEXTOS_POR_REQUISICAO) -- nunca confia
    // cegamente num valor vindo de fora.
    const k =
        Number.isInteger(topK) && (topK as number) > 0
            ? Math.min(topK as number, TOP_K_MAXIMO)
            : TOP_K_PADRAO;

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


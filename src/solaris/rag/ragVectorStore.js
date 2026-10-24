"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COLECAO = void 0;
exports.substituirVetoresDaEntrada = substituirVetoresDaEntrada;
exports.buscarSimilares = buscarSimilares;
// ============================================================
// VECTOR STORE DO RAG DO SOLARIS (Firestore)
// ============================================================
// Lê/escreve os chunks vetorizados do catálogo RAG
// (src/solaris/rag/*.json) na coleção `solaris_rag_vectors`, usando o
// índice vetorial nativo do Firestore (FieldValue.vector +
// findNearest -- KNN real no servidor; ver firestore.indexes.json para
// a configuração do índice, que precisa ser publicada separadamente
// com `firebase deploy --only firestore:indexes`).
//
// `db` é sempre injetado pelo chamador (nunca importa
// src/services/firebase.js diretamente) -- mesmo padrão de injeção de
// dependência já usado no resto do RAG do Solaris
// (modelRouter/catalogoExistente em scripts/ragGenerate.js), permite
// testar sem tocar Firestore de verdade.
// ============================================================
const { FieldValue } = require('firebase-admin/firestore');
exports.COLECAO = 'solaris_rag_vectors';
const DISTANCIA_PADRAO = 'COSINE';
function _docId(entryId, chunkIndex) {
    return `${entryId}::chunk${chunkIndex}`;
}
/**
 * Substitui TODOS os chunks vetorizados de uma entrada do catálogo
 * pelos novos chunks/embeddings fornecidos -- replace completo, nunca
 * um append. Isso evita a duplicação em reindexação documentada em
 * Embedings-python/Observações.md (item 2.2): rodar a reindexação duas
 * vezes sobre a mesma entrada nunca deixa vetor órfão nem duplicado,
 * mesmo que o número de chunks tenha mudado entre as rodadas.
 *
 * @param {object} params
 * @param {FirebaseFirestore.Firestore} params.db
 * @param {{ id: string, categoria?: string }} params.entrada - entrada do catálogo RAG (precisa de `id`).
 * @param {string[]} params.chunks - textos já fatiados (ver ragChunker.chunkarTexto).
 * @param {number[][]} params.embeddings - um vetor por chunk, mesma ordem/tamanho de `chunks`.
 * @returns {Promise<{ escritos: number, removidos: number }>}
 */
async function substituirVetoresDaEntrada({ db, entrada, chunks, embeddings }) {
    if (!entrada || typeof entrada.id !== 'string' || !entrada.id) {
        throw new Error('substituirVetoresDaEntrada: "entrada.id" é obrigatório');
    }
    if (!Array.isArray(chunks) || !Array.isArray(embeddings) || chunks.length !== embeddings.length) {
        throw new Error('substituirVetoresDaEntrada: "chunks" e "embeddings" devem ser arrays do mesmo tamanho');
    }
    const colecao = db.collection(exports.COLECAO);
    // Remove tudo que já existia pra essa entrada antes de escrever de
    // novo -- replace completo, não incremental (ver motivo acima).
    const existentes = await colecao.where('entryId', '==', entrada.id).get();
    const lote = db.batch();
    for (const doc of existentes.docs) {
        lote.delete(doc.ref);
    }
    const agora = new Date().toISOString();
    chunks.forEach((texto, idx) => {
        const ref = colecao.doc(_docId(entrada.id, idx));
        lote.set(ref, {
            entryId: entrada.id,
            categoria: entrada.categoria || null,
            chunkIndex: idx,
            totalChunks: chunks.length,
            texto,
            embedding: FieldValue.vector(embeddings[idx]),
            atualizadoEm: agora,
        });
    });
    await lote.commit();
    return { escritos: chunks.length, removidos: existentes.size };
}
/**
 * Busca os chunks mais similares a um vetor de query, via KNN nativo
 * do Firestore (findNearest). `queryEmbedding` já deve vir gerado com
 * taskType RETRIEVAL_QUERY (ver ragEmbeddingsClient.gerarEmbeddings).
 *
 * @param {object} params
 * @param {FirebaseFirestore.Firestore} params.db
 * @param {number[]} params.queryEmbedding
 * @param {number} [params.topK]
 * @returns {Promise<Array<{ entryId: string, categoria: string|null, chunkIndex: number, texto: string, distancia: number|null }>>}
 */
async function buscarSimilares({ db, queryEmbedding, topK = 5 }) {
    if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
        throw new Error('buscarSimilares: "queryEmbedding" deve ser um array não vazio');
    }
    if (!Number.isInteger(topK) || topK <= 0) {
        throw new Error('buscarSimilares: "topK" deve ser um inteiro positivo');
    }
    const colecao = db.collection(exports.COLECAO);
    const vectorQuery = colecao.findNearest({
        vectorField: 'embedding',
        queryVector: FieldValue.vector(queryEmbedding),
        limit: topK,
        distanceMeasure: DISTANCIA_PADRAO,
        distanceResultField: '_distancia',
    });
    const snapshot = await vectorQuery.get();
    return snapshot.docs.map((doc) => {
        const dados = doc.data();
        return {
            entryId: dados.entryId,
            categoria: dados.categoria ?? null,
            chunkIndex: dados.chunkIndex,
            texto: dados.texto,
            distancia: dados._distancia ?? null,
        };
    });
}

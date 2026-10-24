"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COLLECTION = exports.DIMENSION = void 0;
exports.replaceCodeVectors = replaceCodeVectors;
exports.findCodeVectors = findCodeVectors;
/**
 * Firestore vector store do corpus autoral/externo Solaris Code.
 * Nao se conecta ao RAG tecnico nem ao RAG Blogger.
 * O Firestore e injetado para permitir testes sem rede.
 */
exports.DIMENSION = 768;
const MAX_CHUNKS = 100;
const { FieldValue } = require('firebase-admin/firestore');
const { RAG_NAMESPACES } = require('../../src/knowledge/ragNamespaces');
exports.COLLECTION = RAG_NAMESPACES.solarisCode.collection;
function validateVector(vector) {
    if (!Array.isArray(vector) || vector.length !== exports.DIMENSION || !vector.every(Number.isFinite)) {
        throw new Error('Vetor inválido: esperadas ' + exports.DIMENSION + ' dimensões finitas');
    }
}
/** Substitui todos os chunks da entrada em um unico batch Firestore. */
async function replaceCodeVectors({ db, entry, chunks, embeddings }) {
    if (!db || !entry || !/^code-[a-f0-9]{32}$/.test(entry.id) ||
        !Array.isArray(chunks) || chunks.length === 0 || chunks.length > MAX_CHUNKS ||
        !Array.isArray(embeddings) || chunks.length !== embeddings.length) {
        throw new Error('Entrada/chunks de código inválidos');
    }
    for (const v of embeddings)
        validateVector(v);
    const col = db.collection(exports.COLLECTION);
    const existing = await col.where('entryId', '==', entry.id).get();
    // Operação única limitada a 500 writes (100 chunks + máximo de 100 anteriores).
    if (existing.size + chunks.length > 400)
        throw new Error('Muitos chunks para escrita atômica');
    const batch = db.batch();
    for (const doc of existing.docs)
        batch.delete(doc.ref);
    const updatedAt = new Date().toISOString();
    chunks.forEach((texto, index) => {
        const ref = col.doc(entry.id + '::chunk' + index);
        batch.set(ref, {
            entryId: entry.id, chunkIndex: index, texto,
            repo: entry.repo, path: entry.path, language: entry.language,
            sourceUrl: entry.sourceUrl, commitSha: entry.commitSha,
            license: entry.license, validated: entry.validated === true,
            origin: entry.origin || 'github-external', title: entry.title || null,
            summary: entry.summary || null, useWhen: entry.useWhen || null,
            limitations: entry.limitations || null,
            contentHash: entry.contentHash, atualizadoEm: updatedAt,
            embedding: FieldValue.vector(embeddings[index]),
        });
    });
    await batch.commit();
    return { written: chunks.length, removed: existing.size };
}
/** Consulta exclusivamente a colecao vetorial do corpus de codigo Solaris. */
async function findCodeVectors({ db, queryEmbedding, topK = 3 }) {
    if (!db || !Number.isInteger(topK) || topK < 1 || topK > 20)
        throw new Error('Busca de código inválida');
    validateVector(queryEmbedding);
    const snap = await db.collection(exports.COLLECTION).findNearest({
        vectorField: 'embedding', queryVector: FieldValue.vector(queryEmbedding),
        limit: topK, distanceMeasure: 'COSINE', distanceResultField: '_distancia',
    }).get();
    return snap.docs.map(doc => {
        const d = doc.data();
        return {
            entryId: d.entryId, texto: d.texto, categoria: 'codigo',
            repo: d.repo, path: d.path, language: d.language,
            sourceUrl: d.sourceUrl, license: d.license,
            origin: d.origin || null, title: d.title || null,
            summary: d.summary || null, limitations: d.limitations || null,
            commitSha: d.commitSha, validated: d.validated === true,
            distancia: d._distancia ?? null, chunkIndex: d.chunkIndex,
        };
    });
}

/**
 * Firestore vector store do corpus autoral/externo Solaris Code.
 * Nao se conecta ao RAG tecnico nem ao RAG Blogger.
 * O Firestore e injetado para permitir testes sem rede.
 */
export const DIMENSION = 768;
const MAX_CHUNKS = 100;

declare function require(name: string): unknown;

interface FirestoreVectorFactory {
  vector(values: readonly number[]): unknown;
}
interface FirestoreReference { readonly id?: string }
interface FirestoreWriteBatch {
  delete(ref: FirestoreReference): unknown;
  set(ref: FirestoreReference, data: Record<string, unknown>): unknown;
  commit(): Promise<unknown>;
}
interface FirestoreDoc {
  readonly ref: FirestoreReference;
  data(): Record<string, unknown>;
}
interface FirestoreQuerySnapshot {
  readonly docs: readonly FirestoreDoc[];
  readonly size: number;
}
interface FirestoreCollection {
  doc(id: string): FirestoreReference;
  where(field: string, op: '==', value: string): { get(): Promise<FirestoreQuerySnapshot> };
  findNearest(options: {
    vectorField: 'embedding';
    queryVector: unknown;
    limit: number;
    distanceMeasure: 'COSINE';
    distanceResultField: '_distancia';
  }): { get(): Promise<{ docs: readonly FirestoreDoc[] }> };
}
export interface CodeFirestore {
  collection(name: string): FirestoreCollection;
  batch(): FirestoreWriteBatch;
}
export interface CodeVectorEntry {
  id: string;
  repo: string;
  path: string;
  language: string;
  sourceUrl: string;
  commitSha?: string | null;
  license: string;
  validated?: boolean;
  origin?: string | null;
  title?: string | null;
  summary?: string | null;
  useWhen?: string | null;
  limitations?: string | null;
  contentHash: string;
}
export interface ReplaceCodeVectorsParams {
  db: CodeFirestore;
  entry: CodeVectorEntry;
  chunks: string[];
  embeddings: number[][];
}
export interface FindCodeVectorsParams {
  db: CodeFirestore;
  queryEmbedding: number[];
  topK?: number;
}
export interface CodeVectorMatch {
  entryId: string;
  texto: string;
  categoria: 'codigo';
  repo: string;
  path: string;
  language: string;
  sourceUrl: string;
  license: string;
  origin: string | null;
  title: string | null;
  summary: string | null;
  limitations: string | null;
  commitSha: string | null;
  validated: boolean;
  distancia: number | null;
  chunkIndex: number;
}

const { FieldValue } = require('firebase-admin/firestore') as { FieldValue: FirestoreVectorFactory };
const { RAG_NAMESPACES } = require('../../src/knowledge/ragNamespaces') as {
  RAG_NAMESPACES: { solarisCode: { collection: string } };
};
export const COLLECTION = RAG_NAMESPACES.solarisCode.collection;

function validateVector(vector: unknown): asserts vector is number[] {
  if (!Array.isArray(vector) || vector.length !== DIMENSION || !vector.every(Number.isFinite)) {
    throw new Error('Vetor inválido: esperadas ' + DIMENSION + ' dimensões finitas');
  }
}

/** Substitui todos os chunks da entrada em um unico batch Firestore. */
export async function replaceCodeVectors({ db, entry, chunks, embeddings }: ReplaceCodeVectorsParams): Promise<{ written: number; removed: number }> {
  if (!db || !entry || !/^code-[a-f0-9]{32}$/.test(entry.id) ||
      !Array.isArray(chunks) || chunks.length === 0 || chunks.length > MAX_CHUNKS ||
      !Array.isArray(embeddings) || chunks.length !== embeddings.length) {
    throw new Error('Entrada/chunks de código inválidos');
  }
  for (const v of embeddings) validateVector(v);
  const col = db.collection(COLLECTION);
  const existing = await col.where('entryId', '==', entry.id).get();
  // Operação única limitada a 500 writes (100 chunks + máximo de 100 anteriores).
  if (existing.size + chunks.length > 400) throw new Error('Muitos chunks para escrita atômica');
  const batch = db.batch();
  for (const doc of existing.docs) batch.delete(doc.ref);
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
export async function findCodeVectors({ db, queryEmbedding, topK = 3 }: FindCodeVectorsParams): Promise<CodeVectorMatch[]> {
  if (!db || !Number.isInteger(topK) || topK < 1 || topK > 20) throw new Error('Busca de código inválida');
  validateVector(queryEmbedding);
  const snap = await db.collection(COLLECTION).findNearest({
    vectorField: 'embedding', queryVector: FieldValue.vector(queryEmbedding),
    limit: topK, distanceMeasure: 'COSINE', distanceResultField: '_distancia',
  }).get();
  return snap.docs.map(doc => {
    const d = doc.data() as unknown as CodeVectorMatch & { _distancia?: number | null };
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

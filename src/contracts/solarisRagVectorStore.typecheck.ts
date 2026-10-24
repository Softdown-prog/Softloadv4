import { substituirVetoresDaEntrada, buscarSimilares, COLECAO } from '../solaris/rag/ragVectorStore';
import type { RagVectorDb, RagNearestOptions, RagReplaceOptions, RagSearchHit, RagReplaceResult } from '../solaris/rag/ragVectorStore';
declare const db: RagVectorDb;
const replace: RagReplaceOptions = { db, entrada: { id: 'html5' }, chunks: ['texto'], embeddings: [[0.1, 0.2]] };
const nearest: RagNearestOptions = { db, queryEmbedding: [0.1, 0.2], topK: 5 };
const replaced: Promise<RagReplaceResult> = substituirVetoresDaEntrada(replace);
const found: Promise<RagSearchHit[]> = buscarSimilares(nearest);
const name: string = COLECAO;
void replaced; void found; void name;

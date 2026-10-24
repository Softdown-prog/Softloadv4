/**
 * Busca de receitas de codigo Solaris, isolada do RAG Blogger.
 * As dependencias sao injetaveis para validar degradacao graciosa sem Firestore.
 */
export interface CodeSearchHit {
  entryId: string;
  texto: string;
  [key: string]: unknown;
}
export interface CodeSearchReply {
  query?: string;
  resultados?: readonly unknown[];
  [key: string]: unknown;
}
export interface CodeSearchParams {
  db?: unknown;
  query?: string;
  topK?: number;
}
export type CorpusSearchFn = (params: { db: unknown; query: string; topK: number }) => Promise<CodeSearchReply>;
export type EmbeddingsFn = (params: {
  textos: string[];
  taskType: 'RETRIEVAL_QUERY';
}) => Promise<number[][]>;
export type FindCodeFn = (params: {
  db: unknown;
  queryEmbedding: number[];
  topK: number;
}) => Promise<CodeSearchHit[]>;
export interface BuscarCodigoOptions extends CodeSearchParams {
  gerarEmbeddingsFn?: EmbeddingsFn;
  findFn?: FindCodeFn;
}
export interface MixedSearchOptions extends CodeSearchParams {
  codeSearchEnabled?: boolean;
  catalogFn?: CorpusSearchFn;
  codeFn?: CorpusSearchFn;
}

declare const console: { warn(...args: unknown[]): void; log(...args: unknown[]): void; error(...args: unknown[]): void };
declare function require(id: string): unknown;
const { gerarEmbeddings } = require('../../src/solaris/rag/ragEmbeddingsClient') as {
  gerarEmbeddings: EmbeddingsFn;
};
const { findCodeVectors } = require('./codeVectorStore') as {
  findCodeVectors: FindCodeFn;
};
const { shouldSearchCodeCorpus } = require('../../src/knowledge/ragNamespaces') as {
  shouldSearchCodeCorpus(query: string): boolean;
};

// RAG do Blogger (src/rag) NÃO é importado nem consultado aqui.
// As duas buscas Solaris só recebem coleções próprias: ver ragNamespaces.js.
export async function buscarCodigo({
  db, query, topK = 3, gerarEmbeddingsFn = gerarEmbeddings, findFn = findCodeVectors,
}: BuscarCodigoOptions = {}): Promise<{ query: string; resultados: CodeSearchHit[] }> {
  if (!db || typeof query !== 'string' || !query.trim()) throw new Error('Busca de código requer db e query');
  const limitedK = Number.isInteger(topK) && topK > 0 ? Math.min(topK, 20) : 3;
  const [vector] = await gerarEmbeddingsFn({
    textos: [query.trim().split(/\s+/).slice(0, 220).join(' ')],
    taskType: 'RETRIEVAL_QUERY',
  });
  const resultados = await findFn({ db, queryEmbedding: vector, topK: limitedK });
  return { query, resultados };
}

/** Um chunk por exemplo para nao lotar o contexto do modelo. */
export function uniqueResults(items: readonly unknown[] | null | undefined, limit: number, seen: Set<string> = new Set()): CodeSearchHit[] {
  const out: CodeSearchHit[] = [];
  if (limit <= 0) return out;
  for (const item of items || []) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Partial<CodeSearchHit>;
    if (typeof candidate.entryId !== 'string' || typeof candidate.texto !== 'string' || !candidate.texto.trim()) continue;
    const id = candidate.entryId;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(candidate as CodeSearchHit);
    if (out.length >= limit) break;
  }
  return out;
}

// Ambas as fontes são independentes. Se uma cair, a outra segue funcionando;
// só falha quando ambas estiverem indisponíveis. Blogger não participa.
export async function buscarConhecimentoMisto({
  query, topK = 3, db, codeSearchEnabled = false,
  catalogFn = (require('../../src/solaris/rag/ragSearchService') as { buscarNoCatalogo: CorpusSearchFn }).buscarNoCatalogo,
  codeFn = buscarCodigo,
}: MixedSearchOptions = {}): Promise<CodeSearchReply> {
  if (!db || typeof query !== 'string' || !query.trim()) throw new Error('Busca RAG mista exige db e query');
  const wanted = Number.isInteger(topK) && topK > 0 ? Math.min(topK, 20) : 3;
  if (!codeSearchEnabled || !shouldSearchCodeCorpus(query)) {
    return catalogFn({ query, topK: wanted, db });
  }
  // Recupere uma margem extra para remover chunks duplicados por entryId.
  const codeLimit = wanted === 1 ? 1 : Math.min(2, wanted - 1);
  const [catalog, code] = await Promise.allSettled([
    catalogFn({ query, topK: wanted, db }),
    codeFn({ query, topK: Math.min(wanted * 3, 20), db }),
  ]);
  if (catalog.status === 'rejected') console.warn('[SOLARIS-RAG] Catálogo técnico indisponível: ' + (catalog.reason as Error | null)?.message);
  if (code.status === 'rejected') console.warn('[SOLARIS-CODE-RAG] Receitas de código indisponíveis: ' + (code.reason as Error | null)?.message);
  if (catalog.status === 'rejected' && code.status === 'rejected') {
    throw new Error('As duas bases RAG do Solaris estão indisponíveis');
  }
  const codeResults = code.status === 'fulfilled' ? uniqueResults(code.value?.resultados,
    catalog.status === 'rejected' ? wanted : codeLimit) : [];
  const seen = new Set(codeResults.map(item => item.entryId));
  const technicalResults = catalog.status === 'fulfilled'
    ? uniqueResults(catalog.value?.resultados, wanted - codeResults.length, seen)
    : [];
  // Se o catálogo estiver fora, ainda retorna código. Se não houver
  // código, devolve só o catálogo. Nunca cruza fronteira com o Blogger.
  return { query, resultados: [...codeResults, ...technicalResults].slice(0, wanted) };
}

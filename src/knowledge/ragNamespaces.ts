'use strict';

/**
 * Contrato de ownership das três bases RAG, sem implementar recuperação.
 * Blogger continua em filesystem; os dois índices vetoriais Solaris não
 * compartilham coleção ou diretório.
 */
export type RagMode = 'filesystem' | 'vector';
export type SolarisCorpus = 'catalogo' | 'codigo' | 'ambos';
export interface RagNamespace {
  id: string;
  owner: string;
  mode: RagMode;
  root: string;
  collection: string | null;
  additionalRoot?: string;
}
export type RagNamespaceRegistry = Record<string, Readonly<RagNamespace>>;

export const RAG_NAMESPACES: Readonly<{
  blogger: Readonly<RagNamespace>;
  solarisTechnical: Readonly<RagNamespace>;
  solarisCode: Readonly<RagNamespace>;
}> = Object.freeze({
  blogger: Object.freeze({
    id: 'blogger',
    owner: 'especialista-blogger',
    mode: 'filesystem',
    root: 'src/rag',
    collection: null,
  }),
  solarisTechnical: Object.freeze({
    id: 'solaris:technical',
    owner: 'solaris-code',
    mode: 'vector',
    root: 'src/solaris/rag',
    collection: 'solaris_rag_vectors',
  }),
  solarisCode: Object.freeze({
    id: 'solaris:code',
    owner: 'solaris-code',
    mode: 'vector',
    root: 'src/solaris/code-examples',
    additionalRoot: 'examples/solaris-code',
    collection: 'solaris_code_vectors',
  }),
});

export const SOLARIS_CORPORA: readonly SolarisCorpus[] = Object.freeze(['catalogo', 'codigo', 'ambos']);

export function normalizeSolarisCorpus(corpus: string = 'catalogo'): SolarisCorpus {
  if (!SOLARIS_CORPORA.includes(corpus as SolarisCorpus)) {
    throw new RangeError('corpus deve ser catalogo, codigo ou ambos (Blogger não é uma opção)');
  }
  return corpus as SolarisCorpus;
}

export function shouldSearchCodeCorpus(query: unknown): boolean {
  if (typeof query !== 'string') return false;
  // Não enfiar código no contexto de pedidos genéricos de Blogger/SEO/UI.
  // Só consulta receitas quando há tecnologia ou intenção de código explícita.
  return /\b(?:typescript|javascript|react|node(?:\.js|js)?|python|fastapi|flask|django|php|sql|postgres(?:ql)?|firestore|firebase|express|vite|api\s+rest|programa(?:ção|r)?|c[oó]digo|snippets?|fun[cç][aã]o|classe|algoritmo|debug|refatorar|implementar|integra[cç][aã]o\s+http|requisi[cç][aã]o\s+http)\b/i.test(query);
}

export function validateNamespaceRegistry(entries: RagNamespaceRegistry = RAG_NAMESPACES): boolean {
  const ids = new Set<string>(), collections = new Set<string>();
  for (const item of Object.values(entries)) {
    if (!item || typeof item.id !== 'string' || !item.id ||
        typeof item.owner !== 'string' || !item.owner || typeof item.root !== 'string' ||
        !item.root.startsWith('src/')) throw new Error('Namespace RAG incompleto');
    if (ids.has(item.id)) throw new Error('Namespace RAG duplicado: ' + item.id);
    ids.add(item.id);
    if (item.mode === 'vector') {
      if (typeof item.collection !== 'string' || !item.collection) throw new Error('Coleção vetorial ausente');
      if (collections.has(item.collection)) throw new Error('Coleção RAG duplicada: ' + item.collection);
      collections.add(item.collection);
    } else if (item.mode !== 'filesystem' || item.collection !== null) {
      throw new Error('Namespace de arquivos não deve compartilhar coleção Firestore');
    }
  }
  return true;
}
validateNamespaceRegistry();

import type { RagCatalogEntry } from './ragCatalogLoader';

declare function require(path: string): unknown;
const { buscarCategoria, resumirParaPrompt } = require('./ragCatalogLoader') as typeof import('./ragCatalogLoader');

export interface BuscaCatalogoLocalOptions { query: string; topK?: number }
export interface BuscaCatalogoLocalHit { entryId: string; categoria: string; texto: string }

/** Busca sem serviço externo. Evita expor um vetor obsoleto ou fazer HTTP para embeddings descontinuado. */
export async function buscarCatalogoLocal({ query }: BuscaCatalogoLocalOptions): Promise<{ query: string; resultados: BuscaCatalogoLocalHit[] }> {
  if (typeof query !== 'string' || !query.trim()) throw new Error('query deve ser string não vazia');
  const encontrado: RagCatalogEntry | null = buscarCategoria(query);
  if (!encontrado) return { query, resultados: [] };
  const conteudo = resumirParaPrompt(encontrado);
  return { query, resultados: [{
    entryId: encontrado.id,
    categoria: encontrado.categoria || 'catalogo',
    texto: JSON.stringify(conteudo).slice(0, 1800),
  }] };
}

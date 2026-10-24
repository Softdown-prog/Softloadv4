import { carregarCatalogo, buscarCategoria, resumirParaPrompt } from '../solaris/rag/ragCatalogLoader';
import type { RagCatalogEntry, RagCatalogSource, RagCatalogLoadOptions } from '../solaris/rag/ragCatalogLoader';
const options: RagCatalogLoadOptions = { forcarRecarga: false };
const loaded: RagCatalogEntry[] = carregarCatalogo(options);
const match: RagCatalogEntry | null = buscarCategoria('site para restaurante');
const result: Record<string, unknown> | null = resumirParaPrompt(match);
const source: RagCatalogSource = { id: 'restaurante', categoria: 'site' };
void loaded; void result; void source;

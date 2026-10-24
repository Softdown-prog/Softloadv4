import { buscarNoCatalogo, TOP_K_PADRAO, TOP_K_MAXIMO } from '../solaris/rag/ragSearchService';
import type { RagCatalogSearchOptions, RagCatalogSearchResponse } from '../solaris/rag/ragSearchService';
import type { RagVectorDb } from '../solaris/rag/ragVectorStore';
declare const db: RagVectorDb;
const req: RagCatalogSearchOptions = { query: 'dúvida de TypeScript', db, topK: 2 };
const result: Promise<RagCatalogSearchResponse> = buscarNoCatalogo(req);
const limits: number[] = [TOP_K_PADRAO, TOP_K_MAXIMO];
void result; void limits;

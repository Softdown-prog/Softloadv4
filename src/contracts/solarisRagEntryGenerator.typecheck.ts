import { RAG_ENTRY_RESPONSE_SCHEMA, gerarEntradaCatalogo } from '../solaris/rag/ragEntryGenerator';
import type { RagGeneratedEntry, RagGenerateOptions, RagGeneratorRouter } from '../solaris/rag/ragEntryGenerator';
const router: RagGeneratorRouter = { executarTriagem: async () => '{"slug":"a","descricao":"Exemplo"}' };
const request: RagGenerateOptions = { grupo: 'html5', topico: 'forms', modelRouter: router };
const entry: Promise<RagGeneratedEntry> = gerarEntradaCatalogo(request);
const schema: Record<string, unknown> = RAG_ENTRY_RESPONSE_SCHEMA;
void entry; void schema;

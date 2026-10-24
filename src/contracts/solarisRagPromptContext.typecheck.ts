import { recuperarContextoRag, formatarContextoRag, deveConsultarRagNoChat, TOP_K } from '../solaris/rag/ragPromptContext';
import type { RagContextSearchResponse, RagContextOptions } from '../solaris/rag/ragPromptContext';
const response: RagContextSearchResponse = { resultados: [{ entryId: 'html5', texto: 'Exemplo' }] };
const formatted: string = formatarContextoRag(response);
const shouldSearch: boolean = deveConsultarRagNoChat('como criar um projeto?');
const options: RagContextOptions = { query: 'html5', buscarConhecimento: async () => response };
const pending: Promise<string> = recuperarContextoRag(options);
void formatted; void shouldSearch; void pending; void TOP_K;

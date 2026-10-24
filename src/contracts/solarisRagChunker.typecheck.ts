import { chunkarTexto, MAX_PALAVRAS_PADRAO } from '../solaris/rag/ragChunker';
const limit: number = MAX_PALAVRAS_PADRAO;
const chunks: string[] = chunkarTexto('um dois tres', { maxPalavras: 2 });
void limit;
void chunks;

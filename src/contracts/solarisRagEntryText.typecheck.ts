import { montarTextoEmbedavel } from '../solaris/rag/ragEntryText';
import type { RagEmbedEntry } from '../solaris/rag/ragEntryText';
const entry: RagEmbedEntry = { descricao: 'Ajuda técnica', keywords: ['typescript'] };
const text: string = montarTextoEmbedavel(entry);
void text;

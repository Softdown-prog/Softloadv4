import { encontrarSimilares, similaridadeJaccard } from '../solaris/rag/ragDeduplicator';
import type { RagTokenEntry, RagSimilarEntry } from '../solaris/rag/ragDeduplicator';
const entry: RagTokenEntry = { id: 'um', componentes: ['x'], keywords: ['y'] };
const comparison: number = similaridadeJaccard(entry, { id: 'dois', componentes: ['x'] });
const similars: RagSimilarEntry[] = encontrarSimilares(entry, [{ id: 'dois', componentes: ['x'] }]);
void comparison;
void similars;

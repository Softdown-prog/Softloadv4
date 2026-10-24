import { determinarPasta, organizarDiretorio, PASTA_PADRAO } from '../solaris/workers/ragOrganizerWorker';
import type { RagOrganizerEntry, RagOrganizerReport, RagFolderDecision } from '../solaris/workers/ragOrganizerWorker';
const entry: RagOrganizerEntry = { id: 'flask-blueprints' };
const decision: RagFolderDecision = determinarPasta(entry);
const report: RagOrganizerReport[] = organizarDiretorio({ dir: '/tmp/rag', aplicar: false });
void decision; void report; void PASTA_PADRAO;

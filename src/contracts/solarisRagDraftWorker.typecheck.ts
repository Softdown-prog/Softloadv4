import { triarRascunho, triarDiretorio, resumirTriagem, CAMPOS_CATALOGO } from '../solaris/workers/ragDraftWorker';
import type { RagDraftEntry, RagDraftTriage, RagDraftDirectoryItem, RagDraftSummary } from '../solaris/workers/ragDraftWorker';
const entry: RagDraftEntry = { id: 'flask-blueprints', categoria: 'topico' };
const triage: RagDraftTriage = triarRascunho('flask-blueprints.json', entry);
const files: RagDraftDirectoryItem[] = triarDiretorio();
const summary: RagDraftSummary = resumirTriagem([triage]);
const fields: string[] = CAMPOS_CATALOGO;
void files; void summary; void fields;

import { parseTemplateTree, type TemplateNode } from '../lib/bloggerTemplateTree';
import { evalValueExpr, resolveLoopSource } from '../lib/bloggerTemplateEngine';
import { buildBaseContext } from '../lib/bloggerMockContext';
import { renderBloggerTree } from '../lib/bloggerTemplateRenderer';
import { parseBloggerXMLToHTML } from '../lib/bloggerPreviewRenderer';
import { loadForGeminiSync } from '../rag/ragLoader';
import { TokenBudget, validateTemplateSchema } from '../rag/ragAgent';
import { aplicarPatch, type XmlPatchOperation } from '../workers/xmlPatchWorker';
import type { TaskWorkerData, TaskWorkerMessage } from '../workers/taskWorker';
import type { WorkspaceUsage, WorkspaceSettlement } from '../services/workspaceCreditReservations';
import type { FileQuotaChange, QuotaReservation } from '../services/storageService';
import { SISTEMA_GERACAO, SISTEMA_SUPORTE } from '../routes/dashboard_routes/chat/chatSystemPrompt';

const context = buildBaseContext('Fixture');
const tree: TemplateNode[] = parseTemplateTree('<data:blog.title/>');
const output: string = parseBloggerXMLToHTML(renderBloggerTree('', context));
const items: unknown[] = resolveLoopSource('data:posts', context);
// @ts-expect-error A dynamic expression result requires narrowing before arithmetic.
const number: number = evalValueExpr('data:post', context);
// @ts-expect-error The AST has a closed set of node kinds.
const badNode: TemplateNode = { type: 'unsupported' };
// @ts-expect-error Insertion requires a section ID, not a widget ID.
const badPatch: XmlPatchOperation = { op: 'insertIntoSection', id: 'Blog1', xml: '<x/>' };
const patch = aplicarPatch('', { ops: [{ op: 'replaceLines', start: 1, end: 1, xml: 'new' }] });
const rag = loadForGeminiSync('Fixture', { metaOnly: true, historico: ['prior'] });
if (rag.sucesso) { const size: string = rag.tamanhoTotalKB; void size; }
const validation = validateTemplateSchema('{}');
if (!validation.valid) { const errors: string[] = validation.erros; void errors; }
const budget = new TokenBudget(1000, 2);
const worker: TaskWorkerData = { comando: 'worker:ping', flags: { n: '1', force: true } };
const message: TaskWorkerMessage = { tipo: 'erro', texto: 'Fixture', dados: { code: 'fixture' } };
// @ts-expect-error Usage token counts are numbers.
const usage: WorkspaceUsage = { input: '1' };
const settlement: WorkspaceSettlement = { creditos: 1, descobertos: 0, estimado: false, idempotente: true };
const quota: FileQuotaChange = { path: 'users/fixture/a', bytesAntes: 0, bytesDepois: 20 };
declare const reservation: QuotaReservation;
// @ts-expect-error Storage confirmation cannot accept a string byte count.
reservation.confirmarUso('20');
void [tree, output, items, number, badNode, badPatch, patch, rag, budget, worker, message, usage, settlement, quota, SISTEMA_GERACAO, SISTEMA_SUPORTE];

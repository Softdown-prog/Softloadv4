import { criarExecutorCompilacao } from '../core/workerOrchestrator';
import type { WorkerCompilerBody, WorkerOrchestratorDependencies } from '../core/workerOrchestrator';
import type { CompiledBloggerTheme } from './compiler';

const body: WorkerCompilerBody = { siteName: 'Teste', heroHtml: '<h1>Olá</h1>', staticSections: '<p>Extra</p>' };
const factory: (deps: WorkerOrchestratorDependencies) => (body: WorkerCompilerBody) => CompiledBloggerTheme = criarExecutorCompilacao;
void body;
void factory;

// @ts-expect-error factory é função, não número.
const invalidFactory: number = criarExecutorCompilacao;
void invalidFactory;
// @ts-expect-error o corpo é um objeto, não string.
const invalidBody: WorkerCompilerBody = 'plain text';
void invalidBody;

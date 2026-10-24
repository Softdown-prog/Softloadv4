import { compilarComPipeline, finalizarCompilacao } from '../core/compilerPipeline';
import type { PipelineApi, PipelineContext, PipelineUser, PipelineStatus, PipelineWorkspaceIds } from '../core/compilerPipeline';
import type { WorkerCompilerBody } from '../core/workerOrchestrator';
import type { SavedCompilation } from './compiler';
const user: PipelineUser = {uid:'u',email:'user@example.test',plano:'free'};
const manifesto: WorkerCompilerBody = {siteName:'Meu Site',heroHtml:'<h1>Olá</h1>'};
const ctx: PipelineContext = {slug:'site',siteNameSanitizado:'Meu Site',manifesto};
const status: PipelineStatus = mensagem => { void mensagem; };
const workspace: PipelineWorkspaceIds = {wsProjetoId:'project',wsSessionId:'session'};
const api: PipelineApi = {compilarComPipeline,finalizarCompilacao};
const a: Promise<SavedCompilation> = api.compilarComPipeline({siteName:'Meu Site'},manifesto,user,status,workspace);
const b: Promise<SavedCompilation> = api.finalizarCompilacao('<html/>',ctx,user,status);
void a; void b;
// @ts-expect-error user.uid deve ser texto.
const badUser: PipelineUser = {uid:1,email:'u@example.test',plano:'free'};
void badUser;
// @ts-expect-error contexto exige manifesto.
finalizarCompilacao('<html/>',{slug:'site',siteNameSanitizado:'Site'},user);
// @ts-expect-error XML deve ser texto.
finalizarCompilacao(12,ctx,user);
// @ts-expect-error resultado é uma Promise.
const errado: SavedCompilation = compilarComPipeline({},manifesto,user);
void errado;

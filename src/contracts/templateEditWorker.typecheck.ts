import {
    mergeManifesto, aplicarEdicao, reverterParaVersao, _resumirManifesto,
} from '../core/templateEditWorker';
import type { TemplateEditWorkerApi, EditManifest, EditPatch, TemplateEditResult } from '../core/templateEditWorker';
import type { PipelineUser, PipelineStatus } from '../core/compilerPipeline';

const user: PipelineUser = { uid: 'u', email: 'user@example.test', plano: 'free' };
const status: PipelineStatus = _label => {};
const antigo: EditManifest = { siteName: 'Site do Usuário', modules: { darkMode: false }, categoryBadges: [] };
const patch: EditPatch = { modules: { darkMode: true }, categoryBadges: [{ nome: 'Tech' }] };
const novo: EditManifest = mergeManifesto(antigo, patch);
const resumo: EditManifest = _resumirManifesto(novo);
const api: TemplateEditWorkerApi = { mergeManifesto, aplicarEdicao, reverterParaVersao, _resumirManifesto };
const savedEdit: Promise<TemplateEditResult> = api.aplicarEdicao(antigo, patch, user, status, 'project', 'session', 'Mudou tema');
const savedRevert: Promise<TemplateEditResult> = api.reverterParaVersao(antigo, user, status, 'project', 'session');
void novo; void resumo; void savedEdit; void savedRevert;
// @ts-expect-error a entrada da edição exige um manifesto estruturado.
aplicarEdicao('texto', patch, user);
// @ts-expect-error camposAlterados não pode ser um número.
mergeManifesto(antigo, 4);
// @ts-expect-error user.uid deve ser textual.
reverterParaVersao(antigo, { uid: 4, email: 'x', plano: 'free' });
// @ts-expect-error a operação de edição é assíncrona.
const err: TemplateEditResult = aplicarEdicao(antigo, patch, user);
void err;

import { normalizarFlagsConteudo, normalizarTextosConteudo } from '../core/workerContent';
import type { WorkerConteudoInput, WorkerFlagsConteudo, WorkerTextosConteudo } from '../core/workerContent';
const input: WorkerConteudoInput = {
    enableSeo: 'false', lazyLoad: true,
    description: 'Loja', heroTitle: 'Bem-vindo', heroSubtitle: 'Catálogo',
};
const flags: WorkerFlagsConteudo = normalizarFlagsConteudo(input);
const textos: WorkerTextosConteudo = normalizarTextosConteudo(input);
void flags;
void textos;
// @ts-expect-error seoAtivo exige boolean.
const invalidFlags: WorkerFlagsConteudo = { seoAtivo: 'true', lazyLoadAtivo: true };
void invalidFlags;
// @ts-expect-error heroTitle exige texto ou null.
const invalidTextos: WorkerTextosConteudo = { description: null, heroTitle: 42, heroSubtitle: null, buttonStyle: 'default' };
void invalidTextos;

import { normalizarIdentidadeSite, resolverLayoutPadrao } from '../core/workerLayout';
import type { WorkerLayoutInputs, WorkerLayoutDefaults } from '../core/workerLayout';
const id = normalizarIdentidadeSite('Café');
const input: WorkerLayoutInputs = {
    siteNameBruto:id.siteNameBruto,nichoTema:null,nichoDefaults:{gridLayout:'lista'},
    pageTypeParaNicho:()=>null,hashSeed:()=>9,
};
const layout: WorkerLayoutDefaults = resolverLayoutPadrao(input);
void layout;
// @ts-expect-error hashSeed deve retornar um número.
const wrongHash: WorkerLayoutInputs = {...input,hashSeed:()=> 'nove'};
void wrongHash;
// @ts-expect-error gridLayout padrão deve ser string.
const wrongDefault: WorkerLayoutInputs = {...input,nichoDefaults:{gridLayout:8}};
void wrongDefault;

import { normalizarManifesto } from '../core/workerManifest';
import type { NormalizedWorkerManifest, WorkerManifestDependencies, WorkerManifestInput } from '../core/workerManifest';
import type { CompilerTemplateOptions } from './compiler';

const deps: WorkerManifestDependencies = {
    enums: { gridLayout: ['revista', 'mural'], colorPreset: ['tech-blue'] },
    nicheVoiceMap: {},
    colorVoiceHints: {},
    chassisParaNicho: () => null,
    pageTypeParaNicho: () => null,
    modulosPadraoDoNicho: () => ({}),
    hashSeed: () => 7,
    avisarNichoInvalido: () => {},
};
const input: WorkerManifestInput = { siteName: 'Minha Loja', enableSeo: true, heroTitle: 'Título' };
const params: NormalizedWorkerManifest = normalizarManifesto(input, deps);
const compilerOptions: CompilerTemplateOptions = {
    siteName: params.siteName,
    description: params.description,
    enableSeo: params.seoAtivo,
    gridLayout: params.gridLayout,
    colorPreset: params.colorPreset,
    buttonStyle: params.buttonStyle,
    typography: params.typography,
    modules: params.modulosAtivos,
    categoryBadges: params.badgesProcessados,
    lazyLoad: params.lazyLoadAtivo,
    nichoTema: params.nichoTema,
    footerStyle: params.footerStyle,
    sidebarPosition: params.sidebarPosition,
    heroTitle: params.heroTitle,
    heroSubtitle: params.heroSubtitle,
    designVoice: params.designVoice,
};
void compilerOptions;
// @ts-expect-error contrato interno exige hashSeed numérico.
const invalidHash: WorkerManifestDependencies = { ...deps, hashSeed: () => 'wrong' };
void invalidHash;
// @ts-expect-error tipagem exige slug textual.
const invalidSlug: NormalizedWorkerManifest = { ...params, slug: 8 };
void invalidSlug;

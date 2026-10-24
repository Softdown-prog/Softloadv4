import { resolverEnum, resolverDesignVoice } from './workerInput';
import type { WorkerEnums, VoiceHints } from './workerInput';
import { normalizarModulosAtivos, normalizarBadgesCategoria } from './workerNormalize';
import type { BadgeProcessado, NicheModuleDefaults } from './workerNormalize';
import { normalizarIdentidadeSite, resolverLayoutPadrao } from './workerLayout';
import { normalizarFlagsConteudo, normalizarTextosConteudo } from './workerContent';
import type { WorkerConteudoInput } from './workerContent';
import { sanitizarInput } from './compilerEngine/sanitize';

export interface WorkerManifestInput extends WorkerConteudoInput {
    siteName?: unknown;
    nichoTema?: unknown;
    modules?: unknown;
    categoryBadges?: unknown;
    colorPreset?: unknown;
    typography?: unknown;
    gridLayout?: unknown;
    footerStyle?: unknown;
    sidebarPosition?: unknown;
    designVoice?: unknown;
}

/** Funções legadas que continuam sendo fornecidas pelo compilerWorker.js. */
export interface WorkerManifestDependencies {
    enums: WorkerEnums;
    nicheVoiceMap: VoiceHints;
    colorVoiceHints: VoiceHints;
    chassisParaNicho: (nicho: string) => string | null;
    pageTypeParaNicho: (nicho: string | null) => string | null;
    modulosPadraoDoNicho: (nicho: string | null) => NicheModuleDefaults & { gridLayout?: string | null };
    hashSeed: (seed: string) => number;
    avisarNichoInvalido: (raw: string) => void;
}

/** Contrato interno produzido após validarManifesto(), nunca enviado à API. */
export interface NormalizedWorkerManifest {
    siteName: string;
    siteNameSanitizado: string;
    description: string | null;
    seoAtivo: boolean;
    lazyLoadAtivo: boolean;
    modulosAtivos: Record<string, unknown>;
    badgesProcessados: BadgeProcessado[];
    slug: string;
    nichoTema: string | null;
    pageType: string | null;
    colorPreset: string;
    typography: string;
    gridLayout: string;
    buttonStyle: string;
    footerStyle: string;
    sidebarPosition: string;
    heroTitle: string | null;
    heroSubtitle: string | null;
    designVoice: string;
}

/**
 * Orquestrador tipado do manifesto. Preserva a ordem de avaliação legada:
 * flags → nicho/aviso → defaults de módulos → badges → identidade/layout
 * → textos → propriedades normalizadas. O worker valida o HTTP antes de chamar.
 */
export function normalizarManifesto(
    body: WorkerManifestInput,
    deps: WorkerManifestDependencies,
): NormalizedWorkerManifest {
    const { seoAtivo, lazyLoadAtivo } = normalizarFlagsConteudo(body);

    const nichoTemaRaw = typeof body.nichoTema === 'string' ? body.nichoTema.trim() : '';
    const nichoTemaNorm = nichoTemaRaw.replace(/^tema-/, '').toLowerCase();
    const nichoTema = deps.chassisParaNicho(nichoTemaNorm)
        ? nichoTemaNorm
        : (nichoTemaRaw ? (deps.avisarNichoInvalido(nichoTemaRaw), null) : null);

    const nichoDefaults = deps.modulosPadraoDoNicho(nichoTema);
    const modulosAtivos = normalizarModulosAtivos(body.modules, nichoDefaults);
    const badgesProcessados = normalizarBadgesCategoria(body.categoryBadges);

    const { siteNameBruto, slug } = normalizarIdentidadeSite(body.siteName);
    const { pageTypeAtual, gridLayoutDefault, sidebarPositionDefault } = resolverLayoutPadrao({
        siteNameBruto, nichoTema, nichoDefaults,
        pageTypeParaNicho: deps.pageTypeParaNicho, hashSeed: deps.hashSeed,
    });

    const { description, heroTitle, heroSubtitle, buttonStyle } = normalizarTextosConteudo(body);

    return {
        siteName: siteNameBruto,
        siteNameSanitizado: sanitizarInput(siteNameBruto),
        description,
        seoAtivo,
        lazyLoadAtivo,
        modulosAtivos,
        badgesProcessados,
        slug,
        nichoTema,
        pageType: pageTypeAtual,
        colorPreset: resolverEnum(body.colorPreset, 'colorPreset', 'tech-blue', deps.enums),
        typography: resolverEnum(body.typography, 'typography', 'inter', deps.enums),
        gridLayout: resolverEnum(body.gridLayout, 'gridLayout', gridLayoutDefault, deps.enums),
        buttonStyle,
        footerStyle: resolverEnum(body.footerStyle, 'footerStyle', 'advanced-3-cols', deps.enums),
        sidebarPosition: resolverEnum(body.sidebarPosition, 'sidebarPosition', sidebarPositionDefault, deps.enums),
        heroTitle,
        heroSubtitle,
        designVoice: resolverDesignVoice(body.designVoice, body.nichoTema, body.colorPreset,
            deps.enums, deps.nicheVoiceMap, deps.colorVoiceHints),
    };
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizarManifesto = normalizarManifesto;
const workerInput_1 = require("./workerInput");
const workerNormalize_1 = require("./workerNormalize");
const workerLayout_1 = require("./workerLayout");
const workerContent_1 = require("./workerContent");
const sanitize_1 = require("./compilerEngine/sanitize");
/**
 * Orquestrador tipado do manifesto. Preserva a ordem de avaliação legada:
 * flags → nicho/aviso → defaults de módulos → badges → identidade/layout
 * → textos → propriedades normalizadas. O worker valida o HTTP antes de chamar.
 */
function normalizarManifesto(body, deps) {
    const { seoAtivo, lazyLoadAtivo } = (0, workerContent_1.normalizarFlagsConteudo)(body);
    const nichoTemaRaw = typeof body.nichoTema === 'string' ? body.nichoTema.trim() : '';
    const nichoTemaNorm = nichoTemaRaw.replace(/^tema-/, '').toLowerCase();
    const nichoTema = deps.chassisParaNicho(nichoTemaNorm)
        ? nichoTemaNorm
        : (nichoTemaRaw ? (deps.avisarNichoInvalido(nichoTemaRaw), null) : null);
    const nichoDefaults = deps.modulosPadraoDoNicho(nichoTema);
    const modulosAtivos = (0, workerNormalize_1.normalizarModulosAtivos)(body.modules, nichoDefaults);
    const badgesProcessados = (0, workerNormalize_1.normalizarBadgesCategoria)(body.categoryBadges);
    const { siteNameBruto, slug } = (0, workerLayout_1.normalizarIdentidadeSite)(body.siteName);
    const { pageTypeAtual, gridLayoutDefault, sidebarPositionDefault } = (0, workerLayout_1.resolverLayoutPadrao)({
        siteNameBruto, nichoTema, nichoDefaults,
        pageTypeParaNicho: deps.pageTypeParaNicho, hashSeed: deps.hashSeed,
    });
    const { description, heroTitle, heroSubtitle, buttonStyle } = (0, workerContent_1.normalizarTextosConteudo)(body);
    return {
        siteName: siteNameBruto,
        siteNameSanitizado: (0, sanitize_1.sanitizarInput)(siteNameBruto),
        description,
        seoAtivo,
        lazyLoadAtivo,
        modulosAtivos,
        badgesProcessados,
        slug,
        nichoTema,
        pageType: pageTypeAtual,
        colorPreset: (0, workerInput_1.resolverEnum)(body.colorPreset, 'colorPreset', 'tech-blue', deps.enums),
        typography: (0, workerInput_1.resolverEnum)(body.typography, 'typography', 'inter', deps.enums),
        gridLayout: (0, workerInput_1.resolverEnum)(body.gridLayout, 'gridLayout', gridLayoutDefault, deps.enums),
        buttonStyle,
        footerStyle: (0, workerInput_1.resolverEnum)(body.footerStyle, 'footerStyle', 'advanced-3-cols', deps.enums),
        sidebarPosition: (0, workerInput_1.resolverEnum)(body.sidebarPosition, 'sidebarPosition', sidebarPositionDefault, deps.enums),
        heroTitle,
        heroSubtitle,
        designVoice: (0, workerInput_1.resolverDesignVoice)(body.designVoice, body.nichoTema, body.colorPreset, deps.enums, deps.nicheVoiceMap, deps.colorVoiceHints),
    };
}

"use strict";
/**
 * Identidade do site e defaults determinísticos de layout.
 * Não valida manifesto HTTP e não altera escolhas explícitas do usuário.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizarIdentidadeSite = normalizarIdentidadeSite;
exports.resolverLayoutPadrao = resolverLayoutPadrao;
/** Mantém truncamentos em unidades UTF-16 e a normalização NFD legada. */
function normalizarIdentidadeSite(siteName) {
    const siteNameBruto = String(siteName).trim().substring(0, 60);
    const slug = siteNameBruto.toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .substring(0, 40) || 'template';
    return { siteNameBruto, slug };
}
// Duplicação intencional: mesmo mapa legado do compilerWorker; espelha as
// preferências de página do fluxo de chat, mas sem criar dependência circular.
const PAGINA_TIPO_GRID_ALTERNATIVAS = {
    'portal-noticias': ['mural', 'revista'],
    'magazine': ['revista', 'mural'],
    'documentacao': ['lista', 'dupla'],
    'catalogo-produtos': ['quadrado', 'mural'],
};
/**
 * Seeds idênticos ao worker original. Nunca chamar Math.random nem trocar
 * o hash usado pelo blockLibrary; os mesmos sites mantêm a mesma grade.
 */
function resolverLayoutPadrao(input) {
    const { siteNameBruto, nichoTema, nichoDefaults, pageTypeParaNicho, hashSeed } = input;
    const escolherEntre2PorSeed = (seed, papel, opcoes) => opcoes[hashSeed((seed || '') + ':' + papel) % opcoes.length];
    const seedLayout = siteNameBruto + (nichoTema || '');
    const pageTypeAtual = pageTypeParaNicho(nichoTema);
    const gridAlternativas = PAGINA_TIPO_GRID_ALTERNATIVAS[pageTypeAtual ?? ''];
    const gridLayoutDefault = gridAlternativas
        ? escolherEntre2PorSeed(seedLayout, 'gridlayout', gridAlternativas)
        : (nichoDefaults.gridLayout || 'revista');
    const sidebarPositionDefault = escolherEntre2PorSeed(seedLayout, 'sidebar', ['right', 'left']);
    return { pageTypeAtual, gridLayoutDefault, sidebarPositionDefault };
}

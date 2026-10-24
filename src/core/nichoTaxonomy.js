"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAGE_TYPES_SEM_CHASSIS_DEDICADO = exports.PAGE_TYPES_VALIDOS = exports.NICHO_CHASSIS_MAP = exports.NICHO_PAGE_TYPE_MAP = void 0;
exports.pageTypeParaNicho = pageTypeParaNicho;
exports.chassisParaNicho = chassisParaNicho;
// ──────────────────────────────────────────────────────────────────────────
// Fonte única de verdade: nichoTema → pageType (eixo de ESTRUTURA) e
// nichoTema → chassis (arquivo template_*.xml que efetivamente compila).
//
// Antes desta unificação, blueprintCritics.js (fluxo de chat/IA) e
// compilerWorker.js (fluxo determinístico do Workspace) mantinham duas
// tabelas nichoTema→algo separadas e nunca sincronizadas — resultado:
// tecnologia-techwind tinha pageType='blogger-conteudo' na tabela da IA
// mas compilava no chassis 'magazine', uma incoerência silenciosa.
//
// pageType e chassis são eixos relacionados mas não 1:1: um pageType pode
// abranger mais de um chassis (ex: 'landing-page' cobre tanto o chassis
// 'saas' quanto o 'portfolio' — variações legítimas dentro da mesma
// categoria estrutural). O que este módulo garante é que os DOIS fluxos
// (IA e compilador) leem a mesma definição de cada nicho, em vez de cada
// um ter sua própria cópia que pode divergir com o tempo.
// ──────────────────────────────────────────────────────────────────────────
// nichoTema → pageType (categoria estrutural: o que a página FAZ)
const NICHO_PAGE_TYPE_MAP = {
    // blogger-conteudo — feed de posts, sidebar, grid configurável
    'gamer-playerone': 'blogger-conteudo',
    'pop-retro-pixel': 'blogger-conteudo',
    'culinaria-boutique-gourmet': 'blogger-conteudo',
    'natureza-bulma-vegan': 'blogger-conteudo',
    // portal-noticias — breaking news, muitos posts, ticker, múltiplos editores
    'noticias-mag-news': 'portal-noticias',
    'tecnologia-mag-tech': 'portal-noticias',
    // tecnologia-techwind tem ticker de notícias na top-bar (ver tema-tecnologia-techwind-meta.json)
    // e compila no chassis 'magazine' — estrutura de portal, não de blog clássico com sidebar.
    'tecnologia-techwind': 'portal-noticias',
    // magazine — curadoria editorial, hero mosaico, categorias visuais
    'viral-magazine': 'magazine',
    // landing-page — hero split + features + pricing, sem feed configurável
    'saas-nexus': 'landing-page',
    'brutalista-appcraft': 'landing-page',
    'portfolio-minimalista': 'landing-page',
    'aquarela': 'landing-page',
    // biolink — link-in-bio, perfil + botões sociais, sem feed de posts
    'biolink-social': 'biolink',
    // documentacao — e-learning, TOC, módulos, progress tracking
    'elearning-academy': 'documentacao',
    // catalogo-produtos — grade de apps/produtos, cards ícone+preço+botão
    'appstore-bulma-mobile': 'catalogo-produtos',
};
exports.NICHO_PAGE_TYPE_MAP = NICHO_PAGE_TYPE_MAP;
// nichoTema → chassis (arquivo template_*.xml carregado por carregarChassis()
// em compilerWorker.js). 'blog' é o fallback de fato para os pageTypes que
// ainda não têm chassis dedicado (ver PAGE_TYPES_SEM_CHASSIS_DEDICADO abaixo).
const NICHO_CHASSIS_MAP = {
    // magazine — estrutura de portal com hero wrapper + grid de notícias
    'noticias-mag-news': 'magazine',
    'viral-magazine': 'magazine',
    'tecnologia-mag-tech': 'magazine',
    'tecnologia-techwind': 'magazine', // blog técnico com carousel/ticker → usa hero slot do magazine
    // blog — estrutura de blog com sidebar + grid de posts
    'gamer-playerone': 'blog',
    'culinaria-boutique-gourmet': 'blog',
    'natureza-bulma-vegan': 'blog',
    'pop-retro-pixel': 'blog',
    // fallback: sem chassis dedicado ainda (ver PAGE_TYPES_SEM_CHASSIS_DEDICADO) — v2
    'elearning-academy': 'blog',
    'appstore-bulma-mobile': 'blog',
    // portfolio
    'portfolio-minimalista': 'portfolio',
    'aquarela': 'portfolio',
    // saas — landing page com hero split + feature cards + pricing
    'saas-nexus': 'saas',
    'brutalista-appcraft': 'saas',
    // biolink
    'biolink-social': 'biolink',
};
exports.NICHO_CHASSIS_MAP = NICHO_CHASSIS_MAP;
const PAGE_TYPES_VALIDOS = new Set([
    'blogger-conteudo', 'landing-page', 'portal-noticias',
    'magazine', 'biolink', 'documentacao', 'catalogo-produtos',
]);
exports.PAGE_TYPES_VALIDOS = PAGE_TYPES_VALIDOS;
// pageTypes sem chassis próprio — compilam no chassis mais próximo
// disponível ('blog') em vez de um chassis desenhado pra sua estrutura real
// (documentacao precisaria de TOC/módulos/progresso; catalogo-produtos
// precisaria de grade sem sidebar). Fallback documentado, não silencioso.
// Construir os chassis dedicados fica para uma iteração futura.
const PAGE_TYPES_SEM_CHASSIS_DEDICADO = new Set(['documentacao', 'catalogo-produtos']);
exports.PAGE_TYPES_SEM_CHASSIS_DEDICADO = PAGE_TYPES_SEM_CHASSIS_DEDICADO;
function pageTypeParaNicho(nichoTema) {
    return NICHO_PAGE_TYPE_MAP[nichoTema] || null;
}
function chassisParaNicho(nichoTema) {
    return NICHO_CHASSIS_MAP[nichoTema] || null;
}

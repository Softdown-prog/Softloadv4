"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SECOES_MOBILIA_ESPERADAS = void 0;
exports.verificarSecoesPreenchidas = verificarSecoesPreenchidas;
exports.verificarDomIdsNoOutput = verificarDomIdsNoOutput;
// ============================================================
// DOSSIÊ INTEGRITY CHECKER — verificação mecânica pós-compilação.
//
// Para cada peça do dossiê que declara domIds (só peças com "html"
// próprio precisam — ver dossieValidator.js), confirma que todo id
// aparece de fato no XML compilado. Fecha a classe de bug "CSS/JS
// órfão sem HTML correspondente" (13 casos encontrados em 6 nichos
// legados nesta sessão: banner de cookie, botão voltar-ao-topo,
// preloader, menu offcanvas com estilo/comportamento definidos mas
// sem o elemento existir na página) — aqui é contrato declarado pelo
// próprio nicho, não heurística.
// ============================================================
function _idApareceNoXml(xml, id) {
    return xml.includes(`id='${id}'`) || xml.includes(`id="${id}"`);
}
// ──────────────────────────────────────────────────────────────
// verificarSecoesPreenchidas — 2ª verificação mecânica, ortogonal à
// primeira: em vez de "todo domId do dossiê aparece no XML", checa
// "toda seção de mobília do CHASSIS que deveria ter sido preenchida
// (statsWidget/blogArchiveWidget/translateWidget/featuredPostWidget/
// labelCloudWidget/socialLinksWidget/contactForm/popularPostsRanking —
// ver modules.js) não ficou vazia (<b:section .../> auto-fechada)".
//
// Achado da investigação de qualidade dos templates (comparação com
// referências hand-built Bulma Vegan/Tech Wind): a Engine deixava toda
// seção de sidebar/rodapé do chassis vazia — o dono do site abria o
// painel de Layout do Blogger e via 8-11 caixas "Adicionar um Gadget"
// sem nada dentro. Fecha essa classe de regressão de forma permanente
// (mecânica, não heurística) — se algum wiring futuro remover um
// placeholder por engano, o teste do nicho correspondente quebra.
//
// Só cobre as seções que HOJE têm placeholder de mobília wired (ver
// template_blog.xml/template_magazine.xml/template_saas.xml/
// template_portfolio.xml/template_base.xml) — seções deliberadamente
// deixadas vazias (slots de anúncio, "Sobre o Autor" etc — sem gerador
// que preencha) não entram aqui, não são o que esta função audita.
// 'biolink' fica de fora do mapa: chassis de 1 seção só (hero-area),
// sem seção de mobília nenhuma, por design.
// ──────────────────────────────────────────────────────────────
exports.SECOES_MOBILIA_ESPERADAS = {
    blog: ['sidebar-top', 'sidebar', 'sidebar-bottom', 'post-sidebar', 'footer-2', 'footer-3'],
    magazine: ['sidebar-top', 'sidebar', 'sidebar-bottom', 'post-sidebar', 'footer-about', 'footer-categories', 'footer-links', 'footer-social'],
    saas: ['footer-brand', 'footer-1', 'footer-2', 'post-sidebar'],
    portfolio: ['footer-contact', 'footer-extra'],
    base: ['sidebar', 'footer-1', 'footer-2', 'footer-3'],
    // Entradas por-nicho (esqueleto próprio, ver plano "esqueleto por
    // nicho") — têm precedência sobre a entrada de chassis acima (ver
    // verificarSecoesPreenchidas). viral-magazine: mobília real de
    // template_viral-magazine.xml — 1 sidebar única (não 3 sub-seções) +
    // 3 colunas de rodapé (não 4).
    'viral-magazine': ['sidebar-right', 'footer-1', 'footer-2', 'footer-3'],
    // appstore-bulma-mobile: mobília real de
    // template_appstore-bulma-mobile.xml — 1 sidebar única (não 6
    // sub-seções com split list/post) + 3 colunas de rodapé (mesmos ids
    // do chassis, conteúdo diferente). before-post/after-post/
    // swipe-categories ficam de fora de propósito — são slots nativos
    // vazios por design (anúncio) ou condicionais (swipe-categories só
    // aparece fora de posts), não "mobília sempre preenchida".
    'appstore-bulma-mobile': ['sidebar', 'footer-1', 'footer-2', 'footer-3'],
    // noticias-mag-news: mobília real de
    // template_noticias-mag-news.xml — sidebar-trending-slider (peça
    // secao, sempre preenchida via NICHO_EXTRA_SECTIONS) + sidebar-trending
    // + sidebar-tags (1 seção cada, não a divisão sidebar-top/sidebar/
    // sidebar-bottom do chassis) + footer-1/2/3 (mesmos ids do chassis,
    // conteúdo real diferente). top-date/top-social/footer-copyright ficam
    // de fora de propósito — slots nativos vazios por design (baixo valor
    // no arquivo real).
    'noticias-mag-news': ['sidebar-trending', 'sidebar-tags', 'footer-1', 'footer-2', 'footer-3'],
    // tecnologia-techwind: mobília real de
    // template_tecnologia-techwind.xml — 1 sidebar única (não 3 sub-seções
    // do chassis) + 4 colunas de rodapé (footer-1/2/3/footer-contact —
    // mesmos ids do chassis onde bate, footer-contact é seção nova real).
    // before-post-content/after-post-content/top-ticker/top-social/
    // top-search/featured-full/featured-small-1/featured-small-2/
    // footer-branding/copyright-area ficam de fora de propósito — slots
    // nativos vazios por design (ver doc do topo do template).
    'tecnologia-techwind': ['sidebar', 'footer-1', 'footer-2', 'footer-3', 'footer-contact'],
    // aquarela: mobília real de template_aquarela.xml — só 2 seções
    // preenchidas por padrão (formulário de contato nativo + redes
    // sociais), landing page de 1 página sem sidebar/rodapé de blog.
    // 'main' (Blog1/Novidades) fica de fora de propósito — vazio quando
    // o dono do site não tem posts ainda, comportamento esperado (não
    // "mobília sempre preenchida").
    'aquarela': ['footer-contact', 'footer-social'],
    // elearning-academy: mobília real de template_elearning-academy.xml —
    // sidebar única (Stats + FeaturedPost via tokens, sempre ligados em
    // nichoModuleDefaults), footer-col-1 (LinkList1 nativo real) e
    // footer-col-2 (Label2 nativo real), home-hero (widget HTML89 sempre
    // presente como filho estático da section — só o conteúdo interno é
    // condicional a isHomepage, a própria b:widget nunca sai auto-fechada).
    'elearning-academy': ['sidebar', 'footer-col-1', 'footer-col-2', 'home-hero'],
    // saas-nexus: mobília real de template_saas-nexus.xml — pre-footer
    // (Stats + FeaturedPost), footer-links (BlogArchive + SocialLinks) e
    // footer-contact (ContactForm). 'top-bar' fica de fora de propósito —
    // slot nativo vazio por design (conteúdo real não batia com o
    // estilo da seção, ver doc do topo do template).
    'saas-nexus': ['pre-footer', 'footer-links', 'footer-contact'],
    // brutalista-appcraft: mobília real de template_brutalista-appcraft.xml
    // — footer-info (Stats + LabelCloud + FeaturedPost), footer-links
    // (SocialLinks + BlogArchive) e footer-contact (ContactForm).
    // sidebar-right (Translate) fica de fora do mapa: 1 widget nativo só,
    // já coberto pelo flag translateWidget em nichoModuleDefaults.js, sem
    // ganho adicional em auditar aqui. home-features fica de fora de
    // propósito — slot nativo vazio por design (ver doc do topo do
    // template).
    'brutalista-appcraft': ['footer-info', 'footer-links', 'footer-contact'],
    // culinaria-boutique-gourmet: mobília real de
    // template_culinaria-boutique-gourmet.xml — featured-small-1 (FeaturedPost,
    // vazio no arquivo real), footer-3 (SocialLinks, vazio no arquivo real) e
    // footer-contact (ContactForm, vazio no arquivo real) são os únicos 3
    // pontos que dependem 100% de token genérico pra não ficar vazio.
    // footer-2 fica de fora do mapa de propósito: sempre tem o Label1 nativo
    // real preenchendo, mesmo que BLOG_ARCHIVE_WIDGET resolva vazio.
    'culinaria-boutique-gourmet': ['featured-small-1', 'footer-3', 'footer-contact'],
    // gamer-playerone: mobília real de template_gamer-playerone.xml —
    // sidebar-top (PopularPosts1+FeaturedPost1), footer-col-1
    // (Translate1+Stats1) e footer-col-2 (Label1) ficam de fora do mapa de
    // propósito: widgets nativos verbatim sempre presentes, não dependem de
    // nenhum token/flag genérico que possa resolver vazio. Só top-bar-right
    // (SOCIAL_LINKS_WIDGET, depende de socialLinksWidget) e footer-col-4
    // (CONTACT_FORM, depende de contactForm) dependem de flag em
    // nichoModuleDefaults.js — únicos 2 pontos reais de risco.
    'gamer-playerone': ['top-bar-right', 'footer-col-4'],
    // natureza-bulma-vegan: mobília real de
    // template_natureza-bulma-vegan.xml — header-menu (LinkList1),
    // hero-section (Image1), main (Blog1), after-post-content
    // (HTML7+FeaturedPost1), sidebar-right (cookie banner+Translate1),
    // widget-html-1/2/outros-widgets-html (peças 'secao' do dossiê),
    // footer-left (Stats1) e footer-right (BlogArchive1+HTML5) sempre
    // têm widget nativo real, não dependem de token/flag genérico.
    // before-post-content (READING_TIME) e footer-center (CONTACT_FORM)
    // são os únicos 2 pontos reais que dependem de flag em
    // nichoModuleDefaults.js.
    'natureza-bulma-vegan': ['before-post-content', 'footer-center'],
    // pop-retro-pixel: mobília real de template_pop-retro-pixel.xml —
    // header-logo (Header1+HTML101), landing-content (HTML4+HTML1),
    // testimonials (HTML5), main (HTML3+Blog1) e sidebar (HTML6+
    // Translate1+Stats1+HTML2+HTML50) sempre têm widget nativo real,
    // mesmo com CONTACT_FORM (token) resolvendo vazio. home-hero fica de
    // fora do mapa de propósito — mesmo critério de gamer-playerone/
    // natureza-bulma-vegan: peça hero é 'protegida' (sempre populada),
    // não depende de flag em nichoModuleDefaults.js; checagem de
    // duplicidade/H1 é feita à parte (ID_SECAO_HERO_POR_NICHO em
    // compilerWorker.test.js). Array vazio explícito (não omitido) pra
    // não cair no fallback do chassis 'blog' (sidebar-top/sidebar-bottom/
    // post-sidebar/footer-2/footer-3 — ids que nem existem neste
    // esqueleto, checagem "passaria" sem checar nada de verdade).
    'pop-retro-pixel': [],
    // tecnologia-mag-tech: mobília real de template_tecnologia-mag-tech.xml
    // — header-logo (Header1), menu-area (LinkList1), featured-area
    // (HTML200, gated isHomepage), main (HTML1 real removido + Blog1),
    // sidebar-area (HTML150+PopularPosts1), footer-area-about (8 widgets:
    // Translate1/PageList1/PopularPosts2/Stats1/BlogArchive1/
    // FeaturedPost1/Image1/Text1), footer-area-search (ContactForm1
    // NATIVO — CSS real mira '.contact-form-button-submit', que bate
    // exatamente com a includable 'main' real do widget, sem token
    // genérico — +HTML300), footer-bottom-copy (Text999) e footer-social
    // (HTML400) sempre têm widget nativo real, chassis 'magazine'
    // genérico nunca usado. Array vazio explícito — mesmo motivo de
    // pop-retro-pixel (evita cair no fallback do chassis 'magazine',
    // que tem ids que nem existem neste esqueleto).
    'tecnologia-mag-tech': [],
};
// Retorna true se a tag <b:section ... id='X' ...> for self-closing
// (auto-fechada, '/>') no XML — ou seja, sem nenhum widget dentro.
// null se a seção nem existir nesse XML (chassis sem essa seção).
function _secaoAutoFechada(xml, id) {
    const re = new RegExp(`<b:section\\b[^>]*\\bid=['"]${id}['"][^>]*>`);
    const m = xml.match(re);
    if (!m)
        return null;
    return /\/>\s*$/.test(m[0]);
}
// nichoTema (opcional, 3º parâmetro) tem precedência sobre chassis — ver
// plano "esqueleto por nicho": um nicho com esqueleto próprio
// (template_<nicho>.xml) pode ter um conjunto de seções de mobília
// diferente do chassis de família genérico (SECOES_MOBILIA_ESPERADAS é
// indexado hoje só por chassis, blog/magazine/saas/portfolio/base — sem
// entrada por-nicho, um esqueleto novo que renomeie/remova essas seções
// faria esta checagem simplesmente não encontrar nada pra checar,
// "passando" em silêncio sem verificar nada de real). Retrocompatível:
// chamadas com só 2 argumentos continuam se comportando exatamente como
// antes.
function verificarSecoesPreenchidas(xmlFinal, chassis, nichoTema) {
    const erros = [];
    const secoes = (nichoTema && exports.SECOES_MOBILIA_ESPERADAS[nichoTema])
        || exports.SECOES_MOBILIA_ESPERADAS[chassis]
        || [];
    for (const id of secoes) {
        if (_secaoAutoFechada(xmlFinal, id) === true) {
            erros.push(`seção de mobília <b:section id='${id}'> saiu vazia (auto-fechada) no XML compilado — esperava ao menos 1 widget nativo (ver SECOES_MOBILIA_ESPERADAS em dossieIntegrityChecker.js).`);
        }
    }
    return { ok: erros.length === 0, erros };
}
// ──────────────────────────────────────────────────────────────
// verificarDomIdsNoOutput — checa integridade de um dossiê contra o
// XML final compilado. Retorna { ok, erros: string[] }. Nunca lança
// — quem chama (compilerWorker.js) decide bloquear.
// ──────────────────────────────────────────────────────────────
function verificarDomIdsNoOutput(xmlFinal, dossie) {
    const erros = [];
    if (typeof xmlFinal !== 'string' || !dossie || !Array.isArray(dossie.pecas)) {
        return { ok: true, erros };
    }
    for (const peca of dossie.pecas) {
        const domIds = Array.isArray(peca.domIds) ? peca.domIds : [];
        for (const id of domIds) {
            if (!_idApareceNoXml(xmlFinal, id)) {
                erros.push(`peça "${peca.id}" declara domIds incluindo #${id} mas o elemento id='${id}' não aparece no XML compilado — HTML órfão.`);
            }
        }
    }
    return { ok: erros.length === 0, erros };
}

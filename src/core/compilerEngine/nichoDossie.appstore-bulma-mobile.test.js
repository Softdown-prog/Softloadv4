'use strict';

/**
 * Teste de regressão do dossiê por nicho: appstore-bulma-mobile.
 *
 * Fase 1b do plano "esqueleto por nicho"
 * (/root/.claude/plans/indexed-jumping-treehouse.md) — o alvo real citado
 * pelo usuário ("isso resolve o problema do Bulma mobile", queixa
 * recorrente de meses de o template sempre sair com a mesma aparência).
 * Migrado do chassis genérico compartilhado ('blog', usado também por
 * gamer-playerone/culinaria-boutique-gourmet/natureza-bulma-vegan/
 * pop-retro-pixel/elearning-academy) pra um esqueleto PRÓPRIO
 * (template_appstore-bulma-mobile.xml), extraído da estrutura física real
 * de exemplos/appstore-bulma-mobile.xml. Diferente da Fase 1a
 * (viral-magazine, escolhido por baixa curadoria acoplada ao chassis),
 * este é o nicho com a curadoria MAIS pesadamente construída em cima das
 * peculiaridades do chassis genérico — a maioria dos achados abaixo é
 * exatamente essa curadoria sendo reaberta.
 *
 * Achados reais desta migração (lendo exemplos/appstore-bulma-mobile.xml e
 * comparando com o esqueleto anterior, chassis genérico 'blog'):
 *
 *   1. Estrutura real tem 10 seções (header-logo, header-menu [mantido
 *      como 'main-nav', ver achado 9], before-post, swipe-categories,
 *      main, after-post, sidebar, footer-1/2/3) — nenhuma bate 1:1 com as
 *      14 do chassis genérico (header-right, sidebar-author/sidebar-top/
 *      sidebar/sidebar-bottom/post-sidebar-top/post-sidebar com split
 *      list/post não existem no arquivo real).
 *   2. 'before-post' virou slot nativo vazio, novo — no arquivo real
 *      tinha um widget HTML "tempo de leitura" hand-rolled e morto
 *      (classes que nunca bateram com o chassis, variáveis CSS com
 *      prefixo "nat" nunca declaradas — mesmo padrão de copy-paste já
 *      visto em natureza-bulma-vegan). readingTime:true foi cogitado
 *      como substituto na época, mas removido de novo no achado 11 (nunca
 *      teve token real no esqueleto pra consumir a flag).
 *   3. 'swipe-categories' ganhou seção PRÓPRIA e real — antes a peça
 *      'swipe-menu-categorias' (já existente no dossiê, tipo hero) era
 *      forçada a reusar o slot genérico hero-area (gated por
 *      isMultipleItems, único ponto de injeção disponível antes desta
 *      migração). Agora gated por 'not data:view.isPost' — igual ao
 *      arquivo original.
 *   4. 'after-post' virou slot nativo vazio, novo — no arquivo real tinha
 *      um widget HTML "{Seu Ads Aqui}" (placeholder de anúncio de exemplo
 *      do próprio dono, mesmo padrão do 'hero-top' de viral-magazine).
 *   5. Sidebar colapsada pra 1 única seção 'sidebar' (era 6, com split
 *      list-view/post-view) — no arquivo real a MESMA sidebar aparece em
 *      toda página, com só FeaturedPost1 como widget nativo real (os
 *      outros 3 widgets HTML da sidebar real já estavam tratados: a
 *      heurística de detecção de 404 morta, achado antigo já excluído; o
 *      CSS de popular-posts-ranking-style já global via NICHO_CSS; o
 *      cookie banner injetado à parte via NICHO_WIDGETS_HTML).
 *   6. nichoModuleDefaults.js reauditado contra a mobília real: sem
 *      blogArchiveWidget/socialLinksWidget (não existem em lugar nenhum
 *      do arquivo real); contactForm:true adicionado (ContactForm1 real
 *      em footer-3, sem flag correspondente antes).
 *   7. Achados 1-5/7-10 da migração ORIGINAL (pré-esqueleto-próprio, ver
 *      histórico) continuam válidos e verificados abaixo — remapeamentos
 *      de seletor (.blog-post-body/aside .widget/.sl-header/.sl-footer),
 *      fix do bug rgba(var(--sl-primary),X), ERROR_404_APPSTORE, cookie
 *      card central. Nenhum foi desfeito por esta migração.
 *   8. id 'main-nav' mantido (não 'header-menu', como o arquivo real
 *      chama a seção) de propósito — é o mesmo id fixo que o módulo
 *      global MENU_DROPDOWN_PREFIXO usa (document.querySelector(
 *      '#main-nav ul'), hardcoded em modules.js) — renomear quebraria o
 *      mecanismo sem ganho real (diferença de nome, não de estrutura).
 *   9. CORREÇÃO (achado 8 do plano "esqueleto por nicho", mesmo tipo já
 *      aplicado em viral-magazine): os achados 1-8 (acima) tratavam só o
 *      b:section como "estrutura real" e mantinham o b:widget id='Blog1'
 *      (main/post — feed/card de posts, maior área visual da página)
 *      herdado verbatim do chassis genérico — post-destacado + grid, view
 *      de post único rica (breadcrumb, meta bar, imagem separada, tags,
 *      compartilhar, author box, relacionados). A peça
 *      'app-list-card-style' do dossiê já documentava o problema: suas
 *      classes (app-list-card/app-list-icon/btn-baixar-pill) eram coladas
 *      por cima do grid do chassis como remendo de compatibilidade, nunca
 *      a estrutura real. Comparação direta com
 *      exemplos/appstore-bulma-mobile.xml (achado provocado por feedback
 *      direto do usuário sobre o viral-magazine, generalizado pro lote
 *      inteiro) confirmou: a listagem real é uma lista chata (sem
 *      post-destacado, sem grid) — ícone-esquerda + título/autor/label +
 *      botão "Baixar"-à-direita, exatamente as classes que a peça já
 *      estilizava. Extraído verbatim, adaptado com os tokens de
 *      compile.js já usados no resto do esqueleto. A view de post único
 *      real é radicalmente mais simples: h1 (só em página avulsa/Page) +
 *      corpo em post-content — sem breadcrumb, meta, imagem separada,
 *      tags, compartilhar, comentários visíveis ou relacionados
 *      (widget-settings do Blog1 ligam comentário, mas o includable real
 *      nunca chama nada que os renderize — configuração morta no arquivo
 *      original). nichoModuleDefaults.js reauditado de novo:
 *      readingTime/shareButtons removidos (sem elemento real onde
 *      renderizar). A peça 'blockquote-appstore' tinha um "conserto"
 *      anterior que trocava o seletor real post-content pelo do chassis
 *      blog-post-body — revertido de volta pro seletor real. gridLayout
 *      mantido em nichoModuleDefaults.js mas sem efeito visual (mesmo
 *      trade-off documentado em viral-magazine) — a lista real nunca usa
 *      grid.
 *  15. Refinamento pós-migração (auditoria sistemática de todos os
 *      seletores CSS das peças do dossiê contra classes reais do arquivo,
 *      mesma técnica usada em noticias-mag-news): achado real — a
 *      `<header>`/`<footer>` do esqueleto próprio ainda usava
 *      .sl-header/.sl-footer (herdado do achado 7 original, "remapeado
 *      pro chassis" numa época em que o nicho ainda dependia dele) em vez
 *      das classes reais do arquivo (.site-header/.site-footer,
 *      confirmado em exemplos/appstore-bulma-mobile.xml). A peça
 *      'header-footer-accent' (borda no header, fundo no footer) e o
 *      próprio esqueleto (template_appstore-bulma-mobile.xml) foram
 *      revertidos de volta pros seletores reais. .sl-header-brand (classe
 *      do token HEADER_WIDGET genérico) e --sl-footer-bg (variável de
 *      design token compartilhada) NÃO foram tocados — não são o mesmo
 *      caso (não vieram do "remapeamento pro chassis", são infra
 *      genuinamente compartilhada entre nichos).
 *
 * Execute: node src/core/compilerEngine/nichoDossie.appstore-bulma-mobile.test.js
 */

const { carregarNichoDossie } = require('./dossieLoader');
const { validarDossie } = require('./dossieValidator');
const { verificarDomIdsNoOutput, verificarSecoesPreenchidas } = require('./dossieIntegrityChecker');
const { chassisParaNicho } = require('../nichoTaxonomy');
const { validarEscopoGlobal } = require('./workers/jsWorker');
const { validarTokensCss } = require('./workers/cssWorker');
const { executarCompilacao, carregarChassisParaNicho, verificarMarcadoresDesignPackage } = require('../compilerWorker');
const { checarSeo } = require('../diagnostico/seoChecker');
const { gerarDiagnostico } = require('../diagnostico');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

const NICHO = 'appstore-bulma-mobile';
const dossie = carregarNichoDossie(NICHO);

assert('dossiê carregado (não é null)', dossie !== null);
if (dossie) {
    const { erros, avisos } = validarDossie(dossie);
    assert('dossiê schema-válido (zero erros)', erros.length === 0, erros.join(' | '));
    assert('dossiê sem avisos', avisos.length === 0, avisos.join(' | '));
}

// A. Resolução nicho-primeiro (Fase 0) — carrega o esqueleto PRÓPRIO.
{
    const esqueleto = carregarChassisParaNicho(NICHO);
    assert('esqueleto próprio carregado (estrutura real, não chassis genérico)',
        esqueleto.includes("id='before-post'") && esqueleto.includes("id='swipe-categories'") && esqueleto.includes("id='after-post'"));
}

let xmlFinal = '';
try {
    ({ xmlFinal } = executarCompilacao({ siteName: 'Site Teste', nichoTema: NICHO, colorPreset: 'default' }));
    passed++;
} catch (e) {
    failed++;
    console.error(`  ❌ executarCompilacao() não lança erro — ${e.message}`);
}

if (dossie && xmlFinal) {
    const { ok, erros } = verificarDomIdsNoOutput(xmlFinal, dossie);
    assert('todo domId declarado aparece no XML compilado', ok, erros.join(' | '));
}

// Mobília do esqueleto PRÓPRIO (achado 5/6) — entrada por-nicho.
if (xmlFinal) {
    const { ok, erros } = verificarSecoesPreenchidas(xmlFinal, chassisParaNicho(NICHO), NICHO);
    assert('mobília do esqueleto próprio (sidebar/footer-1/2/3) sem seção vazia', ok, erros.join(' | '));
}

// Smoke-test do Design Package (achado 1 do plano "esqueleto por nicho").
if (xmlFinal) {
    const { ok, erros } = verificarMarcadoresDesignPackage(xmlFinal);
    assert('marcadores literais do Design Package presentes no esqueleto', ok, erros.join(' | '));
}

// B. Estrutura real (achados 1-5) — seções que só existem no esqueleto
// próprio, ausentes do chassis genérico de família.
assert("seção 'before-post' (estrutura real, ausente do chassis genérico) presente",
    xmlFinal.includes("id='before-post'"));
assert("seção 'swipe-categories' (estrutura real, própria) presente",
    xmlFinal.includes("id='swipe-categories'"));
assert("seção 'after-post' (estrutura real, ausente do chassis genérico) presente",
    xmlFinal.includes("id='after-post'"));
assert("sidebar única 'sidebar' (não sidebar-author/sidebar-top/sidebar-bottom/post-sidebar-top/post-sidebar)",
    xmlFinal.includes("id='sidebar'") && !xmlFinal.includes("id='sidebar-author'") && !xmlFinal.includes("id='post-sidebar-top'"));
assert("sem 'header-right' (não existe no arquivo real)",
    !xmlFinal.includes("id='header-right'"));

// C. Achado 3 — swipe menu com seção própria (não mais slot hero genérico).
assert('swipe-menu-categorias (peça do dossiê) presente dentro de swipe-categories',
    xmlFinal.includes("id='swipe-menu-categorias'") || xmlFinal.includes('id="swipe-menu-categorias"'));

// D. Achado 9 — Blog1 main/post extraído verbatim do arquivo real (lista
// chata, sem post-destacado nem grid; post único minimalista).
assert("classe 'app-list-card' (real) usada como card da listagem (não colada em cima de post-destacado/grid do chassis)",
    xmlFinal.includes("class='app-list-card d-flex align-items-center"));
assert("post-destacado do chassis (b:if cond='data:i == 0') NÃO presente",
    !xmlFinal.includes('data:i == 0'));
assert("grade antiga do chassis (row + g-4 do feed) NÃO presente",
    !xmlFinal.includes("class='row [[GRID_CLASS]] g-4'") && !xmlFinal.includes("row  g-4"));
assert("view de post único usa marcação real ('.post-content')",
    xmlFinal.includes("class='post-content'"));
assert('botão Baixar (APP_DOWNLOAD_CTA) presente na listagem', xmlFinal.includes('>Baixar<'));
assert('breadcrumb do post único (layout antigo do chassis) NÃO presente',
    !xmlFinal.includes("aria-label='breadcrumb'"));
assert("script morto de posts relacionados (alvejava container do layout antigo) NÃO presente",
    !xmlFinal.includes('sl-related-ready'));
assert("sl-author-box (author box do layout antigo) NÃO presente",
    !xmlFinal.includes("class='sl-author-box"));

// Achados da migração original — CSS isolado do bloco "=== CSS DO NICHO
// ===" pra não colidir com prosa de comentário do esqueleto (que também
// menciona essas classes/ids como documentação histórica).
{
    const cssMatch = xmlFinal.match(/\/\* === CSS DO NICHO ===+ \*\/\s*\n([\s\S]*?)\n\s*\]\]>/);
    assert('CSS do nicho extraído do XML', !!cssMatch);
    if (cssMatch) {
        const css = cssMatch[1];
        assert('.app-list-card/.app-list-icon/.btn-baixar-pill presentes',
            css.includes('.app-list-card {') && css.includes('.app-list-icon {') && css.includes('.btn-baixar-pill {'));
        assert('rgba(var(--sl-primary-rgb),X) (corrigido) presente, rgba(var(--sl-primary),X) (bug antigo) ausente',
            css.includes('rgba(var(--sl-primary-rgb),0.1)') && !css.includes('rgba(var(--sl-primary),'));
        assert('.post-content blockquote (achado 9: seletor real, revertido de volta) presente, .blog-post-body (chassis) ausente',
            css.includes('.post-content blockquote {') && !css.includes('.blog-post-body'));
        assert('aside .widget (remapeado) presente, .sidebar .widget (órfão) ausente',
            css.includes('aside .widget {') && !css.includes('.sidebar .widget'));
        assert('.site-header/.site-footer (achado 15: seletores reais, revertidos de volta) presentes, .sl-header/.sl-footer (chassis) ausentes',
            css.includes('.site-header { border-bottom: 2px solid var(--bulma-primary); }') &&
            !css.includes('.sl-header {') && !css.includes('.sl-footer {'));
        assert('#nat-hero-slider/#nat-back-to-top (copy-paste de outro nicho) NÃO presentes no CSS real',
            !css.includes('nat-hero-slider') && !css.includes('nat-back-to-top'));

        const tokensExternos = ['--sl-primary-rgb', '--sl-card-bg'];
        const r = validarTokensCss(css, { tokensExternos });
        assert('CSS do nicho sem variável CSS órfã', r.ok, JSON.stringify(r.erros));
    }
}

// Achado 7 — 404 nativo do Blogger via módulo global, heurística JS frágil excluída.
assert('ERROR_404_APPSTORE (data:view.isError) presente, bulma-404-gadget (heurística JS) ausente',
    xmlFinal.includes('data:view.isError') && xmlFinal.includes('error-icon-wrapper') && !xmlFinal.includes('bulma-404-gadget'));

// Achado 8 — menu dropdown prefixo via módulo global (id 'main-nav' mantido de propósito).
assert('#main-nav ul (módulo global real) presente, #dynamic-menu (JS morto) ausente',
    xmlFinal.includes('#main-nav ul') && !xmlFinal.includes('dynamic-menu'));

// Achado 9 — paginação nativa do chassis.
assert('paginação nativa do chassis (.sl-pagination) presente', xmlFinal.includes('sl-pagination'));

// Achado 10 — cookie card central mantido como peça própria.
assert('bulmaCookieBanner (card centralizado) presente', xmlFinal.includes('bulmaCookieBanner') && xmlFinal.includes('bulma_mobile_cookies_accepted'));

// Diagnóstico completo sem erro real.
{
    const diag = gerarDiagnostico(xmlFinal);
    const errosDiag = diag.categorias.flatMap(c => c.achados.filter(a => a.nivel === 'erro'));
    assert('gerarDiagnostico() sem erro real', errosDiag.length === 0, JSON.stringify(errosDiag));
}

// SEO sem erro estrutural.
{
    const achadosSeo = checarSeo(xmlFinal);
    const errosSeo = achadosSeo.filter(a => a.nivel === 'erro');
    assert('checarSeo() não encontra erro estrutural', errosSeo.length === 0, JSON.stringify(errosSeo));
}

// JS combinado não colide em escopo global.
{
    const blocos = [...xmlFinal.matchAll(/<script\b[^>]*>\s*\/\/<!\[CDATA\[([\s\S]*?)\/\/\]\]>\s*<\/script>/g)].map(m => m[1]);
    const { ok, erro } = validarEscopoGlobal(blocos);
    assert('JS do output não colide em escopo global', ok, erro);
}

console.log(`\n${failed === 0 ? '✅' : '❌'} nichoDossie.${NICHO}: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

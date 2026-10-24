'use strict';

/**
 * Teste de regressão do dossiê por nicho: viral-magazine.
 *
 * Fase 1a do plano "esqueleto por nicho"
 * (/root/.claude/plans/indexed-jumping-treehouse.md) — 1º nicho migrado do
 * chassis genérico compartilhado ('magazine', usado também por
 * noticias-mag-news/tecnologia-mag-tech/tecnologia-techwind) pra um
 * esqueleto PRÓPRIO (src/rag/templates/template_viral-magazine.xml),
 * extraído da estrutura física real de exemplos/viral-magazine.xml.
 * Escolhido como piloto de mecanismo por ter a menor "densidade de
 * gambiarra pro chassis" entre os candidatos avaliados (dossiê atual já
 * era só 2 achados, nenhum deles remapeamento de seletor pro chassis
 * genérico) — isola a validação do MECANISMO (extração → esqueleto →
 * resolução nicho-primeiro → compilação → verificação) de complicações de
 * conteúdo. compile.js e nichoBlocks.js não mudam — só o arquivo físico de
 * esqueleto carregado por compilerWorker.carregarChassisParaNicho().
 *
 * Achados reais desta migração (lendo exemplos/viral-magazine.xml e
 * comparando com template_magazine.xml):
 *
 *   1. Estrutura real tem 10 seções (header-logo, main-nav, hero-top,
 *      mag-block-1, mag-block-2, main, sidebar-right, footer-1/2/3) —
 *      nenhuma bate 1:1 com as 14 do chassis genérico (header-banner,
 *      sidebar-top/sidebar/sidebar-bottom, post-sidebar-top, footer-about/
 *      categories/links/social não existem no arquivo real).
 *   2. 'hero-top' virou slot nativo vazio — no arquivo real tinha um
 *      widget HTML "{Seu Ads Aqui}" (placeholder de anúncio de exemplo do
 *      próprio dono do arquivo), sem sentido herdar pra outros usuários.
 *   3. 'mag-block-1'/'mag-block-2' viraram slots nativos vazios — no
 *      arquivo real, mag-block-1 tinha um widget HTML autoral (slider
 *      "cyber-slider", já capturado no dossiê como peça 'cyber-slider-
 *      css-js', tipo modulo, css+js sem html). Remontar o html e religar
 *      como conteúdo nativo real (b:section/b:widget) é um follow-up
 *      dedicado — fora do escopo desta prova de mecanismo, pra manter o
 *      diff revisável. O CSS/JS continua no dossiê no mesmo estado de
 *      antes (já era efetivamente órfão no chassis genérico também — não
 *      é uma regressão introduzida aqui).
 *   4. Sidebar colapsada pra 1 única seção 'sidebar-right' (era 3:
 *      sidebar-top/sidebar/sidebar-bottom) — mobília real: Translate1 +
 *      Stats1 + PopularPosts1 (Label/social NÃO existem no sidebar real,
 *      só no footer). Footer colapsado pra 3 colunas (era 4) — mobília
 *      real: Label1 (footer-1) + FeaturedPost1 (footer-2) + ContactForm1
 *      (footer-3). nichoModuleDefaults.js reauditado: blogArchiveWidget/
 *      socialLinksWidget removidos (não existem em lugar nenhum do
 *      arquivo real); popularPostsRanking:true + contactForm:true
 *      adicionados (existiam mas não tinham placeholder real antes);
 *      darkMode:true adicionado (o arquivo real já tem toggle dedicado +
 *      FOUC-prevention + overrides [data-bs-theme="dark"], só faltava
 *      ligar o módulo genérico que dá o botão de fato).
 *   5. Header/nav reconstruído com a marcação real ('.site-header'/
 *      '.search-bar'/'.navbar', não '.sl-header'/'.sl-nav' do chassis) —
 *      a peça 'header-style' já existia no dossiê com CSS pra essas
 *      classes, mas nunca teve elemento real pra colar (documentado no
 *      próprio texto da peça: "fica como decisão de arquitetura
 *      separada" — só virou possível agora, com esqueleto próprio).
 *   6. Bug real corrigido na mesma peça 'header-style': "font:
 *      $(nav.font)" era sintaxe do Blogger Theme Designer nunca declarada
 *      em nenhum Variable do chassis (nem do antigo nem do novo esqueleto)
 *      — saía como CSS inválido literal no XML compilado (confirmado
 *      rodando executarCompilacao() antes da correção). Corrigido pra
 *      var(--sl-font-family) (token global já usado no resto do site).
 *   7. Widget de "Em Alta" (mag-sidebar-trending, hardcoded no chassis
 *      genérico, div + JS de fetch de posts recentes) removido — não
 *      existe no arquivo real deste nicho.
 *   8. CORREÇÃO: os achados 1-7 (acima) tratavam só o esqueleto de
 *      b:section (ids/ordem/nesting) como "estrutura real" e deixavam o
 *      b:widget id='Blog1' (includables main/post — o feed/card de posts,
 *      maior área visual de qualquer página de blog/magazine) herdado
 *      verbatim do chassis genérico. Feedback direto do usuário ("não
 *      chegou nem a vez do buzz isso não é meu padrão de design ainda,
 *      compara com os templates da pasta exemplos") forçou reabrir essa
 *      decisão: comparação direta confirmou que o Blog1 real usa
 *      '.blog-posts.hfeed' (lista simples empilhada, sem grid) + card
 *      '.mag-card' horizontal (imagem col-md-5 / conteúdo col-md-7,
 *      '.mag-badge'/'.mag-title-dark'/'.mag-excerpt'/'.mag-meta'/botão
 *      "Ler Mais") — nunca '.mag-feature-main'/'.news-card' (grid +
 *      3-post-hero) do chassis, que foi mantido por engano nas fases
 *      1a original e 1b. Corrigido extraindo main/post verbatim de
 *      exemplos/viral-magazine.xml (linhas 1103-1651), adaptado com os
 *      tokens de compile.js já usados no resto do esqueleto. View de
 *      post único também corrigida pra marcação real ('.post-header',
 *      '.post-body.entry-content', '.post-footer' com tags +
 *      '.related-posts-wrapper'). O script hardcoded de "posts
 *      relacionados" do chassis (que alvejava #sl-related-ready, nunca
 *      existiu no arquivo real) foi removido — a peça 'posts-
 *      relacionados-js' do dossiê (já existia, alvejava #vm-related-
 *      posts, estava órfã desde a migração original) agora tem elemento
 *      real pra colar pela primeira vez. Trade-off aceito e documentado:
 *      gridLayout não tem efeito visual neste nicho (feed real nunca usa
 *      grid) — mesmo padrão de "seletor irrelevante pro pageType" já
 *      usado em nichoModuleDefaults.js pra outros casos. CSS morto do
 *      layout antigo (.mag-feature-main/.mag-post-hero/.mag-post-meta/
 *      .sl-author-box e afins) removido do b:skin; as regras
 *      '.news-card' do DYNAMIC_CSS compartilhado (gerarGridCardCss(),
 *      usado por todos os nichos) permanecem como CSS morto inofensivo
 *      (nenhum elemento '.news-card' existe pra combinar) — não alterado
 *      por ser código compartilhado entre nichos.
 *   9. Bug real corrigido na peça 'cyber-slider-css-js' (achado provocado
 *      por feedback direto do usuário — template baixado ainda mostrava
 *      2 buracos vazios entre o hero e o feed): a peça (tipo modulo,
 *      html vazio) alegava na própria descrição que a fonte "não tinha
 *      função de popular os slides via feed" — falso, bug de extração:
 *      o walker legado capturou o CSS + a lógica de rotação/nav
 *      (moveCyberSlide/iniciarCyberRotacao/resetCyberRotacao) mas perdeu
 *      o bloco DOMContentLoaded que faz fetch em /feeds/posts/default e
 *      monta os slides (confirmado lendo exemplos/viral-magazine.xml
 *      linhas 960-1032, função completa e funcional lá). Reescrita como
 *      peça tipo secao (agora id 'mag-block-1', b:widget HTML completo
 *      extraído verbatim das linhas 818-1073 do arquivo real — style +
 *      div + script autocontidos dentro do próprio widget-setting
 *      content) porque 'mag-block-1' é uma b:section nativa que já
 *      existe no esqueleto — o widget precisa encaixar dentro dela, não
 *      ficar solto no blob geral de CSS/JS (que é onde peça tipo modulo
 *      vai parar). O token NICHO_EXTRA_SECTIONS, antes só declarado
 *      dentro do gate isMultipleItems sem nenhuma peça pra preencher,
 *      foi movido pro lugar exato de 'mag-block-1' — igual ao arquivo
 *      real, incondicional (aparece em toda página, não só na home).
 *      'mag-block-2' continua slot nativo vazio de propósito — no
 *      arquivo real também é uma b:section sem widget nenhum dentro.
 *
 * Execute: node src/core/compilerEngine/nichoDossie.viral-magazine.test.js
 */

const { carregarNichoDossie } = require('./dossieLoader');
const { validarDossie } = require('./dossieValidator');
const { verificarDomIdsNoOutput, verificarSecoesPreenchidas } = require('./dossieIntegrityChecker');
const { chassisParaNicho } = require('../nichoTaxonomy');
const { validarEscopoGlobal } = require('./workers/jsWorker');
const { validarTokensCss } = require('./workers/cssWorker');
const { TOKENS_GLOBAIS_CHASSIS } = require('./designTokensCss');
const { executarCompilacao, carregarChassisParaNicho, verificarMarcadoresDesignPackage } = require('../compilerWorker');
const { checarSeo } = require('../diagnostico/seoChecker');
const { gerarDiagnostico } = require('../diagnostico');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

const NICHO = 'viral-magazine';
const dossie = carregarNichoDossie(NICHO);

assert('dossiê carregado (não é null)', dossie !== null);
if (dossie) {
    const { erros, avisos } = validarDossie(dossie);
    assert('dossiê schema-válido (zero erros)', erros.length === 0, erros.join(' | '));
    assert('dossiê sem avisos', avisos.length === 0, avisos.join(' | '));
}

// A. Resolução nicho-primeiro (Fase 0) — carrega o esqueleto PRÓPRIO, não
// o chassis de família genérico.
{
    const esqueleto = carregarChassisParaNicho(NICHO);
    assert('esqueleto próprio carregado (estrutura real, não chassis genérico)',
        esqueleto.includes("id='sidebar-right'") && esqueleto.includes("id='mag-block-2'"));
}

let xmlFinal = '';
try {
    ({ xmlFinal } = executarCompilacao({ siteName: 'Site Teste', nichoTema: NICHO, colorPreset: 'tech-blue' }));
    passed++;
} catch (e) {
    failed++;
    console.error(`  ❌ executarCompilacao() não lança erro — ${e.message}`);
}

if (dossie && xmlFinal) {
    const { ok, erros } = verificarDomIdsNoOutput(xmlFinal, dossie);
    assert('todo domId declarado aparece no XML compilado', ok, erros.join(' | '));
}

// Mobília do esqueleto PRÓPRIO (achado 4) — entrada por-nicho em
// SECOES_MOBILIA_ESPERADAS, não a de chassis (que não bateria com a
// estrutura real: 1 sidebar-right, não 3 sub-seções).
if (xmlFinal) {
    const { ok, erros } = verificarSecoesPreenchidas(xmlFinal, chassisParaNicho(NICHO), NICHO);
    assert('mobília do esqueleto próprio (sidebar-right/footer-1/2/3) sem seção vazia', ok, erros.join(' | '));
}

// Smoke-test do Design Package (achado 1 do plano "esqueleto por nicho") —
// as 4 strings literais de injetarDesignPackage() sobrevivem no esqueleto
// próprio, sem rede de segurança automática (diferente do [[TOKEN]]).
if (xmlFinal) {
    const { ok, erros } = verificarMarcadoresDesignPackage(xmlFinal);
    assert('marcadores literais do Design Package presentes no esqueleto', ok, erros.join(' | '));
}

// B. Estrutura real (achado 1) — seções que só existem no esqueleto
// próprio, ausentes do chassis genérico de família.
assert("seção 'mag-block-1' (estrutura real, ausente do chassis genérico) presente",
    xmlFinal.includes("id='mag-block-1'"));
assert("seção 'sidebar-right' única (não sidebar-top/sidebar/sidebar-bottom) presente",
    xmlFinal.includes("id='sidebar-right'") && !xmlFinal.includes("id='sidebar-top'"));
assert("footer de 3 colunas reais (footer-1/2/3, não footer-about/categories/links/social)",
    xmlFinal.includes("id='footer-1'") && xmlFinal.includes("id='footer-2'") && xmlFinal.includes("id='footer-3'")
    && !xmlFinal.includes("id='footer-about'"));

// Hero grid presente e não duplicado (mesmo achado do dossiê original,
// agora dentro do wrapper b:section que o mecanismo de hero exige — ver
// achado 1 do header do esqueleto).
assert('hero grid (#js-hero-grid) presente no output',
    xmlFinal.includes("id='js-hero-grid'") || xmlFinal.includes('id="js-hero-grid"'));
assert('#js-hero-grid aparece 1x (não duplicado)',
    (xmlFinal.match(/id=['"]js-hero-grid['"]/g) || []).length === 1);

// Banner de cookie continua presente (achado original do dossiê, não
// afetado por esta migração).
assert('banner de cookie (#vm-cookie-banner) presente',
    xmlFinal.includes("id='vm-cookie-banner'") || xmlFinal.includes('id="vm-cookie-banner"'));
assert('botão aceitar cookie (#vm-cookie-accept) presente',
    xmlFinal.includes("id='vm-cookie-accept'") || xmlFinal.includes('id="vm-cookie-accept"'));

// C. Achado 5/6 — header-style agora tem elemento real pra colar, bug do
// $(nav.font) corrigido.
assert(".site-header/.navbar (marcação real) presentes no CSS do nicho",
    xmlFinal.includes('.site-header {') && xmlFinal.includes('.navbar {'));
assert('$(nav.font) (bug Blogger Theme Designer nunca declarado) NÃO presente',
    !xmlFinal.includes('$(nav.font)'));

// D. Achado 7 — widget "Em Alta" hardcoded do chassis genérico removido.
assert("mag-sidebar-trending (widget hardcoded do chassis, ausente do arquivo real) NÃO presente",
    !xmlFinal.includes('mag-sidebar-trending'));

// E. Achado 8 — Blog1 main/post extraído verbatim do arquivo real (feed
// sem grid + card horizontal), não mais herdado do chassis genérico.
assert("feed '.blog-posts.hfeed' (marcação real, sem grid) presente",
    xmlFinal.includes('blog-posts hfeed'));
assert("card '.mag-card' (real, horizontal) presente",
    xmlFinal.includes('mag-card'));
assert("'.mag-title-dark'/'.mag-excerpt' (real) presentes",
    xmlFinal.includes('mag-title-dark') && xmlFinal.includes('mag-excerpt'));
assert("'#vm-related-posts' (peça 'posts-relacionados-js' do dossiê agora com elemento real) presente",
    xmlFinal.includes("id='vm-related-posts'") || xmlFinal.includes('id="vm-related-posts"'));
assert("view de post único usa marcação real ('.post-body.entry-content')",
    xmlFinal.includes('post-body entry-content'));
assert("script hardcoded do chassis (#sl-related-ready, nunca existiu no arquivo real) NÃO presente",
    !xmlFinal.includes('sl-related-ready'));
assert("'.mag-feature-main'/'.mag-post-hero'/'.sl-author-box' (layout antigo herdado do chassis) NÃO presentes no b:skin",
    !xmlFinal.includes('mag-feature-main') && !xmlFinal.includes('mag-post-hero') && !xmlFinal.includes('sl-author-box'));

// F. Achado 9 — cyber-slider (mag-block-1) ligado de verdade, não mais
// slot vazio. b:section id='mag-block-1' agora vem com um b:widget
// dentro (via NICHO_EXTRA_SECTIONS), extraído verbatim do arquivo real.
assert("b:section 'mag-block-1' presente com b:widget dentro (não mais vazia)",
    /id='mag-block-1'[^>]*>\s*<b:widget/.test(xmlFinal));
assert("container real do slider (cyber-slider-widget) presente",
    xmlFinal.includes('id="cyber-slider-widget"'));
assert("função de fetch que popula os slides (bug de extração corrigido) presente",
    xmlFinal.includes('cyber-slider-track') && xmlFinal.includes('/feeds/posts/default'));
assert("lógica de rotação (moveCyberSlide/iniciarCyberRotacao) presente",
    xmlFinal.includes('moveCyberSlide') && xmlFinal.includes('iniciarCyberRotacao'));
assert("'mag-block-2' continua slot nativo vazio de propósito (igual ao arquivo real)",
    /id='mag-block-2'[^\/]*\/>/.test(xmlFinal));

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

// CSS do nicho sem variável órfã (tokens do dossiê + globais do chassis).
{
    const cssMatch = xmlFinal.match(/\/\* === CSS DO NICHO ===+ \*\/\s*\n([\s\S]*?)\n\s*\]\]>/);
    assert('CSS do nicho extraído do XML pro teste de variável órfã', !!cssMatch);
    if (cssMatch && dossie) {
        const tokensExternos = [
            ...Object.keys(dossie.tokensCss.light_mode || {}).filter(k => k.startsWith('--')),
            ...TOKENS_GLOBAIS_CHASSIS,
        ];
        const r = validarTokensCss(cssMatch[1], { tokensExternos });
        assert('CSS do nicho sem variável CSS órfã', r.ok, JSON.stringify(r.erros));
    }
}

// JS combinado não colide em escopo global.
{
    const blocos = [...xmlFinal.matchAll(/<script\b[^>]*>\s*\/\/<!\[CDATA\[([\s\S]*?)\/\/\]\]>\s*<\/script>/g)].map(m => m[1]);
    const { ok, erro } = validarEscopoGlobal(blocos);
    assert('JS do output não colide em escopo global', ok, erro);
}

console.log(`\n${failed === 0 ? '✅' : '❌'} nichoDossie.${NICHO}: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

require('../test/isolatedTelemetry.cjs');
'use strict';

/**
 * Teste de regressão da migração pro dossiê por nicho: noticias-mag-news
 * — 5º nicho migrado, mesmo chassis "magazine"/pageType "portal-noticias"
 * de tecnologia-techwind/tecnologia-mag-tech.
 *
 * Achados reais (test-compilando o cano legado e lendo o chassis de
 * verdade antes de migrar):
 *   1. Hero autoral nunca renderizado: "hero_mosaico" (CSS Grid com post
 *      principal 2fr + 2 secundários 1fr — feature distintiva do nicho)
 *      era sempre descartado pelo walker legado em favor de um hero
 *      genérico do block library (headlines fixas tipo "Crise Hídrica
 *      Atinge Grandes Cidades", sem relação com o nicho) — mesmo bug já
 *      fechado em culinaria-boutique-gourmet. [POST_1]/[POST_2] eram
 *      placeholders de "estrutura similar ao post 0" no impl.json
 *      original, nunca expandidos — expandidos aqui espelhando a
 *      estrutura completa do post 0.
 *   2. --font-text incorretamente aliasado: a heurística tokenVar() de
 *      nichoImpl.js casa qualquer chave terminando em "-text" com o
 *      token de COR --sl-text-main — mas "--font-text" é uma declaração
 *      de FONTE (Inter, sans-serif), não de cor. O CSS legado gerava
 *      "--font-text: var(--sl-text-main)", quebrando font-family em todo
 *      lugar que usa var(--font-text). Dossiê usa o valor literal do
 *      meta.json diretamente.
 *   3. Três seletores CSS órfãos (classes que nunca existiram no chassis
 *      real, herdadas de um template hand-built original diferente do
 *      chassis do Softload): ".post-body-content" → corrigido pra
 *      ".post-body"; ".mag-footer" → corrigido pra ".sl-footer";
 *      ".popular-posts" (minúsculo) → corrigido pra ".PopularPosts"
 *      (classe real do widget Blogger, PascalCase).
 *   4. Features excluídas do dossiê (documentado, não inventado):
 *      "label_pills_editorial" (fonte incompleta — só listas de
 *      propriedades, sem seletor concreto, extração fiel exigiria
 *      inventar seletor); "js_leitura_no_post" (depende de
 *      #post-body-content/#read-time-calc, nenhum dos dois existe no
 *      chassis); "pagina_404"/"css_404" (chassis já tem
 *      [[ERROR_404_MODULE]] configurável — duplicaria); "post_single"/
 *      "news_card_grid" completos de html_estruturas (estruturas de
 *      página inteira de um template hand-built original — o chassis já
 *      renderiza post-single/grid de posts nativamente, sem ponto de
 *      substituição no modelo atual de dossiê).
 *
 * Atualizado quando o design real do usuário (exemplos/noticias-mag-news.xml,
 * renomeado de theme-3939438702693934260.xml — "MAG News (Editorial Premium)")
 * foi ligado ao dossiê (5º nicho da
 * rodada): as 9 peças "modulo" antigas foram substituídas por 51 peças CSS
 * granulares extraídas de verdade do arquivo hand-authored + 1 peça JS-only
 * carregada sem alteração do dossiê anterior (popular-posts-imagem-upgrade
 * — extrator não captura <script> solto fora de b:section). Hero
 * (#heroMosaicoNoticias, widgetNativo FeaturedPost) preservado sem
 * alteração.
 *
 * Achados reais desta migração:
 *   5. Duas peças excluídas por serem redundantes/mortas: "modulo-hero-
 *      mosaico-css-grid" (CSS idêntica à já embutida na peça hero
 *      protegida — duplicata) e "modulo-topo-date-social" (.top-bar,
 *      sem elemento correspondente em nenhum chassis, mesmo padrão já
 *      achado em gamer-playerone).
 *   6. Cabeçalho remapeado pros seletores reais do chassis magazine
 *      (.header-logo h1/.navbar-container/.nav-link nunca existiram —
 *      mesmo achado de gamer-playerone, agora em ".sl-header"/".sl-nav")
 *      — peça nova, o dossiê anterior nunca tinha incluído cabeçalho.
 *   7. tokensCss expandido: --mag-secondary (#6c757d) e --border-color
 *      (#dee2e6) — declarados no <Variable default=...> do Theme
 *      Designer original mas nunca redeclarados no bloco ":root" "de
 *      facto" hardcoded que o autor colou por cima (mesmo padrão da
 *      cor $(...) de culinaria-boutique-gourmet: o bloco com $(...) é
 *      redundante e foi descartado, MAS ele é a única fonte real desses
 *      2 tokens específicos — sem adicioná-los ao tokensCss, ficariam
 *      órfãos em ~10 peças que os usam sem fallback).
 *   8. --font-body (nome real usado no arquivo original) renomeado pro
 *      nome já usado no tokensCss deste dossiê (--font-text).
 *   9. Nenhum recurso genérico já coberto pelo chassis foi duplicado: o
 *      JS solto do arquivo original tinha cookie banner, toggle de dark
 *      mode, formulário de newsletter via AJAX, Google Translate, tempo
 *      de leitura customizado e um slider de últimas postagens — todos
 *      já cobertos por flags genéricas já ativas em
 *      nichoModuleDefaults.js (readingTime/sliderJson/backToTop, +
 *      [[COOKIE_MODULE]]/[[DARK_MODE_MODULE]]/[[FOOTER_NEWSLETTER]]/
 *      [[TRANSLATE_WIDGET]] do chassis) — duplicar reintroduziria
 *      feature redundante (mesma lição de REVIEW_ENGINE em
 *      gamer-playerone).
 *
 * ── ESQUELETO PRÓPRIO (Fase 2, 1/11 — ver plano "esqueleto por nicho") ──
 *
 *  10. Achado provocado por teste real do usuário: templates gerados como
 *      "magazine de notícias" caíam com frequência neste nicho (nome mais
 *      óbvio pro pedido) e saíam idênticos ao chassis genérico 'magazine'
 *      compartilhado com tecnologia-mag-tech/tecnologia-techwind — mesmo
 *      sintoma já corrigido em viral-magazine/appstore-bulma-mobile
 *      (achado 8 dos respectivos testes), agora aplicado aqui:
 *      estrutura de b:section (top-date/top-social/header-branding/
 *      main-menu/hero-section/main-content/sidebar-trending-slider/
 *      sidebar-trending/sidebar-tags/footer-1/2/3/footer-copyright)
 *      extraída de exemplos/noticias-mag-news.xml, main/post do Blog1
 *      extraído verbatim (feed .news-card 2 colunas sem post-destacado,
 *      post único .post-header-single/.post-title-single/
 *      .post-body-content, 404 embutido, tempo de leitura + relacionados
 *      via scripts reais próprios).
 *  11. Os achados 3/6 acima (".post-body-content"→".post-body",
 *      ".mag-footer"→".sl-footer", header "remapeado" pra .sl-header/
 *      .sl-nav) foram uma correção feita numa época em que o nicho ainda
 *      usava o chassis 'magazine' compartilhado — fazia sentido remapear
 *      pros seletores do chassis porque a estrutura física ERA o chassis.
 *      Com o esqueleto próprio, o markup real volta a existir de verdade
 *      — REVERTIDOS de volta pros seletores reais confirmados no arquivo
 *      (.post-body-content, .mag-footer, .navbar .nav-link — não
 *      .header-logo h1/.navbar-container/.nav-link do achado 6 original,
 *      que já estavam mais perto do real mas ainda erravam no seletor
 *      final). [[HEADER_WIDGET]] genérico usa .sl-header-brand de
 *      verdade (gerarHeaderWidget(), widgets.js) — CSS ajustado pra essa
 *      classe real (não .mag-header-content/.mag-logo-link, que nunca
 *      existiram na saída desse token).
 *  12. Slider premium de destaques (sidebar-trending real) extraído
 *      verbatim — HTML/CSS/JS completos e funcionais no arquivo original
 *      (fetch de posts recentes, rotação automática), mesmo padrão do
 *      cyber-slider de viral-magazine. Virou peça tipo secao (id
 *      'sidebar-trending-slider', seção própria adjacente a
 *      'sidebar-trending' — o mecanismo _montarSecaoPeca só permite 1
 *      b:section por peça, e a seção real 'sidebar-trending' tem 4
 *      widgets: slider + newsletter + cookie banner + FeaturedPost1).
 *      Newsletter/cookie banner customizados NÃO extraídos nesta migração
 *      (fora do escopo — mesmo padrão de slots deferidos já usado em
 *      viral-magazine/appstore-bulma-mobile); cookieBanner:true (módulo
 *      genérico, 6 variantes) cobre o consentimento.
 *  13. nichoModuleDefaults.js reauditado de novo: error404/readingTime/
 *      shareButtons/statsWidget/translateWidget/labelCloudWidget
 *      removidos (sem seção real correspondente, ou já cobertos pelo
 *      main/post real embutido — 404/tempo-de-leitura/compartilhar têm
 *      elemento e script próprios agora). cookieBanner/contactForm/
 *      popularPostsRanking adicionados (existiam no arquivo real sem
 *      flag correspondente — footer-3 é o widget nativo ContactForm1,
 *      match exato com o token CONTACT_FORM).
 *  14. seoChecker.js corrigido (bug real, não workaround pontual): o main
 *      includable do Blog1 tem h1 de 404 (dentro de 'data:view.isError')
 *      E h1 de post único (dentro do b:else de 'isMultipleItems'), os
 *      dois no MESMO includable 'main' mas em ramos de b:if mutuamente
 *      exclusivos — a checagem de H1 duplicado priorizava 'includable'
 *      sobre 'gate' sem nunca sub-agrupar por gate quando os dois sinais
 *      coexistem, dando falso positivo de "2 H1 compartilham escopo".
 *      _checarH1() agora sub-agrupa por gate DENTRO do mesmo includable
 *      (só quando todos os H1 do grupo têm gate distinto — se algum não
 *      tiver gate, continua tratando como colisão real, já que nesse caso
 *      os dois de fato coexistiriam sempre que o gate do outro for
 *      verdadeiro). Testado contra a suíte de seoChecker.test.js — 0
 *      regressão.
 *
 * Execute: node src/core/compilerEngine/nichoDossie.noticias-mag-news.test.js
 */

const { carregarNichoDossie } = require('./dossieLoader');
const { validarDossie } = require('./dossieValidator');
const { verificarDomIdsNoOutput, verificarSecoesPreenchidas } = require('./dossieIntegrityChecker');
const { chassisParaNicho } = require('../nichoTaxonomy');
const { validarEscopoGlobal } = require('../../blogger/scriptValidation');
const { validarTokensCss } = require('../../blogger/cssValidation');
const { executarCompilacao, carregarChassisParaNicho, verificarMarcadoresDesignPackage } = require('../compilerWorker');
const { checarSeo } = require('../diagnostico/seoChecker');
const { gerarDiagnostico } = require('../diagnostico');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

const NICHO = 'noticias-mag-news';
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
        esqueleto.includes("id='sidebar-tags'") && esqueleto.includes("id='header-branding'"));
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

// Mobília do esqueleto PRÓPRIO (achado 10) — entrada por-nicho em
// SECOES_MOBILIA_ESPERADAS, não a de chassis (que não bateria com a
// estrutura real).
if (xmlFinal) {
    const { ok, erros } = verificarSecoesPreenchidas(xmlFinal, chassisParaNicho(NICHO), NICHO);
    assert('mobília do esqueleto próprio (sidebar-trending/sidebar-tags/footer-1/2/3) sem seção vazia', ok, erros.join(' | '));
}

// Smoke-test do Design Package (achado 1 do plano "esqueleto por nicho") —
// as 4 strings literais de injetarDesignPackage() sobrevivem no esqueleto
// próprio (id='main' preservado de propósito na b:section do Blog1, mesmo
// o arquivo real chamando essa seção de 'main-content').
if (xmlFinal) {
    const { ok, erros } = verificarMarcadoresDesignPackage(xmlFinal);
    assert('marcadores literais do Design Package presentes no esqueleto', ok, erros.join(' | '));
}

// B. Estrutura real — seções que só existem no esqueleto próprio, ausentes
// do chassis genérico de família.
assert("seção 'sidebar-trending-slider' (secao real, ausente do chassis) presente",
    xmlFinal.includes("id='sidebar-trending-slider'"));
assert("seção 'hero-section' (não 'hero-area') presente",
    xmlFinal.includes("id='hero-section'"));
assert("seção 'main-menu' (não 'main-nav') presente",
    xmlFinal.includes("id='main-menu'"));

// Achado 1 (revisado — auditoria hero/corpo-do-post) — hero mosaico
// autoral originalmente tinha placeholders "[TITULO]"/"[URL_POST_0]"/
// "[AUTOR]"/"[DATA]"/"[CATEGORIA]" que nunca eram preenchidos, vazando
// literalmente pro XML compilado (bug real, confirmado recompilando).
// Corrigido trocando o HTML estático "protegido" por um widget NATIVO
// FeaturedPost (data:postTitle/postUrl/postFirstImage reais, sempre o
// post mais recente) — ver widgetNativo em nichoBlocks.js/widgets.js.
assert("hero mosaico autoral (id='heroMosaicoNoticias') presente",
    xmlFinal.includes('id="heroMosaicoNoticias"') || xmlFinal.includes("id='heroMosaicoNoticias'"));
assert('hero genérico do block library ("Crise Hídrica...") NÃO presente',
    !xmlFinal.includes('Crise H'));
assert('nenhum placeholder tipo [TITULO]/[URL_POST_0]/[AUTOR]/[DATA]/[CATEGORIA] vaza pro XML',
    !/\[[A-Z][A-Z0-9_]*\]/.test(xmlFinal));
assert('hero servido por widget nativo FeaturedPost (data: binding real, não HTML estático)',
    xmlFinal.includes("type='FeaturedPost'") && xmlFinal.includes('data:postTitle') && xmlFinal.includes('data:postFirstImage'));

// Achado 2 — --font-text literal (fonte), não aliasado pro token de cor.
assert('--font-text é literal ("Inter, sans-serif"), não aliasado pra --sl-text-main',
    xmlFinal.includes('--font-text: Inter, sans-serif;') &&
    !/--font-text:\s*var\(--sl-text-main\)/.test(xmlFinal));

// Achado 11 — seletores REVERTIDOS de volta pros nomes reais do arquivo
// (a versão anterior os tinha remapeado pro chassis compartilhado, época
// em que isso era a estrutura física de verdade — não é mais).
assert('CSS do corpo do post usa .post-body-content (real), não .post-body (órfão do chassis)',
    xmlFinal.includes('.post-body-content') && !xmlFinal.includes('.post-body {') && !xmlFinal.includes('.post-body >'));
assert('CSS do footer usa .mag-footer (real), não .sl-footer (órfão do chassis)',
    xmlFinal.includes('.mag-footer {') && !xmlFinal.includes('.sl-footer {'));
assert('upgrade de imagem do PopularPosts usa .PopularPosts (real, convenção nativa Blogger)',
    xmlFinal.includes(".querySelectorAll('.PopularPosts") && !xmlFinal.includes(".popular-posts "));

// widget_title incluído (.widget-title é classe real, reconhecida sitewide
// pelo sistema de tipografia global — não é o mesmo caso dos seletores
// órfãos corrigidos acima).
assert('CSS de .widget-title presente (classe real sitewide)',
    xmlFinal.includes('.widget-title'));

// Achado 10 — tempo de leitura real (não mais "quebrado sem chassis
// compatível" — o esqueleto próprio tem #post-body-content/#read-time-calc
// de verdade agora, script real mantido verbatim).
assert('script real de tempo de leitura (#post-body-content/#read-time-calc) presente',
    xmlFinal.includes('read-time-calc') && xmlFinal.includes('post-body-content'));

// Diagnóstico completo sem erro real (achado 14 — inclui o fix do falso
// positivo de H1 duplicado em ramos mutuamente exclusivos).
{
    const diag = gerarDiagnostico(xmlFinal);
    const errosDiag = diag.categorias.flatMap(c => c.achados.filter(a => a.nivel === 'erro'));
    assert('gerarDiagnostico() sem erro real', errosDiag.length === 0, JSON.stringify(errosDiag));
}

// SEO sem erro de JSON-LD malformado ou outro problema estrutural.
{
    const achadosSeo = checarSeo(xmlFinal);
    const errosSeo = achadosSeo.filter(a => a.nivel === 'erro');
    assert('checarSeo() não encontra erro estrutural', errosSeo.length === 0, JSON.stringify(errosSeo));
}

// CSS sem variável órfã — --bs-* (Bootstrap 5.3, expostos globalmente
// pelo CDN carregado no chassis) e --sl-footer-bg/--sl-text-main (tokens
// globais do colorPreset, referenciados de propósito pelo footer) são
// externos legítimos.
{
    const cssMatch = xmlFinal.match(/\/\* === CSS DO NICHO ===+ \*\/\s*\n([\s\S]*?)\n\s*\]\]>/);
    assert('CSS do nicho extraído do XML pro teste de variável órfã', !!cssMatch);
    if (cssMatch) {
        const tokensExternos = [
            '--sl-footer-bg', '--sl-text-main',
            '--bs-body-bg', '--bs-body-color', '--bs-border-color', '--bs-border-color-translucent',
            '--bs-danger-bg-subtle', '--bs-danger-border-subtle', '--bs-danger-text-emphasis',
            '--bs-primary', '--bs-primary-text-emphasis', '--bs-secondary-color',
            '--bs-success-bg-subtle', '--bs-success-border-subtle', '--bs-success-text-emphasis', '--bs-tertiary-bg',
        ];
        const r = validarTokensCss(cssMatch[1], { tokensExternos });
        assert('CSS do nicho sem variável CSS órfã (fora dos tokens globais/Bootstrap)', r.ok, JSON.stringify(r.erros));
    }
}

// Achado 5 — peças redundantes/mortas excluídas. (.hero-mosaic aparece
// 2x legitimamente — regra base + @media (min-width:992px) override, não
// é duplicata; checa por um fragmento que só existiria se a peça
// "modulo-hero-mosaico-css-grid" duplicada tivesse sido incluída.)
assert('CSS do hero não duplicada (.hero-card position:relative só 1x)',
    (xmlFinal.match(/\.hero-card\s*\{\s*position:\s*relative/g) || []).length === 1);
assert('dossiê tem exatamente 54 peças (51 modulo + 1 js-only + 1 hero preservado + 1 secao slider real, achado 12)',
    dossie && dossie.pecas.length === 54, dossie ? String(dossie.pecas.length) : 'dossie null');

// Achado 11 — cabeçalho, marcação real do [[HEADER_WIDGET]] genérico.
assert('.sl-header-brand (classe real do token HEADER_WIDGET) presente', xmlFinal.includes('.sl-header-brand'));
assert('.navbar .nav-link (marcação real, não .sl-nav ul li a do chassis) presente',
    xmlFinal.includes('.navbar .nav-link'));

// Achado 7 — tokens novos declarados (--mag-secondary/--border-color).
assert('--mag-secondary: #6c757d declarado no :root', xmlFinal.includes('--mag-secondary: #6c757d;'));
assert('--border-color: #dee2e6 declarado no :root', xmlFinal.includes('--border-color: #dee2e6;'));

// Achado 8 — --font-body renomeado.
assert('var(--font-body) (nome errado) NÃO presente', !xmlFinal.includes('var(--font-body)'));

// Achado 9 (ainda válido) — cookie banner e newsletter customizados do
// arquivo real continuam fora do escopo (não extraídos); módulo genérico
// cookieBanner:true cobre o consentimento.
assert('cookie banner nicho-específico (mag-cookie-banner) NÃO presente', !xmlFinal.includes('mag-cookie-banner'));
assert('newsletter AJAX nicho-específica (nl-form/nl-status) NÃO presente', !xmlFinal.includes('nl-status'));
assert('banner de cookie genérico (COOKIE_MODULE, cookieBanner:true) presente',
    xmlFinal.includes('cookie'));

// Achado 12 — slider premium do sidebar-trending REVERTIDO de volta
// (achado 9 original excluía por engano — a versão anterior tratava como
// "genérico já coberto por sliderJson", mas é conteúdo próprio do
// arquivo real, não duplicata de nada). Extraído verbatim, ligado via
// NICHO_EXTRA_SECTIONS.
assert("slider real do sidebar-trending (mag-slider-track/mag-slider-widget) presente",
    xmlFinal.includes('mag-slider-track') && xmlFinal.includes('mag-slider-widget'));
assert("b:section 'sidebar-trending-slider' com b:widget dentro (não vazia)",
    /id='sidebar-trending-slider'[^>]*>\s*<b:widget/.test(xmlFinal));

// JS combinado não colide em escopo global.
{
    const blocos = [...xmlFinal.matchAll(/<script\b[^>]*>\s*\/\/<!\[CDATA\[([\s\S]*?)\/\/\]\]>\s*<\/script>/g)].map(m => m[1]);
    const { ok, erro } = validarEscopoGlobal(blocos);
    assert('JS do output não colide em escopo global', ok, erro);
}

console.log(`\n${failed === 0 ? '✅' : '❌'} nichoDossie.${NICHO}: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

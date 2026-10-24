'use strict';

/**
 * Teste de regressão da migração "esqueleto por nicho" (Fase 2, 8/11):
 * gamer-playerone ganha template_gamer-playerone.xml próprio, extraído de
 * exemplos/gamer-playerone.xml. Chassis 'blog' compartilhado segue ativo
 * com natureza-bulma-vegan/pop-retro-pixel (2 nichos restantes) — este é
 * o 2º a sair dele nesta rodada.
 *
 * Achados desta migração:
 *   1. 6 peças de CSS remapeadas de volta pros seletores reais do arquivo
 *      (tinham sido "corrigidas" antes pra baterem com o chassis
 *      compartilhado — .sl-header/.blog-post-body/.PopularPosts/rgba(var(--sl-*))
 *      — órfãs assim que o nicho ganha esqueleto próprio):
 *      header/navbar (header .navbar/.navbar-brand-wrapper/.navbar-nav),
 *      correção de imagem do post (.post-body-content, não .blog-post-body),
 *      blockquote vermelho (mesmo seletor), cartões de jogos na home
 *      (.game-card/.game-cover/.game-badge, rgba literal), rodapé (cor
 *      #020617 literal, rgba literal, .contact-form-button sem sufixo
 *      -submit — 5ª ocorrência desse bug específico nesta sessão), popular
 *      posts (.popular-posts minúsculo — o dossiê tinha .PopularPosts,
 *      CSS é case-sensitive, nunca bateu).
 *   2. Peça nova 'modulo-shortcode-review-box' autorada: motor de review
 *      cyberpunk (círculo de nota, barras de atributo) do arquivo real
 *      MELHOR que o REVIEW_ENGINE genérico de modules.js (mais estilizado,
 *      combina com o tema) — decisão inversa da migração anterior no cano
 *      legado (que preferia o genérico): aqui o real vence, embutido
 *      verbatim no skeleton, reviewEngine:true em nichoModuleDefaults.js
 *      vira flag não-usada documentada (trade-off aceito).
 *   3. Ripple effect: JS de criar <span class="ripple-effect"> em cliques
 *      preservado (ao contrário do cano legado, que excluía por falta de
 *      CSS correspondente) — esqueleto próprio ganhou o CSS real
 *      correspondente extraído do arquivo, então a feature passa a
 *      funcionar de verdade.
 *   4. 'header-logo': Header1 real usa useImage=false (sem foto/logo,
 *      renderiza texto via <h1>/<p> condicional — ver achado 14).
 *   5. 'main-menu': PageList1 real tinha URL do blog real do dono
 *      original (mega-webly.blogspot.com) — redigido via NAV_WIDGET
 *      genérico (data:pages).
 *   6. 'main' (Blog1, renomeado do id real 'blog-main' pra satisfazer o
 *      marcador canônico do Design Package — mesmo trade-off já aceito em
 *      culinaria-boutique-gourmet; sem isso, injetarDesignPackage() não
 *      acha onde injetar heroHtml/staticSections do chat de edição do
 *      Workspace, achado confirmado pelo teste B de compilerWorker.test.js
 *      falhando com o id antigo 'blog-main'): widget-settings trimmados
 *      pra lista válida (showLocation removido — achado recorrente,
 *      Blogger não aceita esse setting pro tipo Blog). Card do
 *      feed/post único/404 temático ("Game Over!") extraídos verbatim.
 *   7. header/nav: aria-label adicionado no navbar-toggler (só ícone,
 *      sem texto) e no botão de busca (só ícone bi-search).
 *   8. sidebar-top: PopularPosts1+FeaturedPost1 nativos preservados —
 *      FeaturedPost1 tinha <img> sem alt (achado do gerarDiagnostico na
 *      1ª compilação), corrigido com expr:alt='data:postTitle'.
 *   9. footer-col-1/2: Translate1+Stats1+Text1(vazio) nativos
 *      preservados; Label1 LIST sem selectedLabelsList hardcoded (real já
 *      vinha genérico) — showType removido (achado novo: não é setting
 *      válido pro tipo Label, Blogger rejeita upload).
 *  10. 'footer-col-4': ContactForm1 real → token CONTACT_FORM genérico
 *      (mesmo padrão de sempre), título real "Suporte a Jogadores"
 *      preservado via contactFormTitle (já ligado em
 *      nichoModuleDefaults.js).
 *  11. Copyright do rodapé: "© 2026 PlayerOne Gaming. Vanilla JS
 *      Powered." hardcoded → ano dinâmico + data:blog.title.
 *  12. Mobília nova: 'top-bar-left' (vazio no real) sem token — sem flag
 *      correspondente ligada em nichoModuleDefaults.js pra essa posição;
 *      'top-bar-right' (vazio no real, além do botão de tema) ganha
 *      SOCIAL_LINKS_WIDGET (nichoModuleDefaults.js já ligava
 *      socialLinksWidget sem seção real pra receber — nome da seção no
 *      arquivo original, "Redes Sociais Topo", já sugeria esse uso).
 *  13. 'home-hero': o arquivo real não tem nenhuma seção de hero — peça
 *      sintética 'gamer-hero-banner' (autorada na task #103, "hero pros 8
 *      nichos sem hero no dossiê") já traz h1 próprio, então
 *      H1_FALLBACK_OCULTO não entra (heroJaTemH1=true em compile.js).
 *      b:section nova, gated por isHomepage (mesmo padrão de
 *      brutalista-appcraft), entre '/header' e o container principal.
 *  14. H1 duplicado real (gerarDiagnostico pegou em runtime): Header1
 *      (useImage=false) renderizava um <h1> incondicional com o título do
 *      blog — colidia com o h1 do hero (home), do post (single) e do 404
 *      (error), todos já com h1 próprio. Fix: título do header só é <h1>
 *      nas views que NÃO têm h1 próprio (label/busca); em home/post/error
 *      vira <p> (classe .navbar-brand-text compartilhada, CSS revertido
 *      de seletor 'h1' pra '.navbar-brand-text'). Includables extras do
 *      Header1 real nunca invocados (behindImageStyle/image/description/
 *      title — 2 deles referenciavam includables padrão do Blogger
 *      responsiveImageStyle/responsiveImage inexistentes nesse widget
 *      custom, quebrando a expansão) removidos como código morto.
 *  15. <img> sem alt em FeaturedPost1 (ver achado 8) — 2º achado de
 *      acessibilidade fechado nesta migração.
 *
 * Execute: node src/core/compilerEngine/nichoDossie.gamer-playerone.test.js
 */

const { carregarNichoDossie } = require('./dossieLoader');
const { validarDossie } = require('./dossieValidator');
const { verificarDomIdsNoOutput, verificarSecoesPreenchidas } = require('./dossieIntegrityChecker');
const { chassisParaNicho } = require('../nichoTaxonomy');
const { validarEscopoGlobal } = require('./workers/jsWorker');
const { validarTokensCss } = require('./workers/cssWorker');
const { executarCompilacao, carregarChassisParaNicho, verificarMarcadoresDesignPackage } = require('../compilerWorker');
const { gerarDiagnostico } = require('../diagnostico');
const { validarXmlCompilado, validarSemanticaBlogger } = require('../xmlValidator');
const { checarSeo } = require('../diagnostico/seoChecker');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

const NICHO = 'gamer-playerone';
const dossie = carregarNichoDossie(NICHO);

assert('dossiê carregado (não é null)', dossie !== null);
if (dossie) {
    const { erros, avisos } = validarDossie(dossie);
    assert('dossiê schema-válido (zero erros)', erros.length === 0, erros.join(' | '));
    assert('dossiê sem avisos', avisos.length === 0, avisos.join(' | '));
    assert('dossiê tem 12 peças (9 modulo/widget/hero originais + 1 review box nova)',
        dossie.pecas.length === 12, String(dossie.pecas.length));
}

// A. Resolução nicho-primeiro.
{
    const xmlEsqueleto = carregarChassisParaNicho(NICHO);
    assert('esqueleto próprio carregado (marcador do doc no topo do arquivo)',
        xmlEsqueleto.includes('Esqueleto próprio do nicho gamer-playerone'));
}

let xmlFinal = '';
try {
    ({ xmlFinal } = executarCompilacao({ siteName: 'Site Teste', nichoTema: NICHO, colorPreset: 'default' }));
    passed++;
} catch (e) {
    failed++;
    console.error(`  ❌ executarCompilacao() não lança erro — ${e.message}`);
}

if (xmlFinal) {
    const errosXml = validarXmlCompilado(xmlFinal);
    assert('XML compilado bem-formado (zero erros de sintaxe)', errosXml.length === 0, errosXml.join(' | '));
    const { erros: errosSem, avisos: avisosSem } = validarSemanticaBlogger(xmlFinal);
    assert('semântica Blogger sem erro (widgets filhos diretos de b:section)', errosSem.length === 0, errosSem.join(' | '));
    assert('semântica Blogger sem aviso', avisosSem.length === 0, avisosSem.join(' | '));
}

if (dossie && xmlFinal) {
    const { ok, erros } = verificarDomIdsNoOutput(xmlFinal, dossie);
    assert('todo domId declarado aparece no XML compilado', ok, erros.join(' | '));
}

if (xmlFinal) {
    const { ok, erros } = verificarSecoesPreenchidas(xmlFinal, chassisParaNicho(NICHO), NICHO);
    assert('mobília real (top-bar-right/footer-col-4) sem seção vazia', ok, erros.join(' | '));
}

if (xmlFinal) {
    const dp = verificarMarcadoresDesignPackage(xmlFinal);
    assert('marcadores do Design Package presentes (</head>, b:skin, header-logo, main)', dp.ok, dp.erros.join(' | '));
}

if (xmlFinal) {
    const diag = gerarDiagnostico(xmlFinal, { nichoTema: NICHO });
    const achados = diag.categorias.flatMap(c => c.achados.map(a => `${c.id}: ${a.mensagem}`));
    assert('diagnóstico score 100, zero erros/avisos', diag.score === 100 && diag.totalErros === 0 && diag.totalAvisos === 0, achados.join(' | '));
}

const corpo = xmlFinal.slice(xmlFinal.indexOf('<body'));

// Achado 5 — dado real do dono original ausente.
assert('URL do blog real do dono original (mega-webly.blogspot.com) AUSENTE no corpo', !corpo.includes('mega-webly'));
assert('nav dinâmico via data:pages (NAV_WIDGET genérico)', corpo.includes('data:pages'));

// Achado 1 — CSS revertida pros seletores reais (checagem pela forma
// "seletor {" com chave, pra não colidir com o texto do próprio doc
// comment no topo do arquivo).
assert('header .navbar / .navbar-nav .nav-link (reais) presentes', xmlFinal.includes('header .navbar {') && xmlFinal.includes('.navbar-nav .nav-link {'));
assert('.sl-header (órfão do chassis) AUSENTE', !xmlFinal.includes('.sl-header {') && !xmlFinal.includes('.sl-header-brand'));
assert('.post-body-content (real) presente, .blog-post-body (órfão) AUSENTE',
    xmlFinal.includes('.post-body-content') && !xmlFinal.includes('.blog-post-body'));
assert('.game-card/.game-cover/.game-badge (reais) presentes no CSS', xmlFinal.includes('.game-card {') && xmlFinal.includes('.game-cover {') && xmlFinal.includes('.game-badge {'));
assert('#020617 literal (rodapé real) presente', xmlFinal.includes('#020617'));
assert('.contact-form-button (sem sufixo -submit) presente, -submit AUSENTE',
    xmlFinal.includes('.contact-form-button') && !xmlFinal.includes('.contact-form-button-submit'));
assert('.popular-posts minúsculo (real) presente, .PopularPosts (órfão case-sensitive) AUSENTE',
    xmlFinal.includes('.popular-posts') && !xmlFinal.includes('.PopularPosts {'));

// Achado 2 — review box real embutido (não o REVIEW_ENGINE genérico).
assert('shortcode-review-box (motor real cyberpunk) presente', xmlFinal.includes('shortcode-review-box'));
assert('sl-review-box (genérico de modules.js) AUSENTE — real venceu', !xmlFinal.includes('sl-review-box'));

// Achado 3 — ripple effect funcional (JS + CSS correspondente, ao
// contrário do cano legado que excluía por falta de CSS).
assert('ripple-effect JS presente', xmlFinal.includes('ripple-effect'));
assert('.ripple-effect CSS correspondente presente (feature agora funcional)', xmlFinal.includes('.ripple-effect'));

// Achado 6 — feed/post real, 404 temático.
assert('view isError com 404 temático real ("Game Over!") presente', corpo.includes('Game Over!'));
assert('showLocation (Blog1, setting inválido) AUSENTE', !corpo.includes('showLocation'));
assert('showType (Label1, setting inválido) AUSENTE', !corpo.includes('showType'));

// Achado 13 — hero sintético presente e único.
assert('hero gamer-hero-banner presente no XML', corpo.includes('id="gamer-hero-banner"') || corpo.includes("id='gamer-hero-banner'"));
assert('hero aparece exatamente 1x (não duplicado)', (xmlFinal.match(/id=['"]gamer-hero-banner['"]/g) || []).length === 1);

// Achado 14 — H1 único por view (sem duplicidade Header1×hero/post/404).
assert('navbar-brand-text (classe compartilhada h1/p) presente', xmlFinal.includes('navbar-brand-text'));
assert('behindImageStyle/responsiveImageStyle (includables mortos do Header1) AUSENTES', !xmlFinal.includes('responsiveImageStyle') && !xmlFinal.includes('responsiveImage\''));

// Achado 7/15 — acessibilidade.
assert("navbar-toggler com aria-label presente", corpo.includes("aria-label='Alternar menu'"));
assert("botão de busca com aria-label presente", corpo.includes("aria-label='Buscar'"));
assert("FeaturedPost1 <img> com expr:alt (achado de acessibilidade fechado)", corpo.includes("expr:alt='data:postTitle'"));

// Achado 10-11 — mobília nova + copyright genérico.
assert('CONTACT_FORM presente (footer-col-4) com título real preservado', corpo.includes("type='ContactForm'") && corpo.includes('Suporte a Jogadores'));
assert('SOCIAL_LINKS_WIDGET presente (top-bar-right)', corpo.includes('LinkList'));
assert('copyright usa data:blog.title + ano dinâmico, hardcoded AUSENTE',
    corpo.includes('<data:blog.title/>') && !corpo.includes('PlayerOne Gaming. Vanilla JS'));

// SEO sem erro estrutural.
{
    const achadosSeo = checarSeo(xmlFinal);
    const errosSeo = achadosSeo.filter(a => a.nivel === 'erro');
    assert('checarSeo() não encontra erro estrutural', errosSeo.length === 0, JSON.stringify(errosSeo));
}

// CSS do nicho sem variável órfã.
{
    const cssMatch = xmlFinal.match(/CSS DO NICHO[\s\S]*?\*\/\s*\n([\s\S]*?)\n\s*\]\]>/);
    assert('CSS do nicho extraído do XML pro teste de variável órfã', !!cssMatch);
    if (cssMatch) {
        const r = validarTokensCss(cssMatch[1], { tokensExternos: ['--sl-primary-rgb', '--sl-footer-bg'] });
        assert('CSS do nicho sem variável CSS órfã', r.ok, JSON.stringify(r.erros));
    }
}

// JS combinado não colide em escopo global.
{
    const xmlNormalizado = xmlFinal.replace(/\]\]\]\]><!\[CDATA\[>/g, ']]>');
    const blocos = [...xmlNormalizado.matchAll(/<script\b[^>]*>\s*\/\/<!\[CDATA\[([\s\S]*?)\/\/\]\]>\s*<\/script>/g)].map(m => m[1]);
    const { ok, erro } = validarEscopoGlobal(blocos);
    assert('JS do output não colide em escopo global', ok, erro);
}

console.log(`\n${failed === 0 ? '✅' : '❌'} nichoDossie.${NICHO}: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

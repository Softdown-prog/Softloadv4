require('../test/isolatedTelemetry.cjs');
'use strict';

/**
 * Teste de regressão da migração "esqueleto por nicho" (Fase 2, 2/11):
 * tecnologia-techwind ganha template_tecnologia-techwind.xml próprio,
 * extraído de exemplos/tecnologia-techwind.xml (arquivo hand-authored
 * real) — deixa de compartilhar o chassis genérico 'magazine' com
 * tecnologia-mag-tech/noticias-mag-news.
 *
 * Cobre os 4 achados da migração anterior (3º nicho PoC, ainda válidos):
 *   1. HTML órfão: botão #btnScrollToTop tinha css/js extraídos pelo
 *      walker mas o html nunca era gerado.
 *   2. CSS órfã: a classe .animate-up era adicionada via JS mas a CSS
 *      que define a animação nunca era incluída no output.
 *   3. Feature inteira descartada: popular-posts-upscale (JS que corrige
 *      miniaturas do widget Popular Posts) nunca ia pro output.
 *   4. Hero 100% estático (2 legendas fixas, CTA "Ler Artigo" com href="#"
 *      morto) — convertido pro padrão hero-de-posts-reais (widgetNativo
 *      'featured-post-card', mesmo mecanismo de noticias-mag-news).
 *
 * Mais os achados novos desta migração (esqueleto próprio):
 *   5. Achado de auditoria: o b:widget 'featured-big' do arquivo real
 *      declara um b:widget-setting 'content' com um carousel de 3 slides
 *      — mas TAMBÉM tem seu próprio <b:includable id='main'> que nunca
 *      referencia <data:content/>. O carousel é órfão; o que renderiza
 *      de fato é um banner estático diferente ("O teu portal de
 *      Conteúdos Exclusivos"). O achado 4 da migração anterior (acima)
 *      identificou o problema certo (hero estático, CTA morto) mas
 *      descreveu o conteúdo errado — o fix (widgetNativo, hero real)
 *      continua correto e superior de qualquer forma.
 *   6. Dado real vazando: 'main-menu' no arquivo real tem navbar
 *      customizada (ícones + dropdown "Mais") com hrefs do blog real do
 *      dono original (tnews-web.blogspot.com) + 1 link pessoal do Google
 *      Drive — substituído por NAV_WIDGET genérico (data:pages
 *      dinâmico). 'footer-contact' tinha FeaturedPost1 com postId
 *      hardcoded do dono original — FEATURED_POST_WIDGET genérico usa
 *      useMostRecentPost em vez de postId fixo. 'footer-3' tinha Label1
 *      com selectedLabelsList hardcoded ('hardware,tech') —
 *      LABEL_CLOUD_WIDGET genérico não fixa nenhum label. 'footer-1'
 *      tinha 1 iframe promocional de vídeo do vendedor do tema — não
 *      extraído (não é conteúdo do site).
 *   7. Placeholder que vazaria pro XML: 'featured-small-1' no arquivo
 *      real tem um carousel cujo conteúdo são 3 <img> com
 *      src="COLAR_LINK_DA_IMAGEM_AQUI_N.jpg" (instrução textual pro dono
 *      do tema, nunca uma URL real) — mesma classe de bug já fechada no
 *      hero de noticias-mag-news. Deixado como slot nativo vazio.
 *   8. itemprop='articleBody' ausente no arquivo real — adicionado no
 *      esqueleto pro DROPCAP_CSS genérico (mods.dropcap) ter o que
 *      selecionar ([itemprop='articleBody'] > p:first-of-type::first-
 *      letter). Sem isso, dropcap:true em nichoModuleDefaults.js seria
 *      um flag morto (CSS nunca casaria com nada).
 *   9. nichoModuleDefaults.js reauditado: readingTime/shareButtons/toc/
 *      error404/error404Theme removidos (404 agora embutido no main
 *      real; share buttons e tempo de leitura já cobertos pelas peças
 *      reais do dossiê; toc nunca teve seção real correspondente).
 *      contactForm/popularPostsRanking/cookieBanner adicionados
 *      (existiam no arquivo real sem flag, ou são compliance genérico
 *      ausente no arquivo real). menuType: 'classico' (navbar-collapse
 *      real, nunca foi offcanvas).
 *
 * Execute: node src/core/compilerEngine/nichoDossie.tecnologia-techwind.test.js
 */

const { carregarNichoDossie } = require('./dossieLoader');
const { validarDossie } = require('./dossieValidator');
const { verificarDomIdsNoOutput, verificarSecoesPreenchidas } = require('./dossieIntegrityChecker');
const { chassisParaNicho } = require('../nichoTaxonomy');
const { validarEscopoGlobal } = require('../../blogger/scriptValidation');
const { executarCompilacao, carregarChassisParaNicho, verificarMarcadoresDesignPackage } = require('../compilerWorker');
const { gerarDiagnostico } = require('../diagnostico');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

const NICHO = 'tecnologia-techwind';
const dossie = carregarNichoDossie(NICHO);

assert('dossiê carregado (não é null)', dossie !== null);
if (dossie) {
    const { erros, avisos } = validarDossie(dossie);
    assert('dossiê schema-válido (zero erros)', erros.length === 0, erros.join(' | '));
    assert('dossiê sem avisos', avisos.length === 0, avisos.join(' | '));
}

// A. Resolução nicho-primeiro — template_tecnologia-techwind.xml existe e
// é escolhido em vez de cair no chassis 'magazine' de família.
{
    const xmlEsqueleto = carregarChassisParaNicho(NICHO);
    assert('esqueleto próprio carregado (marcador do doc no topo do arquivo)',
        xmlEsqueleto.includes('Esqueleto próprio do nicho tecnologia-techwind'));
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

// Mobília real (sidebar/footer-1/footer-2/footer-3/footer-contact) — ver
// entrada 'tecnologia-techwind' em SECOES_MOBILIA_ESPERADAS.
if (xmlFinal) {
    const { ok, erros } = verificarSecoesPreenchidas(xmlFinal, chassisParaNicho(NICHO), NICHO);
    assert('mobília real (sidebar/footer-1/2/3/footer-contact) sem seção vazia', ok, erros.join(' | '));
}

// Smoke-test do Design Package — as 4 strings literais que
// injetarDesignPackage() (compilerWorker.js) busca sobrevivem no
// esqueleto próprio.
if (xmlFinal) {
    const dp = verificarMarcadoresDesignPackage(xmlFinal);
    assert('marcadores do Design Package presentes (</head>, b:skin, header-logo/brand, main)', dp.ok, dp.erros.join(' | '));
}

// gerarDiagnostico sem erro nem aviso — score 100.
if (xmlFinal) {
    const diag = gerarDiagnostico(xmlFinal);
    const achados = diag.categorias.flatMap(c => c.achados.map(a => `${c.id}: ${a.mensagem}`));
    assert('diagnóstico score 100, zero erros/avisos', diag.score === 100 && diag.totalErros === 0 && diag.totalAvisos === 0, achados.join(' | '));
}

// Hero autoral (destaque de post real) presente e não substituído pelo
// block library genérico.
assert('destaque de post real (widgetNativo FeaturedPost) presente no output',
    xmlFinal.includes("id='featured-big'") && xmlFinal.includes('FeaturedPost'));
assert('hero genérico do block library NÃO presente — protegida:true funcionou',
    !xmlFinal.includes('via.placeholder.com/600x400/198754'));

// Achado 5 — banner/carousel estático antigo (qualquer um dos dois,
// órfão ou renderizado) NÃO presente no corpo real; CTA morto href="#"
// tampouco. Buscas restritas ao <body> — o <head>/doc-comment do topo
// do arquivo MENCIONA esse conteúdo em prosa (pra explicar o achado),
// o que não é o mesmo que ele estar de fato no HTML renderizado.
const corpo = xmlFinal.slice(xmlFinal.indexOf('<body>'));
assert('legenda estática antiga ("O Teu Primeiro Grande Destaque") NÃO presente no corpo',
    !corpo.includes('O Teu Primeiro Grande Destaque'));
assert('banner estático antigo ("Conteúdos Exclusivos") NÃO presente no corpo',
    !corpo.includes('Conteúdos Exclusivos'));
assert('CTA morto href="#" do hero antigo NÃO presente (o botão "Ler Artigo" do gerador genérico usa expr:href=data:postUrl, real, não href="#")',
    !corpo.includes('href="#" class="btn btn-sm btn-primary mt-2">Ler Artigo'));
assert('widget FeaturedPost real alimenta o destaque (data:postTitle)', xmlFinal.includes('<data:postTitle/>'));

// Achado 6 — dado real do dono original redigido (buscas restritas ao
// <body> pelo mesmo motivo acima).
assert('URL do blog real do dono original (tnews-web.blogspot.com) AUSENTE do corpo',
    !corpo.includes('tnews-web.blogspot.com'));
assert('link pessoal do Google Drive do dono original AUSENTE', !xmlFinal.includes('drive.google.com'));
assert('postId hardcoded do FeaturedPost original AUSENTE', !xmlFinal.includes('7376549780373444766'));
assert('nav dinâmico via data:pages (NAV_WIDGET genérico)', xmlFinal.includes('data:pages'));

// Achado 7 — placeholder de imagem que vazaria quebrado AUSENTE.
assert("placeholder 'COLAR_LINK_DA_IMAGEM_AQUI' AUSENTE do HTML real (só em comentário de doc)",
    !xmlFinal.slice(xmlFinal.indexOf('<body>')).includes('COLAR_LINK_DA_IMAGEM_AQUI'));

// Achado 8 — itemprop='articleBody' presente (necessário pro DROPCAP_CSS).
assert("post-body-content com itemprop='articleBody' presente", xmlFinal.includes("itemprop='articleBody'"));
assert('DROPCAP_CSS (::first-letter) presente — dropcap:true tem efeito real',
    xmlFinal.includes('::first-letter'));

// Achados 1-3 (migração anterior, ainda válidos).
assert('botão voltar ao topo (#btnScrollToTop) presente', xmlFinal.includes("id='btnScrollToTop'"));
assert('CSS da classe .animate-up presente no output', xmlFinal.includes('.animate-up {'));
assert('JS de upscale do Popular Posts presente', xmlFinal.includes('PopularPosts'));

// Estrutura real do esqueleto (não a do chassis 'magazine' antigo).
assert('seção real .top-bar/topbar-wrapper presente', xmlFinal.includes("id='topbar-wrapper'"));
assert('feed real .card-post-grid presente', xmlFinal.includes('card-post-grid'));
assert('post único real .post-title-single presente', xmlFinal.includes('post-title-single'));
assert('404 embutido no main real (.error-404-wrapper) presente', xmlFinal.includes('error-404-wrapper'));
assert("footer-contact (4 widgets nativos reais) presente", xmlFinal.includes("id='footer-contact'"));

// Cada peça widget aparece exatamente 1x — não duplicada entre o blob
// geral e o bloco autocontido em NICHO_WIDGETS_HTML.
assert('#btnScrollToTop aparece 1x (não duplicado)',
    (xmlFinal.match(/id='btnScrollToTop'/g) || []).length === 1);

// JS combinado não colide em escopo global.
{
    const blocos = [...xmlFinal.matchAll(/<script\b[^>]*>\s*\/\/<!\[CDATA\[([\s\S]*?)\/\/\]\]>\s*<\/script>/g)].map(m => m[1]);
    const { ok, erro } = validarEscopoGlobal(blocos);
    assert('JS do output não colide em escopo global', ok, erro);
}

console.log(`\n${failed === 0 ? '✅' : '❌'} nichoDossie.${NICHO}: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

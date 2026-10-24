'use strict';

/**
 * Teste de regressão da migração "esqueleto por nicho" (Fase 2, 7/11):
 * culinaria-boutique-gourmet ganha template_culinaria-boutique-gourmet.xml
 * próprio, extraído de exemplos/culinaria-boutique-gourmet.xml (2301
 * linhas, 20 b:section reais — o mais denso desta fase até aqui). Chassis
 * 'blog' compartilhado segue ativo com gamer-playerone/natureza-bulma-
 * vegan/pop-retro-pixel (3 nichos restantes) — este é o 1º a sair dele.
 *
 * Achados desta migração:
 *   1. Dossiê já era fiel à realidade (piloto original da "reconstrução
 *      de dossiê" desta sessão, ~34 peças "modulo-*" cobrindo o bloco
 *      b:skin quase inteiro seção-por-seção) — diferente de saas-nexus/
 *      brutalista-appcraft/tecnologia-techwind, NENHUMA peça precisou de
 *      reversão de seletor (nunca foi remapeada pro chassis 'blog'
 *      compartilhado). O trabalho aqui foi auditoria de CSS órfã +
 *      extração da estrutura física real.
 *   2. CSS órfã removida do dossiê (bug pré-existente no arquivo real,
 *      não introduzido por esta migração), via
 *      dossieWriter.substituirDossieCompleto (36 → 31 peças):
 *        - 'modulo-variaveis-para-facilitar-a-manutencao' +
 *          'modulo-efeito-de-foco': estilizavam .search-input-custom/
 *          .search-box-custom/.search-button-custom — classes que NUNCA
 *          aparecem em nenhum HTML real (a busca usa BlogSearch1 nativo,
 *          classes gsc-*). CSS morta de uma versão anterior da busca.
 *        - 'modulo-otizacao-de-imagens-hd-gourmet' +
 *          'modulo-efeito-ao-passar-o-mouse-ou-slide-ativo' +
 *          'modulo-overlay-para-proteger-a-nitidez-do-texto-sobre-a-imagem':
 *          estilizavam .btq-slide/.btq-slide-overlay — o slider real
 *          (dentro do próprio HTML4, self-contained) usa classes .gs-*
 *          (prefixo diferente). CSS morta de uma versão anterior do
 *          carrossel.
 *      '.list-label-widget-content'/'.post-bottom-tags' MANTIDAS: nomes
 *      de classe que o próprio Blogger gera conforme o modo de exibição
 *      do widget Label (LIST vs CLOUD) — mesmo o Label1 real usando
 *      CLOUD hoje, manter o CSS do modo LIST é inofensivo e resiliente a
 *      troca futura pelo painel do Blogger.
 *   3. '.post-bottom-tags' (design premium com ícone bookmark-heart
 *      antes de cada tag, CSS já pronta) nunca estava ligada a HTML
 *      nenhum — a view de post único mostrava as labels em texto
 *      simples. Ligada nesta migração, substituindo o texto simples (sem
 *      duplicar).
 *   4. 'header-logo': Header1 real tinha displayUrl real do dono
 *      original — redigido via HEADER_WIDGET genérico.
 *   5. 'main-menu': PageList1 real tinha URL do blog real do dono
 *      original (boutiquecookie.blogspot.com) + link pessoal do Google
 *      Drive — redigido via NAV_WIDGET genérico.
 *   6. 'top-search'/'featured-big'/'featured-small-2': 3 b:widget reais
 *      completos e autocontidos (BlogSearch1 padrão; slider de HD com
 *      script próprio; banner de cookies com aceite via localStorage)
 *      escritos diretamente nas suas b:section reais — o mecanismo antigo
 *      (peça tipo:'secao' via token de blob único) despejava as 3 juntas
 *      num só lugar, incapaz de as posicionar nos 3 pontos fisicamente
 *      diferentes que a estrutura real exige.
 *   7. Blog1: widget-settings trimmados pra lista válida (commentLabel/
 *      authorLabel/timestampLabel vazio/reactionsLabel vazio/
 *      showAuthorProfile/postsPerAd/settings "style." (várias)/
 *      postLocationLabel/showLocation/postLabelsLabel vazio rejeitados
 *      pelo Blogger hoje).
 *      Card do feed tinha uma declaração de includable de post colada
 *      indevidamente dentro de uma âncora solta no meio do card (erro de
 *      colagem na autoria original) — corrigido pro card limpo já
 *      documentado no próprio arquivo. View isError com 404 temático
 *      real ("Receita não encontrada!") preservada verbatim.
 *   8. H1 da home: Header1 usa useImage=true (logo em imagem substitui o
 *      título), então a home real nunca tinha h1 nenhum — corrigido com
 *      h1 visually-hidden com o título do blog.
 *   9. Anti-FOUC: dark mode real só aplicava o tema no DOMContentLoaded
 *      (flash de tema errado) — corrigido com script inline no head.
 *  10. sidebar/footer: PopularPosts1+HTML98 ("A Chef", foto Unsplash —
 *      mesmo padrão aceito em saas-nexus) nativos preservados;
 *      Translate1+Stats1 nativos preservados; Label1 nativo preservado
 *      SEM o selectedLabelsList hardcoded ("brownie,cookies"). footer-2
 *      ganha BLOG_ARCHIVE_WIDGET junto do Label1 real. footer-3 (vazio
 *      no real) ganha SOCIAL_LINKS_WIDGET. featured-small-1 (vazio no
 *      real) ganha FEATURED_POST_WIDGET. footer-contact: ContactForm1
 *      real → token CONTACT_FORM genérico. nichoModuleDefaults.js
 *      reauditado: contactForm adicionado (sem flag antes desta
 *      migração, token resolvia vazio e a seção saía auto-fechada).
 *  11. Copyright: "© 2026 - Boutique Gourmet" hardcoded → ano dinâmico +
 *      data:blog.title.
 *  12. JS órfão do ESC-para-limpar-busca (mirava elemento inexistente,
 *      mesmo achado 2) não portado. Scroll-to-top (peça tipo 'widget'
 *      self-contained) renderizada via token de widgets do nicho, não
 *      duplicada à mão — e ganhou aria-label (achado de acessibilidade
 *      do gerarDiagnostico() na 1ª compilação: botão só com ícone).
 *
 * Execute: node src/core/compilerEngine/nichoDossie.culinaria-boutique-gourmet.test.js
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

const NICHO = 'culinaria-boutique-gourmet';
const dossie = carregarNichoDossie(NICHO);

assert('dossiê carregado (não é null)', dossie !== null);
if (dossie) {
    const { erros, avisos } = validarDossie(dossie);
    assert('dossiê schema-válido (zero erros)', erros.length === 0, erros.join(' | '));
    assert('dossiê sem avisos', avisos.length === 0, avisos.join(' | '));
    assert('dossiê tem 31 peças (36 originais - 5 CSS órfãs removidas nesta migração)',
        dossie.pecas.length === 31, String(dossie.pecas.length));
}

// A. Resolução nicho-primeiro.
{
    const xmlEsqueleto = carregarChassisParaNicho(NICHO);
    assert('esqueleto próprio carregado (marcador do doc no topo do arquivo)',
        xmlEsqueleto.includes('Esqueleto próprio do nicho culinaria-boutique-gourmet'));
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
    assert('mobília real (featured-small-1/footer-3/footer-contact) sem seção vazia', ok, erros.join(' | '));
}

if (xmlFinal) {
    const dp = verificarMarcadoresDesignPackage(xmlFinal);
    assert('marcadores do Design Package presentes (</head>, b:skin, header-logo, main)', dp.ok, dp.erros.join(' | '));
}

if (xmlFinal) {
    const diag = gerarDiagnostico(xmlFinal);
    const achados = diag.categorias.flatMap(c => c.achados.map(a => `${c.id}: ${a.mensagem}`));
    assert('diagnóstico score 100, zero erros/avisos', diag.score === 100 && diag.totalErros === 0 && diag.totalAvisos === 0, achados.join(' | '));
}

const corpo = xmlFinal.slice(xmlFinal.indexOf('<body'));

// Achados 4-5 — dado real do dono original ausente.
assert('URL do blog real do dono original (boutiquecookie.blogspot.com) AUSENTE no corpo', !corpo.includes('boutiquecookie.blogspot.com'));
assert('link pessoal do Google Drive AUSENTE', !corpo.includes('drive.google.com'));
assert('foto real do dono original (AVvXsEhYIVETE...) AUSENTE', !xmlFinal.includes('AVvXsEhYIVETE'));
assert('nav dinâmico via data:pages (NAV_WIDGET genérico)', corpo.includes('data:pages'));

// Achado 2 — CSS órfã removida (checagem pela forma "seletor {" com
// chave — o próprio doc comment do topo do arquivo menciona os nomes em
// prosa, sem chave, só pra rastreabilidade do achado).
assert('.search-input-custom/.search-box-custom/.search-button-custom (regras órfãs) AUSENTES', !xmlFinal.includes('.search-input-custom {') && !xmlFinal.includes('.search-box-custom {'));
assert('.btq-slide/.btq-slide-overlay (regras órfãs) AUSENTES', !xmlFinal.includes('.btq-slide {') && !xmlFinal.includes('.btq-slide-overlay {'));
assert('.gs-slide (classe real do slider) presente', xmlFinal.includes('.gs-slide {'));

// Achado 6 — os 3 widgets reais nas suas posições reais.
assert("top-search: b:section própria com BlogSearch1 real presente", corpo.includes("id='top-search'") && corpo.includes("type='BlogSearch'"));
assert('featured-big: slider real (#gourmet-slider-hd) presente', corpo.includes('id="gourmet-slider-hd"'));
assert('featured-small-2: banner de cookie real (#btq-cookie-barrier + #btq-cookie-accept) presente', corpo.includes('id="btq-cookie-barrier"') && corpo.includes('id="btq-cookie-accept"'));
assert('cada widget real aparece exatamente 1x (não duplicado)',
    (xmlFinal.match(/id="gourmet-slider-hd"/g) || []).length === 1 &&
    (xmlFinal.match(/id="btq-cookie-barrier"/g) || []).length === 1);

// Achado 7 — feed/post real, card limpo (sem a declaração de includable solta).
assert('.post-title-single / .post-body-content (real) presentes', corpo.includes('post-title-single') && corpo.includes('post-body-content'));
assert('view isError com 404 temático real ("Receita não encontrada!") presente', corpo.includes('Receita não encontrada!'));
assert('card do feed sem b:includable solto dentro de âncora (card limpo)', !corpo.includes("</a>\n                            <b:includable"));

// Achado 3 — design premium das tags ligado, sem duplicar.
assert('.post-bottom-tags ligado no post único', corpo.includes('post-bottom-tags'));

// Achado 8 — H1 único por view.
assert('h1 visually-hidden com data:blog.title presente (fallback da home)', corpo.includes('<h1 class="visually-hidden"><data:blog.title/></h1>'));

// Achados 10-11 — mobília nova + copyright genérico.
assert('FEATURED_POST_WIDGET presente (featured-small-1)', corpo.includes("type='FeaturedPost'"));
assert('BLOG_ARCHIVE_WIDGET presente (footer-2, junto do Label1 real)', corpo.includes("type='BlogArchive'"));
assert('SOCIAL_LINKS_WIDGET presente (footer-3)', corpo.includes('LinkList'));
assert('CONTACT_FORM presente (footer-contact)', corpo.includes("type='ContactForm'"));
assert('Label1 real sem selectedLabelsList hardcoded ("brownie,cookies") AUSENTE do corpo', !corpo.includes('brownie,cookies'));
assert('copyright usa data:blog.title, "© 2026" hardcoded AUSENTE',
    corpo.includes('<data:blog.title/>. Feito com muito amor') && !corpo.includes('© 2026'));

// Achado 12 — acessibilidade do botão scroll-to-top.
assert("botão scroll-to-top com aria-label presente", xmlFinal.includes("aria-label='Subir ao Topo'"));

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
        const r = validarTokensCss(cssMatch[1], {});
        assert('CSS do nicho sem variável CSS órfã', r.ok, JSON.stringify(r.erros));
    }
}

// JS combinado não colide em escopo global. Normaliza o escape de CDATA
// aninhado (peças tipo 'secao' preservam o <script> inline dentro do
// b:widget-setting original, que escapa o //]]> interno — Blogger desfaz
// esse mesmo escape ao servir a página).
{
    const xmlNormalizado = xmlFinal.replace(/\]\]\]\]><!\[CDATA\[>/g, ']]>');
    const blocos = [...xmlNormalizado.matchAll(/<script\b[^>]*>\s*\/\/<!\[CDATA\[([\s\S]*?)\/\/\]\]>\s*<\/script>/g)].map(m => m[1]);
    const { ok, erro } = validarEscopoGlobal(blocos);
    assert('JS do output não colide em escopo global', ok, erro);
}

console.log(`\n${failed === 0 ? '✅' : '❌'} nichoDossie.${NICHO}: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

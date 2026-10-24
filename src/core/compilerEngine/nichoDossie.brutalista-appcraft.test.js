'use strict';

/**
 * Teste de regressão da migração "esqueleto por nicho" (Fase 2, 5/11):
 * brutalista-appcraft ganha template_brutalista-appcraft.xml próprio,
 * extraído de exemplos/brutalista-appcraft.xml (arquivo hand-authored
 * real) — deixa de compartilhar o chassis genérico 'saas' com saas-nexus
 * (já migrado). Completa a resolução do compartilhamento de chassis
 * ativo entre os 2 nichos.
 *
 * Achados desta migração:
 *   1. 6 das 12 peças do dossiê tinham sido "corrigidas" pra mirar
 *      seletores do CHASSIS 'saas' compartilhado (.sl-footer,
 *      .sl-pagination, .saas-sidebar-widget/.saas-sidebar-widget-title,
 *      .saas-post-article h1, .saas-post-body, .saas-post-meta,
 *      .contact-form-button-submit) — fazia sentido enquanto o nicho
 *      usava o chassis genérico, viraram seletor órfão assim que ganhou
 *      esqueleto próprio (mesmo padrão já corrigido em appstore-bulma-
 *      mobile/noticias-mag-news). Revertidas pros seletores REAIS do
 *      arquivo (lidos direto do <b:skin> real): sidebar-brutalista
 *      (aside .widget / aside h3), paginacao-brutalista (.pagination —
 *      markup real do includable nextprev, NÃO o token genérico
 *      PAGINATION_MODULE que gera .sl-pagination — achado de 2ª ordem:
 *      a 1ª versão do esqueleto usava o token genérico por engano,
 *      corrigido pro markup real extraído), footer-brutalista
 *      (.footer-section), post-single-brutalista (.post-title-single /
 *      .post-body-content), metadados-mono (.post-meta, .post-meta-single
 *      — o arquivo real estiliza feed E post único com a MESMA regra),
 *      botao-tecla-mecanica (.contact-form-button, sem sufixo -submit —
 *      mesmo achado já descoberto em aquarela/saas-nexus: o includable
 *      main do token CONTACT_FORM, o que de fato renderiza, usa a classe
 *      sem sufixo).
 *   2. 'header-logo': Header1 real tinha displayUrl apontando pra uma
 *      imagem já hospedada do dono original — dado real, redigido via
 *      HEADER_WIDGET genérico.
 *   3. 'main-menu': PageList1 real tinha URL do blog real do dono
 *      original (tecdowny.blogspot.com) + 1 link pessoal do Google Drive
 *      — mesmo padrão de dado real já encontrado em saas-nexus/
 *      tecnologia-techwind. Redigido via NAV_WIDGET genérico.
 *   4. 'home-hero': widget real vazio (visible='false') — sem conteúdo
 *      estático real pra preservar. Ocupado pela peça protegida
 *      ac-hero-strip (NICHO_HERO), sozinha no b:section, sem irmãos HTML
 *      soltos (achado de verificação já estabelecido em aquarela:
 *      "Regra B" do xmlValidator.js quebra a árvore XML se houver HTML
 *      solto ao lado do token dentro do mesmo b:section). H1 do fallback
 *      oculto (H1_FALLBACK_OCULTO) é o único H1 da home, já que
 *      ac-hero-strip é puramente visual (badge + texto, sem heading
 *      próprio).
 *   5. 'home-features': widget real vazio (slot nativo, sem conteúdo —
 *      deixado vazio de propósito).
 *   6. 'main' (não 'main-content'): Blog1 extraído verbatim (feed
 *      .post-feed/.post-item/.post-title/.post-meta/.post-snippet, post
 *      único .post-title-single/.post-meta-single/.post-body-content).
 *      widget-settings trimmados pra lista válida (commentLabel/
 *      authorLabel/timestampLabel com valor literal/reactionsLabel/
 *      showAuthorProfile/showLocation/postLocationLabel/style.*
 *      rejeitados pelo Blogger hoje — mesmo achado já descoberto em
 *      noticias-mag-news/tecnologia-techwind/saas-nexus).
 *   7. 'sidebar-right': Translate1 nativo → TRANSLATE_WIDGET. HTML102
 *      "Sobre o Desenvolvedor" com conteúdo vazio no arquivo real — não
 *      extraído.
 *   8. 'footer-info': Stats1 → STATS_WIDGET, Label1 (selectedLabelsList
 *      hardcoded no real) → LABEL_CLOUD_WIDGET genérico (sem labels
 *      fixas), FeaturedPost1 já com defaults seguros (useMostRecentPost)
 *      → FEATURED_POST_WIDGET. nichoModuleDefaults.js reauditado:
 *      statsWidget/labelCloudWidget/translateWidget adicionados (sem
 *      flag correspondente antes desta migração — sem eles os 3 tokens
 *      resolviam pra string vazia em modules.js).
 *   9. 'footer-links' (novo): socialLinksWidget/blogArchiveWidget já
 *      ligados em nichoModuleDefaults.js sem seção real pra receber.
 *  10. 'footer-contact': ContactForm1 real tinha includable customizado
 *      (placeholders estilo terminal) → mapeado pro token CONTACT_FORM
 *      genérico, mesmo padrão de todas as migrações anteriores.
 *  11. Copyright do rodapé usa data:blog.title (nome real do site
 *      gerado), não texto hardcoded do arquivo real.
 *  12. Acessibilidade: botão do menu mobile (navbar-toggler) só tinha
 *      ícone SVG sem aria-label — corrigido (achado do gerarDiagnostico()
 *      na 1ª compilação desta migração).
 *
 * Execute: node src/core/compilerEngine/nichoDossie.brutalista-appcraft.test.js
 */

const { carregarNichoDossie } = require('./dossieLoader');
const { validarDossie } = require('./dossieValidator');
const { verificarDomIdsNoOutput, verificarSecoesPreenchidas } = require('./dossieIntegrityChecker');
const { chassisParaNicho } = require('../nichoTaxonomy');
const { validarEscopoGlobal } = require('./workers/jsWorker');
const { executarCompilacao, carregarChassisParaNicho, verificarMarcadoresDesignPackage } = require('../compilerWorker');
const { gerarDiagnostico } = require('../diagnostico');
const { validarXmlCompilado, validarSemanticaBlogger } = require('../xmlValidator');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

const NICHO = 'brutalista-appcraft';
const dossie = carregarNichoDossie(NICHO);

assert('dossiê carregado (não é null)', dossie !== null);
if (dossie) {
    const { erros, avisos } = validarDossie(dossie);
    assert('dossiê schema-válido (zero erros)', erros.length === 0, erros.join(' | '));
    assert('dossiê sem avisos', avisos.length === 0, avisos.join(' | '));
}

// A. Resolução nicho-primeiro.
{
    const xmlEsqueleto = carregarChassisParaNicho(NICHO);
    assert('esqueleto próprio carregado (marcador do doc no topo do arquivo)',
        xmlEsqueleto.includes('Esqueleto próprio do nicho brutalista-appcraft'));
}

let xmlFinal = '';
try {
    ({ xmlFinal } = executarCompilacao({ siteName: 'Site Teste', nichoTema: NICHO, colorPreset: 'tech-blue' }));
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
    assert('mobília real (footer-info/footer-links/footer-contact) sem seção vazia', ok, erros.join(' | '));
}

if (xmlFinal) {
    const dp = verificarMarcadoresDesignPackage(xmlFinal);
    assert('marcadores do Design Package presentes (</head>, b:skin, header-logo/brand, main)', dp.ok, dp.erros.join(' | '));
}

if (xmlFinal) {
    const diag = gerarDiagnostico(xmlFinal);
    const achados = diag.categorias.flatMap(c => c.achados.map(a => `${c.id}: ${a.mensagem}`));
    assert('diagnóstico score 100, zero erros/avisos', diag.score === 100 && diag.totalErros === 0 && diag.totalAvisos === 0, achados.join(' | '));
}

const corpo = xmlFinal.slice(xmlFinal.indexOf('<body>'));

// Achados 2-3 — dado real do dono original redigido (só no corpo — o
// doc comment no <head> menciona o domínio real de propósito, pra
// rastreabilidade do achado, mesmo padrão já usado nos templates
// anteriores).
assert('URL do blog real do dono original (tecdowny.blogspot.com) AUSENTE no corpo', !corpo.includes('tecdowny.blogspot.com'));
assert('logo real do dono original (AVvXsEjBxBW...) AUSENTE', !xmlFinal.includes('AVvXsEjBxBW'));
assert('link pessoal do Google Drive AUSENTE', !xmlFinal.includes('drive.google.com'));
assert('nav dinâmico via data:pages (NAV_WIDGET genérico)', corpo.includes('data:pages'));

// Achado 1 — seletores revertidos pros reais (CSS vive no <b:skin>, dentro
// do <head> — as checagens de regra CSS usam xmlFinal inteiro, não
// "corpo"; a forma "seletor {" com chave evita falso-positivo contra o
// doc comment do topo do arquivo, que menciona os nomes dos seletores
// órfãos em prosa, sem chave, só pra rastreabilidade do achado).
assert('aside .widget / aside h3 (sidebar real) presentes, .saas-sidebar-widget{/-title{ (órfãos) ausentes como regra CSS',
    xmlFinal.includes('aside .widget {') && xmlFinal.includes('aside h3 {') &&
    !xmlFinal.includes('saas-sidebar-widget {') && !xmlFinal.includes('saas-sidebar-widget-title {'));
assert('.pagination a (regra real) presente, .sl-pagination (regra do token genérico órfão) ausente',
    xmlFinal.includes('.pagination a {') && !xmlFinal.includes('.sl-pagination {') && !xmlFinal.includes('.sl-pagination-card {'));
assert('markup real do includable nextprev (classe pagination) presente no corpo, sl-pagination ausente do corpo',
    corpo.includes("class='pagination d-flex") && !corpo.includes('sl-pagination'));
assert('.footer-section (regra real) presente, .sl-footer (regra órfã) ausente',
    xmlFinal.includes('.footer-section {') && !xmlFinal.includes('.sl-footer {'));
assert('markup real do elemento footer (classe footer-section) presente no corpo, sl-footer ausente do corpo',
    corpo.includes("class='footer-section pt-5 pb-3'") && !corpo.includes('sl-footer'));
assert('.post-title-single / .post-body-content (regras reais) presentes, .saas-post-article h1/.saas-post-body (regras órfãs) ausentes',
    xmlFinal.includes('.post-title-single {') && xmlFinal.includes('.post-body-content {') &&
    !xmlFinal.includes('.saas-post-article h1 {') && !xmlFinal.includes('.saas-post-body {'));
assert('post-title-single/post-body-content (markup real) presentes no corpo, saas-post-article/saas-post-body ausentes do corpo',
    corpo.includes('post-title-single') && corpo.includes('post-body-content') &&
    !corpo.includes('saas-post-article') && !corpo.includes('saas-post-body'));
assert('.post-meta, .post-meta-single (regra real, mesma regra feed+post) presente, .saas-post-meta (regra órfã) ausente',
    xmlFinal.includes('.post-meta, .post-meta-single {') && !xmlFinal.includes('.saas-post-meta {'));
assert('.contact-form-button (regra real, sem sufixo) presente, .contact-form-button-submit (regra órfã) ausente como CSS',
    xmlFinal.includes('.contact-form-button {') && !xmlFinal.includes('.contact-form-button-submit {'));

// Achado 4 — hero protegido sozinho no b:section, H1 único via fallback oculto.
assert('ac-hero-strip (peça protegida) presente', corpo.includes('id="ac-hero-strip"') || corpo.includes("id='ac-hero-strip'"));
assert('texto default da faixa hero presente', corpo.includes('Construído com atitude'));
assert('exatamente 2 h1 no total (fallback oculto do hero + post único, mutuamente exclusivos por view)',
    (corpo.match(/<h1\b/g) || []).length === 2);

// Achado 6 — feed/post real do Blog1.
assert('.post-feed / .post-item (feed real) presentes', corpo.includes('post-feed') && corpo.includes('post-item'));
assert('post-single com header/pub_date real presente', corpo.includes('pub_date:'));

// Achados 7-10 — mobília nova coberta por tokens genéricos.
assert('TRANSLATE_WIDGET presente (sidebar-right)', corpo.includes("type='Translate'"));
assert('STATS_WIDGET presente (footer-info)', corpo.includes("type='Stats'"));
assert('LABEL_CLOUD_WIDGET presente (footer-info)', corpo.includes("type='Label'"));
assert('FEATURED_POST_WIDGET presente (footer-info)', corpo.includes("type='FeaturedPost'"));
assert('SOCIAL_LINKS_WIDGET presente (footer-links)', corpo.includes('LinkList'));
assert('BLOG_ARCHIVE_WIDGET presente (footer-links)', corpo.includes("type='BlogArchive'"));
assert('CONTACT_FORM presente (footer-contact)', corpo.includes("type='ContactForm'"));

// Achado 11 — copyright genérico.
assert('copyright usa data:blog.title (não texto hardcoded do dono real)',
    corpo.includes('<data:blog.title/>. Todos os direitos'));

// Achado 12 — acessibilidade do botão de menu mobile.
assert('navbar-toggler com aria-label presente', corpo.includes("aria-label='Abrir menu de navegação'"));

// Peça protegida do dossiê aparece 1x.
assert('ac-hero-strip (peça protegida) aparece 1x', (xmlFinal.match(/id="ac-hero-strip"/g) || []).length === 1);

// JS combinado não colide em escopo global.
{
    const blocos = [...xmlFinal.matchAll(/<script\b[^>]*>\s*\/\/<!\[CDATA\[([\s\S]*?)\/\/\]\]>\s*<\/script>/g)].map(m => m[1]);
    const { ok, erro } = validarEscopoGlobal(blocos);
    assert('JS do output não colide em escopo global', ok, erro);
}

console.log(`\n${failed === 0 ? '✅' : '❌'} nichoDossie.${NICHO}: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

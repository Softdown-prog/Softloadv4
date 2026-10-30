require('../test/isolatedTelemetry.cjs');
'use strict';

/**
 * Teste de regressão da migração "esqueleto por nicho" (Fase 2, 4/11):
 * saas-nexus ganha template_saas-nexus.xml próprio, extraído de
 * exemplos/saas-nexus.xml (arquivo hand-authored real) — deixa de
 * compartilhar o chassis genérico 'saas' com brutalista-appcraft.
 *
 * Escolhido por resolver um compartilhamento de chassis ATIVO hoje e
 * por ser de baixo risco: o dossiê já documentava que o chassis "saas"
 * foi construído a partir do design REAL deste nicho (comentários no
 * chassis diziam "nexus: #saas-cards .widget" etc) — a estrutura já
 * batia quase 1:1, sem remapeamento de seletor.
 *
 * Achados desta migração:
 *   1. 'top-bar': o b:widget HTML1 do arquivo real tem conteúdo de um
 *      cartão de preços COMPLETO ("Plano Pro", benefícios, CTA) — mas o
 *      CSS do próprio arquivo real define '.top-bar-wrapper .widget'
 *      como barra fina de aviso (h2 escondido, padding pequeno). O
 *      conteúdo é idêntico ao de 'pricing-cards' (mesmo "99"/"A solução
 *      completa..."), claramente colado no lugar errado na autoria
 *      original. Deixado como slot nativo vazio.
 *   2. 'header-logo': Header1 real tinha displayUrl apontando pra uma
 *      imagem já hospedada do dono original — dado real, redigido via
 *      HEADER_WIDGET genérico.
 *   3. 'menu-links': PageList99 real tinha URL do blog real do dono
 *      original + 1 link pessoal do Google Drive — mesmo padrão de dado
 *      real de tecnologia-techwind. Redigido via NAV_WIDGET genérico; o
 *      CTA extra real "Fale Conosco" (âncora #contato) foi preservado
 *      como link estático.
 *   4. 'hero-text'/'hero-media'/'saas-cards'/'pricing-cards'/
 *      'testimonials': widgets nativos reais (HTML/Image/Text) mantidos
 *      verbatim — título/conteúdo editáveis pelo painel de Layout do
 *      Blogger, copy genérica o bastante pra qualquer produto SaaS. CTAs
 *      de pricing (href="#" morto no arquivo real) trocados por âncora
 *      #contato real.
 *   5. 'main' (não 'main-blog'): Blog1 extraído verbatim (feed
 *      .post-card, post único h1/post-body reais — mesmas classes já
 *      documentadas no chassis compartilhado). widget-settings
 *      trimmados pra lista válida (nomes tipo style.textcolor,
 *      showAuthorProfile, showLocation, timestampLabel com valor
 *      literal são rejeitados pelo Blogger hoje).
 *   6. 'pre-footer': Stats1 nativo → STATS_WIDGET genérico. HTML3
 *      "{Como Instalar Seu Template}" (iframe promocional do vendedor
 *      do tema) NÃO extraído — mesmo achado já fechado em tecnologia-
 *      techwind/noticias-mag-news. FEATURED_POST_WIDGET adicionado
 *      (nichoModuleDefaults.js já ligava featuredPostWidget:true sem
 *      seção real pra receber).
 *   7. 'footer-links' (novo): blogArchiveWidget/socialLinksWidget já
 *      ligados em nichoModuleDefaults.js sem seção real pra receber.
 *   8. 'footer-contact': ContactForm1 real tinha includable customizado
 *      → mapeado pro token CONTACT_FORM genérico, mesmo padrão já usado
 *      em todas as migrações anteriores.
 *   9. Copyright do rodapé: "Nexus Tech" hardcoded no arquivo real →
 *      data:blog.title (nome real do site gerado).
 *  10. nichoModuleDefaults.js reauditado: statsWidget adicionado (achado
 *      6, sem flag correspondente antes desta migração).
 *
 * Execute: node src/core/compilerEngine/nichoDossie.saas-nexus.test.js
 */

const { carregarNichoDossie } = require('./dossieLoader');
const { validarDossie } = require('./dossieValidator');
const { verificarDomIdsNoOutput, verificarSecoesPreenchidas } = require('./dossieIntegrityChecker');
const { chassisParaNicho } = require('../nichoTaxonomy');
const { validarEscopoGlobal } = require('../../blogger/scriptValidation');
const { executarCompilacao, carregarChassisParaNicho, verificarMarcadoresDesignPackage } = require('../compilerWorker');
const { gerarDiagnostico } = require('../diagnostico');
const { validarXmlCompilado, validarSemanticaBlogger } = require('../xmlValidator');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

const NICHO = 'saas-nexus';
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
        xmlEsqueleto.includes('Esqueleto próprio do nicho saas-nexus'));
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
    assert('mobília real (pre-footer/footer-links/footer-contact) sem seção vazia', ok, erros.join(' | '));
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

// Achados 2-3 — dado real do dono original redigido.
assert('URL do blog real do dono original (tjtestehj.blogspot.com) AUSENTE', !corpo.includes('tjtestehj.blogspot.com'));
assert('logo real do dono original (AVvXsEhRgwNxGUyv...) AUSENTE', !corpo.includes('AVvXsEhRgwNxGUyvlEepDTjzlvuEQpxk'));
assert('link pessoal do Google Drive AUSENTE', !corpo.includes('drive.google.com'));
assert('nav dinâmico via data:pages (NAV_WIDGET genérico)', corpo.includes('data:pages') || xmlFinal.includes('data:pages'));

// Achado 4 — widgets reais mantidos, CTAs de pricing corrigidos.
assert('hero-text real ("Revolucione a sua Gestão") presente', corpo.includes('Revolucione a sua Gestão'));
assert('saas-cards com os 3 widgets Text reais presentes', (corpo.match(/type='Text'/g) || []).length >= 4);
assert('testimonial real (João Silva) presente', corpo.includes('João Silva'));
assert('CTAs de pricing usam âncora real #contato (não href="#" morto)',
    !corpo.includes('href="#" class="btn btn-outline-primary') && !corpo.includes('href="#" class="btn btn-primary w-100'));

// Achado 1 — conteúdo mal-colocado não extraído.
assert('cartão de preços duplicado do top-bar NÃO presente 2x (só em pricing-cards)',
    (corpo.match(/Ideal para pequenos negócios/g) || []).length === 1);

// Achado 5 — feed/post real.
assert('.post-card (feed real) presente', corpo.includes('post-card'));
assert('h1 de post único real presente', corpo.includes("class='fw-bold mb-4 display-5'"));
assert('exatamente 2 h1 no total (fallback oculto do hero + post único, mutuamente exclusivos)',
    (corpo.match(/<h1\b/g) || []).length === 2);

// Achados 6-8 — mobília nova coberta por tokens genéricos.
assert('STATS_WIDGET presente (pre-footer)', corpo.includes("type='Stats'"));
assert('FEATURED_POST_WIDGET presente (pre-footer)', corpo.includes("type='FeaturedPost'"));
assert('BLOG_ARCHIVE_WIDGET presente (footer-links)', corpo.includes("type='BlogArchive'"));
assert('SOCIAL_LINKS_WIDGET presente (footer-links)', corpo.includes('LinkList'));
assert('CONTACT_FORM presente (footer-contact)', corpo.includes("type='ContactForm'"));
assert('iframe promocional ("Como Instalar Seu Template") AUSENTE', !corpo.includes('Como Instalar Seu Template'));

// Achado 9 — copyright genérico.
assert('copyright usa data:blog.title (não "Nexus Tech" hardcoded)',
    corpo.includes('<data:blog.title/>. Todos os direitos') && !corpo.includes('Nexus Tech.'));

// Peça protegida do dossiê aparece 1x.
assert('nexus-hero-strip (peça protegida) aparece 1x', (xmlFinal.match(/id="nexus-hero-strip"/g) || []).length === 1);

// JS combinado não colide em escopo global.
{
    const blocos = [...xmlFinal.matchAll(/<script\b[^>]*>\s*\/\/<!\[CDATA\[([\s\S]*?)\/\/\]\]>\s*<\/script>/g)].map(m => m[1]);
    const { ok, erro } = validarEscopoGlobal(blocos);
    assert('JS do output não colide em escopo global', ok, erro);
}

console.log(`\n${failed === 0 ? '✅' : '❌'} nichoDossie.${NICHO}: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

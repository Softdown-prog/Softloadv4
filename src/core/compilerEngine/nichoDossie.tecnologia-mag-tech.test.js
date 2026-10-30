require('../test/isolatedTelemetry.cjs');
'use strict';

/**
 * Teste de regressão do dossiê por nicho: tecnologia-mag-tech.
 *
 * Esqueleto próprio (Fase 2, 11/11 — ÚLTIMO nicho da Fase 2, ver plano
 * "esqueleto por nicho", /root/.claude/plans/indexed-jumping-treehouse.md):
 * template_tecnologia-mag-tech.xml substitui o chassis 'magazine'
 * compartilhado, extraído da estrutura física real de
 * exemplos/tecnologia-mag-tech.xml (3177 linhas, o maior arquivo desta
 * rodada — 9 b:section reais: header-area, menu-area, featured-area,
 * main-content, sidebar-area, footer-area-about, footer-area-search,
 * footer-bottom-copy, footer-social).
 *
 * Achados desta migração:
 *   1. Dossiê original (12 peças) tinha só ~204 das ~1360 linhas reais
 *      do b:skin capturadas (9 peças 'modulo' reformatadas/aproximadas —
 *      confirmado: '.dropdown-menu' do dossiê antigo omitia
 *      'box-shadow: var(--shadow-md)' presente no real). Consolidado
 *      numa peça única 'modulo-base-tecnologia-mag-tech' com o b:skin
 *      real INTEIRO e verbatim (exceto o bloco do preloader, já coberto
 *      pela peça widget 'preloader' — evita duplicidade). 'blockquote-
 *      moderno' antiga usava seletor '.post-body' que nunca existiu
 *      fisicamente no arquivo (wrapper real é '.article-safe-area') —
 *      corrigido na consolidação. --primary-hover/--shadow-md: variáveis
 *      CSS genuinamente órfãs da FONTE (usadas em 4 pontos reais, nunca
 *      declaradas em lugar nenhum do arquivo original) — declaradas
 *      no :root com valores derivados do tema (achado do cssWorker.js).
 *   2. 'mag-hero-spotlight' (peça 'hero' antiga, #mag-hero-spotlight)
 *      REMOVIDA do dossiê — zero ocorrência de "mag-hero" no arquivo
 *      real. O hero físico real é outro: um slider client-side (achado
 *      4) sem h1 estático nenhum — nenhum NICHO_HERO (token) usado.
 *   3. 'header-logo' (renomeado de 'header-area' — marcador canônico do
 *      Design Package): Header1 real (useImage=true) com foto real do
 *      dono — displayUrl redigido pra vazio. Ramo b:else (h1.site-title,
 *      só alcançável se useImage=false) removido como código morto —
 *      colidia com o h1 do post único (mesmo padrão de gamer-playerone
 *      achado 14).
 *   4. 'featured-area' (gated isHomepage): HTML200 é casca vazia
 *      preenchida via AJAX (slider real, sem h1 estático — JS injeta h2
 *      por slide) — H1_FALLBACK_OCULTO (mesmo texto de compile.js)
 *      adicionado ao conteúdo estático do widget pra garantir 1 h1 real
 *      e permanente, mesmo antes/sem o JS rodar.
 *   5. 'menu-area': LinkList1 mantido verbatim — dropdown por prefixo
 *      '_' em script próprio do arquivo (id real 'mag-dynamic-menu',
 *      não usa o token MENU_DROPDOWN_PREFIXO genérico).
 *   6. 'main' (Blog1, id renomeado do real 'main-content' — marcador
 *      canônico): HTML1 ("Como Instalar o Template", iframe Drive
 *      pessoal do vendedor, MESMO id de arquivo já achado em
 *      natureza-bulma-vegan/gamer-playerone/pop-retro-pixel) REMOVIDO.
 *      Ao contrário de pop-retro-pixel, a includable 'main' REAL já
 *      diferenciava corretamente isMultipleItems/post único — nenhum
 *      bug de roteamento aqui. Widget-settings trimmados (style.*(7)/
 *      authorLabel/timestampLabel/reactionsLabel vazio/
 *      showAuthorProfile/showLocation/postsPerAd rejeitados). 5
 *      ocorrências de data:blog.pageType (API V1 depreciada)
 *      modernizadas pra data:view.isPost/isPage/isMultipleItems
 *      (mesma semântica, achado do diagnóstico). error404=true já
 *      configurado, sem tratamento no arquivo real — ERROR_404_MODULE
 *      (token) ligado.
 *   7. 'sidebar-area': HTML150 (placeholder de anúncio genérico) +
 *      PopularPosts1 mantidos verbatim.
 *   8. 'footer-area-about' (8 widgets): PageList1 tinha domínio real do
 *      dono (http://mag-webly.blogspot.com/) — redigido pra '/'. Image1
 *      tinha foto/banner real e única do dono (não bate com o padrão
 *      boilerplate confirmado seguro) — displayUrl redigido pra vazio.
 *      Translate1/PopularPosts2/Stats1/BlogArchive1/FeaturedPost1/Text1
 *      mantidos verbatim.
 *   9. 'footer-area-search': ContactForm1 mantido NATIVO (não trocado
 *      pelo token CONTACT_FORM genérico) — a includable 'main' REAL do
 *      widget (self-contida) já usa 'contact-form-button-submit', e a
 *      peça de CSS real do dossiê mira exatamente essa classe — CSS e
 *      HTML batem 1:1 na fonte.
 *  10. 'footer-bottom-copy'/'footer-social': Text999 (copyright nativo
 *      editável) e HTML400 (ícones sociais, todos href='#') mantidos
 *      verbatim.
 *  11. Script de rodapé: bloco "MOTOR DO PRELOADER" removido — já
 *      coberto pelo campo 'js' da peça widget 'preloader'.
 *
 * Execute: node src/core/compilerEngine/nichoDossie.tecnologia-mag-tech.test.js
 */

const { carregarNichoDossie } = require('./dossieLoader');
const { validarDossie } = require('./dossieValidator');
const { verificarDomIdsNoOutput, verificarSecoesPreenchidas } = require('./dossieIntegrityChecker');
const { chassisParaNicho } = require('../nichoTaxonomy');
const { validarEscopoGlobal } = require('../../blogger/scriptValidation');
const { validarTokensCss } = require('../../blogger/cssValidation');
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

const NICHO = 'tecnologia-mag-tech';
const dossie = carregarNichoDossie(NICHO);

// A. Dossiê existe e é schema-válido.
assert('dossiê carregado (não é null)', dossie !== null);
if (dossie) {
    const { erros, avisos } = validarDossie(dossie);
    assert('dossiê schema-válido (zero erros)', erros.length === 0, erros.join(' | '));
    assert('dossiê sem avisos', avisos.length === 0, avisos.join(' | '));
    assert('dossiê tem 3 peças (1 modulo consolidado + 2 widget protegidos)', dossie.pecas.length === 3, String(dossie.pecas.length));
    assert("'mag-hero-spotlight' (hero fantasma, sem estrutura física real) NÃO está entre as peças",
        !dossie.pecas.some(p => p.id === 'mag-hero-spotlight'));
}

// B. Esqueleto próprio carregado (não cai no fallback do chassis 'magazine').
{
    const chassisXml = carregarChassisParaNicho(NICHO);
    assert('carregarChassisParaNicho() carrega template_tecnologia-mag-tech.xml (não o chassis magazine genérico)',
        chassisXml.includes('tecnologia-mag-tech') || chassisXml.includes('QUEST_LOG') === false && chassisXml.includes('MAG TECH'));
}

// C. Compila via executarCompilacao() real (mesmo caminho de um usuário final).
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

// Mobília nativa do esqueleto sem seção vazia.
if (xmlFinal) {
    const { ok, erros } = verificarSecoesPreenchidas(xmlFinal, chassisParaNicho(NICHO), NICHO);
    assert('mobília do esqueleto sem seção vazia', ok, erros.join(' | '));
}

// D. Marcadores do Design Package (achado 3/6 — svgLogo=header-logo, heroHtml/staticSections=main).
if (xmlFinal) {
    const dp = verificarMarcadoresDesignPackage(xmlFinal);
    assert('marcadores do Design Package presentes', dp.ok, dp.erros.join(' | '));
    assert("id='header-logo' (renomeado de header-area) presente", xmlFinal.includes("<b:section id='header-logo'"));
    assert("id='main' (renomeado de main-content) presente", xmlFinal.includes("<b:section id='main'"));
}

// E. Validação estrutural/semântica + diagnóstico completo.
if (xmlFinal) {
    const vx = validarXmlCompilado(xmlFinal);
    assert('validarXmlCompilado() sem erro', (vx.ok !== false), JSON.stringify(vx));

    const vs = validarSemanticaBlogger(xmlFinal);
    assert('validarSemanticaBlogger() sem erro (nenhum includable órfão)', vs.erros.length === 0, vs.erros.join(' | '));

    const diag = gerarDiagnostico(xmlFinal);
    const achados = diag.categorias.flatMap(c => c.achados.map(a => `${c.id}: ${a.mensagem}`));
    assert('diagnóstico score 100, zero erros/avisos', diag.score === 100 && diag.totalErros === 0 && diag.totalAvisos === 0, achados.join(' | '));
}

// F. Tokens de cor do tema continuam injetados (tokensCss não mudou nesta migração).
assert('--primary literal presente no :root', xmlFinal.includes('--primary: #2563eb;'));
assert('--bg-color literal presente no :root', xmlFinal.includes('--bg-color: #f8fafc;'));

// G. Achado 4 — hero real (slider AJAX) + fallback de h1 permanente.
assert("b:section 'featured-area' gated por isHomepage presente", xmlFinal.includes("id='featured-area'") && xmlFinal.includes("cond='data:view.isHomepage'"));
assert("H1_FALLBACK_OCULTO (h1.visually-hidden com data:blog.title) presente no hero", xmlFinal.includes("<h1 class='visually-hidden'><data:blog.title/></h1>"));
assert("shell do slider real (#hero-slider-container) presente", xmlFinal.includes('hero-slider-container'));

// H. Design real do usuário: CSS extraído de verdade do arquivo hand-authored.
assert('CSS de card de notícia (.news-card) presente', xmlFinal.includes('.news-card'));
assert('CSS do dropdown de menu (.dropdown-menu/.dropdown-item) presente', xmlFinal.includes('.dropdown-menu') && xmlFinal.includes('.dropdown-item'));
assert('CSS de PopularPosts premium (.hotness-bar) presente', xmlFinal.includes('.hotness-bar') || xmlFinal.includes('popular-tabs'));
assert("blockquote usa o wrapper real '.article-safe-area' (não '.post-body', que nunca existiu no arquivo)",
    xmlFinal.includes('.article-safe-area blockquote') && !xmlFinal.includes('.post-body blockquote'));
assert('--primary-hover e --shadow-md (achado 1, variáveis órfãs da fonte corrigidas) declaradas',
    xmlFinal.includes('--primary-hover:') && xmlFinal.includes('--shadow-md:'));

// I. Achado 6 — modernização data:blog.pageType (API V1) → data:view.* (dentro do Blog1 real).
assert("data:blog.pageType (API depreciada) AUSENTE do Blog1 (modernizado pra data:view.*)",
    !xmlFinal.slice(xmlFinal.indexOf("id='Blog1'"), xmlFinal.indexOf('</b:widget>', xmlFinal.indexOf("id='Blog1'"))).includes('blog.pageType'));
assert("data:view.isMultipleItems/isPost/isPage presentes na cadeia real de comentários/feed do Blog1",
    xmlFinal.includes('not data:view.isPost') && xmlFinal.includes('data:view.isMultipleItems'));

// J. Dado real do dono original / artefato de vendedor / bug morto ausentes
// (checado a partir de <head> — o doc-comment do topo do arquivo CITA essas
// mesmas strings como documentação do que foi redigido, mesmo padrão de
// pop-retro-pixel/"SOFTLOAD ENGINE V6").
const corpo = xmlFinal.slice(xmlFinal.indexOf('<head>'));
assert('foto real do dono (Header1) AUSENTE', !corpo.includes('AVvXsEjhJLI3'));
assert('foto/banner real do dono (Image1, footer) AUSENTE', !corpo.includes('AVvXsEgl3FHrop'));
assert('domínio real do dono (PageList1) AUSENTE', !corpo.includes('mag-webly.blogspot.com'));
assert("HTML1 'Como Instalar o Template' (iframe Drive pessoal) AUSENTE", !corpo.includes('drive.google.com'));
assert('id de arquivo do Drive do vendedor (mesmo dos outros 3 nichos) AUSENTE', !corpo.includes('1x6uv77pTiuZwcolU0ugJkIo2AtGiSuNE'));
assert("bloco morto 'MOTOR DO PRELOADER' duplicado NÃO presente (só 1x, via peça widget)",
    (xmlFinal.match(/getElementById\('magPreloader'\)/g) || []).length === 1);

// SEO sem erro estrutural.
{
    const achadosSeo = checarSeo(xmlFinal);
    const errosSeo = achadosSeo.filter(a => a.nivel === 'erro');
    assert('checarSeo() não encontra erro estrutural', errosSeo.length === 0, JSON.stringify(errosSeo));
}

// CSS do nicho sem variável órfã (usa os tokens do próprio dossiê + pontes --sl-* do
// design-voice auto-injetado por nichoTema, mesmo padrão de gamer-playerone).
{
    const cssMatch = xmlFinal.match(/CSS DO NICHO[\s\S]*?\*\/\s*\n([\s\S]*?)\n\s*\]\]>/);
    assert('CSS do nicho extraído do XML pro teste de variável órfã', !!cssMatch);
    if (cssMatch && dossie) {
        const tokensExternos = [
            ...Object.keys(dossie.tokensCss.light_mode || {}).filter(k => k.startsWith('--')),
            '--sl-primary', '--sl-card-bg',
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

require('../test/isolatedTelemetry.cjs');
'use strict';

/**
 * Teste de regressão da migração "esqueleto por nicho" (fora da Fase 2 —
 * feita à parte, quando o usuário enviou exemplos/theme-1931633132670417290.xml,
 * um tema Blogger real construído em colaboração direta nesta sessão):
 * elearning-academy ganha template_elearning-academy.xml próprio, extraído
 * da estrutura física real (4 b:section: main, sidebar, footer-col-1,
 * footer-col-2, + hero embrulhado em home-hero nesta migração). Chassis
 * 'blog' compartilhado deixa de ser usado por este nicho.
 *
 * Dossiê continua zerado (pecas:[], tokensCss.light_mode:{}) — todo o
 * conteúdo real do arquivo é WIDGET NATIVO (Blog1/LinkList1/Label2) ou
 * markup estático direto no esqueleto, não peças de dossiê; não havia
 * identidade visual própria (tokensCss) documentada a preservar.
 *
 * Achados desta migração (ver comentário completo no topo de
 * template_elearning-academy.xml):
 *   1. Blog1 (main): 13 b:widget-setting inválidos (style.textcolor e
 *      afins, timestampLabel, reactionsLabel, postLabelsLabel,
 *      showAuthorProfile, showLocation, postsPerAd) — Blogger rejeitaria
 *      o upload. Trimmado pros 9 válidos.
 *   2. Label2 (footer-col-2): selectedLabelsList/showType inválidos, trimmados.
 *   3. ~50 includables padrão (stubs nunca customizados) →
 *      [[BLOGGER_INCLUDABLES_PADRAO]]; postPagination/tooltipCss mantidos
 *      verbatim (fora do partial); post/postMetadataJSONImage/
 *      postMetadataJSONPublisher removidos — a última continha a ÚNICA
 *      URL Blogger-hospedada real do arquivo (redação automática).
 *   4. postPagination ativado (includable + CSS existiam, nunca eram
 *      chamados) via <b:include cond='data:view.isMultipleItems'
 *      name='postPagination'/> no fim do loop de posts.
 *   5. Hero (isHomepage) embrulhado em <b:section id='home-hero'> com
 *      widget HTML89 próprio (data:blog.title/metaDescription reais
 *      preservados via b:includable, não texto estático) — antes era
 *      HTML solto fora de b:section (violava o schema Blogger).
 *   6. [[READING_TIME]] novo, inline no meta do post.
 *   7. [[ERROR_404_MODULE]] novo — sem tratamento de 404 antes.
 *   8. Sidebar única — [[STATS_WIDGET]][[FEATURED_POST_WIDGET]], vazia antes.
 *   9. [[COOKIE_MODULE]] novo — LGPD, sem aviso de cookies antes.
 *  10. [[FONT_MODULE]]/[[DYNAMIC_CSS]]/[[NICHO_CSS]]/[[NICHO_JS]]/
 *      [[NICHO_WIDGETS_HTML]] wired, sem conflito com fonte real.
 *  11. [[SEO_MODULE]] deliberadamente OMITIDO — SEO/OG/Twitter autoral
 *      real já existe (Fase 7, data:blog.canonicalUrl); incluir o módulo
 *      genérico duplicaria/colidiria (data:blog.homepageUrl). Trade-off
 *      aceito: 1 aviso no Diagnóstico (sem JSON-LD WebSite automático).
 *  12. TOC/barra de progresso reais (Fase 7) — [[TOC_MODULE]]/
 *      [[READING_PROGRESS]] genéricos nunca entram (flags órfãs
 *      documentadas em nichoModuleDefaults.js).
 *  13. lang/dir adicionados em <html> — achado real de acessibilidade.
 *
 * Achados do 2º round (feedback direto do usuário testando o compilado):
 *  15. Token de cor real do preset não era usado em nenhum lugar — todo
 *      acento de cor (bordas, botões, hover) referenciava uma variável
 *      local hardcoded pra #198754 (com 1 fallback errado, #2563eb, num
 *      hover de rede social), nunca respondendo à troca de preset no
 *      Workspace. Renomeado pra referenciar a variável de cor de
 *      verdade em todo lugar (superado pelo achado 20, ver abaixo).
 *  16. Header/título/logo não eram Gadget nenhum — <a class='navbar-brand'>
 *      hardcoded, só editável mexendo no código. Trocado por b:section
 *      id='header-logo' com widget Header1 real (data:image/data:title),
 *      editável no painel de Layout do Blogger — inclui upload de logo em
 *      imagem (useImage), que antes não existia de jeito nenhum.
 *  17. Nav só tinha Home/FAQ hardcoded, sem gadget nenhum pro dono
 *      adicionar página. Section id='header-menu' com PageList1 real
 *      adicionada como irmã do <ul> estático (Home/FAQ continuam fixos —
 *      não fazem sentido como Page do Blogger) — lista adicional de
 *      páginas some sozinha quando nenhuma é configurada.
 *  18. Mobile: busca + alternador de tema ficavam espremidos lado a lado
 *      no menu colapsado (<992px, navbar-expand-lg). Busca agora ocupa
 *      100% da largura e empilha acima do alternador.
 *  19. Formulário de contato nativo (ContactForm type, arrastado direto do
 *      painel Layout) não tinha nenhuma classe Bootstrap — 1ª tentativa de
 *      CSS dedicado (superada pelo achado 21, ver abaixo).
 *
 * Achados do 3º round (usuário testando em Blogger real — Tema >
 * Personalizar):
 *  20. Nenhum <Variable> do Blogger Theme Designer existia neste
 *      esqueleto (diferente de TODOS os outros chassis do projeto,
 *      confirmado por grep) — por isso "Tema > Personalizar" não tinha
 *      campo nenhum pra editar cor. Adicionado o bridge nativo (mesmo
 *      padrão de template_natureza-bulma-vegan.xml): bloco <Variable>/
 *      <Group> comentado + `:root { --el-primary: $(theme.color.primary); }`.
 *      Todo o CSS autoral do tema (que antes usava --sl-primary, achado
 *      15) passa a usar --el-primary — editável direto no painel nativo
 *      do Blogger. --sl-primary/[[DYNAMIC_CSS]] continuam presentes em
 *      paralelo, namespace separado, só pros módulos por token
 *      (COOKIE_MODULE/READING_TIME/ERROR_404_MODULE) que já
 *      referenciam --sl-primary internamente.
 *  21. CSS do formulário de contato (achado 19) mirava só
 *      .contact-form-widget, mas a marcação real do Blogger é ANINHADA
 *      (.contact-form-widget > .form > form > input, confirmado contra
 *      exemplos/aquarela.xml, export real com ContactForm nativo) — o
 *      flex no wrapper externo nunca alcançava os campos de verdade,
 *      dentro do <form> 2 níveis abaixo. Reescrito pra
 *      `.contact-form-widget .form > form` (container flex de verdade),
 *      escondendo os <p>/<br> vazios usados como espaçador antigo.
 *      Classe do botão corrigida pra .contact-form-button (a real —
 *      o elemento tem 2 classes, contact-form-button
 *      contact-form-button-submit; a específica-demais não existe sem a
 *      genérica).
 *
 * Execute: node src/core/compilerEngine/nichoDossie.elearning-academy.test.js
 */

const { carregarNichoDossie } = require('./dossieLoader');
const { validarDossie } = require('./dossieValidator');
const { verificarDomIdsNoOutput, verificarSecoesPreenchidas } = require('./dossieIntegrityChecker');
const { chassisParaNicho, pageTypeParaNicho } = require('../nichoTaxonomy');
const { validarEscopoGlobal } = require('../../blogger/scriptValidation');
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

const NICHO = 'elearning-academy';
const dossie = carregarNichoDossie(NICHO);

assert('dossiê carregado (não é null)', dossie !== null);
if (dossie) {
    const { erros } = validarDossie(dossie);
    assert('dossiê schema-válido (zero erros)', erros.length === 0, erros.join(' | '));
    assert('pecas está vazio (conteúdo real é widget nativo/markup estático, não peça de dossiê)',
        dossie.pecas.length === 0);
    assert('chassis continua batendo com nichoTaxonomy.js (fallback de família, hoje sem uso)',
        dossie.chassis === chassisParaNicho(NICHO));
    assert('pageType continua batendo com nichoTaxonomy.js', dossie.pageType === pageTypeParaNicho(NICHO));
}

// A. Resolução nicho-primeiro.
{
    const xmlEsqueleto = carregarChassisParaNicho(NICHO);
    assert('esqueleto próprio carregado (marcador do doc no topo do arquivo)',
        xmlEsqueleto.includes('Esqueleto próprio do nicho elearning-academy'));
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
    const { erros: errosSem } = validarSemanticaBlogger(xmlFinal);
    assert('semântica Blogger sem erro (widget-settings válidos, widgets filhos diretos de b:section)',
        errosSem.length === 0, errosSem.join(' | '));
}

if (dossie && xmlFinal) {
    const { ok, erros } = verificarDomIdsNoOutput(xmlFinal, dossie);
    assert('todo domId declarado aparece no XML compilado (dossiê zerado — sempre ok)', ok, erros.join(' | '));
}

if (xmlFinal) {
    const { ok, erros } = verificarSecoesPreenchidas(xmlFinal, chassisParaNicho(NICHO), NICHO);
    assert('mobília real (sidebar/footer-col-1/footer-col-2/home-hero) sem seção vazia', ok, erros.join(' | '));
}

if (xmlFinal) {
    const dp = verificarMarcadoresDesignPackage(xmlFinal);
    assert('marcadores do Design Package presentes (</head>, b:skin, navbar-brand, main)', dp.ok, dp.erros.join(' | '));
}

if (xmlFinal) {
    const diag = gerarDiagnostico(xmlFinal);
    const achados = diag.categorias.flatMap(c => c.achados.map(a => `${c.id}: ${a.mensagem}`));
    // Achado 11: 1 aviso esperado (JSON-LD ausente — SEO_MODULE omitido de
    // propósito pra não colidir com o bloco SEO/OG/Twitter autoral real).
    assert('diagnóstico score >= 96, zero erros, no máximo 1 aviso (JSON-LD, trade-off aceito)',
        diag.totalErros === 0 && diag.totalAvisos <= 1 && diag.score >= 96, achados.join(' | '));
}

const corpo = xmlFinal.slice(xmlFinal.indexOf('<body'));

// Achado 1 — settings inválidos do Blog1 removidos (checado só no <body>
// — o comentário de documentação no <head> cita os nomes removidos por
// histórico, não é o widget-settings de verdade).
assert("style.textcolor (setting inválido de Blog1) AUSENTE", !corpo.includes('style.textcolor'));
assert("postLabelsLabel (setting inválido de Blog1) AUSENTE", !corpo.includes('postLabelsLabel'));
assert("showLocation (setting inválido de Blog1) AUSENTE", !corpo.includes('showLocation'));

// Achado 2 — settings inválidos do Label2 removidos.
assert("selectedLabelsList (setting inválido de Label2) AUSENTE", !corpo.includes('selectedLabelsList'));

// Achado 3 — includables padrão trocados pelo partial; postPagination/
// tooltipCss reais preservados; URL Blogger-hospedada real removida.
assert('tooltipCss real (LINT.IfChange) preservado verbatim', xmlFinal.includes('LINT.IfChange'));
assert('nenhuma URL Blogger-hospedada real vazada (AVvXsEgfMvYAhAbd)', !xmlFinal.includes('AVvXsEgfMvYAhAbd'));

// Achado 4 — paginação ativada.
assert("postPagination ativado (b:include cond='data:view.isMultipleItems')",
    corpo.includes("name='postPagination'"));
assert("includable postPagination (blog-pager) presente", xmlFinal.includes("id='blog-pager'"));

// Achado 5 — hero embrulhado em b:section válido, com data: real preservado.
assert("home-hero é uma b:section de verdade (widget HTML89 filho direto)",
    /<b:section id='home-hero'[^>]*>[\s\S]*?<b:widget id='HTML89'/.test(xmlFinal));
assert('hero preserva data:blog.title real (não virou texto estático)',
    /home-hero[\s\S]{0,600}<data:blog\.title\/>/.test(xmlFinal));

// Achado 6 — reading time ativado.
assert('[[READING_TIME]] resolvido (id sl-reading-time)', corpo.includes('sl-reading-time'));

// Achado 7 — 404 ativado.
assert("módulo de 404 presente (data:view.isError)", xmlFinal.includes('data:view.isError'));

// Achado 8 — sidebar preenchida.
assert("Stats1 (STATS_WIDGET) na sidebar", corpo.includes("type='Stats'"));
assert("FeaturedPost1 (FEATURED_POST_WIDGET) na sidebar", corpo.includes("type='FeaturedPost'"));

// Achado 9 — cookie banner ativado.
assert('[[COOKIE_MODULE]] resolvido (id sl-cookie-bar)', corpo.includes('sl-cookie-bar'));

// Achado 11 — SEO autoral real preservado, sem módulo genérico duplicado.
assert('canonical autoral real (data:blog.canonicalUrl) presente', xmlFinal.includes('data:blog.canonicalUrl'));
assert('Open Graph autoral real (og:site_name) presente', xmlFinal.includes("property='og:site_name'"));

// Achado 12 — TOC/progresso reais preservados, tokens genéricos ausentes.
assert('TOC autoral real (auto-toc) presente', corpo.includes('auto-toc'));
assert('barra de progresso autoral real (read-progress) presente', corpo.includes('read-progress'));
assert('[[TOC_MODULE]] genérico NÃO usado (token não sobrou órfão)', !xmlFinal.includes('[[TOC_MODULE]]'));

// Achado 15/20 — --el-primary real (bridge nativo Blogger), sem
// --bs-primary local hardcoded, sem --sl-primary no CSS autoral (só
// segue existindo via [[DYNAMIC_CSS]] pros módulos por token).
assert('CSS do tema usa var(--el-primary...)', xmlFinal.includes('var(--el-primary'));
assert('--bs-primary local (desconectada do preset) AUSENTE', !xmlFinal.includes('--bs-primary'));
assert('bridge nativo :root com --el-primary presente', xmlFinal.includes('--el-primary: $(theme.color.primary)'));
assert('<Variable name="theme.color.primary" presente (Tema > Personalizar)', xmlFinal.includes('<Variable name="theme.color.primary"'));

// Achado 16 — Header1 real, editável via Layout, com suporte a logo em imagem.
assert("b:section id='header-logo' com Header1 real", /<b:section[^>]*id='header-logo'[\s\S]{0,200}<b:widget id='Header1'/.test(xmlFinal));
assert('Header1 suporta logo em imagem (data:image)', corpo.includes('data:image'));

// Achado 17 — nav com PageList real pra páginas extras, Home/FAQ fixos.
assert("b:section id='header-menu' com PageList1 real", /<b:section[^>]*id='header-menu'[\s\S]{0,200}<b:widget id='PageList1'/.test(xmlFinal));
assert('Home/FAQ fixos continuam presentes', corpo.includes(">Home<") && corpo.includes(">FAQ<"));

// Achado 18 — mobile: busca full-width no menu colapsado.
assert('regra mobile de #search-input full-width presente', xmlFinal.includes('#search-input'));

// Achado 19 — CSS do formulário de contato nativo.
// Achado 21 — CSS alcança a marcação real ANINHADA (não só o wrapper externo).
assert('CSS de .contact-form-widget .form > form (container flex real)', xmlFinal.includes('.contact-form-widget .form > form'));
assert('CSS de .contact-form-button (classe real, não a "-submit" sozinha)', xmlFinal.includes('.contact-form-button {'));
assert('<p>/<br> vazios do formulário escondidos', /\.contact-form-widget \.form > form > p,\s*\n\s*\.contact-form-widget \.form > form > br \{\s*\n\s*display: none;/.test(xmlFinal));

// Achado 13 — acessibilidade (lang/dir).
assert("expr:lang='data:blog.locale' presente em <html>", xmlFinal.includes("expr:lang='data:blog.locale'"));

// Achado 14 — CSS de fundo elegante (Fase 8), sem faixas.
assert('gradiente diagonal elegante (135deg) presente', xmlFinal.includes('linear-gradient(135deg'));
assert('faixas repetidas (repeating-linear-gradient) AUSENTES', !xmlFinal.includes('repeating-linear-gradient'));

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

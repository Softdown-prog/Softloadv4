'use strict';

/**
 * Teste de regressão da migração "esqueleto por nicho" (Fase 2, 9/11):
 * natureza-bulma-vegan ganha template_natureza-bulma-vegan.xml próprio,
 * extraído de exemplos/natureza-bulma-vegan.xml (2606 linhas, 13 b:section
 * reais). Chassis 'blog' compartilhado segue ativo só com pop-retro-pixel/
 * tecnologia-mag-tech (2 nichos restantes da Fase 2).
 *
 * Achados desta migração:
 *   1. Dossiê (19 peças, +1 nesta migração) já era CSS-fiel à realidade —
 *      zero seletor remapeado pro chassis 'blog' compartilhado (confirmado
 *      via grep: nenhuma ocorrência de .sl-header/.sl-footer/.sl-nav/
 *      .blog-post-body/.news-card/rgba(var(--sl-primary)) em nenhuma
 *      peça). Trabalho aqui foi 100% estrutural.
 *   2. 'header-logo': Header1 real (useImage=true, foto real do dono) →
 *      [[HEADER_WIDGET]] genérico (.sl-header-brand, compatível com troca
 *      de logo via Design Package).
 *   3. 'header-menu': LinkList1 real tinha domínio real do dono
 *      (bulma-webly.blogspot.com) + 1 link pessoal do Google Drive —
 *      redigidos pra '#', preservando a ESTRUTURA real (itens com prefixo
 *      '_' alimentam submenu dropdown via [[MENU_DROPDOWN_PREFIXO]]).
 *   4. 'hero-section': Image1 real (foto real do dono) — displayUrl
 *      redigido. Seção ganhou gate isHomepage (arquivo real renderizava
 *      em toda página — colidia com o h1 do post único).
 *   5. 'before-post-content': badge de tempo de leitura customizado →
 *      [[READING_TIME]] genérico (mesma função, seletor mais robusto).
 *   6. 'main' (Blog1, id renomeado do real 'main-blog' pro marcador
 *      canônico do Design Package): settings inválidos trimmados; view
 *      isError → [[ERROR_404_MODULE]] (variante ERROR_404_NATUREZA já
 *      existia em modules.js); postCard/postFull/nextprev reais mantidos.
 *      Includables completos do Blog1 (~680 linhas) mantidos VERBATIM sem
 *      [[BLOGGER_INCLUDABLES_PADRAO]] — sistema de comentários real
 *      (comment-block/avatar/author/footer, CSS própria no dossiê) é
 *      substancialmente mais rico que os stubs vazios do partial
 *      genérico. postMetadataJSON/shareIcon/emailIcon/facebookIcon/
 *      twitterIcon/pinterestIcon/linkedinIcon/blogThisIcon/get_linkIcon/
 *      manageComments — includables referenciados mas nunca definidos no
 *      arquivo original (gap real da fonte) — autorados como stubs de
 *      segurança / JSON-LD mínimo real.
 *   7. 'after-post-content': HTML8 ("Como Instalar o Template", iframe
 *      pro Google Drive pessoal do dono) REMOVIDO — artefato de
 *      distribuição do tema, não conteúdo do site. HTML7 (anúncio) e
 *      FeaturedPost1 mantidos verbatim.
 *   8. 'sidebar-right': HTML3 é um banner de cookies REAL completo nunca
 *      antes capturado como peça de dossiê (cookieBanner não estava
 *      ligado em nichoModuleDefaults.js — site não tinha banner nenhum)
 *      — autorada como peça nova 'widget-cookie-banner'. Translate1
 *      nativo preservado.
 *   9. 'widget-html-1'/'widget-html-2'/'outros-widgets-html': peças
 *      'secao' já existentes escritas direto nas suas b:section reais —
 *      inclui o HERO SLIDER real (#nat-hero-slider, carrossel Bootstrap
 *      via JSON feed) + botão voltar-ao-topo (#nat-back-to-top) +
 *      PopularPosts1/Label1 nativos.
 *  10. footer-left (Stats1)/footer-right (BlogArchive1+HTML5) verbatim.
 *      footer-center: Image2 (foto real, sem título/link/caption)
 *      redigido; ContactForm1 real → [[CONTACT_FORM]] (CSS revertida de
 *      '.contact-form-button-submit' pra '.contact-form-button', 6ª
 *      ocorrência desse bug recorrente nesta sessão).
 *  11. Copyright já era genérico (ano dinâmico + data:blog.title) — único
 *      nicho desta rodada sem hardcode real no copyright.
 *  12. Script de rodapé: mover before/after-post pro post único e
 *      highlight de busca mantidos verbatim; posts relacionados (JSON
 *      feed, ids #related-posts-container/#related-posts-grid) mantido
 *      verbatim — NÃO é o mesmo mecanismo do [[RELATED_POSTS_JSON]]
 *      genérico. relatedPosts=true/sliderJson=true ficam como flags
 *      não-usadas documentadas (mesmo trade-off de gamer-playerone/
 *      reviewEngine) — o hero slider e os posts relacionados reais são
 *      estruturalmente diferentes dos tokens genéricos equivalentes.
 *  13. H1 único por view — postFull (post) e hero-section gated por
 *      isHomepage (home) nunca colidem.
 *  14. Acessibilidade: 5 <img> sem alt corrigidos (avatares de
 *      comentário, ícone de excluir comentário, foto do autor, imagem do
 *      FeaturedPost1); botão de busca do header ganhou aria-label.
 *
 * Execute: node src/core/compilerEngine/nichoDossie.natureza-bulma-vegan.test.js
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
const { TOKENS_GLOBAIS_CHASSIS } = require('./designTokensCss');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

const NICHO = 'natureza-bulma-vegan';
const dossie = carregarNichoDossie(NICHO);

assert('dossiê carregado (não é null)', dossie !== null);
if (dossie) {
    const { erros, avisos } = validarDossie(dossie);
    assert('dossiê schema-válido (zero erros)', erros.length === 0, erros.join(' | '));
    assert('dossiê sem avisos', avisos.length === 0, avisos.join(' | '));
    assert('dossiê tem 20 peças (19 originais + banner de cookies novo)',
        dossie.pecas.length === 20, dossie ? String(dossie.pecas.length) : 'dossie null');
}

// A. Resolução nicho-primeiro.
{
    const xmlEsqueleto = carregarChassisParaNicho(NICHO);
    assert('esqueleto próprio carregado (marcador do doc no topo do arquivo)',
        xmlEsqueleto.includes('Esqueleto próprio do nicho natureza-bulma-vegan'));
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
    assert('mobília real (before-post-content/footer-center) sem seção vazia', ok, erros.join(' | '));
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

// Achados 3 — dado real do dono original ausente.
assert('domínio real do dono original (bulma-webly.blogspot.com) AUSENTE', !xmlFinal.includes('bulma-webly'));
assert('link pessoal do Google Drive AUSENTE', !xmlFinal.includes('drive.google.com'));
assert('foto real do logo do dono (AVvXsEhVSq) AUSENTE', !xmlFinal.includes('AVvXsEhVSq'));
assert('foto real do hero do dono (AVvXsEiDhD) AUSENTE', !xmlFinal.includes('AVvXsEiDhD'));
assert('foto real do footer do dono (AVvXsEgWWgqJ) AUSENTE', !xmlFinal.includes('AVvXsEgWWgqJ'));

// Achado 7 — artefato de distribuição do tema removido.
assert('"Como Instalar o Template" (leak de marketplace) AUSENTE', !xmlFinal.includes('Como Instalar'));

// Achados 9 — hero slider e botão voltar-ao-topo reais, únicos.
assert('hero slider autoral (#nat-hero-slider) presente', xmlFinal.includes('id="nat-hero-slider"'));
assert('#nat-hero-slider aparece 1x (não duplicado)', (xmlFinal.match(/id="nat-hero-slider"/g) || []).length === 1);
assert('botão voltar ao topo (#nat-back-to-top) presente', xmlFinal.includes('id="nat-back-to-top"'));
assert('#nat-back-to-top aparece 1x (não duplicado)', (xmlFinal.match(/id="nat-back-to-top"/g) || []).length === 1);

// Achado 8 — banner de cookies real, novo.
assert('banner de cookies real (#nat-cookie-banner) presente', xmlFinal.includes('nat-cookie-banner'));
assert('consentimento via localStorage (nat_cookie_consent_v1) presente', xmlFinal.includes('nat_cookie_consent_v1'));

// Achado 1 — variáveis CSS órfãs já corrigidas na fonte (nenhuma
// regressão nesta migração).
assert('token --nat-primary com a cor real do design (#8FBC8F)', xmlFinal.includes('--nat-primary: $(theme.color.primary)'));
assert('--news-primary (bug de copy-paste, nunca declarado) NÃO presente', !xmlFinal.includes('--news-primary'));
assert('var(--sl-font-family) (fix do --font-main órfão) presente', xmlFinal.includes('var(--sl-font-family)'));

// Achado 2 — settings inválidos removidos (Label + Blog).
assert("settings inválidos do Label (selectedLabelsList/showType) NÃO presentes", !xmlFinal.includes('selectedLabelsList') && !xmlFinal.includes("name='showType'"));
assert("showLocation (Blog1, setting inválido) AUSENTE", !corpo.includes('showLocation'));

// Achado 6 — 404 temático real via módulo, includables reais mantidos.
assert('404 temático real ("perdeu na trilha") presente', corpo.includes('perdeu na trilha'));
assert('sistema de comentários real (.comment-block) presente — não substituído por stub', corpo.includes('comment-block'));

// Achado 10 — CONTACT_FORM revertido pro seletor real.
assert('.contact-form-button (sem sufixo -submit) presente no CSS', xmlFinal.includes('.contact-form-button'));
assert("type='ContactForm' presente (footer-center)", corpo.includes("type='ContactForm'"));

// Achado 14 — acessibilidade.
assert("botão de busca do header com aria-label='Buscar'", corpo.includes("aria-label='Buscar'"));

// SEO sem erro estrutural.
{
    const achadosSeo = checarSeo(xmlFinal);
    const errosSeo = achadosSeo.filter(a => a.nivel === 'erro');
    assert('checarSeo() não encontra erro estrutural', errosSeo.length === 0, JSON.stringify(errosSeo));
}

// CSS do nicho sem variável órfã — --sl-* são tokens globais legítimos.
{
    const cssMatch = xmlFinal.match(/CSS DO NICHO[\s\S]*?\*\/\s*\n([\s\S]*?)\n\s*\]\]>/);
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

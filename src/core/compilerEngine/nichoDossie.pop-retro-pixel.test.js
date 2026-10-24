'use strict';

/**
 * Teste de regressão do dossiê por nicho: pop-retro-pixel.
 *
 * Esqueleto próprio (Fase 2, 10/11 — ver plano "esqueleto por nicho",
 * /root/.claude/plans/indexed-jumping-treehouse.md): template_pop-retro-
 * pixel.xml substitui o chassis 'blog' compartilhado, extraído da
 * estrutura física real de exemplos/pop-retro-pixel.xml (1436 linhas, 5
 * b:section reais: header-top, landing-content, testimonials, main-feed,
 * sidebar — sem footer b:section, texto estático).
 *
 * Achados desta migração:
 *   1. Dossiê (16 peças, 14 módulos CSS-only + 1 hero autoral +
 *      1 widget novo) já era CSS-fiel à realidade — zero seletor
 *      remapeado pro chassis 'blog'.
 *   2. 'header-logo' (renomeado de 'header-top' — marcador canônico do
 *      Design Package, mesmo trade-off de biolink-social): Header1 real
 *      (useImage=true/imagePlacement=REPLACE, foto real do dono) —
 *      displayUrl redigido pra vazio, estrutura preservada. HTML101
 *      "Frase de Moeda" (placeholder "COLOQUE UMA MOEDA") mantido.
 *   3. 'home-hero' (seção NOVA, gated isHomepage): peça hero
 *      'pixel-hero-banner' (autoral, já existia no dossiê) recebe seção
 *      própria pela 1ª vez — arquivo real não tinha hero nenhum.
 *   4. 'landing-content'/'testimonials': HTML4/HTML1/HTML5 mantidos
 *      100% verbatim — zero dado real (imagens já placehold.co no
 *      arquivo original); placeholders editáveis (@NOME_DO_ESPECIALISTA,
 *      @CLIENTE_PRO, "1000 XP") mantidos — não são leak.
 *   5. 'main' (Blog1, id renomeado de 'main-feed' — marcador canônico):
 *      HTML8 ("Como Instalar o Template", iframe Drive pessoal do
 *      vendedor, MESMO id de arquivo já achado em natureza-bulma-vegan/
 *      gamer-playerone) REMOVIDO. HTML3 (post demo estático): única
 *      imagem realmente exclusiva do arquivo redigida pra placehold.co.
 *      BUG REAL DA FONTE corrigido: 'main' original SEMPRE renderizava o
 *      card simplificado (glitch-title), mesmo em post único — nunca
 *      chamava post/postBody/postFooter/comments (definidas mas órfãs).
 *      Corrigido: card + paginação só em isMultipleItems; isSingleItem
 *      usa a cadeia real via postCommentsAndAd. Includables ausentes
 *      (headerByline/footerBylines/bylineByName/bylineRegion/postAuthor/
 *      postLabels/postLocation/postTimestamp/postShareButtons/
 *      sharingButtons+cadeia/commentsLink/defaultAdUnit/postJumpLink/
 *      emailPostIcon — gap real da fonte) autoradas verbatim a partir
 *      dos defaults reais do próprio Blogger. postMetadataJSON (JSON-LD
 *      mínimo real) autorado do zero. View isError (404) sem tratamento
 *      no arquivo real — ligado ERROR_404_MODULE (token) genérico.
 *   6. 'sidebar': HTML6/Translate1/Stats1/HTML2/HTML50 mantidos
 *      verbatim. ContactForm1 real → CONTACT_FORM (token) genérico
 *      (upgrade de qualidade real: zero CSS pré-existente mirava
 *      ContactForm1 no arquivo original). HTML7 (banner de cookies REAL
 *      e completo, nunca capturado antes) autorado como peça NOVA
 *      'widget-cookie-banner' — renderizada só via NICHO_WIDGETS_HTML,
 *      NÃO hand-embutida (evita duplicidade, mesmo padrão de natureza).
 *   7. Copyright do rodapé genericizado (era "© 2026 - SOFTLOAD ENGINE
 *      V6" hardcoded) — ano dinâmico + data:blog.title.
 *   8. Script de rodapé: bloco morto "LOGO SWAP ENGINE" REMOVIDO
 *      (`#main-logo-img` nunca existia em nenhum elemento real do
 *      arquivo). `.logo-switcher` (CSS órfã, mesmo motivo) mantida —
 *      inofensiva, documentada.
 *   9. xmlValidator.js: 'widget-title'/'responsiveImage'/
 *      'responsiveImageStyle' confirmados includables PLATAFORMA Blogger
 *      (o arquivo real, tema comercializado, usa os 3 sem jamais
 *      definir localmente) — adicionados a INCLUDABLES_BUILTIN (fix na
 *      raiz; gamer-playerone tinha contornado removendo a referência).
 *
 * Execute: node src/core/compilerEngine/nichoDossie.pop-retro-pixel.test.js
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

const NICHO = 'pop-retro-pixel';
const dossie = carregarNichoDossie(NICHO);

// A. Dossiê existe e é schema-válido.
assert('dossiê carregado (não é null)', dossie !== null);
if (dossie) {
    const { erros, avisos } = validarDossie(dossie);
    assert('dossiê schema-válido (zero erros)', erros.length === 0, erros.join(' | '));
    assert('dossiê sem avisos', avisos.length === 0, avisos.join(' | '));
    assert('dossiê tem 16 peças (14 modulo + 1 hero + 1 widget novo)', dossie.pecas.length === 16, String(dossie.pecas.length));
    assert("peça nova 'widget-cookie-banner' presente", dossie.pecas.some(p => p.id === 'widget-cookie-banner'));
}

// B. Esqueleto próprio carregado (não cai no fallback do chassis 'blog').
{
    const chassisXml = carregarChassisParaNicho(NICHO);
    assert('carregarChassisParaNicho() carrega template_pop-retro-pixel.xml (não o chassis blog genérico)',
        chassisXml.includes('pop-retro-pixel') || chassisXml.includes('QUEST_LOG'));
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

// Mobília nativa do esqueleto (before-post-content/footer-center) sem seção vazia.
if (xmlFinal) {
    const { ok, erros } = verificarSecoesPreenchidas(xmlFinal, chassisParaNicho(NICHO), NICHO);
    assert('mobília do esqueleto (sidebar/main) sem seção vazia', ok, erros.join(' | '));
}

// Regressão visual objetiva: o input no widget de newsletter não pode
// somar largura 100% + padding + borda fora do box (overflow mobile).
assert('newsletter .pixel-input usa border-box no XML compilado',
    xmlFinal.includes('box-sizing: border-box; min-width: 0;'));

// D. Marcadores do Design Package (achado 2/5 — svgLogo=header-logo, heroHtml/staticSections=main).
if (xmlFinal) {
    const dp = verificarMarcadoresDesignPackage(xmlFinal);
    assert('marcadores do Design Package presentes', dp.ok, dp.erros.join(' | '));
    assert("id='header-logo' (renomeado de header-top) presente", xmlFinal.includes("<b:section id='header-logo'"));
    assert("id='main' (renomeado de main-feed) presente", xmlFinal.includes("<b:section id='main'"));
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
assert('--primary literal presente no :root', xmlFinal.includes('--primary: #FF4500;'));
assert('--border-pixel (token completo, largura+estilo+cor) presente',
    xmlFinal.includes('--border-pixel: 4px solid #000000;'));

// G. Hero (achado 3): seção NOVA, gated isHomepage.
assert('hero pixel-hero-banner presente no XML', xmlFinal.includes("id='pixel-hero-banner'") || xmlFinal.includes('id="pixel-hero-banner"'));
assert('texto do hero presente', xmlFinal.includes('Bem-vindo à zona retro') || xmlFinal.includes('data-typewriter'));
assert("b:section 'home-hero' gated por isHomepage presente", xmlFinal.includes("id='home-hero'") && xmlFinal.includes("cond='data:view.isHomepage'"));

// H. Design real do usuário: CSS extraído de verdade do arquivo hand-authored.
assert('CSS de card RPG (.pixel-card) presente', xmlFinal.includes('.pixel-card'));
assert('CSS de diálogo NPC (.npc-dialogue) presente', xmlFinal.includes('.npc-dialogue'));
assert('CSS de efeito CRT (.crt-container/.scanlines) presente', xmlFinal.includes('.crt-container') && xmlFinal.includes('.scanlines'));
assert('CSS do componente de vídeo 16:9 (.mag-video-wrapper) presente', xmlFinal.includes('.mag-video-wrapper'));
assert('cursor RPG piscante (.widget-content ul li::before) presente', xmlFinal.includes('.widget-content ul li::before'));
assert('.reveal/.reveal.active presentes', xmlFinal.includes('.reveal {') && xmlFinal.includes('.reveal.active {'));

// I. Achado 5 — bug real da fonte corrigido: post único usa a cadeia real, não o card simplificado.
assert("'main' do Blog1 roteia por isMultipleItems (card+paginação) / isSingleItem (postCommentsAndAd)",
    xmlFinal.includes("cond='data:view.isMultipleItems'") && xmlFinal.includes("name='postCommentsAndAd'"));
assert('postMetadataJSON (JSON-LD) autoral presente', xmlFinal.includes('"@type": "BlogPosting"'));

// J. Achados 5/7/8 — dado real do dono original / artefato de vendedor / bug morto ausentes.
assert('foto real do dono (header) AUSENTE', !xmlFinal.includes('AVvXsEicUcI631Ui8_0Tqi'));
assert('imagem exclusiva do post-demo real AUSENTE (redigida pra placehold.co)', !xmlFinal.includes('AVvXsEi-Snxm'));
assert("HTML8 'Como Instalar o Template' (iframe Drive pessoal) AUSENTE", !xmlFinal.includes('drive.google.com'));
assert('id de arquivo do Drive do vendedor (mesmo dos outros 2 nichos) AUSENTE', !xmlFinal.includes('1x6uv77pTiuZwcolU0ugJkIo2AtGiSuNE'));
assert("LOGO SWAP ENGINE ('main-logo-img', id nunca existiu em html nenhum) NÃO presente", !xmlFinal.includes('main-logo-img'));
assert('copyright genericizado (ano dinâmico + data:blog.title, não mais hardcoded)',
    xmlFinal.includes('document.write(new Date().getFullYear())') && !xmlFinal.includes('© 2026 - SOFTLOAD ENGINE V6'));

// K. Achado 6 — banner de cookies real vira peça de dossiê, renderizado 1x só via NICHO_WIDGETS_HTML.
assert("banner de cookies (#retro-cookie-banner) presente exatamente 1x",
    (xmlFinal.match(/id="retro-cookie-banner"/g) || []).length === 1);
assert("chave real de consentimento 'softload_cookie_accepted' presente", xmlFinal.includes('softload_cookie_accepted'));

// SEO sem erro estrutural.
{
    const achadosSeo = checarSeo(xmlFinal);
    const errosSeo = achadosSeo.filter(a => a.nivel === 'erro');
    assert('checarSeo() não encontra erro estrutural', errosSeo.length === 0, JSON.stringify(errosSeo));
}

// CSS do nicho sem variável órfã (usa os tokens do próprio dossiê).
{
    const cssMatch = xmlFinal.match(/CSS DO NICHO[\s\S]*?\*\/\s*\n([\s\S]*?)\n\s*\]\]>/);
    assert('CSS do nicho extraído do XML pro teste de variável órfã', !!cssMatch);
    if (cssMatch && dossie) {
        const tokensExternos = Object.keys(dossie.tokensCss.light_mode || {}).filter(k => k.startsWith('--'));
        const r = validarTokensCss(cssMatch[1], { tokensExternos });
        assert('CSS do nicho sem variável CSS órfã', r.ok, JSON.stringify(r.erros));
    }
}

// JS combinado não colide em escopo global. HTML3 (post demo estático,
// real, verbatim) usa a técnica de escape de CDATA aninhado
// '//]]]]><![CDATA[>' pra um '//]]>' literal não fechar prematuramente o
// CDATA externo do widget-setting — XML-válido (validarXmlCompilado já
// confirma), mas a extração via regex (não é um parser XML de verdade)
// precisa desfazer esse escape antes de casar o fechamento do <script>,
// senão o non-greedy engole conteúdo até o PRÓXIMO '//]]>' do documento.
{
    const xmlParaAnalise = xmlFinal.replace(/\]\]\]\]><!\[CDATA\[>/g, ']]>');
    const blocos = [...xmlParaAnalise.matchAll(/<script\b[^>]*>\s*\/\/<!\[CDATA\[([\s\S]*?)\/\/\]\]>\s*<\/script>/g)].map(m => m[1]);
    const { ok, erro } = validarEscopoGlobal(blocos);
    assert('JS do output não colide em escopo global', ok, erro);
}

console.log(`\n${failed === 0 ? '✅' : '❌'} nichoDossie.${NICHO}: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

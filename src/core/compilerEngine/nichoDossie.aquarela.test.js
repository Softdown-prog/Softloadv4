require('../test/isolatedTelemetry.cjs');
'use strict';

/**
 * Teste de regressão da migração "esqueleto por nicho" (Fase 2, 3/11):
 * aquarela ganha template_aquarela.xml próprio, extraído de
 * exemplos/aquarela.xml (arquivo hand-authored real, origem externa) —
 * deixa de compartilhar o chassis genérico 'portfolio' com
 * portfolio-minimalista.
 *
 * Escolhido por ser o arquivo mais simples de todos os candidatos
 * restantes (374 linhas, landing page estática de 1 página, sem Blog
 * widget nenhum no arquivo original) e por resolver um compartilhamento
 * de chassis ativo hoje.
 *
 * Achados desta migração:
 *   1. Sem navbar/menu/dark-mode/back-to-top/cookie-banner no arquivo
 *      real — nenhuma dessas flags está ligada em nichoModuleDefaults.js
 *      pra este nicho, esqueleto não injeta nenhum desses módulos.
 *   2. Sem Blog widget nenhum no arquivo real (landing page de verdade).
 *      gerarDiagnostico() exige pelo menos 1 widget type='Blog' em todo
 *      template ("sem ele as postagens do Blogger nunca são entregues")
 *      — bug latente do arquivo de origem, não reproduzido aqui: seção
 *      'main' ganhou um Blog1 real ("Novidades"), visível só na home
 *      quando o dono do site tiver posts (b:if cond='data:posts').
 *   3. Hero do arquivo real é 100% estático ("Renovação e Arte para seus
 *      Ambientes" — copy de demo do autor original, amarrada a pintura
 *      residencial) — trocado por data:blog.title/data:blog.metaDescription
 *      (dados reais do site gerado). Peça protegida do dossiê
 *      (aqua-hero-strip) fica isolada dentro do seu próprio b:section
 *      (só o token, sem HTML irmão — achado de verificação abaixo);
 *      headline visível é h2 (não h1): compile.js já injeta um heading
 *      oculto (H1_FALLBACK_OCULTO) com data:blog.title dentro do próprio
 *      widget do hero, porque a peça é 100% visual (sem heading próprio)
 *      — um h1 segundo duplicaria H1 na página.
 *   4. Achado de verificação (xmlValidator.js "Regra B"): numa versão
 *      anterior desta migração, o h2/p/cta ficavam DENTRO do mesmo
 *      b:section do hero, como irmãos do token NICHO_HERO — isso não é
 *      só um lint warning, quebra a árvore XML de verdade (o widget do
 *      hero passou a ter pai errado, "<html>" em vez do b:section).
 *      Corrigido movendo h2/p/cta pra FORA do b:section, como irmãos —
 *      mesmo padrão do bloco "Sobre" do template_portfolio.xml original
 *      (h2 com data:blog.title também fica fora de qualquer b:section
 *      lá).
 *   5. 'skills-section' (grade de 3 cards de serviço do arquivo real,
 *      copy de demo específica de pintura) NÃO extraída — renomeada pra
 *      id='main' (marcador canônico do Design Package — precisa da
 *      string literal em algum lugar do esqueleto mesmo sem Blog widget
 *      original), reaproveitada como área de Novidades (achado 2).
 *      .grid-services/.card do arquivo real NÃO portados pro CSS base —
 *      seriam seletor órfão sem HTML real pra bater.
 *   6. 'footer-contact': ContactForm1 nativo do arquivo real → mapeado
 *      pro token CONTACT_FORM genérico. Achado: a peça de dossiê
 *      'aqua-contact-form-style' mirava '.contact-form-button-submit',
 *      mas o includable 'main' (o que de fato renderiza) do gerador
 *      genérico usa a classe '.contact-form-button' (sem sufixo
 *      '-submit') — corrigido no dossiê nesta migração.
 *   7. 'footer-social' (novo): nichoModuleDefaults.js já ligava
 *      socialLinksWidget:true sem seção real pra receber — ganhou seção
 *      própria ao lado do formulário de contato.
 *   8. .watercolor-bg (classe CSS do arquivo real) NÃO portada — nunca é
 *      usada em nenhum elemento do corpo real (a section hero usa
 *      'watercolor-animated', não 'watercolor-bg') — CSS órfã já na
 *      fonte original.
 *
 * Execute: node src/core/compilerEngine/nichoDossie.aquarela.test.js
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

const NICHO = 'aquarela';
const dossie = carregarNichoDossie(NICHO);

assert('dossiê carregado (não é null)', dossie !== null);
if (dossie) {
    const { erros, avisos } = validarDossie(dossie);
    assert('dossiê schema-válido (zero erros)', erros.length === 0, erros.join(' | '));
    assert('dossiê sem avisos', avisos.length === 0, avisos.join(' | '));
}

// A. Resolução nicho-primeiro — template_aquarela.xml existe e é
// escolhido em vez de cair no chassis 'portfolio' de família.
{
    const xmlEsqueleto = carregarChassisParaNicho(NICHO);
    assert('esqueleto próprio carregado (marcador do doc no topo do arquivo)',
        xmlEsqueleto.includes('Esqueleto próprio do nicho aquarela'));
}

let xmlFinal = '';
try {
    ({ xmlFinal } = executarCompilacao({ siteName: 'Site Teste', nichoTema: NICHO, colorPreset: 'clean-white' }));
    passed++;
} catch (e) {
    failed++;
    console.error(`  ❌ executarCompilacao() não lança erro — ${e.message}`);
}

// Achado 4 — verificação estrutural: XML bem-formado e widgets são
// filhos diretos de b:section (o bug de "pai errado" desta migração
// aparecia aqui).
if (xmlFinal) {
    const errosXml = validarXmlCompilado(xmlFinal);
    assert('XML compilado bem-formado (zero erros de sintaxe)', errosXml.length === 0, errosXml.join(' | '));
    const { erros: errosSem, avisos: avisosSem } = validarSemanticaBlogger(xmlFinal);
    assert('semântica Blogger sem erro (widgets filhos diretos de b:section)', errosSem.length === 0, errosSem.join(' | '));
    assert('semântica Blogger sem aviso (Regra B — HTML solto em b:section)', avisosSem.length === 0, avisosSem.join(' | '));
}

if (dossie && xmlFinal) {
    const { ok, erros } = verificarDomIdsNoOutput(xmlFinal, dossie);
    assert('todo domId declarado aparece no XML compilado', ok, erros.join(' | '));
}

// Mobília real (footer-contact/footer-social) — ver entrada 'aquarela'
// em SECOES_MOBILIA_ESPERADAS.
if (xmlFinal) {
    const { ok, erros } = verificarSecoesPreenchidas(xmlFinal, chassisParaNicho(NICHO), NICHO);
    assert('mobília real (footer-contact/footer-social) sem seção vazia', ok, erros.join(' | '));
}

// Smoke-test do Design Package.
if (xmlFinal) {
    const dp = verificarMarcadoresDesignPackage(xmlFinal);
    assert('marcadores do Design Package presentes (</head>, b:skin, header-logo/brand, main)', dp.ok, dp.erros.join(' | '));
}

// Achado 2 — gerarDiagnostico exige Blog widget; score 100.
if (xmlFinal) {
    const diag = gerarDiagnostico(xmlFinal);
    const achados = diag.categorias.flatMap(c => c.achados.map(a => `${c.id}: ${a.mensagem}`));
    assert('diagnóstico score 100, zero erros/avisos', diag.score === 100 && diag.totalErros === 0 && diag.totalAvisos === 0, achados.join(' | '));
    assert("widget type='Blog' presente (achado 2 — arquivo real não tinha nenhum)", xmlFinal.includes("type='Blog'"));
}

const corpo = xmlFinal.slice(xmlFinal.indexOf('<body>'));

// Achado 3 — hero: copy de demo antiga AUSENTE, dados reais presentes.
assert('copy de demo antiga ("Renovação e Arte") AUSENTE do corpo', !corpo.includes('Renovação e Arte'));
assert('data:blog.title presente no hero (headline real, dinâmica)', corpo.includes('<data:blog.title/>'));
assert('data:blog.metaDescription presente no hero', corpo.includes('<data:blog.metaDescription/>'));
assert('peça protegida do dossiê (aqua-hero-strip) presente', corpo.includes('aqua-hero-strip'));
assert('headline visível é h2, não h1 (evita H1 duplicado)', corpo.includes("class='rainbow-text'") && /<h2[^>]*rainbow-text/.test(corpo));
assert('exatamente 1 h1 oculto (fallback) + 1 h1 de post único (mutuamente exclusivos)',
    (corpo.match(/<h1\b/g) || []).length === 2);

// Achado 6 — seletor do botão de contato corrigido.
assert("CSS usa '.contact-form-button' (corrigido, sem sufixo '-submit')", xmlFinal.includes('.contact-form-button {'));
assert("CSS NÃO usa mais '.contact-form-button-submit' (seletor antigo, órfão)", !xmlFinal.includes('.contact-form-button-submit {'));
assert('ContactForm1 nativo presente (footer-contact)', corpo.includes("type='ContactForm'"));

// Achado 7 — social links.
assert('footer-social presente', corpo.includes("id='footer-social'"));

// Achado 8 — CSS órfã não portada (busca só na área do <b:skin>, não no
// doc-comment do topo, que MENCIONA a classe em prosa pra explicar o achado).
{
    const skinInicio = xmlFinal.indexOf('<b:skin>');
    const skinFim = xmlFinal.indexOf('</b:skin>');
    const skinCss = xmlFinal.slice(skinInicio, skinFim);
    assert("'.watercolor-bg' NÃO portada pro CSS base (órfã na fonte original)", !skinCss.includes('.watercolor-bg'));
}

// Cada peça widget aparece exatamente 1x.
assert('peça hero (aqua-hero-strip) aparece 1x (não duplicada)',
    (xmlFinal.match(/id="aqua-hero-strip"/g) || []).length === 1);

// JS combinado não colide em escopo global.
{
    const blocos = [...xmlFinal.matchAll(/<script\b[^>]*>\s*\/\/<!\[CDATA\[([\s\S]*?)\/\/\]\]>\s*<\/script>/g)].map(m => m[1]);
    const { ok, erro } = validarEscopoGlobal(blocos);
    assert('JS do output não colide em escopo global', ok, erro);
}

console.log(`\n${failed === 0 ? '✅' : '❌'} nichoDossie.${NICHO}: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

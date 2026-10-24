'use strict';

/**
 * Teste de regressão da migração "esqueleto por nicho" (Fase 2, 6/11):
 * biolink-social ganha template_biolink-social.xml próprio, resolvido
 * nicho-primeiro em vez do chassis de família 'biolink'
 * (template_biolink.xml, que segue existindo como fallback — biolink-
 * social é hoje o único nicho dessa família).
 *
 * Caso atípico em relação às migrações anteriores desta fase (saas-nexus/
 * brutalista-appcraft/aquarela/tecnologia-techwind/noticias-mag-news):
 * biolink-social é o ÚNICO nicho na família 'biolink' — não havia
 * "chassis compartilhado ativo" pra resolver. A migração foi feita mesmo
 * assim pra fechar o checklist da Fase 2 e pra confirmar formalmente,
 * comparando linha a linha com exemplos/biolink-social.xml (arquivo
 * hand-authored real), que o chassis já batia com a estrutura real.
 *
 * Achados desta migração:
 *   1. O chassis já era, na prática, um esqueleto quase idêntico ao
 *      arquivo real — mesmas variáveis CSS, mesmas classes estruturais,
 *      mesma função de auto-detecção de ícone social por palavra-chave
 *      na URL. Nenhuma reversão de seletor órfão foi necessária.
 *   2. 'header-logo' (Header1): arquivo real tem uma displayUrl real
 *      apontando pra uma foto já hospedada do dono original — o chassis
 *      já usa data:image dinâmico, nenhuma redação adicional necessária.
 *   3. 'main' (antes 'links-section'): PageList1 real (URL do blog real
 *      do dono original + link pessoal do Google Drive) colado num
 *      contexto de biolink onde não faz sentido — não extraído. HTML2
 *      tem o botão de WhatsApp colado como HTML BRUTO dentro do CAMPO DE
 *      CONTEÚDO de outro widget (erro de autoria original, não Blogger
 *      XML executável nesse contexto) — preservado o 'whatsapp-float'
 *      nativo e funcional do chassis em vez da versão quebrada do
 *      arquivo real. HTML3 "{Como Instalar Seu Template}" (iframe
 *      promocional do vendedor) não extraído.
 *   4. 'footer-copyright' (arquivo real) / 'attr-section' (chassis):
 *      HTML1 do arquivo real é documentação do vendedor sobre ícones —
 *      não extraído; Attribution1 nativo preservado.
 *   5. Nenhum dado real do dono original (foto/domínio/link do Drive)
 *      sobrevive no esqueleto.
 *   6. Achado NOVO (bug latente pré-existente, não introduzido por esta
 *      migração): verificarMarcadoresDesignPackage() acusava falta dos
 *      2 marcadores literais que injetarDesignPackage() (compilerWorker.js)
 *      busca — "b:section id=header-logo"/classe de marca (svgLogo) e
 *      "b:section id=main" (heroHtml/staticSections). O chassis antigo
 *      NUNCA teve nenhum dos dois — o recurso de Design Package do chat
 *      de edição do Workspace sempre falhou silenciosamente pra
 *      biolink-social. Corrigido: 'header-bio' renomeada pra
 *      id=header-logo, 'links-section' renomeada pra id=main (mesmo
 *      padrão já usado em aquarela) — class= preservada em ambas pro CSS
 *      existente continuar batendo, name= decorativo documenta o nome
 *      real.
 *
 * Execute: node src/core/compilerEngine/nichoDossie.biolink-social.test.js
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

const NICHO = 'biolink-social';
const dossie = carregarNichoDossie(NICHO);

assert('dossiê carregado (não é null)', dossie !== null);
if (dossie) {
    const { erros, avisos } = validarDossie(dossie);
    assert('dossiê schema-válido (zero erros)', erros.length === 0, erros.join(' | '));
    assert('dossiê tem 1 peça (hero) — resto continua baseline do chassis', dossie.pecas.length === 1);
    assert('único aviso esperado é light_mode vazio',
        avisos.length === 1 && avisos.some(a => a.includes('light_mode está vazio')),
        avisos.join(' | '));
}

// A. Resolução nicho-primeiro.
{
    const xmlEsqueleto = carregarChassisParaNicho(NICHO);
    assert('esqueleto próprio carregado (marcador do doc no topo do arquivo)',
        xmlEsqueleto.includes('Esqueleto próprio do nicho biolink-social'));
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
    assert('todo domId declarado aparece no XML compilado (bio-hero-banner)', ok, erros.join(' | '));
}

if (xmlFinal) {
    const { ok, erros } = verificarSecoesPreenchidas(xmlFinal, chassisParaNicho(NICHO), NICHO);
    assert('mobília do chassis (perfil/links/social/rodapé) sem seção vazia', ok, erros.join(' | '));
}

// Achado 6 — marcadores do Design Package (bug latente pré-existente, corrigido).
if (xmlFinal) {
    const dp = verificarMarcadoresDesignPackage(xmlFinal);
    assert('marcadores do Design Package presentes (svgLogo=header-logo, heroHtml/staticSections=main)', dp.ok, dp.erros.join(' | '));
    assert("id='header-logo' (renomeado de header-bio) presente", xmlFinal.includes("<b:section id='header-logo'"));
    assert("id='main' (renomeado de links-section) presente", xmlFinal.includes("<b:section id='main'"));
}

if (xmlFinal) {
    const diag = gerarDiagnostico(xmlFinal);
    const achados = diag.categorias.flatMap(c => c.achados.map(a => `${c.id}: ${a.mensagem}`));
    assert('diagnóstico score 100, zero erros/avisos', diag.score === 100 && diag.totalErros === 0 && diag.totalAvisos === 0, achados.join(' | '));
}

const corpo = xmlFinal.slice(xmlFinal.indexOf('<body'));

// Achados 2-3 — dado real do dono original ausente.
assert('URL do blog real do dono original (social-webly.blogspot.com) AUSENTE', !corpo.includes('social-webly.blogspot.com'));
assert('link pessoal do Google Drive AUSENTE', !xmlFinal.includes('drive.google.com'));
assert('foto real do dono original (AVvXsEg9eWoT...) AUSENTE', !xmlFinal.includes('AVvXsEg9eWoT'));

// Garantias visuais: o preset genérico não cobre o footer autoral
// com um retângulo escuro em temas BioLink claros.
assert('BioLink XML não injeta seletor global escuro de footer',
    !xmlFinal.includes('.sl-footer, footer {'));
assert('BioLink preserva token de footer para componentes opcionais',
    xmlFinal.includes('--sl-footer-bg:'));
assert('BioLink não copia os links fictícios do preview para o XML',
    !xmlFinal.includes('#instagram.com') && !xmlFinal.includes('Projetos recentes'));

// Hero: banner de saudação presente no XML compilado.
assert('hero bio-hero-banner presente no XML', xmlFinal.includes('id="bio-hero-banner"') || xmlFinal.includes("id='bio-hero-banner'"));
assert('texto default do hero presente (sem heroTitle customizado no teste)', xmlFinal.includes('Tudo em um único lugar'));

// Baseline do chassis (glassmorphism, blobs, dark mode, ícones, share,
// whatsapp) continua 100% intacto e bate com o arquivo real.
assert('.link-btn (glassmorphism) presente', xmlFinal.includes('.link-btn {'));
assert('blobs animados (@keyframes blob-float) presentes', xmlFinal.includes('blob-float'));
assert('.profile-img-wrapper (anel de gradiente) presente', xmlFinal.includes('.profile-img-wrapper {'));
assert('FOUC prevention (localStorage biolink-theme no <head>) presente', xmlFinal.includes("localStorage.getItem('biolink-theme')"));
assert('motor de detecção de ícone (detectIcon, mesma lógica do arquivo real) presente', xmlFinal.includes('function detectIcon') && xmlFinal.includes('bi bi-instagram'));
assert('WhatsApp floating (widget HTML99 com SVG oficial, não a versão quebrada do arquivo real) presente', xmlFinal.includes('whatsapp-btn') && xmlFinal.includes('wa.me'));
assert('Web Share API com fallback clipboard presente', xmlFinal.includes('function handleShare') && xmlFinal.includes('navigator.clipboard'));
assert('LinkList como motor dos botões (widget LinkList1) presente', corpo.includes("id='LinkList1'"));
assert('iframe promocional ("Como Instalar Seu Template") AUSENTE', !xmlFinal.includes('Como Instalar Seu Template'));
assert('documentação de ícones do vendedor (HTML1 real, "Ícones Suportados Automaticamente") AUSENTE', !xmlFinal.includes('Ícones Suportados Automaticamente'));

// SEO sem erro estrutural.
{
    const achadosSeo = checarSeo(xmlFinal);
    const errosSeo = achadosSeo.filter(a => a.nivel === 'erro');
    assert('checarSeo() não encontra erro estrutural', errosSeo.length === 0, JSON.stringify(errosSeo));
}

// CSS do nicho (bloco NICHO_CSS) — sem variável órfã.
{
    const cssMatch = xmlFinal.match(/\/\* ---- Nicho overrides \(CSS do impl\.json\) ---- \*\/\s*\n([\s\S]*?)\n\s*\]\]>/);
    assert('bloco NICHO_CSS extraído do XML pro teste', !!cssMatch);
    if (cssMatch) {
        assert('bloco NICHO_CSS contém o CSS do hero (.bio-hero-banner)', cssMatch[1].includes('.bio-hero-banner'));
        const r = validarTokensCss(cssMatch[1], {});
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

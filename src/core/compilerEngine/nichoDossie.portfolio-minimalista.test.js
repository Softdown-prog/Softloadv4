require('../test/isolatedTelemetry.cjs');
'use strict';

/**
 * Teste de regressão do dossiê por nicho: portfolio-minimalista.
 *
 * ZERADO por decisão explícita do usuário (ver plano "Reconstruir os
 * dossiês de nicho do zero a partir de exemplos/") — não existe
 * exemplos/portfolio-minimalista.xml (nenhum arquivo hand-authored real
 * enviado pra este nicho). O dossiê anterior (achado real documentado:
 * o chassis "portfolio" já implementa TODO o padroes_design original como
 * baseline — neon_text/hero_fluido/navbar_glassmorphism/etc — dossiê
 * tinha só 1 peça, ".fw-black") tinha curadoria válida, mas SEM fonte
 * real pra reconciliar contra — zerado pra não carregar conteúdo cuja
 * proveniência não é rastreável a um arquivo real do usuário.
 * `pecas:[]` e `tokensCss.light_mode:{}`; `chassis`/`pageType` continuam
 * batendo com nichoTaxonomy.js (isso nunca muda). Fica assim até um
 * exemplos/portfolio-minimalista.xml real chegar — nesse momento,
 * reconstrução completa pela mesma metodologia usada em
 * culinaria-boutique-gourmet/natureza-bulma-vegan.
 *
 * Execute: node src/core/compilerEngine/nichoDossie.portfolio-minimalista.test.js
 */

const { carregarNichoDossie } = require('./dossieLoader');
const { validarDossie } = require('./dossieValidator');
const { verificarSecoesPreenchidas } = require('./dossieIntegrityChecker');
const { chassisParaNicho, pageTypeParaNicho } = require('../nichoTaxonomy');
const { executarCompilacao } = require('../compilerWorker');
const { checarSeo } = require('../diagnostico/seoChecker');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

const NICHO = 'portfolio-minimalista';
const dossie = carregarNichoDossie(NICHO);

// A. Dossiê existe, zerado, schema-válido (array vazio é aceito — só avisa).
assert('dossiê carregado (não é null)', dossie !== null);
if (dossie) {
    const { erros, avisos } = validarDossie(dossie);
    assert('dossiê schema-válido (zero erros)', erros.length === 0, erros.join(' | '));
    assert('pecas está vazio (zerado — sem exemplos/ real ainda)', dossie.pecas.length === 0);
    assert('tokensCss.light_mode está vazio (zerado — sem identidade visual própria ainda)',
        Object.keys(dossie.tokensCss.light_mode || {}).length === 0);
    assert('avisos mencionam pecas/light_mode vazios (esperado pro estado zerado)',
        avisos.some(a => a.includes('pecas')) && avisos.some(a => a.includes('light_mode')), avisos.join(' | '));
    assert('chassis continua batendo com nichoTaxonomy.js', dossie.chassis === chassisParaNicho(NICHO));
    assert('pageType continua batendo com nichoTaxonomy.js', dossie.pageType === pageTypeParaNicho(NICHO));
}

// B. Compila via executarCompilacao() real mesmo zerado — não deve lançar
// erro nem deixar a mobília do chassis vazia; sem nenhuma peça própria,
// o nicho vira puro chassis "portfolio" genérico (que já é rico por si
// só — neon_text/hero_fluido/navbar_glassmorphism/etc são baseline do
// chassis, não do dossiê).
let xmlFinal = '';
try {
    ({ xmlFinal } = executarCompilacao({ siteName: 'Site Teste', nichoTema: NICHO, colorPreset: 'default' }));
    passed++;
} catch (e) {
    failed++;
    console.error(`  ❌ executarCompilacao() não lança erro mesmo com dossiê zerado — ${e.message}`);
}

if (xmlFinal) {
    const { ok, erros } = verificarSecoesPreenchidas(xmlFinal, chassisParaNicho(NICHO));
    assert('mobília do chassis sem seção vazia mesmo sem peças de nicho', ok, erros.join(' | '));
}

// Baseline do chassis "portfolio" continua intacto mesmo com o dossiê
// zerado — a identidade visual do nicho, hoje, vive inteira no chassis.
if (xmlFinal) {
    assert('.hero-section (baseline do chassis) presente', xmlFinal.includes('.hero-section {'));
    assert('.btn-neon (baseline do chassis) presente', xmlFinal.includes('.btn-neon {'));
}

// SEO sem erro estrutural mesmo com o nicho zerado.
if (xmlFinal) {
    const achadosSeo = checarSeo(xmlFinal);
    const errosSeo = achadosSeo.filter(a => a.nivel === 'erro');
    assert('checarSeo() não encontra erro estrutural', errosSeo.length === 0, JSON.stringify(errosSeo));
}

console.log(`\n${failed === 0 ? '✅' : '❌'} nichoDossie.${NICHO}: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

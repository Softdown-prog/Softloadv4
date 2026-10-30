require('./test/isolatedTelemetry.cjs');
'use strict';

/**
 * Testes de compilerWorker.js — Design Package × hero protegido de dossiê.
 *
 * Achado real: blueprintEnricher.js SEMPRE preenche body.heroHtml quando
 * ausente (hero genérico + tagline fixa). Como todos os 15 nichos migrados
 * pra dossiê têm hero PROTEGIDO (protegida:true — nunca deve ser
 * trocado/suprimido), o Passo 4 já forçava temHeroDesignPackage=false pra
 * renderizar o hero real do dossiê em NICHO_HERO — mas o Passo 4c
 * (injetarDesignPackage) não sabia disso e injetava um SEGUNDO hero
 * (landing-hero/HTML90) por cima sempre que body.heroHtml existia.
 * Resultado: 2 heroes / 3 <h1> em todo template gerado pro chat.
 *
 * Execute: node src/core/compilerWorker.test.js
 */

const { executarCompilacao } = require('./compilerWorker');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

// A. Nicho com hero protegido no dossiê (gamer-playerone) + design package
// heroHtml (simula o que blueprintEnricher.js sempre preenche) — o hero do
// design package NÃO deve ser injetado; só o hero real do dossiê aparece.
{
    const { xmlFinal } = executarCompilacao({
        siteName: 'Site Teste Hero Duplo',
        nichoTema: 'gamer-playerone',
        colorPreset: 'gamer-dark',
        heroHtml: "<section class='sl-hero-enriched'><h1>Boilerplate Genérico</h1><p>Tagline fixa</p></section>",
    });
    assert('hero do design package (landing-hero) NÃO presente', !xmlFinal.includes('landing-hero'));
    assert('texto do hero boilerplate NÃO presente', !xmlFinal.includes('Boilerplate Genérico'));
    assert('hero real do dossiê (gph-hero) presente', xmlFinal.includes('gph-hero'));
    assert('só 1 <b:section id=\'landing-hero\'> (zero, na verdade — não deve existir)',
        (xmlFinal.match(/id='landing-hero'/g) || []).length === 0);
}

// B. staticSections (não é hero) continua sendo injetado normalmente mesmo
// com hero protegido no dossiê — só heroHtml é suprimido, não o design
// package inteiro.
{
    const { xmlFinal } = executarCompilacao({
        siteName: 'Site Teste Static Sections',
        nichoTema: 'gamer-playerone',
        colorPreset: 'gamer-dark',
        heroHtml: "<section><h1>Boilerplate</h1></section>",
        staticSections: "<section class='landing-extra-marker'><p>Seção extra real</p></section>",
    });
    assert('staticSections continua injetado (landing-sections)', xmlFinal.includes('landing-sections'));
    assert('conteúdo de staticSections presente', xmlFinal.includes('landing-extra-marker'));
    assert('hero boilerplate ainda suprimido mesmo com staticSections presente', !xmlFinal.includes('landing-hero'));
}

// C. Nicho SEM dossiê (retrocompatibilidade) — design package heroHtml
// continua funcionando normalmente, sem hero protegido pra suprimir.
{
    const { xmlFinal } = executarCompilacao({
        siteName: 'Site Teste Sem Dossie',
        nichoTema: null,
        colorPreset: 'tech-blue',
        heroHtml: "<section class='sl-hero-enriched'><h1>Hero Custom Sem Dossie</h1><p>Sub</p></section>",
    });
    assert('design package heroHtml injetado normalmente sem dossiê', xmlFinal.includes('landing-hero'));
    assert('texto do hero custom presente', xmlFinal.includes('Hero Custom Sem Dossie'));
}

// D. Achado real (auditoria SEO com template real de usuário): a HOME de
// todo nicho renderizava só h2/h3 no hero (nunca h1) — só a view de post
// único tinha h1. O b:section do hero só renderiza em data:view.isMultipleItems
// (ou 'not data:view.isPost', ver override abaixo), mutuamente exclusivo
// da view de post único, então promover o heading do hero pra h1 (ou
// injetar H1_FALLBACK_OCULTO quando o hero não tem heading próprio, caso
// de heros 100% visuais — badge/strip/slider JS) nunca colide com o h1
// real do post. Todos os 15 nichos devem ter exatamente 1 <h1> no
// b:section do hero, nunca 0 nem 2+.
//
// ID_SECAO_HERO_POR_NICHO: nichos com esqueleto próprio (ver plano
// "esqueleto por nicho") podem ter o slot de hero num b:section com id
// diferente de 'hero-area' — appstore-bulma-mobile usa 'swipe-categories'
// (peça 'swipe-menu-categorias' do dossiê, ver template_appstore-bulma-mobile.xml).
const ID_SECAO_HERO_POR_NICHO = {
    'appstore-bulma-mobile': 'swipe-categories',
    'noticias-mag-news': 'hero-section',
    'tecnologia-techwind': 'featured-big',
    'brutalista-appcraft': 'home-hero',
    'culinaria-boutique-gourmet': 'home-hero-h1',
    'gamer-playerone': 'home-hero',
    'natureza-bulma-vegan': 'hero-section',
    'pop-retro-pixel': 'home-hero',
    'tecnologia-mag-tech': 'featured-area',
    'elearning-academy': 'home-hero',
};
{
    const { NICHO_PAGE_TYPE_MAP } = require('./nichoTaxonomy');
    for (const nicho of Object.keys(NICHO_PAGE_TYPE_MAP)) {
        const idSecao = ID_SECAO_HERO_POR_NICHO[nicho] || 'hero-area';
        const { xmlFinal } = executarCompilacao({ siteName: `Site H1 ${nicho}`, nichoTema: nicho });
        const idx = xmlFinal.indexOf(`id='${idSecao}'`);
        assert(`${nicho}: tem b:section ${idSecao}`, idx !== -1, nicho);
        if (idx === -1) continue;
        const fechaIdx = xmlFinal.indexOf('</b:section>', idx);
        const trecho = xmlFinal.slice(idx, fechaIdx === -1 ? idx + 3000 : fechaIdx + 13);
        const h1s = (trecho.match(/<h1\b/g) || []).length;
        assert(`${nicho}: exatamente 1 <h1> em ${idSecao} (achou ${h1s})`, h1s === 1, trecho.slice(0, 200));
    }
}

console.log(`\n${failed === 0 ? '✅' : '❌'} compilerWorker: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

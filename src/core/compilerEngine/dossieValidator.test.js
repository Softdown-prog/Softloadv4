'use strict';

/**
 * Testes para o validador de schema do dossiê por nicho — dossieValidator.js.
 * Execute: node src/core/compilerEngine/dossieValidator.test.js
 */

const { validarDossie } = require('./dossieValidator');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

const DOSSIE_VALIDO = {
    nicho: 'culinaria-boutique-gourmet',
    versaoDossie: 1,
    chassis: 'blog',
    pageType: 'blogger-conteudo',
    tokensCss: {
        light_mode: { '--sd-primary': '#6f42c1' },
    },
    pecas: [
        { id: 'p1', tipo: 'hero', protegida: true, domIds: ['x'], css: '.a{}', html: '<div id="x"></div>', js: '' },
        { id: 'p2', tipo: 'modulo', protegida: false, domIds: [], css: '.b{}', html: '', js: '' },
    ],
};

// A. Dossiê válido não gera erro nenhum.
{
    const { erros, avisos } = validarDossie(DOSSIE_VALIDO);
    assert('dossiê válido: zero erros', erros.length === 0, erros.join(' | '));
    assert('dossiê válido: zero avisos', avisos.length === 0, avisos.join(' | '));
}

// B. chassis/pageType divergentes de nichoTaxonomy.js são rejeitados.
{
    const d = { ...DOSSIE_VALIDO, chassis: 'magazine' };
    const { erros } = validarDossie(d);
    assert('chassis divergente de nichoTaxonomy.js é erro', erros.some(e => e.includes('chassis')), erros.join(' | '));
}
{
    const d = { ...DOSSIE_VALIDO, pageType: 'landing-page' };
    const { erros } = validarDossie(d);
    assert('pageType divergente de nichoTaxonomy.js é erro', erros.some(e => e.includes('pageType')), erros.join(' | '));
}

// C. nicho inexistente em nichoTaxonomy.js é erro.
{
    const d = { ...DOSSIE_VALIDO, nicho: 'nicho-que-nao-existe' };
    const { erros } = validarDossie(d);
    assert('nicho inexistente em nichoTaxonomy é erro', erros.some(e => e.includes('não existe')), erros.join(' | '));
}

// D. tokensCss só aceita o formato canônico light_mode/dark_mode.
{
    const d = { ...DOSSIE_VALIDO, tokensCss: { valores_padrao: { primary: '#fff' } } };
    const { erros } = validarDossie(d);
    assert('tokensCss sem light_mode é erro (formato não-canônico rejeitado)', erros.some(e => e.includes('light_mode')), erros.join(' | '));
}
{
    const d = { ...DOSSIE_VALIDO, tokensCss: { light_mode: { corPrimaria: '#fff' } } };
    const { erros } = validarDossie(d);
    assert('chave de token sem "--" no início é erro', erros.some(e => e.includes('não é uma variável CSS')), erros.join(' | '));
}
{
    const d = { ...DOSSIE_VALIDO, tokensCss: { light_mode: { '--x': '#fff' }, dark_mode: { seletor: "[data-bs-theme='dark']", '--x': '#000' } } };
    const { erros } = validarDossie(d);
    assert('dark_mode com "seletor" + tokens válidos não gera erro', erros.length === 0, erros.join(' | '));
}

// E. pecas — ids únicos, tipo válido, protegida boolean.
{
    const d = { ...DOSSIE_VALIDO, pecas: [
        { id: 'dup', tipo: 'widget', protegida: true, domIds: ['a'], css: '', html: '<div id="a"></div>', js: '' },
        { id: 'dup', tipo: 'modulo', protegida: false, domIds: [], css: '', html: '', js: '' },
    ] };
    const { erros } = validarDossie(d);
    assert('id duplicado entre peças é erro', erros.some(e => e.includes('duplicado')), erros.join(' | '));
}
{
    const d = { ...DOSSIE_VALIDO, pecas: [{ id: 'p', tipo: 'invalido', protegida: true, domIds: [], css: '', html: '', js: '' }] };
    const { erros } = validarDossie(d);
    assert('tipo inválido é erro', erros.some(e => e.includes('tipo')), erros.join(' | '));
}
{
    const d = { ...DOSSIE_VALIDO, pecas: [{ id: 'p', tipo: 'modulo', domIds: [], css: '', html: '', js: '' }] };
    const { erros } = validarDossie(d);
    assert('protegida ausente é erro', erros.some(e => e.includes('protegida')), erros.join(' | '));
}
{
    // tipo:'secao' — <b:widget> Blogger registrado de verdade, que
    // precisa da própria <b:section> (ver nichoBlocks.js:_montarSecaoPeca
    // e [[NICHO_EXTRA_SECTIONS]]) — mesma regra de domIds de widget/hero.
    const d = { ...DOSSIE_VALIDO, pecas: [{ id: 'busca', tipo: 'secao', protegida: true, domIds: ['blog-search'], css: '', html: "<b:widget id='BlogSearch1' type='BlogSearch'><b:includable id='main'><div id='blog-search'/></b:includable></b:widget>", js: '' }] };
    const { erros } = validarDossie(d);
    assert('tipo:secao é aceito como válido', erros.length === 0, erros.join(' | '));
}

// F. domIds só é exigido quando a peça tem "html" não-vazio — peça
// "modulo" que só estiliza elemento já existente (sem html próprio) não
// precisa de domIds (achado real: culinaria-boutique-gourmet tinha 11
// peças modulo rejeitadas antes desta regra ser corrigida).
{
    const d = { ...DOSSIE_VALIDO, pecas: [
        { id: 'so-css', tipo: 'modulo', protegida: false, domIds: [], css: '.x{color:red}', html: '', js: '' },
    ] };
    const { erros } = validarDossie(d);
    assert('peça só com css, sem html, não exige domIds', erros.length === 0, erros.join(' | '));
}
{
    const d = { ...DOSSIE_VALIDO, pecas: [
        { id: 'com-html', tipo: 'widget', protegida: true, domIds: [], css: '', html: '<div id="y"></div>', js: '' },
    ] };
    const { erros } = validarDossie(d);
    assert('peça com html não-vazio SEM domIds é erro', erros.some(e => e.includes('domIds')), erros.join(' | '));
}

console.log(`\n${failed === 0 ? '✅' : '❌'} dossieValidator: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { normalizarModulosAtivos, normalizarBadgesCategoria } = require('./workerNormalize');
const defaults = {
    darkMode: true, backToTop: false, error404: true, error404Theme: 'magnews',
    contactForm: true, contactFormTitle: 'Contato do Nicho',
    popularPostsRanking: true, popularPostsRankingTitle: 'Mais Lidas',
    statsWidget: true, statsWidgetTitle: 'Estatísticas',
    blogArchiveWidget: true, blogArchiveWidgetTitle: 'Arquivo',
    featuredPostWidget: true, featuredPostWidgetTitle: 'Destaques',
    labelCloudWidget: true, labelCloudWidgetTitle: 'Categorias',
    socialLinksWidget: true, socialLinksWidgetTitle: 'Redes',
    menuType: 'offcanvas', commentsSystem: 'nativo',
};
const cases = [
    undefined, null, false, true, 'false', [], {},
    { darkMode: false, contactForm: false, menuType: 'classico', commentsSystem: 'disqus' },
    { darkMode: 'false', toc: 'false', slotAfter: 1, slotBefore: 0 },
    { darkMode: null, backToTop: false, error404Theme: 'gamer' },
    { error404Theme: 'other', mobileMenuType: 'offcanvas-right', commentsSystem: 'disqus' },
    { error404Theme: null, mobileMenuType: 'wrong', commentsSystem: 4 },
    { contactFormTitle: 'A'.repeat(70), popularPostsRankingTitle: ' P  ', statsWidgetTitle: '  ' },
    { featuredPostWidgetTitle: 123, blogArchiveWidgetTitle: 'B'.repeat(65) },
    { labelCloudWidgetTitle: ' x ', socialLinksWidgetTitle: ' y ' },
];
const vals = cases.map(c => normalizarModulosAtivos(c, defaults));
const expectedKeys = [
    'darkMode', 'backToTop', 'cookieBanner', 'toc', 'error404', 'error404Theme',
    'slotBefore', 'slotAfter', 'shareButtons', 'readingProgress', 'readingTime',
    'dropcap', 'reviewEngine', 'sliderJson', 'relatedPosts', 'contactForm',
    'contactFormTitle', 'popularPostsRanking', 'popularPostsRankingTitle',
    'appDownloadCta', 'menuDropdownPrefixo', 'statsWidget', 'statsWidgetTitle',
    'blogArchiveWidget', 'blogArchiveWidgetTitle', 'translateWidget',
    'featuredPostWidget', 'featuredPostWidgetTitle', 'labelCloudWidget',
    'labelCloudWidgetTitle', 'socialLinksWidget', 'socialLinksWidgetTitle',
    'mobileMenuType', 'commentsSystem',
];
for (const value of vals) assert.deepEqual(Object.keys(value), expectedKeys);
assert.equal(vals[0].darkMode, true);
assert.equal(vals[7].darkMode, false);
assert.equal(vals[8].darkMode, true, 'Boolean("false") continua true no contrato legado');
assert.equal(vals[9].darkMode, false, 'null explícito desliga módulo');
assert.equal(vals[10].mobileMenuType, 'offcanvas-right');
assert.equal(vals[10].commentsSystem, 'disqus');
assert.equal(vals[11].mobileMenuType, 'offcanvas');
assert.equal(vals[12].contactFormTitle.length, 60);
assert.equal(vals[12].statsWidgetTitle, 'Estatísticas');
assert.equal(vals[13].featuredPostWidgetTitle, 'Destaques');
assert.equal(vals[14].socialLinksWidgetTitle, 'y');

const badgesCases = [
    undefined, null, false, '', [], {},
    ['FPS', 'RPG', '', 'A&B', '<b>', ' Teste ', '6', '7', '8', '9'],
    [{ nome: 'FPS', bg: '#ABC', text: '#fff' }, { nome: 'RPG', bg: 'red', text: null }],
    { FPS: { bg: '#abcdef', text: '#000' }, RPG: { bg: '#xyz', text: '#f00' } },
    [null, undefined, false, 0, { nome: 'a'.repeat(45), bg: ' #fff ', text: '#ffffff' }],
    { 'A & B': null, Out: 33, Tag: 'color' },
];
const badgeVals = badgesCases.map(c => normalizarBadgesCategoria(c));
assert.equal(badgeVals[6].length, 8);
assert.equal(badgeVals[6][2].nome, 'A&amp;B');
assert.equal(badgeVals[7][0].bg, '#ABC');
assert.equal(badgeVals[7][1].bg, '#3498db');
assert.equal(badgeVals[8][0].text, '#000');
assert.equal(badgeVals[9][0].nome.length, 40);
assert.equal(badgeVals[9][0].bg, ' #fff ', 'validarHex não remove espaços do valor retornado');
function fingerprint(v) { return crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex'); }
assert.equal(fingerprint(vals), 'c5f5f860259182e7e0fdfd126ddf19567c926a11c91b6526c26e4a05a85c7b37');
assert.equal(fingerprint(badgeVals), 'de454556f1e707df054e9f951e557c375c00c05276f1ec90297eb43ac353efcb');
console.log('✅ Contrato módulos/badges: 15 + 11 cenários, precedência, limites e CSS.');

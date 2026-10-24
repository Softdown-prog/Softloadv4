'use strict';
const assert = require('node:assert/strict');
const {
    gerarDynamicCss, gerarTypographyCss, gerarCategoryBadgesCss,
    gerarButtonCss, gerarGridCardCss, TOKENS_GLOBAIS_CHASSIS,
} = require('./designTokensCss');
const engine = require('./index');

const tokens = {
    color: {primary:'#2563eb',bgBody:'#f8fafc',cardBg:'#ffffff',textMain:'#1e293b',footerBg:'#0f172a'},
    button: {btnRadius:'8px',btnShadow:'none'},
    typography: {label:'Inter',fontFamily:"'Inter', sans-serif",headingWeight:'700',lineHeight:'1.4',letterSpacing:'.02em'},
};
const expectedGlobalTokens = [
    '--sl-primary', '--sl-primary-rgb', '--sl-bg-body', '--sl-card-bg',
    '--sl-card-bg-rgb', '--sl-text-main', '--sl-text-muted', '--sl-border',
    '--sl-footer-bg', '--sl-btn-radius', '--sl-btn-shadow', '--sl-font-family',
    '--sl-heading-weight', '--sl-radius-lg', '--sl-radius-sm', '--sl-transition',
];
assert.deepEqual(TOKENS_GLOBAIS_CHASSIS,expectedGlobalTokens);
for(const fn of ['gerarDynamicCss','gerarTypographyCss','gerarCategoryBadgesCss','gerarButtonCss']) {
    assert.equal(engine[fn],require('./designTokensCss')[fn],'Barrel deve manter identidade de '+fn);
}
assert.equal(gerarCategoryBadgesCss(null),'');
assert.equal(gerarCategoryBadgesCss(undefined),'');
assert.equal(gerarCategoryBadgesCss([]),'');
assert.equal(gerarGridCardCss(),gerarGridCardCss(),'Grid estático determinístico');
const grid=gerarGridCardCss();
for(const layout of ['lista','dupla','quadrado','mural','coluna-unica','zigzag']) {
    assert.ok(grid.includes('.sl-grid-'+layout+' '),'Layout deve existir: '+layout);
}
assert.ok(grid.includes('@media (max-width: 575.98px)'));
assert.ok(grid.includes('@media (max-width: 767.98px)'));
assert.ok(grid.includes('.sl-grid-mural .news-card p,'));
assert.ok(grid.includes('/* === VARIANTES DE FORMATO DE CARD (gridLayout) === */'));

let cases=0;
for (const primary of ['#2563eb','#f00','#000000','#ffffff']) {
 for(const preserveNicheFooter of [false,true]){
    const css=gerarDynamicCss({...tokens,color:{...tokens.color,primary}}, {preserveNicheFooter});
    assert.ok(css.includes('--sl-primary:        '+primary+' !important;'));
    assert.ok(css.includes('--sl-text-muted:     color-mix(in srgb, #1e293b 65%, transparent);'));
    assert.ok(css.includes('--sl-border:         color-mix(in srgb, #1e293b 12%, transparent);'));
    assert.ok(css.includes(preserveNicheFooter?'.sl-footer {':'.sl-footer, footer {'));
    assert.ok(!css.includes('undefined'));
    assert.equal(css,gerarDynamicCss({...tokens,color:{...tokens.color,primary}}, {preserveNicheFooter}));
    cases++;
 }
}
const typo=gerarTypographyCss(tokens.typography);
assert.ok(typo.startsWith('/* === TIPOGRAFIA: Inter === */'));
assert.ok(typo.includes('letter-spacing: .02em;'));
assert.ok(typo.includes('line-height: 1.4;'));
const typoFallback=gerarTypographyCss({fontFamily:'Arial',headingWeight:'600'});
assert.ok(typoFallback.includes('line-height: 1.3;'));
assert.ok(typoFallback.includes('line-height: 1.7;'));
assert.ok(typoFallback.includes('letter-spacing: 0;'));

const badges=[
 {nome:'Café',bg:'#abc',text:'#def'},
 {nome:'Invalido',bg:'red;background:url(test)',text:'<svg>'},
 {nome:'News',bg:'#00ff00',text:'#ffffff'},
];
const cssBadges=gerarCategoryBadgesCss(badges);
assert.ok(cssBadges.includes('[data-badge="Café"]'));
assert.ok(cssBadges.includes('.sl-badge-2'));
assert.ok(cssBadges.includes('background-color: #3498db !important;'),'Invalid background fallback');
assert.ok(cssBadges.includes('color: #ffffff !important;'),'Invalid text fallback');
assert.ok(!cssBadges.includes('background:url(test)'));
assert.equal(cssBadges,gerarCategoryBadgesCss(badges));

for (const style of ['flat','default','pill','neon','brutalist','nao-existe']) {
 const css=gerarButtonCss(style,'#2563eb');
 assert.ok(css.includes('/* === ESTILO DE BOTÃO: '+style+' === */'));
 assert.ok(css.includes('.btn-primary:hover, .sl-btn:hover, .btn-cta:hover'));
 assert.ok(!css.includes('undefined'));
 assert.equal(css,gerarButtonCss(style,'#2563eb'));
 if(style==='neon')assert.ok(css.includes('box-shadow:0 0 28px #2563ebaa,0 0 8px #2563eb;'));
 if(style==='nao-existe')assert.ok(css.includes('transform:translateY(-2px);'));
 cases++;
}
assert.ok(gerarButtonCss('neon','javascript:alert(1)').includes('border:1px solid #0ea5e9;'));
console.log('✅ Design Tokens CSS: '+cases+' cenários parametrizados e contratos visuais preservados.');

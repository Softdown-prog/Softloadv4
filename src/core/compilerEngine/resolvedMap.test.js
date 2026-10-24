'use strict';

const assert = require('node:assert/strict');
const { montarMapaSlotsResolvidos } = require('./resolvedMap');
const { injetarSlotsXml, construirTraceCompilacao } = require('./compileStages');

// Independente da implementação TS: representa o objeto literal e o loop
// de módulos usados no compile.js antes desta extração.
function legado(input, modSnippets) {
    const modMap = {};
    for (const [k, v] of Object.entries(modSnippets)) {
        modMap[k.replace(/^\[\[|\]\]$/g, '')] = v;
    }
    const nichoImpl = input.nichoImpl;
    return {
        THEME_COLOR: input.primaryColor,
        SEO_MODULE: input.seoValue,
        FONT_MODULE: input.fontValue,
        DYNAMIC_CSS: input.fullCss,
        GRID_CLASS: input.gridClass,
        LAZY_LOAD_TOGGLE: input.lazyValue,
        PLACEHOLDER_IMG: input.placeholderImg,
        NICHO_CSS: nichoImpl.css || '',
        NICHO_JS: nichoImpl.js || '',
        NICHO_HERO: input.temHeroDesignPackage ? '' : (nichoImpl.heroNativoXml || input.gerarHeroWidget()),
        NICHO_WIDGETS_HTML: nichoImpl.widgetsHtml || '',
        NICHO_EXTRA_SECTIONS: nichoImpl.extraSecoesHtml || '',
        BREAKING_NEWS_BAR: input.breakingNewsBar,
        BODY_LAYOUT_CLASS: input.bodyLayoutClass,
        FOOTER_NEWSLETTER: input.footerNewsletter,
        HEADER_WIDGET: input.gerarHeaderWidget(),
        NAV_WIDGET: input.gerarNavWidget(),
        MOBILE_NAV_WIDGET: input.gerarNavWidget('PageList2'),
        ICON_AUTHOR: input.iconAuthor,
        ...modMap,
    };
}
function makeInput(nichoImpl, temHeroDesignPackage, calls) {
    return {
        primaryColor: '#aabbcc', seoValue: '<seo/>', fontValue: '<font/>',
        fullCss: 'a{}', gridClass: 'grid', lazyValue: "loading='lazy'",
        placeholderImg: 'data:img', nichoImpl, temHeroDesignPackage,
        gerarHeroWidget: () => { calls.push('hero'); return '<b:widget id="HTML89"/>'; },
        breakingNewsBar: '', bodyLayoutClass: 'layout', footerNewsletter: '',
        gerarHeaderWidget: () => { calls.push('header'); return '<header/>'; },
        gerarNavWidget: id => { calls.push(id || 'nav'); return `<nav id="${id || ''}"/>`; },
        iconAuthor: 'fa-user',
    };
}

for (const nicho of [
    {},
    { css: '.x{}', js: '[[PLACEHOLDER_IMG]]', widgetsHtml: '<aside/>', extraSecoesHtml: '<section/>' },
    { heroNativoXml: '<b:widget id="FeaturedPost1"/>', css: '', js: null },
]) {
    for (const designPackage of [false, true]) {
        for (const snippets of [
            {},
            { '[[DARK_MODE_MODULE]]': '<script/>', '[[MOBILE_MENU_TYPE]]': '<nav/>' },
            { '[[SEO_MODULE]]': '<override/>', '[[NICHO_CSS]]': '.override{}' },
        ]) {
            const oldCalls = [], newCalls = [];
            const oldMap = legado(makeInput(nicho, designPackage, oldCalls), snippets);
            const newMap = montarMapaSlotsResolvidos(makeInput(nicho, designPackage, newCalls), snippets);
            assert.deepEqual(newMap, oldMap, 'Objetos e ordem das chaves devem ser idênticos');
            assert.deepEqual(newCalls, oldCalls, 'A ordem/quantidade dos widgets deve ser idêntica');
            const xml = Object.keys(newMap).map(s => `[[${s}]]`).join('\n');
            assert.equal(injetarSlotsXml(xml, newMap, snippets), injetarSlotsXml(xml, oldMap, snippets));
            assert.deepEqual(construirTraceCompilacao(newMap), construirTraceCompilacao(oldMap));
        }
    }
}
assert.equal(montarMapaSlotsResolvidos(makeInput({}, true, []), {}).NICHO_HERO, '');
assert.equal(montarMapaSlotsResolvidos(makeInput({ heroNativoXml: '<native/>' }, false, []), {}).NICHO_HERO, '<native/>');
console.log('✅ 18 cenários de resolvedMap: conteúdo, precedência, ordem e trace compatíveis.');

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.montarMapaSlotsResolvidos = montarMapaSlotsResolvidos;
/**
 * Monta o mesmo resolvedMap do compile.js original, inclusive precedência de
 * módulos: as chaves limpas dos snippets prevalecem sobre os valores base.
 * Não sanitiza nem valida conteúdo aqui: isso permanece nos produtores.
 */
function montarMapaSlotsResolvidos(input, modSnippets) {
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
        // O hero nativo é um b:widget real e dispensa HTML89. Um design
        // package substitui o hero padrão por completo (não duplicar H1).
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

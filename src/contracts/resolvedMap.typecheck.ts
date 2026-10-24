import { montarMapaSlotsResolvidos } from '../core/compilerEngine/resolvedMap';
import type { ResolvedMapInputs } from '../core/compilerEngine/resolvedMap';
import type { ResolvedSlots } from '../core/compilerEngine/compileStages';

const input: ResolvedMapInputs = {
    primaryColor: '#abcdef', seoValue: '<meta/>', fontValue: '<link/>',
    fullCss: '', gridClass: 'grid', lazyValue: '', placeholderImg: '',
    nichoImpl: { heroNativoXml: null, css: null, extraSecoesHtml: '<section/>' },
    gerarHeroWidget: () => '<b:widget/>', breakingNewsBar: '', bodyLayoutClass: '',
    footerNewsletter: '', gerarHeaderWidget: () => '<header/>',
    gerarNavWidget: (id?: string) => id || '<nav/>', iconAuthor: 'fa-user',
};
const slots: ResolvedSlots = montarMapaSlotsResolvidos(input, { '[[FOO]]': '<div/>' });
void slots;
// @ts-expect-error O CSS compilado é string, não número.
const invalidCss: ResolvedMapInputs = { ...input, fullCss: 123 };
void invalidCss;
// @ts-expect-error o callback do hero deve devolver XML/HTML em string.
const invalidHero: ResolvedMapInputs = { ...input, gerarHeroWidget: () => 1 };
void invalidHero;

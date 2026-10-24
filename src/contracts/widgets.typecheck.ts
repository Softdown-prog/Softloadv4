import { gerarHeaderWidget, montarWidgetHtml, gerarHeroDestaqueMosaico, gerarHeroDestaqueCard, gerarNavWidget } from '../core/compilerEngine/widgets';

const header: string = gerarHeaderWidget();
const generico: string = montarWidgetHtml('HTML5', 'Apresentação', '<div>Oi</div>');
const vazio: string = montarWidgetHtml('HTML6', 'Vazio', null);
const mosaico: string = gerarHeroDestaqueMosaico('Em destaque', 'hero-mosaico');
const card: string = gerarHeroDestaqueCard('Último artigo', 'hero-card');
const navPadrao: string = gerarNavWidget();
const navMobile: string = gerarNavWidget('PageList2');
void header; void generico; void vazio; void mosaico; void card; void navPadrao; void navMobile;

// @ts-expect-error id do widget deve ser string.
montarWidgetHtml(10, 'Título', '<p/>');
// @ts-expect-error título do destaque deve ser string.
gerarHeroDestaqueMosaico(7, 'hero');
// @ts-expect-error navegação só recebe string.
gerarNavWidget(false);
// @ts-expect-error resultado é XML textual, não número.
const invalido: number = gerarHeaderWidget();
void invalido;

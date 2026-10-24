import { carregarNichoImpl } from '../core/compilerEngine/nichoImpl';
import type { NichoImplExtraido } from '../core/compilerEngine/nichoImpl';

const vazio: NichoImplExtraido = carregarNichoImpl(null);
const semNicho: NichoImplExtraido = carregarNichoImpl(undefined);
const nicho: NichoImplExtraido = carregarNichoImpl('viral-magazine');
const css: string = nicho.css;
const js: string = nicho.js;
const html: string = nicho.heroHtml;
void vazio; void semNicho; void css; void js; void html;
// @ts-expect-error o nome do nicho é texto ou ausente, nunca número.
carregarNichoImpl(42);
// @ts-expect-error o resultado contém CSS textual, não um valor numérico.
const invalido: number = carregarNichoImpl('viral-magazine').css;
void invalido;

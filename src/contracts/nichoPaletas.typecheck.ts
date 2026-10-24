import { gerarPaletaCss, PALETAS } from '../core/compilerEngine/nichoPaletas';
import type { PaletaNicho } from '../core/compilerEngine/nichoPaletas';
const css: string = gerarPaletaCss('pop-retro-pixel','SiteA');
const blank: string = gerarPaletaCss(undefined,undefined);
const table: Record<string, PaletaNicho[]> = PALETAS;
const primary: string = table['pop-retro-pixel'][0].primary;
void css; void blank; void primary;
// @ts-expect-error o CSS gerado é string e não number.
const invalid: number = gerarPaletaCss('pop-retro-pixel','seed');
void invalid;
// @ts-expect-error paletas primárias são strings hexadecimais.
const color: number = table['pop-retro-pixel'][0].primary;
void color;

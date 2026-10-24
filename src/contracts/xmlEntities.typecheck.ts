import { sanitizarEntidadesXml, escaparTextoXml, injetarHeroTexto } from '../core/compilerEngine/xmlEntities';
const str: string = sanitizarEntidadesXml('<h1>Olá</h1>');
const text: string = escaparTextoXml('A & B');
const hero: string = injetarHeroTexto('<h1>Original</h1>','Novo','Sub');
const passthroughNull: null = sanitizarEntidadesXml(null);
const passthroughNumber: number = injetarHeroTexto(42,'Novo','Sub');
const passthroughUnknown: unknown = sanitizarEntidadesXml({foo:'bar'});
void str; void text; void hero; void passthroughNull; void passthroughNumber; void passthroughUnknown;
// @ts-expect-error escaparTextoXml sempre retorna string.
const bad: number = escaparTextoXml(null);
void bad;
// @ts-expect-error Strings de entrada devem resultar em strings de saída.
const badHero: number = injetarHeroTexto('<h1>X</h1>',42,undefined);
void badHero;

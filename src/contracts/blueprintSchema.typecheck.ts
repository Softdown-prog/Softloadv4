import { ENUMS } from '../blogger/manifestSchema';
import type { BlueprintEnumKey, BlueprintEnumValue } from '../blogger/manifestSchema';

const key: BlueprintEnumKey = 'menuType';
const menu: BlueprintEnumValue<'menuType'> = 'offcanvas';
const dark: BlueprintEnumValue<'darkMode'> = 'toggle-btn';
const page: BlueprintEnumValue<'pageType'> = 'portal-noticias';
const voice: BlueprintEnumValue<'designVoice'> = 'editorial-clean';
const font: BlueprintEnumValue<'typography'> = 'space-grotesk';
const runtimeColor: BlueprintEnumValue<'colorPreset'> = 'tech-blue';
const colors: readonly string[] = ENUMS.colorPreset;
const menus: readonly BlueprintEnumValue<'menuType'>[] = ENUMS.menuType;
void key; void menu; void dark; void page; void voice; void font; void runtimeColor;
void colors; void menus;

// @ts-expect-error mega-menu não é uma opção suportada pelo runtime.
const invalidMenu: BlueprintEnumValue<'menuType'> = 'mega-menu';
// @ts-expect-error modo escuro inválido.
const invalidDark: BlueprintEnumValue<'darkMode'> = 'enabled';
// @ts-expect-error tipos de página são literais, não nomes inventados.
const invalidPage: BlueprintEnumValue<'pageType'> = 'commerce';
// @ts-expect-error nichoTema não pertence a este catálogo de enums.
const invalidKey: BlueprintEnumKey = 'nichoTema';
// @ts-expect-error listas de enums são contratos readonly em TypeScript.
ENUMS.menuType.push('mega-menu');
// @ts-expect-error uma cor não é um array de opções de menu.
const invalidMenus: typeof ENUMS.menuType = ENUMS.colorPreset;
void invalidMenu; void invalidDark; void invalidPage; void invalidKey; void invalidMenus;

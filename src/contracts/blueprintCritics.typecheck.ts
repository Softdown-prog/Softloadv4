import {
    criticarBlueprint, NICHO_TEMAS_VALIDOS, COLOR_PRESETS_VALIDOS,
    MODULE_OVERRIDES_PERMITIDOS, NICHO_PAGE_TYPE_MAP, PAGE_TYPES_VALIDOS,
    PAGE_TYPES_SEM_SIDEBAR, NICHO_COLOR_INCOMPATIVEIS, NICHOS_HERO_DE_POSTS_REAIS,
} from '../core/blueprintCritics';
import type { BlueprintCriticsInput, BlueprintCriticsOutput, BlueprintCriticsResult } from '../core/blueprintCritics';

const input: BlueprintCriticsInput = {
    siteName: 'Meu Portal', nichoTema: 'gamer-playerone', colorPreset: 'warm-amber',
    darkMode: 'disabled', moduleOverrides: {contactForm: true},
};
const result: BlueprintCriticsResult = criticarBlueprint(input);
const output: BlueprintCriticsOutput = result.blueprint;
const errors: string[] = result.erros;
const corrections: string[] = result.correcoes;
const criticisms: string[] = result.criticas;
const niches: ReadonlySet<string> = NICHO_TEMAS_VALIDOS;
const colors: ReadonlySet<string> = COLOR_PRESETS_VALIDOS;
const allowedModules: ReadonlySet<string> = MODULE_OVERRIDES_PERMITIDOS;
const pageType: string = NICHO_PAGE_TYPE_MAP['gamer-playerone'];
const validPageTypes: ReadonlySet<string> = PAGE_TYPES_VALIDOS;
const noSidebar: ReadonlySet<string> = PAGE_TYPES_SEM_SIDEBAR;
const rules: Readonly<Record<string, {proibidos: string[]; fallback: string}>> = NICHO_COLOR_INCOMPATIVEIS;
const nativeHeroes: ReadonlySet<string> = NICHOS_HERO_DE_POSTS_REAIS;
void output; void errors; void corrections; void criticisms; void niches; void colors;
void allowedModules; void pageType; void validPageTypes; void noSidebar; void rules; void nativeHeroes;
// @ts-expect-error validações exigem objeto.
criticarBlueprint('site');
// @ts-expect-error errors é array de strings.
const invalid: number[] = result.erros;
void invalid;
// @ts-expect-error colorRule fallback precisa ser string.
const invalidRule: {fallback: number} = NICHO_COLOR_INCOMPATIVEIS['gamer-playerone'];
void invalidRule;

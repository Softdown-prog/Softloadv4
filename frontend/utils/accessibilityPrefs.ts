// Preferências de acessibilidade do dashboard (tamanho de fonte e
// tipografia) -- mesmo padrão de persistência local usado por
// CookieConsent.jsx (localStorage, sem backend). Aplicadas via atributos
// em <html>, lidos pelo CSS escopado a `.sl-dash-wrapper` em
// public/css/softload.css -- não afeta as páginas públicas.

export type FontScale = '100' | '115' | '130';
export type FontFamily = 'padrao' | 'legivel';

const STORAGE_KEY_FONT_SCALE = 'sl-a11y-font-scale';
const STORAGE_KEY_FONT_FAMILY = 'sl-a11y-font-family';

export const FONT_SCALE_OPTIONS: ReadonlyArray<{value: FontScale;label: string}> = [
    { value: '100', label: 'Padrão' },
    { value: '115', label: 'Grande (+15%)' },
    { value: '130', label: 'Extra grande (+30%)' },
];

export const FONT_FAMILY_OPTIONS: ReadonlyArray<{value: FontFamily;label: string}> = [
    { value: 'padrao', label: 'Padrão do sistema' },
    { value: 'legivel', label: 'Alta legibilidade (Atkinson Hyperlegible)' },
];

const DEFAULT_FONT_SCALE = FONT_SCALE_OPTIONS[0].value;
const DEFAULT_FONT_FAMILY = FONT_FAMILY_OPTIONS[0].value;

function readValidated(key: string, validValues: readonly string[], fallback: string): string {
    const stored = localStorage.getItem(key);
    return stored !== null && validValues.includes(stored) ? stored : fallback;
}

export function getFontScale(): FontScale {
    return readValidated(STORAGE_KEY_FONT_SCALE, FONT_SCALE_OPTIONS.map((o) => o.value), DEFAULT_FONT_SCALE) as FontScale;
}

export function getFontFamily(): FontFamily {
    return readValidated(STORAGE_KEY_FONT_FAMILY, FONT_FAMILY_OPTIONS.map((o) => o.value), DEFAULT_FONT_FAMILY) as FontFamily;
}

// Aplica os valores atuais (localStorage) em <html> -- chamada tanto na
// inicialização do app (main.jsx, antes do primeiro render, pra evitar
// flash) quanto depois de cada mudança feita na aba Acessibilidade.
export function applyAccessibilityPrefs(): void {
    const html = document.documentElement;
    html.setAttribute('data-font-scale', getFontScale());
    html.setAttribute('data-font-family', getFontFamily());
}

export function setFontScale(value: string): void {
    if (!FONT_SCALE_OPTIONS.some((o) => o.value === value)) return;
    localStorage.setItem(STORAGE_KEY_FONT_SCALE, value);
    applyAccessibilityPrefs();
}

export function setFontFamily(value: string): void {
    if (!FONT_FAMILY_OPTIONS.some((o) => o.value === value)) return;
    localStorage.setItem(STORAGE_KEY_FONT_FAMILY, value);
    applyAccessibilityPrefs();
}

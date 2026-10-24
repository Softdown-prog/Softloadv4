// Preferências de acessibilidade do dashboard (tamanho de fonte e
// tipografia) -- mesmo padrão de persistência local usado por
// CookieConsent.jsx (localStorage, sem backend). Aplicadas via atributos
// em <html>, lidos pelo CSS escopado a `.sl-dash-wrapper` em
// public/css/softload.css -- não afeta as páginas públicas.

const STORAGE_KEY_FONT_SCALE = 'sl-a11y-font-scale';
const STORAGE_KEY_FONT_FAMILY = 'sl-a11y-font-family';

export const FONT_SCALE_OPTIONS = [
    { value: '100', label: 'Padrão' },
    { value: '115', label: 'Grande (+15%)' },
    { value: '130', label: 'Extra grande (+30%)' },
];

export const FONT_FAMILY_OPTIONS = [
    { value: 'padrao', label: 'Padrão do sistema' },
    { value: 'legivel', label: 'Alta legibilidade (Atkinson Hyperlegible)' },
];

const DEFAULT_FONT_SCALE = FONT_SCALE_OPTIONS[0].value;
const DEFAULT_FONT_FAMILY = FONT_FAMILY_OPTIONS[0].value;

function readValidated(key, validValues, fallback) {
    const stored = localStorage.getItem(key);
    return validValues.includes(stored) ? stored : fallback;
}

export function getFontScale() {
    return readValidated(STORAGE_KEY_FONT_SCALE, FONT_SCALE_OPTIONS.map((o) => o.value), DEFAULT_FONT_SCALE);
}

export function getFontFamily() {
    return readValidated(STORAGE_KEY_FONT_FAMILY, FONT_FAMILY_OPTIONS.map((o) => o.value), DEFAULT_FONT_FAMILY);
}

// Aplica os valores atuais (localStorage) em <html> -- chamada tanto na
// inicialização do app (main.jsx, antes do primeiro render, pra evitar
// flash) quanto depois de cada mudança feita na aba Acessibilidade.
export function applyAccessibilityPrefs() {
    const html = document.documentElement;
    html.setAttribute('data-font-scale', getFontScale());
    html.setAttribute('data-font-family', getFontFamily());
}

export function setFontScale(value) {
    if (!FONT_SCALE_OPTIONS.some((o) => o.value === value)) return;
    localStorage.setItem(STORAGE_KEY_FONT_SCALE, value);
    applyAccessibilityPrefs();
}

export function setFontFamily(value) {
    if (!FONT_FAMILY_OPTIONS.some((o) => o.value === value)) return;
    localStorage.setItem(STORAGE_KEY_FONT_FAMILY, value);
    applyAccessibilityPrefs();
}

/** Edição parcial, validada no servidor antes do merge do manifesto. */
export type EditChangeFields = Record<string, unknown>;
export interface EditSchemaValidation {
    valido: boolean;
    erros: string[];
    camposAlterados: EditChangeFields;
    resumoMudancas: string;
}
export type EditSchemaEnumKey = keyof typeof EDIT_ENUMS;
export type EditSchemaEnumValue<K extends EditSchemaEnumKey> = (typeof EDIT_ENUMS)[K][number];
declare function require(path: string): unknown;
declare const module: { exports: unknown };

// ============================================================
// TEMPLATE EDIT SCHEMA — schema de edição de campos do `manifesto`
// ============================================================
// Diferente de blueprintSchema.js (usado na GERAÇÃO de um template novo,
// shape pageType-based), este schema serve para EDITAR um template já
// compilado: todos os campos são opcionais (a IA só devolve o que muda) e
// o shape espelha `manifesto` (ver _blueprintParaManifesto em chat.js),
// não o blueprint pageType-based.
//
// A IA nunca decide a estrutura do XML — só decide valores de campos já
// validados pelo pipeline de compilação existente (compilerWorker.js).
// ============================================================

const { Type } = require('@google/genai') as {
    Type: Record<'OBJECT' | 'STRING' | 'BOOLEAN' | 'ARRAY', string>;
};
const { ENUMS: BLUEPRINT_ENUMS } = require('./blueprintSchema') as typeof import('./blueprintSchema');
const { BUTTON_STYLES } = require('../core/presets') as {
    BUTTON_STYLES: Record<string, unknown>;
};

// Espelham MENU_VALIDOS / COMMENTS_VALIDOS de compilerWorker.js (que só tem
// 'nativo'/'disqus' — qualquer outro valor já vira '' na normalização do
// manifesto). O Gemini rejeita string vazia como valor de enum em tool
// declarations ("enum[0]: cannot be empty" — 400 Bad Request, trava TODO
// o agente de edição), então 'desativado' é o valor exposto à IA pra pedir
// "sem sistema de comentários"; validarEdicao mapeia de volta pra '' antes
// de aplicar no manifesto.
const MOBILE_MENU_VALUES = ['classico', 'offcanvas'] as const;
const COMMENTS_VALUES    = ['desativado', 'nativo', 'disqus'] as const;

const EDIT_ENUMS = {
    colorPreset:     BLUEPRINT_ENUMS.colorPreset,
    typography:      BLUEPRINT_ENUMS.typography,
    gridLayout:      BLUEPRINT_ENUMS.gridLayout,
    sidebarPosition: BLUEPRINT_ENUMS.sidebarPosition,
    footerStyle:     BLUEPRINT_ENUMS.footerStyle,
    designVoice:     BLUEPRINT_ENUMS.designVoice,
    buttonStyle:     Object.keys(BUTTON_STYLES),
    mobileMenuType:  MOBILE_MENU_VALUES,
    commentsSystem:  COMMENTS_VALUES,
} as const;

const MODULES_BOOLEAN_FIELDS = [
    'darkMode', 'backToTop', 'shareButtons', 'readingTime',
    'readingProgress', 'toc', 'error404', 'cookieBanner',
    'slotBefore', 'slotAfter',
] as const;

// ──────────────────────────────────────────────────────────────────────────
// GEMINI_EDIT_RESPONSE_SCHEMA
// Único campo obrigatório: resumoMudancas (string vazia = "não mapeia pra
// nenhum campo conhecido"). Todo o resto é opcional — a IA só inclui o que
// deve mudar; campos ausentes ficam intocados no merge.
// ──────────────────────────────────────────────────────────────────────────
const GEMINI_EDIT_RESPONSE_SCHEMA = {
    type: Type.OBJECT,
    required: ['resumoMudancas'],
    properties: {
        resumoMudancas: {
            type:        Type.STRING,
            description: 'Frase curta em PT-BR, tom de confirmação amigável, resumindo exatamente o que vai mudar. Se o pedido do usuário NÃO corresponder a nenhum campo deste schema, retorne string vazia "".',
        },

        siteName:       { type: Type.STRING, description: 'Novo nome do blog/site.' },
        colorPreset:     { type: Type.STRING, enum: EDIT_ENUMS.colorPreset },
        buttonStyle:     { type: Type.STRING, enum: EDIT_ENUMS.buttonStyle },
        typography:      { type: Type.STRING, enum: EDIT_ENUMS.typography },
        gridLayout:      { type: Type.STRING, enum: EDIT_ENUMS.gridLayout },
        footerStyle:     { type: Type.STRING, enum: EDIT_ENUMS.footerStyle },
        designVoice:     { type: Type.STRING, enum: EDIT_ENUMS.designVoice },
        sidebarPosition: { type: Type.STRING, enum: EDIT_ENUMS.sidebarPosition },

        heroTitle:      { type: Type.STRING, nullable: true, description: 'Título do hero. null = remove/usa fallback.' },
        heroSubtitle:   { type: Type.STRING, nullable: true, description: 'Subtítulo do hero. null = remove/usa fallback.' },

        enableSeo: { type: Type.BOOLEAN },
        lazyLoad:  { type: Type.BOOLEAN },

        customCss:      { type: Type.STRING, description: 'CSS customizado completo (substitui o anterior).' },
        heroHtml:        { type: Type.STRING, description: 'HTML customizado do hero (substitui o anterior).' },
        staticSections: { type: Type.STRING, description: 'HTML de seções estáticas customizadas (substitui o anterior).' },
        svgLogo:        { type: Type.STRING, description: 'Logo em SVG inline (substitui o anterior).' },
        darkTheme:      { type: Type.BOOLEAN },

        categoryBadges: {
            type:  Type.ARRAY,
            items: {
                type:       Type.OBJECT,
                properties: {
                    nome: { type: Type.STRING },
                    bg:   { type: Type.STRING },
                    text: { type: Type.STRING },
                },
            },
            description: 'Se presente, SUBSTITUI o array inteiro de badges (não é merge item a item) — inclua também os badges que não mudaram, junto dos alterados.',
        },

        modules: {
            type:       Type.OBJECT,
            description: 'Só inclua as chaves que devem mudar.',
            properties: {
                darkMode:        { type: Type.BOOLEAN },
                backToTop:       { type: Type.BOOLEAN },
                shareButtons:    { type: Type.BOOLEAN },
                readingTime:     { type: Type.BOOLEAN },
                readingProgress: { type: Type.BOOLEAN },
                toc:             { type: Type.BOOLEAN },
                error404:        { type: Type.BOOLEAN },
                cookieBanner:    { type: Type.BOOLEAN },
                slotBefore:      { type: Type.BOOLEAN },
                slotAfter:       { type: Type.BOOLEAN },
                mobileMenuType:  { type: Type.STRING, enum: EDIT_ENUMS.mobileMenuType },
                commentsSystem:  { type: Type.STRING, enum: EDIT_ENUMS.commentsSystem },
            },
        },
    },
};

// ──────────────────────────────────────────────────────────────────────────
// validarEdicao — segunda linha de defesa server-side.
// Nada é obrigatório aqui (é uma edição parcial, não um blueprint
// completo), e um campo inválido é DESCARTADO com aviso em vez de
// invalidar a proposta inteira — a edição segue com o que sobrou de válido.
// ──────────────────────────────────────────────────────────────────────────
function validarEdicao(obj: unknown): EditSchemaValidation {
    const erros: string[] = [];

    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        return { valido: false, erros: ['Resposta de edição não é um objeto JSON.'], camposAlterados: {}, resumoMudancas: '' };
    }

    const input = obj as Record<string, unknown>;
    const resumoMudancas = typeof input.resumoMudancas === 'string' ? input.resumoMudancas.trim() : '';
    const camposAlterados: EditChangeFields = {};

    // Campos enum escalares
    for (const [campo, valores] of Object.entries(EDIT_ENUMS)) {
        if (campo === 'mobileMenuType' || campo === 'commentsSystem') continue; // tratados dentro de modules
        if (input[campo] !== undefined) {
            if ((valores as readonly string[]).includes(input[campo] as string)) camposAlterados[campo] = input[campo];
            else erros.push(`"${campo}": valor "${input[campo]}" inválido, ignorado.`);
        }
    }

    // Strings livres (aceitam null quando nullable)
    for (const campo of ['heroTitle', 'heroSubtitle']) {
        if (input[campo] !== undefined) {
            if (input[campo] === null || typeof input[campo] === 'string') camposAlterados[campo] = input[campo];
            else erros.push(`"${campo}": deve ser string ou null, ignorado.`);
        }
    }
    for (const campo of ['siteName', 'customCss', 'heroHtml', 'staticSections', 'svgLogo']) {
        if (input[campo] !== undefined) {
            if (typeof input[campo] === 'string' && input[campo].trim()) camposAlterados[campo] = input[campo];
            else erros.push(`"${campo}": deve ser string não-vazia, ignorado.`);
        }
    }

    // Booleans
    for (const campo of ['enableSeo', 'lazyLoad', 'darkTheme']) {
        if (input[campo] !== undefined) {
            if (typeof input[campo] === 'boolean') camposAlterados[campo] = input[campo];
            else erros.push(`"${campo}": deve ser boolean, ignorado.`);
        }
    }

    // categoryBadges — substituição total do array
    if (input.categoryBadges !== undefined) {
        if (Array.isArray(input.categoryBadges)) {
            camposAlterados.categoryBadges = input.categoryBadges
                .filter((b: unknown) => b && typeof b === 'object' && typeof (b as Record<string, unknown>).nome === 'string')
                .slice(0, 8);
        } else {
            erros.push('"categoryBadges": deve ser um array, ignorado.');
        }
    }

    // modules — merge profundo fica a cargo do caller (mergeManifesto); aqui só valida
    if (input.modules !== undefined) {
        if (input.modules && typeof input.modules === 'object' && !Array.isArray(input.modules)) {
            const mod: EditChangeFields = {};
            const moduleInput = input.modules as Record<string, unknown>;
            for (const campo of MODULES_BOOLEAN_FIELDS) {
                if (moduleInput[campo] !== undefined) {
                    if (typeof moduleInput[campo] === 'boolean') mod[campo] = moduleInput[campo];
                    else erros.push(`"modules.${campo}": deve ser boolean, ignorado.`);
                }
            }
            if (moduleInput.mobileMenuType !== undefined) {
                if (MOBILE_MENU_VALUES.includes(moduleInput.mobileMenuType as typeof MOBILE_MENU_VALUES[number])) mod.mobileMenuType = moduleInput.mobileMenuType;
                else erros.push(`"modules.mobileMenuType": valor inválido, ignorado.`);
            }
            if (moduleInput.commentsSystem !== undefined) {
                if (COMMENTS_VALUES.includes(moduleInput.commentsSystem as typeof COMMENTS_VALUES[number])) {
                    mod.commentsSystem = moduleInput.commentsSystem === 'desativado' ? '' : moduleInput.commentsSystem;
                } else {
                    erros.push(`"modules.commentsSystem": valor inválido, ignorado.`);
                }
            }
            if (Object.keys(mod).length > 0) camposAlterados.modules = mod;
        } else {
            erros.push('"modules": deve ser um objeto, ignorado.');
        }
    }

    return { valido: erros.length === 0, erros, camposAlterados, resumoMudancas };
}

module.exports = {
    GEMINI_EDIT_RESPONSE_SCHEMA,
    EDIT_ENUMS,
    validarEdicao,
};
export { GEMINI_EDIT_RESPONSE_SCHEMA, EDIT_ENUMS, validarEdicao };

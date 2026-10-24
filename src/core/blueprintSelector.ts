/** Contrato do seletor; o blueprint é validado pelos critics antes do refinamento. */
export type SelectorBlueprint = Record<string, unknown>;
export interface SelectorReport {
    criticas: string[];
    erros: string[];
    correcoes: string[];
    refined: boolean;
    refinamentosAplicados?: number;
}
export interface SelectorResult {
    blueprint: SelectorBlueprint;
    report: SelectorReport;
}
declare function require(path: string): unknown;
declare const module: { exports: unknown };
declare const console: { log(...args: unknown[]): void; warn(...args: unknown[]): void };


// ──────────────────────────────────────────────────────────────────────────
// Blueprint Selector — Stage 2 do pipeline multi-stage
//
// Recebe o blueprint bruto gerado pelo marcador [[TEMPLATE:{...}]] do chat
// e o refina em dois passos:
//
//   Passo A — Critics (síncrono, sem custo de API):
//     blueprintCritics.criticarBlueprint() valida e auto-corrige regras
//     estruturais (darkMode, menuType, colorPreset, badges, segurança CSS/HTML).
//
//   Passo B — Refinador Gemini (assíncrono, opcional):
//     Só chamado quando critics encontra criticas (sub-ótimos que não foram
//     auto-corrigidos) OU quando o nichoTema não está no catálogo.
//     Usa um prompt focado e barato (max 250 tokens) para sugerir melhorias
//     de coerência nicho × colorPreset × gridLayout × darkMode × menuType.
//     Falha silenciosa — se o Gemini não responder, usa o resultado dos critics.
//
// Retorna: { blueprint: refinedBlueprint, report: { criticas, erros, correcoes, refined } }
// ──────────────────────────────────────────────────────────────────────────

const { gerarJson } = require('../services/geminiService') as {
    gerarJson(prompt: string, systemPrompt: string, options: { maxOutputTokens: number }): Promise<unknown>;
};
const { criticarBlueprint, NICHO_TEMAS_VALIDOS } = require('./blueprintCritics') as typeof import('./blueprintCritics');
const { ENUMS } = require('../ai/blueprintSchema') as typeof import('../ai/blueprintSchema');

// Campos que o refinador Gemini pode alterar (whitelist de segurança)
const CAMPOS_REFINAVEIS = new Set([
    'nichoTema', 'colorPreset', 'typography', 'gridLayout',
    'sidebarPosition', 'footerStyle', 'darkMode', 'menuType',
    'postModules', 'coreFeatures',
]);

// Catálogo compacto de temas para injetar no prompt do refinador
const CATALOGO_TEMAS = [
    { id: 'viral-magazine',           nicho: 'notícias, social, pessoal, magazine',           estetica: 'editorial, jornalístico, magazine grid' },
    { id: 'tecnologia-mag-tech',      nicho: 'tecnologia, hardware, gadgets, reviews',         estetica: 'magazine tech, profissional, azul corporativo' },
    { id: 'tecnologia-techwind',      nicho: 'tecnologia, dev, tutoriais, programação',        estetica: 'verde matrix, minimal, terminal' },
    { id: 'noticias-mag-news',        nicho: 'notícias, editorial, jornalismo',                estetica: 'editorial premium, limpo, legível' },
    { id: 'elearning-academy',        nicho: 'educação, cursos, e-learning, LMS',              estetica: 'profissional, clean, azul/verde' },
    { id: 'culinaria-boutique-gourmet', nicho: 'culinária, gastronomia, receitas, restaurante', estetica: 'luxo, feminino, roxo/rosa, premium' },
    { id: 'saas-nexus',               nicho: 'SaaS, produto, startup, landing page',           estetica: 'dark moderno, neon, conversão' },
    { id: 'biolink-social',           nicho: 'link na bio, social, perfil pessoal, influencer', estetica: 'glassmorphism, gradiente, single-page' },
    { id: 'portfolio-minimalista',    nicho: 'portfolio, dev, designer, freelancer',            estetica: 'minimalista, preto/branco/ciano' },
    { id: 'pop-retro-pixel',          nicho: 'gaming, retro, pixel art, cultura pop',          estetica: 'pixel art, 8-bit, NES/SNES' },
    { id: 'gamer-playerone',          nicho: 'gaming, esports, reviews de jogos',              estetica: 'cyberpunk, neon, dark intenso' },
    { id: 'brutalista-appcraft',      nicho: 'app, produto digital, brutalismo',               estetica: 'brutalista, borders grossas, sem sombras' },
    { id: 'appstore-bulma-mobile',    nicho: 'apps móveis, loja de apps, mobile first',        estetica: 'cards de app store, screenshots, ratings' },
    { id: 'natureza-bulma-vegan',     nicho: 'natureza, sustentabilidade, vegan, eco',         estetica: 'verde natural, orgânico, respira' },
].map(t => `- ${t.id}: ${t.nicho} | ${t.estetica}`).join('\n');

const SISTEMA_REFINADOR = `Você é um crítico de blueprints de templates Blogger.
Analise o blueprint e retorne APENAS JSON válido com os campos que precisam de ajuste.
Se o blueprint está ótimo, retorne {}. Sem texto, sem markdown, só JSON.`;

async function _chamarRefinadorGemini(blueprint: SelectorBlueprint, criticas: string[]): Promise<unknown> {
    const prompt = `Blueprint atual:
siteName: "${blueprint.siteName}"
nichoTema: "${blueprint.nichoTema || '(não definido)'}"
colorPreset: "${blueprint.colorPreset || '?'}"
typography: "${blueprint.typography || '?'}"
gridLayout: "${blueprint.gridLayout || '?'}"
darkMode: "${blueprint.darkMode || '?'}"
menuType: "${blueprint.menuType || '?'}"

Problemas detectados pelas regras: ${criticas.join(' | ')}

Temas disponíveis:
${CATALOGO_TEMAS}

colorPresets válidos: ${ENUMS.colorPreset.join(' | ')}
gridLayouts válidos: lista | dupla | revista | quadrado | mural
darkModes válidos: disabled | toggle-btn | auto-system
menuTypes válidos: ${ENUMS.menuType.join(' | ')}

Retorne JSON com apenas os campos que devem mudar (campos válidos: nichoTema, colorPreset, typography, gridLayout, sidebarPosition, footerStyle, darkMode, menuType, postModules, coreFeatures). Se tudo está coerente, retorne {}.`;

    const result = await gerarJson(prompt, SISTEMA_REFINADOR, { maxOutputTokens: 250 });
    return result;
}

/**
 * Refina o blueprint em dois passos: critics (regras) + Gemini (coerência).
 *
 * @param {object} blueprint — blueprint bruto do marcador [[TEMPLATE:{...}]]
 * @returns {Promise<{ blueprint: object, report: object }>}
 */
async function refinarBlueprint(blueprint: SelectorBlueprint): Promise<SelectorResult> {
    // Passo A — Critics síncronos
    const { blueprint: critiqueBlueprint, criticas, erros, correcoes } = criticarBlueprint(blueprint);

    const report: SelectorReport = { criticas, erros, correcoes, refined: false };

    // Erros fatais detectados pelos critics — não tenta refinamento
    if (erros.length > 0) {
        return { blueprint: critiqueBlueprint, report };
    }

    // Passo B — Refinador Gemini (apenas se há sub-ótimos ou nicho inválido)
    const nichoInvalido = blueprint.nichoTema && !NICHO_TEMAS_VALIDOS.has(blueprint.nichoTema as string);
    if (criticas.length > 0 || nichoInvalido) {
        try {
            const refinamentos = await _chamarRefinadorGemini(critiqueBlueprint, criticas);

            if (refinamentos && typeof refinamentos === 'object') {
                let camposAlterados = 0;
                for (const [key, value] of Object.entries(refinamentos)) {
                    if (!CAMPOS_REFINAVEIS.has(key)) continue;
                    // Arrays: merge sem duplicatas
                    if (Array.isArray(value) && Array.isArray(critiqueBlueprint[key])) {
                        const merged = [...new Set([...(critiqueBlueprint[key] as unknown[]), ...value])];
                        critiqueBlueprint[key] = merged;
                    } else if (value !== null && value !== undefined && value !== '') {
                        critiqueBlueprint[key] = value;
                    }
                    camposAlterados++;
                }
                if (camposAlterados > 0) {
                    report.refined = true;
                    report.refinamentosAplicados = camposAlterados;
                    console.log(`[BLUEPRINT-SELECTOR] Refinador aplicou ${camposAlterados} campo(s) ao blueprint de "${blueprint.siteName}"`);
                }
            }
        } catch (err) {
            // Falha silenciosa — usa resultado dos critics
            console.warn('[BLUEPRINT-SELECTOR] Refinador Gemini falhou, usando resultado dos critics:', (err as Error).message);
        }
    }

    return { blueprint: critiqueBlueprint, report };
}

module.exports = { refinarBlueprint };
export { refinarBlueprint };

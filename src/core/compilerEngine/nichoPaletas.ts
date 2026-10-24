declare function require(name: string): typeof import('../blockLibrary');
const { hashSeed } = require('../blockLibrary');

export interface PaletaNicho { primary: string; secondary: string }

// ============================================================
// PALETAS DE COR ALTERNATIVAS POR NICHO
// ============================================================
// Achado real (pop-retro-pixel): var(--primary)/var(--secondary)/
// var(--border-pixel)/var(--font-pixel) apareciam 7+0+5+4 vezes no CSS
// extraído do impl.json, mas nenhuma dessas variáveis era declarada em
// lugar nenhum do compilado — var() sem fallback resolve pra vazio, ou
// seja, cor e borda simplesmente não apareciam no site publicado. O
// impl.json já documentava 4 paletas alternativas prontas
// (paleta_de_cores_documentada.combinacoes_alternativas), nunca conectadas
// a CSS de verdade — só existiam como texto de referência pro chat.
//
// Escolha de paleta é determinística por seed (mesmo princípio de
// pickBlock/escolherIconeAutor) — nunca Math.random(): o mesmo site sempre
// recebe a mesma paleta entre recompilações, sites diferentes tendem a
// variar.
// ============================================================

const PALETAS: Record<string, PaletaNicho[]> = {
    // Fonte: tema-pop-retro-pixel-impl.json →
    // paleta_de_cores_documentada.{default_primary,default_secondary,
    // combinacoes_alternativas.*}
    'pop-retro-pixel': [
        { primary: '#FF4500', secondary: '#00FF41' }, // default
        { primary: '#7B2FBE', secondary: '#FF006E' }, // gaming_roxo
        { primary: '#FFE600', secondary: '#00FFFF' }, // cyberpunk
        { primary: '#E3000B', secondary: '#0078D7' }, // retro_nintendo
        { primary: '#00FF41', secondary: '#FF4500' }, // terminal_verde
    ],
};

// Tokens fixos (não fazem parte da variação de paleta) — fonte:
// tema-pop-retro-pixel-meta.json → tokens_css.variaveis_raw.
const TOKENS_FIXOS: Record<string, Record<string, string>> = {
    'pop-retro-pixel': {
        '--bg-light':     '#F4F4F4',
        '--border-pixel': '4px solid #000000',
        '--font-pixel':   "'Press Start 2P', cursive",
    },
};

/**
 * Gera o bloco `:root { --primary: ...; ... }` do nicho, com a paleta de
 * cor escolhida deterministicamente por seed. Retorna '' se o nicho não
 * tem paletas documentadas — nunca inventa cor pra nicho que não pediu
 * isso.
 */
function gerarPaletaCss(nichoTema: unknown, seed: unknown): string {
    const paletas = PALETAS[nichoTema as string];
    if (!paletas || paletas.length === 0) return '';

    const idx = hashSeed(`${seed || ''}:paleta`) % paletas.length;
    const { primary, secondary } = paletas[idx];
    const fixos = TOKENS_FIXOS[nichoTema as string] || {};

    const linhas = [`  --primary: ${primary};`, `  --secondary: ${secondary};`];
    for (const [nome, valor] of Object.entries(fixos)) linhas.push(`  ${nome}: ${valor};`);

    return `:root {\n${linhas.join('\n')}\n}`;
}

export { gerarPaletaCss, PALETAS };

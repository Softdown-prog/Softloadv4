"use strict";
/** Presets visuais e pistas de voz de design usadas pelo compilador. */
// ──────────────────────────────────────────────────────────────────────────
// Design Voice Presets — 8 arquétipos de design que sobrepõem micro-decisões
// visuais: raio de borda, sombra, borda, hover, peso tipográfico, espaçamento.
//
// Cada voice gera um bloco CSS compacto injetado no fullCss após o buttonCss,
// criando "100 templates que parecem ter sido feitos por 100 designers distintos".
// ──────────────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.COLOR_DESIGN_VOICE_HINT = exports.NICHO_DESIGN_VOICE_MAP = exports.DESIGN_VOICE_PRESETS = void 0;
exports.gerarDesignVoiceCss = gerarDesignVoiceCss;
exports.DESIGN_VOICE_PRESETS = {
    // Paper editorial: NYT / The Atlantic — precisão tipográfica, espaço negativo
    'editorial-clean': `
    /* === VOICE: editorial-clean === */
    .news-card,.card,.sl-card{border-radius:2px!important;box-shadow:0 1px 4px rgba(0,0,0,.06)!important;border:1px solid rgba(0,0,0,.08)!important;}
    .news-card:hover,.card:hover,.sl-card:hover{box-shadow:0 4px 14px rgba(0,0,0,.1)!important;}
    h2,h3,h4{letter-spacing:-.025em;}
    .btn,.btn-primary,.sl-btn{border-radius:2px!important;}`.trim(),
    // Brutalista arrojado: VICE / Hypebeast — peso extremo, offset de sombra, sem suavidade
    'bold-impact': `
    /* === VOICE: bold-impact === */
    .news-card,.card,.sl-card{border-radius:0!important;border:2px solid var(--sl-text-main,#111)!important;box-shadow:4px 4px 0 var(--sl-text-main,#111)!important;}
    .news-card:hover,.card:hover,.sl-card:hover{transform:translate(-2px,-2px);box-shadow:6px 6px 0 var(--sl-text-main,#111)!important;}
    h2,h3,.card-title,.news-card-title{font-weight:900!important;letter-spacing:-.03em;}
    .btn,.btn-primary,.sl-btn{border-radius:0!important;border:2px solid var(--sl-text-main,#111)!important;box-shadow:3px 3px 0 var(--sl-text-main,#111)!important;}`.trim(),
    // Essencialismo utilitário: Linear / Vercel — zero ornamento, clareza máxima
    'minimal-mono': `
    /* === VOICE: minimal-mono === */
    .news-card,.card,.sl-card{border-radius:0!important;box-shadow:none!important;border:1px solid rgba(0,0,0,.1)!important;}
    .news-card:hover,.card:hover,.sl-card:hover{border-color:var(--sl-primary)!important;box-shadow:none!important;}
    .card-title,.news-card-title{letter-spacing:.05em;font-weight:500!important;}
    .btn,.btn-primary,.sl-btn{border-radius:0!important;letter-spacing:.06em!important;}`.trim(),
    // Névoa e profundidade: Spotify / Letterboxd — superfícies escuras, sombras profundas
    'dark-atmospheric': `
    /* === VOICE: dark-atmospheric === */
    .news-card,.card,.sl-card{border-radius:8px!important;box-shadow:0 4px 24px rgba(0,0,0,.45)!important;border:1px solid rgba(255,255,255,.06)!important;}
    .news-card:hover,.card:hover,.sl-card:hover{box-shadow:0 8px 40px rgba(0,0,0,.65)!important;transform:translateY(-2px);}
    h2,h3{letter-spacing:-.01em;font-weight:700!important;}
    .btn,.btn-primary,.sl-btn{border-radius:8px!important;}`.trim(),
    // Calor e respiro: Substack / Ghost — arredondado, acolhedor, orgânico
    'warm-organic': `
    /* === VOICE: warm-organic === */
    .news-card,.card,.sl-card{border-radius:12px!important;box-shadow:0 2px 12px rgba(0,0,0,.08)!important;border:none!important;}
    .news-card:hover,.card:hover,.sl-card:hover{box-shadow:0 8px 28px rgba(0,0,0,.13)!important;transform:translateY(-3px);}
    h2,h3{letter-spacing:-.01em;font-weight:700!important;}
    .btn,.btn-primary,.sl-btn{border-radius:999px!important;}`.trim(),
    // Precisão sistêmica: Stripe / GitHub — funcional, 4px grid, sem ornamento
    'tech-sharp': `
    /* === VOICE: tech-sharp === */
    .news-card,.card,.sl-card{border-radius:4px!important;box-shadow:0 1px 2px rgba(0,0,0,.08),0 2px 6px rgba(0,0,0,.04)!important;border:1px solid rgba(0,0,0,.09)!important;}
    .news-card:hover,.card:hover,.sl-card:hover{box-shadow:0 4px 12px rgba(0,0,0,.1)!important;border-color:var(--sl-primary)!important;}
    h2,h3{letter-spacing:-.02em;font-weight:600!important;}
    .btn,.btn-primary,.sl-btn{border-radius:4px!important;font-weight:500!important;}`.trim(),
    // Energia celebrativa: Dribbble / Awwwards — raios máximos, sombras dramáticas
    'vibrant-pop': `
    /* === VOICE: vibrant-pop === */
    .news-card,.card,.sl-card{border-radius:16px!important;box-shadow:0 4px 20px rgba(0,0,0,.1)!important;border:none!important;}
    .news-card:hover,.card:hover,.sl-card:hover{box-shadow:0 12px 36px rgba(0,0,0,.18)!important;transform:scale(1.025) translateY(-2px);}
    h2,h3{letter-spacing:-.015em;font-weight:800!important;}
    .btn,.btn-primary,.sl-btn{border-radius:999px!important;}`.trim(),
    // Cuidado artesanal: Shopify artisan / food blogs — detalhes refinados, elegância contida
    'artisanal-craft': `
    /* === VOICE: artisanal-craft === */
    .news-card,.card,.sl-card{border-radius:6px!important;box-shadow:0 2px 8px rgba(0,0,0,.09)!important;border:1px solid rgba(0,0,0,.06)!important;}
    .news-card:hover,.card:hover,.sl-card:hover{box-shadow:0 8px 24px rgba(0,0,0,.14)!important;transform:translateY(-3px);}
    h2,h3{letter-spacing:-.01em;font-weight:700!important;}
    .btn,.btn-primary,.sl-btn{border-radius:6px!important;}`.trim(),
    // Nostalgia de sistema operacional: Windows 95/98 — bordas em relevo, sem raio nem sombra difusa
    'retro-web1': `
    /* === VOICE: retro-web1 === */
    .news-card,.card,.sl-card{border-radius:0!important;border:2px outset #c0c0c0!important;box-shadow:none!important;}
    .news-card:hover,.card:hover,.sl-card:hover{box-shadow:none!important;}
    h2,h3{letter-spacing:0;font-weight:700!important;}
    .btn,.btn-primary,.sl-btn{border-radius:0!important;border:2px outset #c0c0c0!important;box-shadow:none!important;}
    .btn:active,.btn-primary:active,.sl-btn:active{border-style:inset!important;}`.trim(),
    // Vidro fosco translúcido: iOS/visionOS — fundo semitransparente com blur, borda de brilho
    'glass-translucent': `
    /* === VOICE: glass-translucent === */
    .news-card,.card,.sl-card{border-radius:16px!important;background:rgba(255,255,255,.12)!important;backdrop-filter:blur(12px) saturate(160%)!important;-webkit-backdrop-filter:blur(12px) saturate(160%)!important;border:1px solid rgba(255,255,255,.25)!important;box-shadow:0 8px 32px rgba(0,0,0,.15)!important;}
    .news-card:hover,.card:hover,.sl-card:hover{background:rgba(255,255,255,.18)!important;box-shadow:0 12px 40px rgba(0,0,0,.2)!important;}
    h2,h3{letter-spacing:-.01em;font-weight:700!important;}
    .btn,.btn-primary,.sl-btn{border-radius:999px!important;background:rgba(255,255,255,.15)!important;backdrop-filter:blur(8px)!important;-webkit-backdrop-filter:blur(8px)!important;border:1px solid rgba(255,255,255,.3)!important;}`.trim(),
    // Soft UI esculpida: sombra dupla clara/escura simulando relevo na própria superfície
    'neumorphic-soft': `
    /* === VOICE: neumorphic-soft === */
    .news-card,.card,.sl-card{border-radius:20px!important;border:none!important;box-shadow:8px 8px 16px rgba(0,0,0,.12),-8px -8px 16px rgba(255,255,255,.7)!important;}
    .news-card:hover,.card:hover,.sl-card:hover{box-shadow:4px 4px 10px rgba(0,0,0,.14),-4px -4px 10px rgba(255,255,255,.75)!important;}
    h2,h3{letter-spacing:-.01em;font-weight:700!important;}
    .btn,.btn-primary,.sl-btn{border-radius:12px!important;border:none!important;box-shadow:5px 5px 10px rgba(0,0,0,.15),-5px -5px 10px rgba(255,255,255,.7)!important;}`.trim(),
    // Preto/branco/cinza estrito: só a cor de destaque escolhida pelo usuário aparece (links/botões)
    'monochrome-accent': `
    /* === VOICE: monochrome-accent === */
    .news-card,.card,.sl-card{border-radius:0!important;box-shadow:none!important;border:1px solid currentColor!important;}
    .news-card:hover,.card:hover,.sl-card:hover{border-color:var(--sl-primary)!important;box-shadow:none!important;}
    h2,h3{letter-spacing:0;font-weight:700!important;}
    .btn,.btn-primary,.sl-btn{border-radius:0!important;border:1px solid currentColor!important;}
    .btn-primary,.sl-btn{background:var(--sl-primary)!important;border-color:var(--sl-primary)!important;}`.trim(),
};
// Mapeamento canônico: nichoTema → designVoice preferido
// Encapsula a "opinião de design" de cada nicho.
exports.NICHO_DESIGN_VOICE_MAP = {
    'gamer-playerone': 'dark-atmospheric',
    'pop-retro-pixel': 'vibrant-pop',
    'culinaria-boutique-gourmet': 'artisanal-craft',
    'natureza-bulma-vegan': 'warm-organic',
    'tecnologia-techwind': 'tech-sharp',
    'noticias-mag-news': 'editorial-clean',
    'tecnologia-mag-tech': 'tech-sharp',
    'viral-magazine': 'bold-impact',
    'saas-nexus': 'tech-sharp',
    'brutalista-appcraft': 'bold-impact',
    'portfolio-minimalista': 'minimal-mono',
    'biolink-social': 'vibrant-pop',
    'elearning-academy': 'editorial-clean',
    'appstore-bulma-mobile': 'tech-sharp',
};
// Hint por colorPreset — usado como desempate quando nichoTema não resolve.
// Cada variação de família (ver presets.js — 4 novas por preset original)
// herda a voz do preset original: mesma identidade de cor, tom diferente,
// não motivo pra opinião de design diferente.
exports.COLOR_DESIGN_VOICE_HINT = {
    'midnight-purple': 'dark-atmospheric',
    'midnight-purple-violet': 'dark-atmospheric',
    'midnight-purple-orchid': 'dark-atmospheric',
    'midnight-purple-indigo': 'dark-atmospheric',
    'midnight-purple-amethyst': 'dark-atmospheric',
    'gamer-dark': 'dark-atmospheric',
    'gamer-dark-cyan': 'dark-atmospheric',
    'gamer-dark-magenta': 'dark-atmospheric',
    'gamer-dark-crimson': 'dark-atmospheric',
    'gamer-dark-toxic': 'dark-atmospheric',
    'carbon-dark': 'dark-atmospheric',
    'carbon-dark-indigo': 'dark-atmospheric',
    'carbon-dark-teal': 'dark-atmospheric',
    'carbon-dark-steel': 'dark-atmospheric',
    'carbon-dark-electric': 'dark-atmospheric',
    'neon-orange': 'vibrant-pop',
    'neon-orange-sunset': 'vibrant-pop',
    'neon-orange-fire': 'vibrant-pop',
    'neon-orange-coral': 'vibrant-pop',
    'neon-orange-ember': 'vibrant-pop',
    'rose-gold': 'artisanal-craft',
    'rose-gold-blush': 'artisanal-craft',
    'rose-gold-crimson': 'artisanal-craft',
    'rose-gold-fuchsia': 'artisanal-craft',
    'rose-gold-berry': 'artisanal-craft',
    'warm-amber': 'warm-organic',
    'warm-amber-honey': 'warm-organic',
    'warm-amber-copper': 'warm-organic',
    'warm-amber-mustard': 'warm-organic',
    'warm-amber-terracotta': 'warm-organic',
    'forest-green': 'warm-organic',
    'forest-green-emerald': 'warm-organic',
    'forest-green-mint': 'warm-organic',
    'forest-green-sage': 'warm-organic',
    'forest-green-jungle': 'warm-organic',
    'luxury-purple': 'editorial-clean',
    'luxury-purple-lavender': 'editorial-clean',
    'luxury-purple-plum': 'editorial-clean',
    'luxury-purple-orchid': 'editorial-clean',
    'luxury-purple-wine': 'editorial-clean',
    'tech-blue': 'tech-sharp',
    'tech-blue-royal': 'tech-sharp',
    'tech-blue-ice': 'tech-sharp',
    'tech-blue-cobalt': 'tech-sharp',
    'tech-blue-midnight': 'tech-sharp',
    'clean-white': 'minimal-mono',
    'clean-white-graphite': 'minimal-mono',
    'clean-white-ivory': 'minimal-mono',
    'clean-white-slate': 'minimal-mono',
    'clean-white-onyx': 'minimal-mono',
};
/**
 * Retorna o bloco CSS para o designVoice especificado.
 * Retorna '' para 'auto' ou voice desconhecido — sem CSS extra.
 *
 * @param {string} designVoice — valor resolvido (não 'auto')
 * @returns {string}
 */
function gerarDesignVoiceCss(designVoice) {
    if (!designVoice || !exports.DESIGN_VOICE_PRESETS[designVoice])
        return '';
    return '\n    ' + exports.DESIGN_VOICE_PRESETS[designVoice];
}

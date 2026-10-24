"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.enriquecerBlueprint = enriquecerBlueprint;
const { escaparTextoXml } = require('./compilerEngine/xmlEntities');
// ──────────────────────────────────────────────────────────────────────────
// Blueprint Enricher — Stage 1 do pipeline multi-stage
//
// Recebe o blueprint escasso gerado pelo chat (siteName, nichoTema,
// colorPreset, categoryBadges, heroTitle, heroSubtitle) e o expande com
// heroHtml + customCss — sem chamar IA.
//
// Antes: 1 chamada Gemini por template gerado (a mais frequente do pipeline)
// pedindo pra "inventar" um hero Bootstrap + CSS de marca. Na prática a IA
// só tinha 2 graus de liberdade reais: o texto do heroSubtitle (quando o
// usuário não informou um) e o styling pontual — o resto (cores via
// var(--sl-*), nome do site, categorias) já vinha determinado pelo próprio
// prompt. Isso virou uma tabela de taglines por nicho (só usada quando
// heroSubtitle não foi informado) + um template HTML/CSS fixo.
//
// Degradação: nunca falha (não há chamada de rede) — na pior hipótese
// (nichoTema desconhecido) usa a tagline genérica e segue normalmente.
// ──────────────────────────────────────────────────────────────────────────
// Tagline padrão por nicho — usada só quando o blueprint não trouxe
// heroSubtitle (ex.: geração rápida sem a rodada de descoberta do chat).
// Mesmo registro/tom que a IA produzia: curta, sem jargão, 1 frase.
const TAGLINE_POR_NICHO = {
    'gamer-playerone': 'Reviews, guias e as novidades do universo gamer, sem enrolação.',
    'pop-retro-pixel': 'Cultura pop, nostalgia e pixel art com a nossa cara.',
    'natureza-bulma-vegan': 'Ideias simples pra viver de um jeito mais consciente e natural.',
    'elearning-academy': 'Conteúdo prático pra você aprender no seu ritmo.',
    'biolink-social': 'Todos os meus links e conteúdos em um lugar só.',
    'appstore-bulma-mobile': 'Os melhores apps, testados e recomendados de verdade.',
    'brutalista-appcraft': 'Produtos e ideias sem enfeite — direto ao ponto.',
    'culinaria-boutique-gourmet': 'Receitas e histórias pra quem ama cozinhar com carinho.',
    'noticias-mag-news': 'As notícias que importam, com contexto e sem ruído.',
    'viral-magazine': 'O que está bombando na internet, explicado com leveza.',
    'saas-nexus': 'A ferramenta certa pra o seu negócio crescer mais rápido.',
    'portfolio-minimalista': 'Um portfólio simples e direto sobre o que eu faço.',
    'tecnologia-mag-tech': 'Tecnologia, reviews e tendências explicadas sem jargão.',
    'tecnologia-techwind': 'Programação, ferramentas e o que há de novo em tech.',
};
const TAGLINE_GENERICA = 'Conteúdo pensado pra quem quer informação de verdade.';
// Monta os pills de categoria a partir de categoryBadges (já vem com
// {nome,bg,text} quando emitido pelo marcador do chat — ver chatSystemPrompt.js
// e _blueprintParaManifesto). Aceita strings soltas como fallback defensivo.
function _construirCategoriasHtml(categoryBadges) {
    if (!Array.isArray(categoryBadges) || !categoryBadges.length)
        return '';
    const pills = categoryBadges.slice(0, 5).map(b => {
        const nome = (b && typeof b === 'object' && b.nome) ? b.nome : String(b);
        const bg = (b && typeof b === 'object' && b.bg) ? b.bg : 'var(--sl-primary)';
        const text = (b && typeof b === 'object' && b.text) ? b.text : '#ffffff';
        return `<span class='badge rounded-pill px-3 py-2' style='background:${bg};color:${text};font-weight:600;'>${escaparTextoXml(nome)}</span>`;
    }).join('\n        ');
    return `\n      <div class='d-flex flex-wrap justify-content-center gap-2 mt-3'>\n        ${pills}\n      </div>`;
}
/**
 * Expande um blueprint escasso com heroHtml e customCss — determinístico.
 *
 * @param {object} blueprint  — campos do marcador [[TEMPLATE:{...}]]
 * @param {Function} onStatus — callback(label) para enviar status ao frontend
 * @returns {object}          — blueprint com heroHtml/customCss preenchidos
 */
async function enriquecerBlueprint(blueprint, onStatus = () => { }) {
    onStatus('Personalizando identidade visual...');
    const { siteName, nichoTema, categoryBadges } = blueprint;
    const result = { ...blueprint };
    if (!blueprint.heroHtml) {
        const titulo = (blueprint.heroTitle && blueprint.heroTitle.trim()) || siteName;
        const subtitulo = (blueprint.heroSubtitle && blueprint.heroSubtitle.trim())
            || TAGLINE_POR_NICHO[nichoTema] || TAGLINE_GENERICA;
        const categoriasHtml = _construirCategoriasHtml(categoryBadges);
        result.heroHtml = `<section class='sl-hero-enriched py-5 py-lg-6' style='background:var(--sl-bg-body);border-bottom:1px solid rgba(0,0,0,.06);'>
      <div class='container text-center'>
        <h1 class='fw-bold mb-3' style='color:var(--sl-text-main);font-size:clamp(2rem,5vw,3.2rem);'>${escaparTextoXml(titulo)}</h1>
        <p class='lead mx-auto mb-0' style='color:var(--sl-text-main);opacity:.75;max-width:640px;'>${escaparTextoXml(subtitulo)}</p>${categoriasHtml}
      </div>
    </section>`;
    }
    if (!blueprint.customCss) {
        result.customCss = `.sl-hero-enriched .badge{transition:transform .15s ease;}.sl-hero-enriched .badge:hover{transform:translateY(-2px);}`;
    }
    return result;
}
module.exports = { enriquecerBlueprint };

'use strict';

/**
 * Testes para blueprintEnricher.js (versão determinística, sem chamada de IA)
 * Execute: node src/core/blueprintEnricher.test.js
 */

const { enriquecerBlueprint } = require('./blueprintEnricher');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

(async () => {
    // ── Sem heroTitle/heroSubtitle: usa siteName + tagline do nicho ────────
    {
        const r = await enriquecerBlueprint({
            siteName: 'Game Zone', nichoTema: 'gamer-playerone', categoryBadges: [],
        });
        assert('heroHtml contém o siteName', r.heroHtml.includes('Game Zone'));
        assert('heroHtml usa tagline do nicho gamer-playerone', r.heroHtml.includes('universo gamer'));
        assert('heroHtml começa com <section', r.heroHtml.trim().startsWith('<section'));
        assert('heroHtml não tem tags Blogger', !/[bd]:[a-z]+=|<data:|<b:/.test(r.heroHtml));
        assert('customCss termina com }', r.customCss.trim().endsWith('}'));
        assert('customCss não declara novas :root vars', !r.customCss.includes(':root'));
        assert('customCss não usa @import', !r.customCss.includes('@import'));
    }

    // ── heroTitle/heroSubtitle explícitos têm prioridade sobre os defaults ──
    {
        const r = await enriquecerBlueprint({
            siteName: 'Doces da Vó', nichoTema: 'culinaria-boutique-gourmet',
            heroTitle: 'Doces da Vó', heroSubtitle: 'Receita de família há 3 gerações',
            categoryBadges: [],
        });
        assert('heroSubtitle explícito é usado', r.heroHtml.includes('Receita de família há 3 gerações'));
        assert('tagline do nicho NÃO aparece quando heroSubtitle foi dado', !r.heroHtml.includes('Receitas e histórias'));
    }

    // ── categoryBadges viram pills com as cores exatas ──────────────────────
    {
        const r = await enriquecerBlueprint({
            siteName: 'X', nichoTema: 'gamer-playerone',
            categoryBadges: [
                { nome: 'Reviews', bg: '#f59e0b', text: '#000000' },
                { nome: 'Notícias', bg: '#06b6d4', text: '#ffffff' },
            ],
        });
        assert('badge 1 presente com cor exata', r.heroHtml.includes("background:#f59e0b;color:#000000") && r.heroHtml.includes('Reviews'));
        assert('badge 2 presente com cor exata', r.heroHtml.includes("background:#06b6d4;color:#ffffff") && r.heroHtml.includes('Notícias'));
    }

    // ── Nome de categoria com caracteres XML-sensíveis é escapado ───────────
    {
        const r = await enriquecerBlueprint({
            siteName: 'X', nichoTema: 'gamer-playerone',
            categoryBadges: [{ nome: 'Ação & Aventura <RPG>', bg: '#000', text: '#fff' }],
        });
        assert('& é escapado', r.heroHtml.includes('Ação &amp; Aventura'));
        assert('< é escapado (sem tag literal injetada)', r.heroHtml.includes('&lt;RPG&gt;') && !r.heroHtml.includes('<RPG>'));
    }

    // ── categoryBadges ausente/vazio/inválido não quebra (defensivo) ────────
    {
        const semBadges  = await enriquecerBlueprint({ siteName: 'X', nichoTema: 'gamer-playerone' });
        assert('sem categoryBadges no blueprint não lança erro', typeof semBadges.heroHtml === 'string');
        const vazio = await enriquecerBlueprint({ siteName: 'X', nichoTema: 'gamer-playerone', categoryBadges: [] });
        assert('categoryBadges vazio não gera <div> de pills', !vazio.heroHtml.includes('rounded-pill'));
        const invalido = await enriquecerBlueprint({ siteName: 'X', nichoTema: 'gamer-playerone', categoryBadges: 'string-invalida' });
        assert('categoryBadges como string (formato errado) não lança erro', typeof invalido.heroHtml === 'string');
    }

    // ── nichoTema desconhecido/ausente cai na tagline genérica ──────────────
    {
        const semNicho = await enriquecerBlueprint({ siteName: 'X', categoryBadges: [] });
        assert('sem nichoTema usa tagline genérica', semNicho.heroHtml.includes('informação de verdade'));
        const nichoInvalido = await enriquecerBlueprint({ siteName: 'X', nichoTema: 'nicho-que-nao-existe', categoryBadges: [] });
        assert('nichoTema inválido usa tagline genérica', nichoInvalido.heroHtml.includes('informação de verdade'));
    }

    // ── Não sobrescreve heroHtml/customCss já definidos no blueprint ────────
    {
        const r = await enriquecerBlueprint({
            siteName: 'X', nichoTema: 'gamer-playerone',
            heroHtml: '<section>já veio pronto</section>',
            customCss: '.ja-existe{color:red;}',
        });
        assert('heroHtml pré-existente é preservado', r.heroHtml === '<section>já veio pronto</section>');
        assert('customCss pré-existente é preservado', r.customCss === '.ja-existe{color:red;}');
    }

    // ── onStatus é chamado (mantém paridade de UX com o fluxo antigo) ───────
    {
        let chamado = false;
        await enriquecerBlueprint({ siteName: 'X', nichoTema: 'gamer-playerone' }, () => { chamado = true; });
        assert('onStatus foi chamado', chamado);
    }

    // ── Nunca lança exceção (contrato: sempre resolve, sem I/O de rede) ─────
    {
        let ok = true;
        try { await enriquecerBlueprint({}); } catch (_) { ok = false; }
        assert('blueprint vazio não lança exceção', ok);
    }

    // ── Todos os 14 nichos têm tagline própria (sem cair no genérico) ───────
    {
        const NICHOS = [
            'gamer-playerone', 'pop-retro-pixel', 'natureza-bulma-vegan', 'elearning-academy',
            'biolink-social', 'appstore-bulma-mobile', 'brutalista-appcraft', 'culinaria-boutique-gourmet',
            'noticias-mag-news', 'viral-magazine', 'saas-nexus', 'portfolio-minimalista',
            'tecnologia-mag-tech', 'tecnologia-techwind',
        ];
        let todosComTaglinePropria = true;
        for (const nicho of NICHOS) {
            const r = await enriquecerBlueprint({ siteName: 'X', nichoTema: nicho, categoryBadges: [] });
            if (r.heroHtml.includes('informação de verdade')) {
                console.error(`  ❌ nicho "${nicho}" caiu na tagline genérica`);
                todosComTaglinePropria = false;
            }
        }
        assert('14/14 nichos têm tagline própria (nenhum cai no genérico)', todosComTaglinePropria);
    }

    console.log(`\n${failed === 0 ? '✅' : '❌'} blueprintEnricher: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
})();

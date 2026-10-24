'use strict';

/**
 * Testes do blueprintCritics — foco na Regra 8 (categoryBadges), a
 * correção do bug "todo template gera badges de categoria coloridos e
 * não personalizados pro nicho": a cor de cada badge agora é sempre
 * derivada deterministicamente da badgePalette do colorPreset escolhido
 * (presets.js), nunca inventada pela IA nem por uma paleta genérica fixa.
 *
 * Execute: node src/core/blueprintCritics.test.js
 */

const { criticarBlueprint, NICHOS_HERO_DE_POSTS_REAIS } = require('./blueprintCritics');
const { COLOR_PRESETS }     = require('./presets');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

// ── Regra 8: cor sempre vem da badgePalette do colorPreset — não da IA ──
{
    const { blueprint } = criticarBlueprint({
        siteName: 'Loja Gamer Real',
        colorPreset: 'gamer-dark',
        categoryBadges: [
            { nome: 'Reviews', bg: '#f59e0b', text: '#000000' }, // hex "válido" mas fora da paleta do preset
            { nome: 'Notícias', bg: '#06b6d4', text: '#ffffff' },
        ],
    });
    const paleta = COLOR_PRESETS['gamer-dark'].badgePalette;
    assert('badge 0: bg vem da badgePalette do preset (ignora o bg enviado)',
        blueprint.categoryBadges[0].bg === paleta[0], JSON.stringify(blueprint.categoryBadges[0]));
    assert('badge 1: bg vem da badgePalette do preset (ignora o bg enviado)',
        blueprint.categoryBadges[1].bg === paleta[1], JSON.stringify(blueprint.categoryBadges[1]));
    assert('badge 0: nome preservado', blueprint.categoryBadges[0].nome === 'Reviews');
    assert('badge 0: text sempre #ffffff (paleta é escura o bastante)', blueprint.categoryBadges[0].text === '#ffffff');
}

// ── Regra 8: presets diferentes → paletas diferentes (personalização real) ──
{
    const badgesInput = [{ nome: 'Categoria A' }, { nome: 'Categoria B' }];
    const { blueprint: bpGamer }  = criticarBlueprint({ siteName: 'Site A', colorPreset: 'gamer-dark',  categoryBadges: badgesInput });
    const { blueprint: bpAmber }  = criticarBlueprint({ siteName: 'Site B', colorPreset: 'warm-amber',  categoryBadges: badgesInput });
    assert('presets distintos produzem paletas de badge distintas',
        bpGamer.categoryBadges[0].bg !== bpAmber.categoryBadges[0].bg,
        `gamer-dark=${bpGamer.categoryBadges[0].bg} warm-amber=${bpAmber.categoryBadges[0].bg}`);
}

// ── Regra 8: aceita strings soltas (formato novo do prompt) ──────────────
{
    const { blueprint } = criticarBlueprint({
        siteName: 'Blog de Receitas',
        colorPreset: 'warm-amber',
        categoryBadges: ['Sobremesas', 'Salgados', 'Bebidas'],
    });
    const paleta = COLOR_PRESETS['warm-amber'].badgePalette;
    assert('3 badges (strings) convertidos em objetos', blueprint.categoryBadges.length === 3);
    assert('badge de string: nome correto', blueprint.categoryBadges[0].nome === 'Sobremesas');
    assert('badge de string: bg da paleta', blueprint.categoryBadges[0].bg === paleta[0]);
    assert('badge de string: text #ffffff', blueprint.categoryBadges[0].text === '#ffffff');
}

// ── Regra 8: badge sem nome válido é descartado, resto segue ─────────────
{
    const { blueprint, criticas } = criticarBlueprint({
        siteName: 'Blog X',
        colorPreset: 'tech-blue',
        categoryBadges: ['Válida', '', { bg: '#fff' }, { nome: '  ' }, 123, null],
    });
    assert('só a badge com nome válido sobrevive', blueprint.categoryBadges.length === 1, JSON.stringify(blueprint.categoryBadges));
    assert('badge sobrevivente é a correta', blueprint.categoryBadges[0].nome === 'Válida');
    assert('avisos registrados pras descartadas', criticas.some(c => c.includes('sem \'nome\' válido')));
}

// ── Regra 8: máx 8 badges, nome truncado a 40 chars ───────────────────────
{
    const nomeLongo = 'X'.repeat(60);
    const { blueprint } = criticarBlueprint({
        siteName: 'Blog Y',
        colorPreset: 'tech-blue',
        categoryBadges: Array.from({ length: 12 }, (_, i) => `Cat${i}`).concat(nomeLongo),
    });
    assert('máx 8 badges', blueprint.categoryBadges.length === 8, String(blueprint.categoryBadges.length));
    assert('cores ciclam pela paleta (badge 0 e a paleta tem 6 cores, então badge 6 repete badge 0)',
        blueprint.categoryBadges[0].bg === blueprint.categoryBadges[6].bg);
}

// ── Regra 8: colorPreset ausente/inválido cai no fallback tech-blue ──────
{
    const { blueprint } = criticarBlueprint({
        siteName: 'Blog Z',
        categoryBadges: ['Só uma categoria'],
    });
    assert('sem colorPreset: badge ainda recebe cor (fallback tech-blue)',
        blueprint.categoryBadges[0].bg === COLOR_PRESETS['tech-blue'].badgePalette[0]);
}

// ── Regra 8: categoryBadges ausente/vazio não quebra ──────────────────────
{
    const { blueprint: semCampo } = criticarBlueprint({ siteName: 'Blog W' });
    assert('sem categoryBadges no blueprint: não lança, não adiciona nada', semCampo.categoryBadges === undefined);

    const { blueprint: vazio } = criticarBlueprint({ siteName: 'Blog W2', categoryBadges: [] });
    assert('categoryBadges vazio: continua vazio', Array.isArray(vazio.categoryBadges) && vazio.categoryBadges.length === 0);
}

// ── Todos os 10 presets têm badgePalette não-vazia (guarda de integridade) ──
{
    let todosOk = true;
    for (const [nome, preset] of Object.entries(COLOR_PRESETS)) {
        if (!Array.isArray(preset.badgePalette) || preset.badgePalette.length === 0) {
            todosOk = false;
            console.error(`  ❌ preset '${nome}' sem badgePalette válida`);
        }
    }
    assert('todos os COLOR_PRESETS têm badgePalette', todosOk);
}

// ── Regra 17: moduleOverrides — liga OU desliga, só whitelist ───────────
{
    const { blueprint } = criticarBlueprint({
        siteName: 'Loja Gamer Real',
        nichoTema: 'gamer-playerone',
        moduleOverrides: {
            contactForm: false,            // válido — na whitelist, valor false
            popularPostsRanking: true,     // válido — na whitelist, valor true (liga)
            gridLayout: false,             // inválido — não é módulo, é campo de escolha direta
            fooBarBaz: false,              // inválido — fora da whitelist
            statsWidget: 'sim',            // inválido — não é booleano
        },
    });
    assert('moduleOverrides: contactForm (false) e popularPostsRanking (true) sobrevivem ao filtro',
        Object.keys(blueprint.moduleOverrides).length === 2 &&
        blueprint.moduleOverrides.contactForm === false &&
        blueprint.moduleOverrides.popularPostsRanking === true,
        JSON.stringify(blueprint.moduleOverrides));
}
{
    const { blueprint } = criticarBlueprint({ siteName: 'Sem Overrides', nichoTema: 'gamer-playerone' });
    assert('moduleOverrides ausente no blueprint: não lança, fica undefined', blueprint.moduleOverrides === undefined);
}
{
    const { blueprint } = criticarBlueprint({ siteName: 'Overrides Array', nichoTema: 'gamer-playerone', moduleOverrides: ['contactForm'] });
    assert('moduleOverrides array (formato errado): descartado, não quebra', blueprint.moduleOverrides === undefined);
}

// ── Regra 18: heroTitle/heroSubtitle sem efeito em hero de posts reais ──
// Achado real (teste manual "News", nichoTema=noticias-mag-news): a IA
// prometeu heroTitle/heroSubtitle na conversa e nenhum dos dois apareceu
// no XML compilado — compile.js usa heroNativoXml (FeaturedPost) pra esses
// nichos, injetarHeroTexto nunca roda. Regra remove os campos antes de
// virarem uma promessa morta no manifesto.
{
    assert('noticias-mag-news está no set de hero-de-posts-reais (pré-condição do teste)',
        NICHOS_HERO_DE_POSTS_REAIS.has('noticias-mag-news'));
}
{
    const { blueprint, correcoes } = criticarBlueprint({
        siteName: 'News',
        nichoTema: 'noticias-mag-news',
        heroTitle: 'Jornalismo direto, apuração aberta',
        heroSubtitle: 'Política, economia e cidades — as pautas do dia com contexto.',
    });
    assert('heroTitle removido pra nicho de hero de posts reais', blueprint.heroTitle === undefined);
    assert('heroSubtitle removido pra nicho de hero de posts reais', blueprint.heroSubtitle === undefined);
    assert('correção documentada (heroTitle)', correcoes.some(c => c.includes('heroTitle removido')));
    assert('correção documentada (heroSubtitle)', correcoes.some(c => c.includes('heroSubtitle removido')));
}
{
    const { blueprint } = criticarBlueprint({
        siteName: 'Loja Gamer Real',
        nichoTema: 'gamer-playerone', // NÃO é hero de posts reais
        heroTitle: 'Level up sua jogatina',
        heroSubtitle: 'Reviews e guias sem enrolação.',
    });
    assert('heroTitle preservado em nicho sem hero de posts reais', blueprint.heroTitle === 'Level up sua jogatina');
    assert('heroSubtitle preservado em nicho sem hero de posts reais', blueprint.heroSubtitle === 'Reviews e guias sem enrolação.');
}

console.log(`\n${failed === 0 ? '✅' : '❌'} blueprintCritics: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

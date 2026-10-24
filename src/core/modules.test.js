'use strict';

/**
 * Testes para variação determinística de ícones (dark mode, back-to-top,
 * autor) — src/core/modules.js.
 * Execute: node src/core/modules.test.js
 */

const { resolverModulos, escolherIconeAutor, ICON_AUTHOR_VARIANTES, _DARK_MODE_VARIANTES, _BACK_TO_TOP_VARIANTES } = require('./modules');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

// A. Determinismo — mesma seed sempre escolhe a mesma variante em toda chamada.
{
    const seed = 'Meu Site' + 'gamer-playerone';
    const autor1 = escolherIconeAutor(seed);
    const autor2 = escolherIconeAutor(seed);
    assert('escolherIconeAutor é determinístico pra mesma seed', autor1 === autor2, `${autor1} !== ${autor2}`);

    const mods1 = resolverModulos({ darkMode: true, backToTop: true }, seed);
    const mods2 = resolverModulos({ darkMode: true, backToTop: true }, seed);
    assert('DARK_MODE_MODULE é determinístico pra mesma seed', mods1['[[DARK_MODE_MODULE]]'] === mods2['[[DARK_MODE_MODULE]]']);
    assert('BACK_TO_TOP_MODULE é determinístico pra mesma seed', mods1['[[BACK_TO_TOP_MODULE]]'] === mods2['[[BACK_TO_TOP_MODULE]]']);
}

// B. Variedade — seeds diferentes tendem a escolher variantes diferentes
// (não determinístico no sentido "sempre a mesma pra todo mundo").
{
    const seeds = ['SiteA1', 'SiteB2', 'SiteC3', 'SiteD4', 'SiteE5', 'SiteF6', 'SiteG7', 'SiteH8'];
    const autores = new Set(seeds.map(escolherIconeAutor));
    assert('escolherIconeAutor varia entre seeds diferentes (não sempre o mesmo índice)',
        autores.size > 1, [...autores].join(', '));

    const darkModes = new Set(seeds.map(s => resolverModulos({ darkMode: true }, s)['[[DARK_MODE_MODULE]]']));
    assert('DARK_MODE_MODULE varia entre seeds diferentes', darkModes.size > 1);

    const backToTops = new Set(seeds.map(s => resolverModulos({ backToTop: true }, s)['[[BACK_TO_TOP_MODULE]]']));
    assert('BACK_TO_TOP_MODULE varia entre seeds diferentes', backToTops.size > 1);
}

// C. Decorrelação — os 3 papéis de ícone (author/darkmode/backtotop) não usam
// sempre o mesmo índice relativo entre si pra uma mesma seed (evita "sempre
// a variante 0 de tudo junto" por reaproveitar o mesmo hash cru).
{
    const seed = 'SeedQualquer' + 'nicho-x';
    const idxAutor      = ICON_AUTHOR_VARIANTES.indexOf(escolherIconeAutor(seed));
    const mods          = resolverModulos({ darkMode: true, backToTop: true }, seed);
    const idxDarkMode   = _DARK_MODE_VARIANTES.indexOf(mods['[[DARK_MODE_MODULE]]']);
    const idxBackToTop  = _BACK_TO_TOP_VARIANTES.indexOf(mods['[[BACK_TO_TOP_MODULE]]']);
    assert('índices escolhidos não são idênticos entre os 3 papéis (namespaces de hash distintos)',
        !(idxAutor === idxDarkMode && idxDarkMode === idxBackToTop),
        `autor=${idxAutor} darkmode=${idxDarkMode} backtotop=${idxBackToTop}`);
}

// D. Módulo desativado continua retornando string vazia, variação não afeta isso.
{
    const mods = resolverModulos({ darkMode: false, backToTop: false }, 'qualquer-seed');
    assert('DARK_MODE_MODULE vazio quando desativado', mods['[[DARK_MODE_MODULE]]'] === '');
    assert('BACK_TO_TOP_MODULE vazio quando desativado', mods['[[BACK_TO_TOP_MODULE]]'] === '');
}

// E. Todas as variantes de dark mode preservam o mesmo contrato funcional:
// localStorage['theme'] e atributo data-bs-theme (todo o CSS dos templates
// depende disso — trocar de mecanismo quebraria o dark mode de verdade).
{
    for (const variante of _DARK_MODE_VARIANTES) {
        assert('variante de dark mode usa localStorage theme (não sl_theme nem outra chave)',
            variante.includes("localStorage.getItem('theme')") && variante.includes("localStorage.setItem('theme'"),
            variante.slice(0, 60));
        assert('variante de dark mode seta data-bs-theme no documentElement',
            variante.includes("setAttribute('data-bs-theme'"));
    }
}

// F. Todas as variantes de back-to-top preservam o mesmo contrato funcional
// (threshold de scroll e scrollTo suave).
{
    for (const variante of _BACK_TO_TOP_VARIANTES) {
        assert('variante de back-to-top usa o mesmo threshold de scroll (320)', variante.includes('window.scrollY>320'));
        assert('variante de back-to-top usa scrollTo suave', variante.includes('scrollTo({top:0,behavior:"smooth"})'));
    }
}

// G. Achado real (fuzzing combinatório pós-PR#548): _DARK_MODE_EMOJI e
// _DARK_MODE_SVG_SUNMOON só tinham title=, sem aria-label — só aparecia com
// certas seeds (nicho+preset+siteName), por isso um baseline de 1 preset por
// nicho não achava. Todo botão/label sem texto visível (só ícone/emoji)
// precisa de aria-label pra leitor de tela, em qualquer variante.
{
    for (const variante of _DARK_MODE_VARIANTES) {
        assert('variante de dark mode tem aria-label (botão/label só-ícone)',
            variante.includes('aria-label='), variante.slice(0, 60));
    }
    for (const variante of _BACK_TO_TOP_VARIANTES) {
        assert('variante de back-to-top tem aria-label (botão só-ícone)',
            variante.includes('aria-label='), variante.slice(0, 60));
    }
}

console.log(`\n${failed === 0 ? '✅' : '❌'} modules: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

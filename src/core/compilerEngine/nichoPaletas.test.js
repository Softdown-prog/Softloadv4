'use strict';

/**
 * Testes para variação determinística de paletas de cor por nicho —
 * src/core/compilerEngine/nichoPaletas.js.
 * Execute: node src/core/compilerEngine/nichoPaletas.test.js
 */

const { gerarPaletaCss, PALETAS } = require('./nichoPaletas');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

// A. Nicho sem paleta documentada → string vazia, nunca inventa cor.
assert("nicho sem paleta documentada retorna ''", gerarPaletaCss('gamer-playerone', 'qualquer') === '');
assert("nicho inexistente retorna ''", gerarPaletaCss('nicho-que-nao-existe', 'qualquer') === '');

// B. pop-retro-pixel — bloco :root bem-formado com as 5 variáveis esperadas.
{
    const css = gerarPaletaCss('pop-retro-pixel', 'seed-fixo');
    assert('bloco começa com :root {', css.startsWith(':root {'));
    assert('declara --primary', /--primary:\s*#[0-9A-Fa-f]{6};/.test(css));
    assert('declara --secondary', /--secondary:\s*#[0-9A-Fa-f]{6};/.test(css));
    assert('declara --bg-light fixo', css.includes('--bg-light: #F4F4F4;'));
    assert('declara --border-pixel fixo', css.includes('--border-pixel: 4px solid #000000;'));
    assert("declara --font-pixel fixo", css.includes("--font-pixel: 'Press Start 2P', cursive;"));
}

// C. Determinismo — mesma seed sempre escolhe a mesma paleta.
{
    const css1 = gerarPaletaCss('pop-retro-pixel', 'Meu Site' + 'pop-retro-pixel');
    const css2 = gerarPaletaCss('pop-retro-pixel', 'Meu Site' + 'pop-retro-pixel');
    assert('mesma seed produz o mesmo bloco de paleta', css1 === css2);
}

// D. Variedade — seeds diferentes tendem a escolher paletas diferentes.
{
    const seeds = ['SiteA', 'SiteB', 'SiteC', 'SiteD', 'SiteE', 'SiteF', 'SiteG', 'SiteH'];
    const resultados = new Set(seeds.map(s => gerarPaletaCss('pop-retro-pixel', s)));
    assert('paleta varia entre seeds diferentes (não sempre a mesma)', resultados.size > 1, [...resultados].join(' | '));
}

// E. Toda paleta declarada usa cor hexadecimal válida de 6 dígitos —
// nenhum valor truncado/corrompido na tabela de dados.
{
    const paletas = PALETAS['pop-retro-pixel'];
    assert('tabela de paletas do pop-retro-pixel tem as 5 combinações documentadas', paletas.length === 5);
    for (const p of paletas) {
        assert(`primary '${p.primary}' é hex válido de 6 dígitos`, /^#[0-9A-Fa-f]{6}$/.test(p.primary));
        assert(`secondary '${p.secondary}' é hex válido de 6 dígitos`, /^#[0-9A-Fa-f]{6}$/.test(p.secondary));
    }
}

console.log(`\n${failed === 0 ? '✅' : '❌'} nichoPaletas: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

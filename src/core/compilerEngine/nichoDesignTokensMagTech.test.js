'use strict';

/**
 * Teste de regressão — tecnologia-mag-tech usava --primary/--text-main/
 * --text-muted/--border/--surface/--bg-color/--font-body/--shadow-sm em
 * dezenas de regras CSS mas nunca declarava nenhuma delas em :root.
 * Corrigido normalizando tema-tecnologia-mag-tech-meta.json (tokens_css)
 * pro formato canônico light_mode/dark_mode que nichoImpl.js já injeta
 * automaticamente (mesmo mecanismo usado por noticias-mag-news).
 * Execute: node src/core/compilerEngine/nichoDesignTokensMagTech.test.js
 */

const { carregarNichoImplComBlocos } = require('./nichoBlocks');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

const impl = carregarNichoImplComBlocos('tecnologia-mag-tech', 'Site Teste');
const css = impl.css || '';

const VARS_ESPERADAS = [
    '--primary', '--text-main', '--text-muted', '--border',
    '--surface', '--bg-color', '--font-body', '--shadow-sm',
];

for (const v of VARS_ESPERADAS) {
    const re = new RegExp(`\\${v}:\\s*[^;]+;`);
    assert(`declara ${v} em :root`, re.test(css), css.slice(0, 200));
}

assert("declara override [data-bs-theme='dark']", css.includes("[data-bs-theme='dark']"));
assert('--primary aliasado ao token global --sl-primary (respeita o preset de cor)',
    css.includes('--primary: var(--sl-primary)'));
assert('--surface no dark mode usa o valor literal documentado no meta.json (não aliasado)',
    css.includes('--surface: #1e293b'));
assert('--font-body continua fonte (não colide com o alias de --sl-bg-body via "-body$")',
    css.includes("--font-body: 'Roboto', sans-serif"));

// Nenhuma var(--x) usada no CSS deste nicho fica sem declaração correspondente
// em algum lugar do próprio bloco (exceto os tokens globais --sl-*, que são
// declarados por designTokensCss.js, e --bs-*, do Bootstrap 5.3.3 via CDN).
{
    const usadas = new Set([...css.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)].map(m => m[1]));
    const declaradas = new Set([...css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map(m => m[1]));
    const orfas = [...usadas].filter(v => !declaradas.has(v) && !v.startsWith('--sl-') && !v.startsWith('--bs-'));
    assert('nenhuma variável --* órfã (usada mas nunca declarada)', orfas.length === 0, orfas.join(', '));
}

console.log(`\n${failed === 0 ? '✅' : '❌'} nichoDesignTokensMagTech: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

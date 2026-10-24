'use strict';

/**
 * Testes para os tokens CSS globais (--sl-*) — designTokensCss.js + hexParaRgb
 * em sanitize.js.
 * Execute: node src/core/compilerEngine/designTokensCss.test.js
 */

const { gerarDynamicCss } = require('./designTokensCss');
const { hexParaRgb } = require('./sanitize');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

const TOKENS_BASE = {
    color: { primary: '#2563eb', bgBody: '#f8fafc', cardBg: '#ffffff', textMain: '#1e293b', footerBg: '#0f172a' },
    button: { btnRadius: '8px', btnShadow: 'none' },
    typography: { fontFamily: "'Inter', sans-serif", headingWeight: '700' },
};

// A. Regressão — --sl-text-muted e --sl-border agora são declarados.
// Achado real: usadas em 7/14 e em variantes de outro nicho respectivamente,
// mas nunca declaradas em lugar nenhum — var() sem fallback resolvia pra
// vazio (texto secundário e bordas sutis sumiam em produção).
{
    const css = gerarDynamicCss(TOKENS_BASE);
    assert('declara --sl-text-muted', /--sl-text-muted:\s*color-mix/.test(css));
    assert('declara --sl-border', /--sl-border:\s*color-mix/.test(css));
    assert('declara --sl-primary-rgb', /--sl-primary-rgb:\s*37,99,235;/.test(css), css);
    assert('declara --sl-card-bg-rgb', /--sl-card-bg-rgb:\s*255,255,255;/.test(css), css);
}

// B. O footer global não pode sobrescrever o glassmorphism autoral do
// BioLink. Outros nichos mantêm o comportamento legado do preset.
{
    const cssBio = gerarDynamicCss(TOKENS_BASE, { preserveNicheFooter: true });
    const cssLegado = gerarDynamicCss(TOKENS_BASE);
    assert('biolink preserva --sl-footer-bg', cssBio.includes('--sl-footer-bg:      #0f172a !important;'));
    assert('biolink não pinta todo elemento footer', !cssBio.includes('.sl-footer, footer {'));
    assert('biolink mantém suporte a footer de componentes .sl-footer', cssBio.includes('.sl-footer {'));
    assert('outros nichos mantêm CSS legado', cssLegado.includes('.sl-footer, footer {'));
}

// C. Tokens pré-existentes continuam intactos (não regredir o que já
// funcionava).
{
    const css = gerarDynamicCss(TOKENS_BASE);
    assert('--sl-primary intacto', css.includes('--sl-primary:        #2563eb !important;'));
    assert('--sl-bg-body intacto', css.includes('--sl-bg-body:        #f8fafc !important;'));
    assert('--sl-card-bg intacto', css.includes('--sl-card-bg:        #ffffff !important;'));
    assert('--sl-text-main intacto', css.includes('--sl-text-main:      #1e293b !important;'));
    assert('--sl-footer-bg intacto', css.includes('--sl-footer-bg:      #0f172a !important;'));
}

// C. hexParaRgb — conversão correta pra #RRGGBB e #RGB, fallback seguro pra
// entrada inválida (nunca gera CSS quebrado).
assert('#RRGGBB converte certo', hexParaRgb('#2563eb') === '37,99,235');
assert('#RGB curto converte certo (expande dígitos)', hexParaRgb('#fff') === '255,255,255');
assert('preto', hexParaRgb('#000000') === '0,0,0');
assert('branco', hexParaRgb('#FFFFFF') === '255,255,255');
assert("entrada inválida usa fallback ('0,0,0' por padrão)", hexParaRgb('not-a-color') === '0,0,0');
assert('entrada inválida usa fallback customizado', hexParaRgb('xyz', '9,9,9') === '9,9,9');
assert('hex maiúsculo/minúsculo funciona igual', hexParaRgb('#2563EB') === hexParaRgb('#2563eb'));

// D. Em qualquer preset (claro ou escuro), --sl-text-muted/--sl-border
// nunca ficam vazios — color-mix() sempre produz um valor válido a partir
// de qualquer textMain.
{
    const presetEscuro = { ...TOKENS_BASE, color: { ...TOKENS_BASE.color, textMain: '#e2e8f0' } };
    const css = gerarDynamicCss(presetEscuro);
    assert('preset escuro também declara --sl-text-muted com o textMain certo',
        css.includes('--sl-text-muted:     color-mix(in srgb, #e2e8f0 65%, transparent);'));
}

console.log(`\n${failed === 0 ? '✅' : '❌'} designTokensCss: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

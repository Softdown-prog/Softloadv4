'use strict';
const assert = require('node:assert/strict');
const { gerarPlaceholderImagemSvg } = require('./placeholderImage');

// Contrato congelado antes da migração: forma, espaços, fallback e base64.
function svgEsperado(primary, background) {
    return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 300'>
<rect width='400' height='300' fill='${background}'/>
<g opacity='0.32'>
<circle cx='150' cy='115' r='24' fill='${primary}'/>
<path d='M40 230 L145 140 L200 185 L255 120 L360 230 Z' fill='${primary}'/>
</g>
</svg>`;
}

const casos = [
    ['#0ea5e9', '#f8fafc', '#0ea5e9', '#f8fafc'],
    ['#abc', '#FFF', '#abc', '#FFF'],
    ['#abcdef', '#123456', '#abcdef', '#123456'],
    ['#12345678', '#0f0f0f00', '#12345678', '#0f0f0f00'],
    ['#1234', '#12345', '#1234', '#12345'], // Limites legados: regex de 3 a 8 hex.
    ['not-a-color', undefined, '#64748b', '#f1f5f9'],
    ['#12', '#123456789', '#64748b', '#f1f5f9'],
    ['rgb(1,2,3)', 'var(--bg)', '#64748b', '#f1f5f9'],
    [undefined, null, '#64748b', '#f1f5f9'],
    ['<script>alert(1)</script>', '#fff', '#64748b', '#fff'],
];
for (const [primary, background, expectedPrimary, expectedBackground] of casos) {
    const expected = 'data:image/svg+xml;base64,' + Buffer.from(svgEsperado(expectedPrimary, expectedBackground)).toString('base64');
    const actual = gerarPlaceholderImagemSvg(primary, background);
    assert.equal(actual, expected, 'Saída SVG precisa ser idêntica para ' + String(primary) + '/' + String(background));
    assert.equal(Buffer.from(actual.split(',')[1], 'base64').toString('utf8'), svgEsperado(expectedPrimary, expectedBackground));
    assert.ok(!actual.includes('placehold.co'));
    assert.equal(actual, gerarPlaceholderImagemSvg(primary, background), 'A saída é determinística');
}
assert.equal(typeof require('./placeholderImage').gerarPlaceholderImagemSvg, 'function', 'Compatibilidade require CommonJS');
console.log('✅ Placeholder SVG: ' + casos.length + ' casos com equivalência byte a byte.');

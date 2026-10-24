'use strict';

// Smoke de compatibilidade: os demais módulos continuam chamando require('./...').
const assert = require('node:assert/strict');
const { sanitizarInput, validarHex, sanitizarCssColor, hexParaRgb } = require('./sanitize');
const { detectarOrfaos } = require('./orphans');
const { construirGrafoCampos } = require('./fieldGraph');

assert.equal(sanitizarInput('  <a href="x&y">\'  '), '&lt;a href=&quot;x&amp;y&quot;&gt;&#x27;');
assert.equal(sanitizarInput(null), '');
assert.equal(sanitizarInput({}), '');
assert.equal(validarHex('#Ab3'), true);
assert.equal(validarHex('#abcDEF'), true);
assert.equal(validarHex('#12345g'), false);
assert.equal(validarHex(123), false);
assert.equal(sanitizarCssColor(' #abc '), '#abc');
assert.equal(sanitizarCssColor('url(javascript:evil)', '#ffffff'), '#ffffff');
assert.equal(hexParaRgb('#abc'), '170,187,204');
assert.equal(hexParaRgb('#0102FF'), '1,2,255');
assert.equal(hexParaRgb('invalid'), '0,0,0');

const originalWarn = console.warn;
const warnings = [];
console.warn = (...args) => warnings.push(args);
try {
    assert.equal(detectarOrfaos('<h1>ok</h1>'), '<h1>ok</h1>');
    assert.equal(detectarOrfaos('[[HEADER]]\n<p>[[MISSING]]</p>\n'), '<p> </p>\n');
} finally {
    console.warn = originalWarn;
}
assert.equal(warnings.length, 1);
assert.equal(warnings[0][1], '[[HEADER]], [[MISSING]]');

const sources = ['siteName', 'theme'];
const trace = [
    { slot: 'HEADER', type: 'widget', valueBytes: 5, active: true, sources },
    { slot: 'SEO', type: 'seo', valueBytes: 0, active: false, sources: ['siteName'] },
];
const graph = construirGrafoCampos(trace);
assert.strictEqual(graph.nos, trace);
assert.strictEqual(graph.slotParaCampos.get('HEADER'), sources);
assert.deepEqual(graph.campoParaSlots.get('siteName'), ['HEADER', 'SEO']);
assert.deepEqual(graph.campoParaSlots.get('theme'), ['HEADER']);
assert.strictEqual(graph.campoParaSlots.get('none'), undefined);

console.log('✅ Compatibilidade dos três módulos TypeScript: OK');

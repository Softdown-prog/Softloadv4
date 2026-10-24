'use strict';

// Baseline do slotManifest.js legado anterior à migração TypeScript.
// FNV32 do JSON de { GRID_OPTIONS, SLOT_MANIFEST } coletado na main original.
const assert = require('node:assert/strict');
const { GRID_OPTIONS, SLOT_MANIFEST } = require('./slotManifest');
const { construirGrafoCampos } = require('./fieldGraph');

function fnv32(text) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i++) {
        h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}
assert.deepEqual(Object.keys(require('./slotManifest')), ['GRID_OPTIONS', 'SLOT_MANIFEST']);
assert.equal(Object.keys(GRID_OPTIONS).length, 7);
assert.equal(SLOT_MANIFEST.length, 38);
assert.equal(fnv32(JSON.stringify({ GRID_OPTIONS, SLOT_MANIFEST })), 'd4eeee8f',
    'Manifesto e opções de grade devem permanecer idênticos ao JS legado');
assert.equal(SLOT_MANIFEST[0].slot, 'THEME_COLOR');
assert.equal(SLOT_MANIFEST.at(-1).slot, 'SOCIAL_LINKS_WIDGET');
assert.equal(new Set(SLOT_MANIFEST.map(s => s.slot)).size, SLOT_MANIFEST.length);

const trace = SLOT_MANIFEST.map(s => ({
    slot: s.slot, type: s.type, sources: s.sources, valueBytes: 0, active: false,
}));
const grafo = construirGrafoCampos(trace);
assert.strictEqual(grafo.nos, trace);
assert.strictEqual(grafo.slotParaCampos.get('SEO_MODULE'), SLOT_MANIFEST[1].sources);
assert.deepEqual(grafo.campoParaSlots.get('typography'), ['FONT_MODULE', 'DYNAMIC_CSS']);
assert.ok(grafo.campoParaSlots.get('modules.darkMode').includes('DARK_MODE_MODULE'));
console.log('✅ 38 slots e 7 grades preservados, contrato do trace compatível.');

'use strict';
const assert = require('node:assert/strict');
const { COLOR_PRESETS, BUTTON_STYLES, TYPOGRAPHY_PRESETS } = require('./presets');
assert.equal(Object.keys(COLOR_PRESETS).length, 50);
for (const [key, preset] of Object.entries(COLOR_PRESETS)) {
    assert.ok(preset.label, key + ': label');
    assert.ok(preset.primary && preset.bgBody && preset.cardBg && preset.textMain && preset.footerBg, key + ': cores obrigatórias');
    assert.equal(preset.badgePalette.length, 6, key + ': palette de badges');
}
assert.equal(Object.keys(BUTTON_STYLES).length, 5);
assert.equal(Object.keys(TYPOGRAPHY_PRESETS).length, 6);
assert.equal(BUTTON_STYLES['default'].btnRadius, '8px');
assert.ok(TYPOGRAPHY_PRESETS['inter'].fontFamily.includes('Inter'));
console.log('✅ presets: cores, botões e tipografia compatíveis');

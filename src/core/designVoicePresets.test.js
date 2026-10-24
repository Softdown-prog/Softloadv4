'use strict';

/** Smoke tests do catálogo de vozes visuais e compatibilidade da API CommonJS. */
const assert = require('node:assert/strict');
const {
    DESIGN_VOICE_PRESETS,
    NICHO_DESIGN_VOICE_MAP,
    COLOR_DESIGN_VOICE_HINT,
    gerarDesignVoiceCss,
} = require('./designVoicePresets');

assert.ok(Object.keys(DESIGN_VOICE_PRESETS).length >= 8, 'catálogo deve conter arquétipos reais');
assert.equal(gerarDesignVoiceCss('auto'), '');
assert.equal(gerarDesignVoiceCss('desconhecido'), '');
assert.equal(gerarDesignVoiceCss(undefined), '');
assert.equal(gerarDesignVoiceCss('editorial-clean'), '\n    ' + DESIGN_VOICE_PRESETS['editorial-clean']);
assert.ok(gerarDesignVoiceCss('tech-sharp').includes('VOICE: tech-sharp'));
assert.equal(NICHO_DESIGN_VOICE_MAP['gamer-playerone'], 'dark-atmospheric');
assert.equal(COLOR_DESIGN_VOICE_HINT['gamer-dark'], 'dark-atmospheric');
assert.equal(gerarDesignVoiceCss(NICHO_DESIGN_VOICE_MAP['gamer-playerone']).includes('VOICE: dark-atmospheric'), true);
console.log('✅ designVoicePresets: contratos CommonJS e presets validados');

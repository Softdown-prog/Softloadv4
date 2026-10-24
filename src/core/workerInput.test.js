'use strict';

const assert = require('node:assert/strict');
const { validarManifesto, resolverEnum, resolverDesignVoice } = require('./workerInput');
const { validarManifesto: workerExport } = require('./compilerWorker');
const { ENUMS } = require('../ai/blueprintSchema');
const { NICHO_DESIGN_VOICE_MAP, COLOR_DESIGN_VOICE_HINT } = require('./designVoicePresets');

// Contrato público do worker: a função exportada segue a referência migrada.
assert.strictEqual(workerExport, validarManifesto);

// Independente do TS: validação original antes da migração.
function validarLegado(body) {
    const erros = [];
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        erros.push('Corpo da requisição não é um objeto JSON válido.');
        return erros;
    }
    const { siteName, modules } = body;
    if (!siteName || typeof siteName !== 'string' || siteName.trim().length < 2) {
        erros.push('siteName: obrigatório, mínimo 2 caracteres.');
    }
    if (modules !== undefined && (typeof modules !== 'object' || Array.isArray(modules))) {
        erros.push('modules: deve ser um objeto (ex: { darkMode: true, backToTop: false }).');
    }
    return erros;
}
for (const payload of [
    undefined, null, false, 0, '', 'abc', [], ['ok'],
    {}, { siteName: 'A' }, { siteName: '  ' },
    { siteName: 'Loja' }, { siteName: ' Loja ', modules: null },
    { siteName: 'X', modules: [] }, { siteName: 'Loja', modules: true },
    { siteName: 'Loja', modules: 'não' }, { siteName: 12, modules: {} },
    { siteName: 'Água', modules: { toc: true } },
    { siteName: 'Loja', modules: undefined },
    Object.create(null),
]) {
    assert.deepEqual(validarManifesto(payload), validarLegado(payload));
}
const enumDefaults = { colorPreset: 'tech-blue', typography: 'inter', buttonStyle: 'default', footerStyle: 'advanced-3-cols', designVoice: 'auto' };
function legadoEnum(valor, campo, fallback) {
    const validos = ENUMS[campo];
    if (validos && validos.includes(valor)) return valor;
    return enumDefaults[campo] ?? fallback;
}
for (const [value, field, fallback] of [
    ['mural', 'gridLayout', 'revista'], ['not-valid', 'gridLayout', 'revista'],
    [null, 'gridLayout', 'lista'], ['invalid', 'colorPreset', 'tech-blue'],
    ['invalid', 'footerStyle', 'other'], ['inter', 'typography', 'other'],
    [12, 'gridLayout', 'dupla'], ['?', 'sidebarPosition', 'left'],
    [undefined, 'notAnEnum', 'fallback'], ['auto', 'designVoice', ''],
]) assert.equal(resolverEnum(value, field, fallback, ENUMS), legadoEnum(value, field, fallback));
function legadoVoice(designVoice, nichoTema, colorPreset) {
    const nichoNorm = typeof nichoTema === 'string' ? nichoTema.replace(/^tema-/, '').toLowerCase() : '';
    const raw = typeof designVoice === 'string' ? designVoice.trim() : 'auto';
    const validos = ENUMS.designVoice || [];
    if (raw && raw !== 'auto' && validos.includes(raw)) return raw;
    return NICHO_DESIGN_VOICE_MAP[nichoNorm] || COLOR_DESIGN_VOICE_HINT[colorPreset] || '';
}
for (const voice of ['auto', 'editorial-clean', '  bold-impact  ', 'inexistente', null, 42, '', undefined]) {
    for (const niche of ['tema-gamer-playerone', 'biolink-social', null, '']) {
        for (const color of ['tech-blue', 'clean-white', null]) {
            assert.equal(
                resolverDesignVoice(voice, niche, color, ENUMS, NICHO_DESIGN_VOICE_MAP, COLOR_DESIGN_VOICE_HINT),
                legadoVoice(voice, niche, color),
            );
        }
    }
}
console.log('✅ workerInput: validação, enums e identidade visual preservados (20 + 10 + 96 casos).');

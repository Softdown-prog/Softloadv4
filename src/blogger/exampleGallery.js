'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const { COLOR_PRESETS, TYPOGRAPHY_PRESETS } = require('../core/presets');
const { NICHO_PAGE_TYPE_MAP, PAGE_TYPES_SEM_CHASSIS_DEDICADO } = require('../core/nichoTaxonomy');
const ENTRIES = require('./exampleGallery.json');
const GALLERY = Object.freeze(ENTRIES.map((entry) => {
    if (!Object.hasOwn(NICHO_PAGE_TYPE_MAP, entry.nichoTema) ||
        !Object.hasOwn(COLOR_PRESETS, entry.colorPreset) ||
        !Object.hasOwn(TYPOGRAPHY_PRESETS, entry.typography) ||
        !['lista', 'dupla', 'revista', 'quadrado', 'mural', 'coluna-unica', 'zigzag'].includes(entry.gridLayout) ||
        !['left', 'right', 'none'].includes(entry.sidebarPosition)) {
        throw new Error('Exemplo Blogger com opção não suportada: ' + entry.id);
    }
    const colors = COLOR_PRESETS[entry.colorPreset];
    return Object.freeze({
        ...entry,
        accent: colors.primary,
        surface: colors.cardBg,
        background: colors.bgBody,
        contrast: colors.textMain,
        fallback: PAGE_TYPES_SEM_CHASSIS_DEDICADO.has(NICHO_PAGE_TYPE_MAP[entry.nichoTema]),
    });
}));
function listarExemplos() { return GALLERY; }
function encontrarExemplo(id) { return GALLERY.find((p) => p.id === id) || null; }
module.exports = { listarExemplos, encontrarExemplo };

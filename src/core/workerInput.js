"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validarManifesto = validarManifesto;
exports.resolverEnum = resolverEnum;
exports.resolverDesignVoice = resolverDesignVoice;
const ENUM_DEFAULTS_WORKER = {
    colorPreset: 'tech-blue',
    typography: 'inter',
    buttonStyle: 'default',
    footerStyle: 'advanced-3-cols',
    designVoice: 'auto',
};
/** Mesmo contrato de erros e mesma ordem do validarManifesto legado. */
function validarManifesto(body) {
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
/** Não antecipa a validação de body; os enums vêm do blueprintSchema legado. */
function resolverEnum(valor, campo, fallback, enums) {
    const validos = enums[campo];
    if (validos && validos.includes(valor))
        return valor;
    return ENUM_DEFAULTS_WORKER[campo] ?? fallback;
}
/** Mantém prioridade nicho → paleta → vazio, inclusive 'auto' e entrada inválida. */
function resolverDesignVoice(designVoice, nichoTema, colorPreset, enums, nichoVoices, colorVoices) {
    const nichoNorm = typeof nichoTema === 'string' ? nichoTema.replace(/^tema-/, '').toLowerCase() : '';
    const raw = typeof designVoice === 'string' ? designVoice.trim() : 'auto';
    const validos = enums.designVoice || [];
    if (raw && raw !== 'auto' && validos.includes(raw))
        return raw;
    return nichoVoices[nichoNorm]
        || colorVoices[colorPreset]
        || '';
}

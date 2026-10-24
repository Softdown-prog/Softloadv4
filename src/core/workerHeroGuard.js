"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.temHeroProtegido = temHeroProtegido;
exports.prepararDesignPackage = prepararDesignPackage;
exports.temCamposDesignPackage = temCamposDesignPackage;
function temHeroProtegido(dossie) {
    return !!(dossie && dossie.pecas.some(p => p.tipo === 'hero' && p.protegida));
}
/** Mantém todos os campos; descarta apenas o hero genérico quando protegido. */
function prepararDesignPackage(body, protegido) {
    return protegido ? { ...body, heroHtml: undefined } : body;
}
/** Exatamente as mesmas cinco condições de ativação do worker legado. */
function temCamposDesignPackage(body) {
    const CAMPOS = ['customCss', 'svgLogo', 'heroHtml', 'staticSections', 'darkTheme'];
    return CAMPOS.some(c => body[c] !== undefined && body[c] !== null && body[c] !== '');
}

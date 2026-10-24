"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gerarFontModule = gerarFontModule;
function gerarFontModule(typography) {
    const safeFontUrl = typography.fontUrl ? typography.fontUrl.replace(/&/g, '&amp;') : '';
    return `<link rel='preconnect' href='https://fonts.googleapis.com'/>
    <link rel='preconnect' href='https://fonts.gstatic.com' crossorigin='anonymous'/>
    <link href='${safeFontUrl}' rel='stylesheet'/>`;
}

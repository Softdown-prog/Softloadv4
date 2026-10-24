"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setPublicStaticHeaders = setPublicStaticHeaders;
const path = require('node:path');
const DEFAULT_PUBLIC = path.join(__dirname, '..', 'public');
/**
 * Invocado por express.static({ setHeaders }) ANTES de escrever a resposta.
 * O caminho de main.js continua sem cache como antes; outros chunks
 * continuam com o maxAge/immutable globais do express.static.
 */
function setPublicStaticHeaders(res, filePath, publicRoot = DEFAULT_PUBLIC) {
    const relative = path.relative(publicRoot, filePath);
    if (relative === path.join('dist', 'assets', 'main.js') || relative.startsWith('vendor' + path.sep)) {
        res.setHeader('Cache-Control', 'no-store, max-age=0');
    }
}

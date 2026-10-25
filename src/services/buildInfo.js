"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTime = exports.gitDate = exports.gitSha = void 0;
const fs = require('fs');
const path = require('path');
function lerArquivo(nome) {
    try {
        const conteudo = fs.readFileSync(path.join(__dirname, '../..', nome), 'utf-8').trim();
        return conteudo || null;
    }
    catch (_) {
        return null;
    }
}
exports.gitSha = lerArquivo('GIT_SHA') || 'dev-local';
exports.gitDate = lerArquivo('GIT_DATE') || null;
exports.buildTime = lerArquivo('BUILD_TIME') || null;

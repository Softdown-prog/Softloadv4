'use strict';

// ============================================================
// BUILD INFO — metadados do commit/build gravados na imagem Docker
// ============================================================
// O Dockerfile (stage "build-info") grava GIT_SHA / GIT_DATE / BUILD_TIME
// na raiz da imagem durante o build — de forma independente de quem/o que
// dispara o `docker build` (Cloud Build trigger, deploy manual, etc.), já
// que só depende do .git estar presente no contexto de build.
//
// Em dev local (`npm run dev`) esses arquivos não existem — fallback claro
// em vez de erro, pra não confundir "rodando local" com "deploy quebrado".
// ============================================================

const fs   = require('fs');
const path = require('path');

function _lerArquivo(nome) {
    try {
        const conteudo = fs.readFileSync(path.join(__dirname, '../..', nome), 'utf-8').trim();
        return conteudo || null;
    } catch (_) {
        return null;
    }
}

const gitSha    = _lerArquivo('GIT_SHA')    || 'dev-local';
const gitDate   = _lerArquivo('GIT_DATE')   || null;
const buildTime = _lerArquivo('BUILD_TIME') || null;

module.exports = { gitSha, gitDate, buildTime };

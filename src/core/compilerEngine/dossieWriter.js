"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adicionarPeca = adicionarPeca;
exports.substituirPecas = substituirPecas;
exports.substituirDossieCompleto = substituirDossieCompleto;
// ============================================================
// DOSSIÊ WRITER — única escrita em tema-{nicho}-dossie.json.
//
// Nenhum outro módulo do dossiê (dossieLoader/dossieValidator/
// dossieIntegrityChecker) tem writeFileSync — persistir uma peça
// gerada por IA de volta no dossiê é mecanismo 100% novo. Só grava
// se o dossiê RESULTANTE (peça já incluída) continuar schema-válido
// — nunca persiste um dossiê que ficaria inválido, mesmo que o
// chamador (pecaOrchestrator.js) já devesse ter validado a peça
// antes de chegar aqui. Escrita atômica (.tmp + rename) evita
// corromper o arquivo se o processo morrer no meio da escrita.
// ============================================================
const fs = require('fs');
const path = require('path');
const { carregarNichoDossie, limparCache } = require('./dossieLoader');
const { validarDossie } = require('./dossieValidator');
const TEMAS_DIR = path.join(__dirname, '../../../src/rag/rag-ia-compiler/pipeline/temas');
function _caminhoDossie(nichoTema) {
    const base = nichoTema.replace(/^tema-/, '');
    return path.join(TEMAS_DIR, `tema-${base}-dossie.json`);
}
// ──────────────────────────────────────────────────────────────
// adicionarPeca — grava uma peça nova no dossiê de um nicho já
// migrado. `peca` precisa vir com "id" já atribuído pelo chamador
// (pecaOrchestrator.js decide o slug — não é responsabilidade do
// writer inventar identificador). Retorna { ok, erros }.
// ──────────────────────────────────────────────────────────────
function adicionarPeca(nichoTema, peca) {
    const dossieAtual = carregarNichoDossie(nichoTema);
    if (!dossieAtual) {
        return { ok: false, erros: [`nicho "${nichoTema}" não tem dossiê — não é possível adicionar peça (nicho ainda no cano legado).`] };
    }
    if (!peca || typeof peca !== 'object' || !peca.id || typeof peca.id !== 'string') {
        return { ok: false, erros: ['peça inválida: precisa de "id" (string) atribuído pelo chamador antes de persistir.'] };
    }
    if (dossieAtual.pecas.some(p => p.id === peca.id)) {
        return { ok: false, erros: [`peça "${peca.id}" já existe no dossiê de "${nichoTema}" — id colidiria.`] };
    }
    const dossieResultante = {
        ...dossieAtual,
        pecas: [...dossieAtual.pecas, peca],
    };
    const { erros } = validarDossie(dossieResultante);
    if (erros.length > 0) {
        return { ok: false, erros: [`dossiê resultante ficaria inválido, peça NÃO gravada: ${erros.join(' | ')}`] };
    }
    const caminho = _caminhoDossie(nichoTema);
    const tmp = `${caminho}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(dossieResultante, null, 2), 'utf-8');
    fs.renameSync(tmp, caminho);
    limparCache();
    return { ok: true, erros: [] };
}
// ──────────────────────────────────────────────────────────────
// substituirPecas — troca o array `pecas` inteiro do dossiê de um nicho
// (não só adiciona 1 — usado pra ligar o design real do usuário, extraído
// de exemplos/*.xml, no lugar do que a IA tinha gerado antes; ver
// scripts/pilotoCulinaria*.js e o processo documentado no plano de
// "Ligar os designs reais do usuário aos dossiês de produção"). Mesma
// atomicidade e mesma validação de `adicionarPeca` — só grava se o
// dossiê resultante continuar schema-válido. Retorna { ok, erros }.
// ──────────────────────────────────────────────────────────────
function substituirPecas(nichoTema, novasPecas) {
    const dossieAtual = carregarNichoDossie(nichoTema);
    if (!dossieAtual) {
        return { ok: false, erros: [`nicho "${nichoTema}" não tem dossiê — não é possível substituir peças (nicho ainda no cano legado).`] };
    }
    if (!Array.isArray(novasPecas)) {
        return { ok: false, erros: ['novasPecas precisa ser um array (pode ser vazio).'] };
    }
    const dossieResultante = {
        ...dossieAtual,
        pecas: novasPecas,
    };
    const { erros } = validarDossie(dossieResultante);
    if (erros.length > 0) {
        return { ok: false, erros: [`dossiê resultante ficaria inválido, peças NÃO gravadas: ${erros.join(' | ')}`] };
    }
    const caminho = _caminhoDossie(nichoTema);
    const tmp = `${caminho}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(dossieResultante, null, 2), 'utf-8');
    fs.renameSync(tmp, caminho);
    limparCache();
    return { ok: true, erros: [] };
}
// ──────────────────────────────────────────────────────────────
// substituirDossieCompleto — troca `tokensCss` E `pecas` juntos, mesma
// atomicidade/validação das funções acima. Usado na reconstrução dos
// dossiês a partir de exemplos/*.xml (fonte real do usuário): tanto os
// tokens de cor quanto as peças precisam ser re-derivados juntos, não só
// as peças isoladas. `nicho`/`versaoDossie`/`chassis`/`pageType` do
// dossiê atual são preservados — não são responsabilidade de quem chama
// (a reconstrução não decide identidade nem taxonomia do nicho).
// Retorna { ok, erros }.
// ──────────────────────────────────────────────────────────────
function substituirDossieCompleto(nichoTema, { tokensCss, pecas }) {
    const dossieAtual = carregarNichoDossie(nichoTema);
    if (!dossieAtual) {
        return { ok: false, erros: [`nicho "${nichoTema}" não tem dossiê — não é possível substituir (nicho ainda no cano legado).`] };
    }
    if (!tokensCss || typeof tokensCss !== 'object') {
        return { ok: false, erros: ['tokensCss precisa ser um objeto.'] };
    }
    if (!Array.isArray(pecas)) {
        return { ok: false, erros: ['pecas precisa ser um array (pode ser vazio).'] };
    }
    const dossieResultante = {
        ...dossieAtual,
        tokensCss,
        pecas,
    };
    const { erros } = validarDossie(dossieResultante);
    if (erros.length > 0) {
        return { ok: false, erros: [`dossiê resultante ficaria inválido, NÃO gravado: ${erros.join(' | ')}`] };
    }
    const caminho = _caminhoDossie(nichoTema);
    const tmp = `${caminho}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(dossieResultante, null, 2), 'utf-8');
    fs.renameSync(tmp, caminho);
    limparCache();
    return { ok: true, erros: [] };
}

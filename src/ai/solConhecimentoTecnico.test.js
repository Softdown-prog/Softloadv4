'use strict';

/**
 * Testes do RAG de conhecimento técnico externo do Sol.
 * Execute: node src/ai/solConhecimentoTecnico.test.js
 */

const fs = require('fs');
const path = require('path');
const { buscarConhecimentoTecnico } = require('./solConhecimentoTecnico');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

const CONHECIMENTO_DIR = path.join(__dirname, '../rag/rag-sol-conhecimento');
const INDEX_PATH = path.join(CONHECIMENTO_DIR, 'index.json');
const conteudoIndexAntes = fs.readFileSync(INDEX_PATH, 'utf-8');

try {
    // A. Base vazia (estado real hoje) — avisa em vez de devolver lista vazia silenciosa.
    const semConteudo = buscarConhecimentoTecnico('como funciona include no EJS');
    assert('base vazia: avisa explicitamente', typeof semConteudo.aviso === 'string' && semConteudo.aviso.length > 0, JSON.stringify(semConteudo));
    assert('base vazia: resultados é array vazio', Array.isArray(semConteudo.resultados) && semConteudo.resultados.length === 0);

    // B. Com conteúdo cadastrado — keyword-match acha o ficheiro certo.
    const nomeArquivoTeste = '_teste-ejs-include.md';
    fs.writeFileSync(path.join(CONHECIMENTO_DIR, nomeArquivoTeste), '# EJS include\nComo usar <%- include(...) %> em templates EJS.', 'utf-8');
    fs.writeFileSync(INDEX_PATH, JSON.stringify({
        rota: 'rag-sol-conhecimento',
        descricao: 'teste',
        ficheiros: [
            { arquivo: nomeArquivoTeste, palavras_chave: ['ejs', 'include', 'template'] },
        ],
    }, null, 2), 'utf-8');

    const comConteudo = buscarConhecimentoTecnico('como funciona include no EJS');
    assert('com conteúdo: acha o ficheiro cadastrado', comConteudo.resultados.length === 1 && comConteudo.resultados[0].arquivo === nomeArquivoTeste, JSON.stringify(comConteudo));
    assert('com conteúdo: devolve o conteúdo do arquivo', comConteudo.resultados[0].conteudo.includes('EJS'));
    assert('com conteúdo: sem aviso quando encontrou', !comConteudo.aviso);

    const semMatch = buscarConhecimentoTecnico('assunto totalmente não relacionado sobre culinária');
    assert('com índice povoado mas sem match: avisa e devolve vazio', semMatch.resultados.length === 0 && typeof semMatch.aviso === 'string');

    fs.unlinkSync(path.join(CONHECIMENTO_DIR, nomeArquivoTeste));

} finally {
    fs.writeFileSync(INDEX_PATH, conteudoIndexAntes, 'utf-8');
}

console.log(`\n${failed === 0 ? '✅' : '❌'} solConhecimentoTecnico: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

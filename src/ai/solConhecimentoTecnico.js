"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buscarConhecimentoTecnico = buscarConhecimentoTecnico;
// ============================================================
// CONHECIMENTO TÉCNICO DO SOL — RAG de referência externa (Node.js,
// Express, EJS, etc), separado do código-fonte da própria Softload
// (esse o Sol já lê direto via ler_arquivo_codigo/buscar_no_codigo em
// solAgent.js). Mesmo formato de índice {ficheiros:[...]} e mesmo
// motor de matching (ragMatcher.js) já usados por bibliotecaPecas.js —
// evita reinventar um segundo mecanismo de busca por keyword.
//
// Começa vazio (index.ficheiros = []) — cresce por curadoria manual:
// alguém adiciona um .md de referência na pasta e uma entrada no
// index.json, nunca gerado/escrito por este módulo.
// ============================================================
const fs = require('fs');
const path = require('path');
const { criarMatcher, pontuarKeywords } = require('../rag/ragMatcher');
const CONHECIMENTO_DIR = path.join(__dirname, '../rag/rag-sol-conhecimento');
const INDEX_PATH = path.join(CONHECIMENTO_DIR, 'index.json');
const MAX_RESULTADOS = 3;
const TAMANHO_MAX_ARQUIVO = 40 * 1024; // 40KB por ficheiro de referência
function _lerIndex() {
    try {
        return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
    }
    catch (e) {
        console.warn(`[SOL-CONHECIMENTO] index.json ausente ou corrompido: ${e.message}`);
        return { rota: 'rag-sol-conhecimento', descricao: '', ficheiros: [] };
    }
}
// ──────────────────────────────────────────────────────────────
// buscarConhecimentoTecnico — keyword-match (mesmo mecanismo de
// bibliotecaPecas.buscarNaBiblioteca) contra o índice de referência
// externa. Retorna até MAX_RESULTADOS ficheiros com score > 0, já
// com conteúdo carregado. Nunca lança.
// ──────────────────────────────────────────────────────────────
function buscarConhecimentoTecnico(pergunta) {
    const index = _lerIndex();
    const ficheiros = index.ficheiros || [];
    if (ficheiros.length === 0) {
        return {
            aviso: 'Nenhum material de referência técnica cadastrado ainda em rag-sol-conhecimento/ — essa base está vazia até alguém adicionar conteúdo.',
            resultados: [],
        };
    }
    const matcher = criarMatcher(pergunta || '');
    const pontuados = ficheiros
        .map(item => ({ item, score: pontuarKeywords(matcher, item.palavras_chave || []).score }))
        .filter(p => p.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_RESULTADOS);
    if (pontuados.length === 0) {
        return {
            aviso: `Nenhum material cadastrado bateu com "${pergunta}" — a base de conhecimento técnico tem ${ficheiros.length} ficheiro(s), mas nenhum relevante pra essa pergunta.`,
            resultados: [],
        };
    }
    const resultados = [];
    for (const { item } of pontuados) {
        try {
            const caminho = path.join(CONHECIMENTO_DIR, item.arquivo);
            const stat = fs.statSync(caminho);
            if (stat.size > TAMANHO_MAX_ARQUIVO) {
                resultados.push({ arquivo: item.arquivo, erro: `arquivo maior que ${TAMANHO_MAX_ARQUIVO / 1024}KB, pulado.` });
                continue;
            }
            resultados.push({ arquivo: item.arquivo, conteudo: fs.readFileSync(caminho, 'utf-8') });
        }
        catch (e) {
            resultados.push({ arquivo: item.arquivo, erro: `falha ao ler: ${e.message}` });
        }
    }
    return { resultados };
}

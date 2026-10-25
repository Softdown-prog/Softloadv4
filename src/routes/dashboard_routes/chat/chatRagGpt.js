"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ──────────────────────────────────────────────────────────────────────────
// RAG EXCLUSIVO DO GPT — pasta gpt-5-4/
// Cache SEPARADO do RAG_INDEX partilhado (chatRag.js): estes ficheiros só são
// roteados quando o modelo selecionado é o GPT (isGpt). Nunca injetados no Gemini.
// ──────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const { criarMatcher } = require('../../../rag/ragMatcher');
const RAG_BASE = path.join(__dirname, '../../../rag');
const GPT_RAG_DIR = path.join(RAG_BASE, 'gpt-5-4');
let GPT_RAG_INDEX = [];   // [ { arquivo, _keywords, fundacao } ]
const GPT_RAG_CACHE = {};   // arquivo → objeto JSON parseado
let GPT_RAG_FUNDACAO = null; // arquivo de fundação, sempre injetado para GPT
(function _carregarRagGpt() {
    try {
        const idx = JSON.parse(fs.readFileSync(path.join(GPT_RAG_DIR, 'index.json'), 'utf8'));
        let n = 0;
        for (const entry of (idx.ficheiros || [])) {
            const keywords = entry.palavras_chave || entry.tags || [];
            GPT_RAG_INDEX.push({ ...entry, _keywords: keywords });
            try {
                GPT_RAG_CACHE[entry.arquivo] = JSON.parse(
                    fs.readFileSync(path.join(GPT_RAG_DIR, entry.arquivo), 'utf8')
                );
                if (entry.fundacao) GPT_RAG_FUNDACAO = entry.arquivo;
                n++;
            } catch (e) {
                console.warn(`[RAG-GPT] Falha ao carregar ${entry.arquivo}:`, e.message);
            }
        }
        console.log(`[RAG-GPT] gpt-5-4: ${n} ficheiros exclusivos do GPT (fundação: ${GPT_RAG_FUNDACAO || 'nenhuma'})`);
    } catch (e) {
        console.warn('[RAG-GPT] pasta gpt-5-4 ausente ou inválida:', e.message);
    }
})();
// Seleciona conhecimento GPT-exclusivo: fundação sempre + até 2 por palavra-chave.
function buscarRagGpt(msg) {
    const matcher = criarMatcher(msg);
    const selecionados = [];
    // Fundação (conduta de alto nível) — sempre presente para o GPT
    if (GPT_RAG_FUNDACAO && GPT_RAG_CACHE[GPT_RAG_FUNDACAO]) {
        selecionados.push({ arquivo: GPT_RAG_FUNDACAO, data: GPT_RAG_CACHE[GPT_RAG_FUNDACAO] });
    }
    // Por relevância (exceto a fundação, que já entrou)
    for (const entry of GPT_RAG_INDEX) {
        if (entry.arquivo === GPT_RAG_FUNDACAO) continue;
        const hit = entry._keywords.some(kw => matcher(kw));
        if (hit && GPT_RAG_CACHE[entry.arquivo]) {
            selecionados.push({ arquivo: entry.arquivo, data: GPT_RAG_CACHE[entry.arquivo] });
        }
    }
    // Fundação + no máx 2 temáticos para não estourar contexto do GPT
    return selecionados.slice(0, 3);
}
// Formata o conhecimento GPT-exclusivo como contexto do system prompt.
function montarContextoRagGpt(arquivos) {
    if (!arquivos.length) return '';
    const blocos = arquivos.map(({ arquivo, data }) => {
        const label = data.titulo || data.id || arquivo;
        return `\n\n## DIRETRIZ GPT: ${label}\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;
    });
    return `\n\n---\n## PADRÕES DE ALTO NÍVEL (EXCLUSIVO GPT)${blocos.join('')}`;
}
module.exports = {
    buscarRagGpt,
    montarContextoRagGpt,
};

'use strict';

// ============================================================
// PADRÕES VISUAIS — loader do RAG consultado por gerarPeca()
// (geminiService.js) antes de gerar CSS/HTML de uma peça nova.
//
// padroes-visuais-comprovados.json é dado puro (ver campo "_sobre"
// nele pra proveniência); este arquivo só formata um digest curto
// pra caber no system prompt sem inflar o custo de token por peça.
// ============================================================

const regras = require('./padroes-visuais-comprovados.json').regras;

// Formato compacto: 1 linha por regra (título + descrição), sem os
// campos de proveniência ("evidencia"/"quando_usar") — esses servem
// só documentação humana, não precisam ir pro prompt da IA.
function padroesVisuaisParaPrompt() {
    return regras
        .map(r => `- ${r.titulo}: ${r.descricao}`)
        .join('\n');
}

module.exports = { padroesVisuaisParaPrompt };

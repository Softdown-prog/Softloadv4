'use strict';
Object.defineProperty(exports, "__esModule", { value: true });

// ──────────────────────────────────────────────────────────────────────────
// montarHistoricoSeguro — corta o histórico do cliente pro tamanho aceito
// pelo modelo e garante que o primeiro turno seja SEMPRE 'user'.
//
// O Gemini exige que `startChat({history})` comece com role 'user'
// (rejeita com 400 "First content should be with role 'user', got model"
// caso contrário). Um `history.slice(-histLen)` simples pode cortar bem no
// meio de um par user/assistant e deixar 'assistant' como primeiro
// elemento — isso já aconteceu em produção (recorrente assim que a
// conversa passa de `histLen` mensagens, travando TODAS as mensagens
// seguintes da sessão). Descartar elementos até o primeiro 'user' fecha
// isso pra qualquer tamanho de corte, não só o caso feliz.
// ──────────────────────────────────────────────────────────────────────────
function montarHistoricoSeguro(history, histLen) {
    if (!Array.isArray(history)) return [];

    const cortado = history
        .slice(-histLen)
        .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string');

    let inicio = 0;
    while (inicio < cortado.length && cortado[inicio].role !== 'user') inicio++;

    return cortado.slice(inicio);
}

module.exports = { montarHistoricoSeguro };

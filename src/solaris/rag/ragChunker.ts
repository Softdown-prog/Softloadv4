// ============================================================
// RAG CHUNKER
// ============================================================
// Fatia texto em pedaços de até N palavras (default 250, mesmo teto
// validado pelo serviço de embeddings -- ver
// Embedings-python/server.py, MAX_WORDS_PER_TEXT). Puro/determinístico
// -- zero IA, zero rede, testável sem nenhuma dependência externa
// (princípio #5 do CLAUDE.md).
//
// Corta em fronteira de palavra (nunca no meio de um token) e nunca
// produz chunk vazio.
// ============================================================

export const MAX_PALAVRAS_PADRAO = 250;

/**
 * Fatia um texto em chunks de até `maxPalavras` palavras cada.
 * @param {string} texto
 * @param {{ maxPalavras?: number }} [opcoes]
 * @returns {string[]} Chunks, na ordem original do texto. Array vazio
 *   se o texto for vazio/só espaço.
 */
export function chunkarTexto(texto: string, { maxPalavras = MAX_PALAVRAS_PADRAO }: { maxPalavras?: number } = {}): string[] {
    if (typeof texto !== 'string') {
        throw new Error('chunkarTexto: "texto" deve ser uma string');
    }
    if (!Number.isInteger(maxPalavras) || maxPalavras <= 0) {
        throw new Error('chunkarTexto: "maxPalavras" deve ser um inteiro positivo');
    }

    const palavras = texto.trim().split(/\s+/).filter(Boolean);
    if (palavras.length === 0) return [];

    const chunks: string[] = [];
    for (let i = 0; i < palavras.length; i += maxPalavras) {
        chunks.push(palavras.slice(i, i + maxPalavras).join(' '));
    }
    return chunks;
}


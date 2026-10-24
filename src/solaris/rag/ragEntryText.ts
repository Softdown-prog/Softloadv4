/** Campos consumidos pelo texto vetorizável do catálogo. */
export interface RagEmbedEntry {
    descricao?: string;
    componentes?: string[];
    exemplos?: string[];
    boas_praticas?: string[];
    keywords?: string[];
}

// ============================================================
// TEXTO EMBEDÁVEL DE UMA ENTRADA DO CATÁLOGO RAG
// ============================================================
// Monta o texto que vai ser fatiado (ragChunker) e vetorizado
// (ragEmbeddingsClient) a partir de uma entrada do catálogo — puro,
// determinístico: a MESMA entrada sempre produz o MESMO texto, o que
// é o que garante que ragVectorStore.substituirVetoresDaEntrada seja
// idempotente entre rodadas (reindexar sem a entrada ter mudado nunca
// produz um resultado diferente).
//
// Reusa os mesmos campos de RAG_ENTRY_RESPONSE_SCHEMA
// (ragEntryGenerator.js) — nenhum campo novo inventado aqui.
// ============================================================

/**
 * @param {object} entrada - entrada do catálogo RAG (id/categoria/descricao/componentes/exemplos/boas_praticas/keywords).
 * @returns {string} Texto embedável, pronto para ragChunker.chunkarTexto.
 */
export function montarTextoEmbedavel(entrada: RagEmbedEntry | null | undefined): string {
    if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
        throw new Error('montarTextoEmbedavel: "entrada" deve ser um objeto');
    }

    const partes: string[] = [];

    if (typeof entrada.descricao === 'string' && entrada.descricao.trim()) {
        partes.push(entrada.descricao.trim());
    }
    if (Array.isArray(entrada.componentes) && entrada.componentes.length) {
        partes.push(`Componentes: ${entrada.componentes.join(', ')}.`);
    }
    if (Array.isArray(entrada.exemplos) && entrada.exemplos.length) {
        partes.push(`Exemplos:\n${entrada.exemplos.join('\n')}`);
    }
    if (Array.isArray(entrada.boas_praticas) && entrada.boas_praticas.length) {
        partes.push(`Boas práticas: ${entrada.boas_praticas.join(' ')}`);
    }
    if (Array.isArray(entrada.keywords) && entrada.keywords.length) {
        partes.push(`Palavras-chave: ${entrada.keywords.join(', ')}.`);
    }

    return partes.join('\n\n').trim();
}


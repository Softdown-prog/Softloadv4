"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.similaridadeJaccard = similaridadeJaccard;
exports.encontrarSimilares = encontrarSimilares;
// ============================================================
// SOLARIS RAG DEDUPLICATOR — Etapa 5 do pipeline de geração
// ============================================================
// Decisão de arquitetura: similaridade por Jaccard sobre tokens (id +
// categoria + componentes + keywords), não embeddings — determinístico,
// sem chamada a API nem custo de token extra (princípio #5 do
// CLAUDE.md: "favorecer código determinístico sempre que possível — IA
// só entra onde não há alternativa determinística viável"; aqui há
// alternativa determinística perfeitamente viável, então é ela que
// entra). Nunca decide sozinho o que fazer com um par parecido — só
// aponta pra revisão humana (`encontrarSimilares`), mesma régua de
// "nunca corrige conteúdo sozinho" do resto do módulo RAG.
// ============================================================
// Só "componentes"/"keywords" — o vocabulário técnico concreto de cada
// entrada. Deliberadamente NÃO usa "id"/"categoria": id sempre carrega
// o prefixo do grupo (ex.: "bootstrap5-modal"/"bootstrap5-offcanvas"),
// que faria qualquer par do mesmo grupo parecer "parecido" só por
// estarem no mesmo framework; "categoria" hoje é quase sempre "topico"
// pra entradas geradas (ver ragEntryGenerator.js), então praticamente
// todo par teria esse token em comum — ambos derrubariam o score real
// pra ruído, mascarando duplicata de verdade em vez de apontar uma.
function _tokens(entrada) {
    const campos = [
        ...(Array.isArray(entrada.componentes) ? entrada.componentes : []),
        ...(Array.isArray(entrada.keywords) ? entrada.keywords : []),
    ];
    const set = new Set();
    for (const campo of campos) {
        if (typeof campo !== 'string')
            continue;
        for (const parte of campo.toLowerCase().split(/[-_\s]+/)) {
            if (parte.trim())
                set.add(parte.trim());
        }
    }
    return set;
}
/**
 * Similaridade de Jaccard entre os conjuntos de tokens de duas
 * entradas — 0 (nada em comum) a 1 (mesmo conjunto de tokens).
 */
function similaridadeJaccard(entradaA, entradaB) {
    const a = _tokens(entradaA);
    const b = _tokens(entradaB);
    if (a.size === 0 || b.size === 0)
        return 0;
    let intersecao = 0;
    for (const t of a)
        if (b.has(t))
            intersecao++;
    const uniao = a.size + b.size - intersecao;
    return uniao === 0 ? 0 : intersecao / uniao;
}
/**
 * Compara `entradaNova` contra todo o catálogo existente e retorna as
 * entradas com similaridade >= `limiar`, ordenadas da mais parecida
 * pra menos. Nunca bloqueia sozinho o salvamento — quem chama decide
 * (ver scripts/ragGenerate.js: acima do limiar vira "revisar", não
 * "descartar automaticamente" — pode ser um tópico genuinamente
 * relacionado, não necessariamente um duplicado real).
 *
 * @returns {Array<{ entrada: object, score: number }>}
 */
function encontrarSimilares(entradaNova, catalogoExistente, { limiar = 0.6 } = {}) {
    if (!entradaNova || !Array.isArray(catalogoExistente))
        return [];
    const similares = [];
    for (const existente of catalogoExistente) {
        if (existente.id === entradaNova.id)
            continue; // mesma entrada, não é duplicata de outra coisa
        const score = similaridadeJaccard(entradaNova, existente);
        if (score >= limiar)
            similares.push({ entrada: existente, score });
    }
    return similares.sort((a, b) => b.score - a.score);
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SOLARIS_GERAR_MARKER_RE = void 0;
exports.detectarMarcador = detectarMarcador;
exports.removerMarcadorTruncado = removerMarcadorTruncado;
// ============================================================
// SOLARIS GENERATION TRIGGER (Fase 3)
// ============================================================
// Detecta o marcador [[SOLARIS_GERAR:{...}]] embutido pelo modelo no
// fim da resposta de confirmação do manifesto — mesmo padrão do
// [[TEMPLATE:{...}]] já usado pelo chat gerador da Blogger Engine
// (src/routes/dashboard_routes/chat/chatGenerationFlow.js,
// TEMPLATE_MARKER_RE), aplicado ao Solaris. Puro parsing de string —
// decisão de disparar orchestrator.gerarProjeto() é sempre do código
// (src/routes/dashboard_routes/solaris.js), nunca deste módulo.
// ============================================================
exports.SOLARIS_GERAR_MARKER_RE = /\[\[SOLARIS_GERAR:([\s\S]+?)\]\]/;
/**
 * Analisa o texto completo de uma resposta do Solaris em busca do
 * marcador de geração. Nunca lança — JSON inválido/campos ausentes
 * viram `erro` no retorno, pro caller decidir o que fazer (nunca trava
 * a conversa por um marcador malformado).
 *
 * @param {string} textoCompleto
 * @returns {null | { textoVisivel: string, objetivo: string|null, framework: string|null, erro: string|null }}
 *          null quando não há marcador nenhum no texto.
 */
function detectarMarcador(textoCompleto) {
    if (!textoCompleto || typeof textoCompleto !== 'string')
        return null;
    const match = textoCompleto.match(exports.SOLARIS_GERAR_MARKER_RE);
    if (!match)
        return null;
    const textoVisivel = textoCompleto.replace(exports.SOLARIS_GERAR_MARKER_RE, '').trim();
    let payload;
    try {
        payload = JSON.parse(match[1]);
    }
    catch (err) {
        return { textoVisivel, objetivo: null, framework: null, erro: `marcador com JSON inválido: ${err.message}` };
    }
    const objetivo = typeof payload.objetivo === 'string' ? payload.objetivo.trim() : '';
    const framework = typeof payload.framework === 'string' ? payload.framework.trim() : '';
    if (!objetivo || !framework) {
        return { textoVisivel, objetivo: null, framework: null, erro: 'marcador sem "objetivo"/"framework" válidos' };
    }
    return { textoVisivel, objetivo, framework, erro: null };
}
/**
 * Remove um marcador TRUNCADO (sem "]]" de fechamento) do texto — caso
 * o streaming seja interrompido no meio da emissão do marcador (usuário
 * clicou "parar", corte por teto de tokens). Nunca deixa um fragmento de
 * marcador vazar pro texto exibido/salvo no histórico.
 */
function removerMarcadorTruncado(texto) {
    if (!texto || typeof texto !== 'string' || !texto.includes('[[SOLARIS_GERAR:'))
        return texto;
    return texto.replace(/\[\[SOLARIS_GERAR:[\s\S]*/, '').trim();
}

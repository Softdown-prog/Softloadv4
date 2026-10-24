"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeManifesto = mergeManifesto;
exports.aplicarEdicao = aplicarEdicao;
exports.reverterParaVersao = reverterParaVersao;
exports._resumirManifesto = _resumirManifesto;
// ============================================================
// TEMPLATE EDIT WORKER — orquestra a edição de um template já compilado.
// ============================================================
// Princípio: a IA nunca vê nem escreve XML — só decide valores de campos
// já conhecidos e validados do `manifesto` (mesmo shape que
// _blueprintParaManifesto produz em chat.js). Todo o trabalho pesado
// (compilar, validar, empacotar, persistir) roda no pipeline determinístico
// existente (compilerWorker.js / compilerPipeline.js), sem custo de tokens.
//
// A decisão de QUAIS campos mudar vem de fora (src/ai/templateEditAgent.js
// — loop agêntico de tool-calling, já validada por validarEdicao antes de
// chegar aqui). Este worker só aplica: `aplicarEdicao` recompila e persiste,
// zero chamada de IA.
// ============================================================
const { executarCompilacao } = require('./compilerWorker');
const { finalizarCompilacao } = require('./compilerPipeline');
// Campos de texto longo truncados no resumo (economiza tokens quando esse
// resumo é injetado como contexto pra IA) — o valor completo NOVO ainda
// pode ser gerado pela IA, se ela decidir mudá-lo; só o que é enviado como
// contexto do estado ATUAL é resumido.
const CAMPOS_TEXTO_LONGO = ['customCss', 'heroHtml', 'staticSections', 'svgLogo'];
function _resumirManifesto(manifesto) {
    const resumo = { ...manifesto };
    for (const campo of CAMPOS_TEXTO_LONGO) {
        if (typeof resumo[campo] === 'string' && resumo[campo].length > 160) {
            resumo[campo] = resumo[campo].slice(0, 160) + `…(truncado, ${resumo[campo].length} chars totais)`;
        }
    }
    return resumo;
}
/**
 * Merge do manifesto atual com os campos alterados.
 * Raso para a maioria dos campos; `modules` faz merge profundo (só as
 * chaves alteradas mudam); `categoryBadges`, quando presente, substitui o
 * array inteiro (documentado no schema — a IA reenvia os badges inalterados).
 */
function mergeManifesto(atual, alterados) {
    const resultado = { ...atual };
    for (const [campo, valor] of Object.entries(alterados)) {
        if (campo === 'modules') {
            resultado.modules = { ...(atual.modules || {}), ...valor };
        }
        else {
            resultado[campo] = valor;
        }
    }
    return resultado;
}
/**
 * Aplica os campos alterados: faz o merge, recompila e persiste.
 * Pula o Stage 1 (ENRICH) do pipeline de geração — não faz sentido gastar
 * uma chamada Gemini extra de enriquecimento para um patch pontual.
 *
 * @param {object}   manifestoAtual  — manifesto completo antes da edição
 * @param {object}   camposAlterados — campos já validados (ver validarEdicao em src/ai/templateEditSchema.js)
 * @param {object}   user            — { uid, email, plano }
 * @param {Function} onStatus        — callback(label) para eventos de status SSE
 * @param {string}   [wsProjetoId]   — liga a compilação de volta à sessão do Workspace (histórico de versões)
 * @param {string}   [wsSessionId]
 * @param {string}   [resumoMudancas] — resumo em PT-BR da edição (ex: "Mudou a cor pra azul escuro"),
 *   já gerado pelo agente ao propor a mudança — vira a "mensagem de commit" dessa versão no histórico.
 * @returns {Promise<{ downloadUrl: string, manifesto: object }>}
 */
async function aplicarEdicao(manifestoAtual, camposAlterados, user, onStatus = () => { }, wsProjetoId = null, wsSessionId = null, resumoMudancas = null) {
    const manifestoFinal = mergeManifesto(manifestoAtual, camposAlterados);
    onStatus('Recompilando template com as alterações...');
    let resultado;
    try {
        resultado = executarCompilacao(manifestoFinal);
    }
    catch (err) {
        throw new Error(`[EDIT-WORKER/COMPILE] ${err.message}`);
    }
    const { xmlFinal, slug, siteNameSanitizado } = resultado;
    const { downloadUrl, xmlPath, gcPath } = await finalizarCompilacao(xmlFinal, {
        slug,
        siteNameSanitizado,
        manifesto: manifestoFinal,
        origem: 'chat-edicao',
        enriched: false,
        wsProjetoId,
        wsSessionId,
        resumoMudancas,
    }, user, onStatus);
    return { downloadUrl, xmlPath, gcPath, manifesto: manifestoFinal };
}
/**
 * Reverte pra uma versão anterior: recompila o manifesto ANTIGO tal como
 * ele estava, SEM merge (diferente de aplicarEdicao, que faz patch sobre o
 * manifesto atual — aqui é substituição total). O revert em si vira mais
 * uma entrada nova no histórico (origem:'revert') — nunca apaga nada, mesmo
 * princípio de `git revert` criar um commit novo em vez de reescrever
 * histórico.
 *
 * @param {object}   manifestoAntigo — manifesto completo de uma compilação passada
 * @param {object}   user            — { uid, email, plano }
 * @param {Function} onStatus        — callback(label) para eventos de status SSE
 * @param {string}   [wsProjetoId]
 * @param {string}   [wsSessionId]
 * @returns {Promise<{ downloadUrl: string, manifesto: object }>}
 */
async function reverterParaVersao(manifestoAntigo, user, onStatus = () => { }, wsProjetoId = null, wsSessionId = null) {
    onStatus('Recompilando a versão selecionada...');
    let resultado;
    try {
        resultado = executarCompilacao(manifestoAntigo);
    }
    catch (err) {
        throw new Error(`[EDIT-WORKER/REVERT] ${err.message}`);
    }
    const { xmlFinal, slug, siteNameSanitizado } = resultado;
    const { downloadUrl, xmlPath, gcPath } = await finalizarCompilacao(xmlFinal, {
        slug,
        siteNameSanitizado,
        manifesto: manifestoAntigo,
        origem: 'revert',
        enriched: false,
        wsProjetoId,
        wsSessionId,
    }, user, onStatus);
    return { downloadUrl, xmlPath, gcPath, manifesto: manifestoAntigo };
}
const publicApi = { mergeManifesto, aplicarEdicao, reverterParaVersao, _resumirManifesto };
module.exports = publicApi;

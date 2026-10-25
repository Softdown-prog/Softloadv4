'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const { gerarChatStream } = require('../../../services/geminiService');
const { gerarChatGptStream } = require('../../../services/openaiService');
const { validateResponseBlocks, validateCode, extractCodeBlocks } = require('../../../core/codeValidator');
const { repararXml, repararCssTruncado } = require('../../../core/repairEngine');
// ──────────────────────────────────────────────────────────────────────────
// CODE VALIDATOR — validação pós-stream + reparo determinístico + retry IA
//
// Fluxo:
//   1. Texto streama normalmente ao frontend (sem regressão de UX)
//   2. Após o stream, validateResponseBlocks() verifica todos os blocos
//   3. Se erro → tenta reparo DETERMINÍSTICO primeiro (repairEngine — os
//      mesmos padrões já usados no pipeline de compilação: & cru em
//      href/src, atributo booleano sem valor, whitespace unicode, chave
//      CSS sem fechar). Resolve boa parte dos erros comuns sem gastar
//      1 chamada de IA.
//   4. Só se o reparo determinístico não resolver → 1 retry focado por IA
//      (mesmo fluxo de antes: AI recebe só o bloco quebrado + erro).
//   5. Evento code_patch informa o frontend do bloco substituído, com
//      `method: 'deterministico'|'ia'` indicando qual caminho resolveu.
//   6. done carrega codeValidation com resultado final
// ──────────────────────────────────────────────────────────────────────────
// Tenta reparar o bloco quebrado sem IA. Retorna o código reparado (ou null
// se não há reparo determinístico aplicável para este tipo/erro).
function _tentarReparoDeterministico(code, type, errors) {
    if (type === 'xml') {
        const { xml, total } = repararXml(code);
        return total > 0 ? xml : null;
    }
    if (type === 'css') {
        // Só tenta fechar chaves quando esse É o problema — se há erro de
        // aspas desbalanceadas junto, a corrupção é mais profunda que um
        // truncamento simples e o reparo automático arriscaria produzir
        // CSS sintaticamente balanceado mas semanticamente errado.
        const soFechamento = errors.every(e => e.includes('sem } de fechamento'));
        if (!soFechamento)
            return null;
        const { css, reparado } = repararCssTruncado(code);
        return reparado ? css : null;
    }
    return null;
}
// System prompt minimalista para chamada de correção — não precisa do
// contexto completo da conversa, só precisa corrigir sintaxe.
const SISTEMA_CORRETOR = 'Você é um corretor de sintaxe de código. Recebe um bloco com erro e retorna APENAS o bloco corrigido entre ``` fences, sem nenhuma explicação ou texto adicional.';
/**
 * Valida os blocos de código de uma resposta e tenta corrigir erros com 1 retry.
 *
 * @param {string}   fullText      — Resposta completa da IA
 * @param {string}   msg           — Mensagem original do usuário (contexto)
 * @param {boolean}  isGpt         — Modelo usado (para chamar o stream correto)
 * @param {object}   tokensRef     — Referência compartilhada do contador de tokens
 * @param {Function} sendEvent     — Emite SSE ao frontend
 * @returns {Promise<{ finalText: string, validation: object }>}
 */
async function _validarECorrigir(fullText, msg, isGpt, tokensRef, sendEvent) {
    const { allOk, results } = validateResponseBlocks(fullText);
    const validation = { checked: results.length, ok: allOk, retried: false, fixApplied: false };
    // Sem blocos de código ou todos ok → retorna sem alteração
    if (results.length === 0 || allOk) {
        return { finalText: fullText, validation };
    }
    // Encontra o primeiro bloco com erro real (não skipped)
    const failIdx = results.findIndex(r => !r.ok && !r.skipped);
    if (failIdx === -1)
        return { finalText: fullText, validation };
    const failResult = results[failIdx];
    const blocks = extractCodeBlocks(fullText);
    const failBlock = blocks[failIdx];
    if (!failBlock)
        return { finalText: fullText, validation };
    const errorDesc = failResult.errors.slice(0, 2).join(' | ');
    // ── Reparo determinístico primeiro — sem gastar 1 chamada de IA ────────
    const codigoReparado = _tentarReparoDeterministico(failBlock.code, failResult.type, failResult.errors);
    if (codigoReparado !== null) {
        const recheck = validateCode(codigoReparado, failBlock.lang);
        if (recheck.ok) {
            const fixedRaw = '```' + (failBlock.lang || '') + '\n' + codigoReparado + '```';
            const idx = fullText.indexOf(failBlock.raw);
            const patchedText = idx !== -1
                ? fullText.slice(0, idx) + fixedRaw + fullText.slice(idx + failBlock.raw.length)
                : fullText;
            sendEvent({
                type: 'code_patch',
                original: failBlock.raw,
                fixed: fixedRaw,
                lang: failBlock.lang || null,
                error: errorDesc,
                method: 'deterministico',
            });
            validation.retried = false;
            validation.fixApplied = true;
            validation.fixMethod = 'deterministico';
            return { finalText: patchedText, validation };
        }
    }
    // ── Reparo determinístico não resolveu — 1 retry focado por IA ─────────
    // Sinaliza ao frontend que está corrigindo
    sendEvent({ type: 'status', label: 'Corrigindo código...' });
    const retryPrompt = `Corrija o erro de sintaxe abaixo e retorne APENAS o bloco corrigido entre \`\`\` fences.\n\n` +
        `ERRO: ${errorDesc}\n\n` +
        `${failBlock.raw}`;
    try {
        let fixedRaw = '';
        const retrySource = isGpt
            ? gerarChatGptStream([], retryPrompt, SISTEMA_CORRETOR, { maxOutputTokens: 1024, tokensRef })
            : gerarChatStream([], retryPrompt, SISTEMA_CORRETOR, { maxOutputTokens: 1024, tokensRef });
        for await (const chunk of retrySource) {
            fixedRaw += chunk;
        }
        // Extrai bloco da resposta do retry
        const fixedBlocks = extractCodeBlocks(fixedRaw);
        if (!fixedBlocks.length) {
            validation.retried = true;
            validation.fixFailed = true;
            return { finalText: fullText, validation };
        }
        const fixedBlock = fixedBlocks[0];
        // Valida o código corrigido antes de aceitar
        const recheck = validateCode(fixedBlock.code, fixedBlock.lang || failBlock.lang);
        if (!recheck.ok) {
            validation.retried = true;
            validation.fixFailed = true;
            return { finalText: fullText, validation };
        }
        // Substitui o bloco quebrado na resposta original
        // Usa replace literal (não regex) para evitar escape de caracteres especiais
        const idx = fullText.indexOf(failBlock.raw);
        const patchedText = idx !== -1
            ? fullText.slice(0, idx) + fixedBlock.raw + fullText.slice(idx + failBlock.raw.length)
            : fullText;
        // Notifica frontend: bloco foi corrigido
        sendEvent({
            type: 'code_patch',
            original: failBlock.raw,
            fixed: fixedBlock.raw,
            lang: fixedBlock.lang || failBlock.lang || null,
            error: errorDesc,
            method: 'ia',
        });
        validation.retried = true;
        validation.fixApplied = true;
        validation.fixMethod  = 'ia';
        return { finalText: patchedText, validation };
    }
    catch (retryErr) {
        console.warn('[CODE-VALIDATOR] Retry falhou:', retryErr.message);
        validation.retried = true;
        validation.fixFailed = true;
        return { finalText: fullText, validation };
    }
}
module.exports = { _validarECorrigir, _tentarReparoDeterministico };

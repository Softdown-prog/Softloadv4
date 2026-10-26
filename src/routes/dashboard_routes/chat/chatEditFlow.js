'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const { admin } = require('../../../services/firebase');
const { aplicarEdicao } = require('../../../core/templateEditWorker');
const { debitarCreditos } = require('../../../services/creditService');
const { processarEdicaoAgentica } = require('../../../ai/templateEditAgent');
const { _snapshotDeManifesto } = require('./chatTemplateCompiler');
// ──────────────────────────────────────────────────────────────────────────
// CHAT AGÊNTICO DE EDIÇÃO — camada de integração (Firestore + billing +
// compile) do agente de tool-calling em src/ai/templateEditAgent.js. Toda a
// decisão de "o que o usuário quer" fica no agente; este arquivo só monta o
// handler de aplicação real, chama o agente, e persiste o resultado.
//
// Modo EXCLUSIVO de edição — o caller (workspaceChat.js) só invoca esta
// função quando já confirmou que `wsSnapshot.manifesto` existe; não há mais
// fallback pro chat geral quando o agente não "engaja" com a mensagem — o
// próprio agente sempre devolve uma resposta real (mesmo pra assunto fora
// de escopo, ver SYSTEM_PROMPT em templateEditAgent.js), então o resultado
// desta função é SEMPRE mostrado ao usuário.
//
// Aplicar de verdade (recompilar + persistir + debitar crédito) continua
// exigindo uma mensagem SEGUINTE à proposta: essa garantia é reforçada em
// código dentro do próprio agente (nunca aplica na mesma resposta em que
// propôs), não depende deste arquivo.
// ──────────────────────────────────────────────────────────────────────────
/**
 * Processa a mensagem via o agente de edição de template. Sempre retorna
 * uma resposta pra mostrar ao usuário — o agente decide, em linguagem
 * natural, se a mensagem é sobre editar o template ou não; quando não é,
 * ele mesmo explica o escopo em vez de deixar o caller cair num fallback.
 *
 * @returns {Promise<{ fullText: string, downloadUrl?: string }>}
 */
async function processarEdicaoDeTemplate({ msg, wsSnapshot, edicaoPendente, sessaoRef, user, sendEvent, historico, wsProjetoId, wsSessionId, billingOperationId, cobrarDiretamente = true, tokensRef, maxOutputTokens }) {
    const aplicarEdicaoReal = async (campos, resumoMudancas) => {
        sendEvent({ type: 'status', label: 'Recompilando template com as alterações...' });
        return aplicarEdicao(wsSnapshot.manifesto, campos, user, (label) => sendEvent({ type: 'status', label }), wsProjetoId, wsSessionId, resumoMudancas);
    };
    let resultado;
    try {
        resultado = await processarEdicaoAgentica(historico || [], msg, {
            manifestoAtual: wsSnapshot.manifesto,
            propostaPendente: edicaoPendente ? { campos: edicaoPendente.campos, resumo: edicaoPendente.resumo } : null,
            aplicarEdicaoReal,
            onProgress: sendEvent,
        maxOutputTokens,
        });
    }
    catch (err) {
        console.error('[CHAT-EDICAO] processarEdicaoAgentica falhou:', err.message);
        return { fullText: 'Tive um problema técnico ao processar isso agora — pode tentar de novo?' };
    }
    const { resposta, propostaFinal, downloadUrl, tokens } = resultado;
    if(tokensRef && tokens) {tokensRef.input=tokens.input;tokensRef.output=tokens.output;tokensRef.total=tokens.input+tokens.output;}
    let falhaDebito = false;
    if (cobrarDiretamente && tokens && (tokens.input || tokens.output)) {
        try {
            await debitarCreditos(user.email, tokens.input, tokens.output, billingOperationId);
        }
        catch (e) {
            falhaDebito = true;
            console.error(`[BILLING] chat-edicao-agente debit err: ${e.message}`);
        }
    }
    // Persiste o estado final do turno no Firestore — 1 único write, decidido
    // pelo que o agente efetivamente fez neste turno:
    //   - aplicou de verdade (downloadUrl presente)  → snapshot novo + limpa pendência
    //   - propôs/ajustou uma proposta nova            → grava a nova pendência
    //   - cancelou (propostaFinal null, sem apply)    → limpa pendência
    //   - nada mudou (ex: só respondeu pergunta)      → nenhum write
    try {
        if (downloadUrl) {
            const novoSnapshot = _snapshotDeManifesto(downloadUrl, resultado.manifestoFinal, resultado.xmlPath, resultado.gcPath);
            await sessaoRef.update({ snapshot: novoSnapshot, edicaoPendente: admin.firestore.FieldValue.delete() });
        }
        else if (propostaFinal && propostaFinal.resumo !== edicaoPendente?.resumo) {
            await sessaoRef.set({
                edicaoPendente: {
                    campos: propostaFinal.campos,
                    resumo: propostaFinal.resumo,
                    criadoEm: admin.firestore.FieldValue.serverTimestamp(),
                },
            }, { merge: true });
        }
        else if (!propostaFinal && edicaoPendente) {
            await sessaoRef.update({ edicaoPendente: admin.firestore.FieldValue.delete() });
        }
    }
    catch (err) {
        console.error('[CHAT-EDICAO] Falha ao persistir estado da sessão:', err.message);
    }
    // preview: só presente quando a edição foi aplicada de verdade nesta
    // resposta (downloadUrl presente) — dá pro caller (workspaceChat.js)
    // oferecer um jeito de VER a mudança sem o usuário ter que sair do chat
    // e caçar a aba Histórico de Versões sozinho. Achado real (usuário
    // relatou "chat só promete e diz que mudou"): a única confirmação era
    // texto — nenhum link/preview aparecia depois de aplicar, então mesmo
    // uma edição real ficava indistinguível de uma que não fez nada.
    const preview = downloadUrl ? {
        xmlPath: resultado.xmlPath || null,
        gcPath: resultado.gcPath || null,
        siteName: resultado.manifestoFinal?.siteName || null,
        colorPreset: resultado.manifestoFinal?.colorPreset || null,
        nichoTema: resultado.manifestoFinal?.nichoTema || null,
    } : null;
    return { fullText: resposta + (falhaDebito ? '\n\n⚠️ Não foi possível confirmar o débito desta edição. Confira seu saldo de créditos.' : ''), downloadUrl: downloadUrl || null, preview };
}
module.exports = { processarEdicaoDeTemplate };

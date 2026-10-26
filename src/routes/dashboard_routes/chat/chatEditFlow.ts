'use strict';
interface EdicaoUsuario { email: string; [key: string]: unknown }
interface ManifestoEdicao { siteName?: string; colorPreset?: string; nichoTema?: string; [key: string]: unknown }
interface PropostaEdicao { campos: unknown; resumo: string }
interface RespostaAgente {
    resposta: string;
    propostaFinal?: PropostaEdicao | null;
    downloadUrl?: string | null;
    tokens?: { input: number; output: number };
    manifestoFinal?: ManifestoEdicao | null;
    xmlPath?: string | null;
    gcPath?: string | null;
}
interface RefSessao {
    update(payload: Record<string, unknown>): Promise<unknown>;
    set(payload: Record<string, unknown>, options: { merge: boolean }): Promise<unknown>;
}
interface OpcaoEdicao {
    msg: string;
    wsSnapshot: { manifesto: ManifestoEdicao };
    edicaoPendente?: PropostaEdicao | null;
    sessaoRef: RefSessao;
    user: EdicaoUsuario;
    sendEvent: (event: { type: string; label?: string }) => void;
    historico?: unknown[];
    wsProjetoId?: string | null;
    wsSessionId?: string | null;
    billingOperationId?: string;
}
interface PreviewEdicao { xmlPath: string | null; gcPath: string | null; siteName: string | null; colorPreset: string | null; nichoTema: string | null }
interface RetornoEdicao { fullText: string; downloadUrl?: string | null; preview?: PreviewEdicao | null }
declare const require: (id: string) => unknown;
declare const module: { exports: unknown };

const { admin } = require('../../../services/firebase') as { admin: { firestore: { FieldValue: { delete(): unknown; serverTimestamp(): unknown } } } };
const { aplicarEdicao } = require('../../../core/templateEditWorker') as { aplicarEdicao: (manifesto: ManifestoEdicao, campos: unknown, user: EdicaoUsuario, progress: (label: string) => void, projetoId?: string | null, sessionId?: string | null, resumo?: string) => Promise<unknown> };
const { debitarCreditos } = require('../../../services/creditService') as { debitarCreditos(email: string, input: number, output: number, operationId?: string): Promise<unknown> };
const { processarEdicaoAgentica } = require('../../../ai/templateEditAgent') as { processarEdicaoAgentica(history: unknown[], message: string, options: { manifestoAtual: ManifestoEdicao; propostaPendente: PropostaEdicao | null; aplicarEdicaoReal: (campos: unknown, resumo: string) => Promise<unknown>; onProgress: OpcaoEdicao['sendEvent'] }): Promise<RespostaAgente> };
const { _snapshotDeManifesto } = require('./chatTemplateCompiler') as { _snapshotDeManifesto(downloadUrl: string, manifesto: ManifestoEdicao | null | undefined, xmlPath?: string | null, gcPath?: string | null): unknown };

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
async function processarEdicaoDeTemplate({ msg, wsSnapshot, edicaoPendente, sessaoRef, user, sendEvent, historico, wsProjetoId, wsSessionId, billingOperationId }: OpcaoEdicao): Promise<RetornoEdicao> {
    const aplicarEdicaoReal = async (campos: unknown, resumoMudancas: string): Promise<unknown> => {
        sendEvent({ type: 'status', label: 'Recompilando template com as alterações...' });
        return aplicarEdicao(wsSnapshot.manifesto, campos, user, (label: string) => sendEvent({ type: 'status', label }), wsProjetoId, wsSessionId, resumoMudancas);
    };

    let resultado;
    try {
        resultado = await processarEdicaoAgentica(historico || [], msg, {
            manifestoAtual:   wsSnapshot.manifesto,
            propostaPendente: edicaoPendente ? { campos: edicaoPendente.campos, resumo: edicaoPendente.resumo } : null,
            aplicarEdicaoReal,
            onProgress: sendEvent,
        });
    } catch (err) {
        console.error('[CHAT-EDICAO] processarEdicaoAgentica falhou:', (err as Error).message);
        return { fullText: 'Tive um problema técnico ao processar isso agora — pode tentar de novo?' };
    }

    const { resposta, propostaFinal, downloadUrl, tokens } = resultado;

    let falhaDebito = false;
    if (tokens && (tokens.input || tokens.output)) {
        try {
            await debitarCreditos(user.email, tokens.input, tokens.output, billingOperationId);
        } catch (e) {
            falhaDebito = true;
            console.error(`[BILLING] chat-edicao-agente debit err: ${(e as Error).message}`);
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
        } else if (propostaFinal && propostaFinal.resumo !== edicaoPendente?.resumo) {
            await sessaoRef.set({
                edicaoPendente: {
                    campos:   propostaFinal.campos,
                    resumo:   propostaFinal.resumo,
                    criadoEm: admin.firestore.FieldValue.serverTimestamp(),
                },
            }, { merge: true });
        } else if (!propostaFinal && edicaoPendente) {
            await sessaoRef.update({ edicaoPendente: admin.firestore.FieldValue.delete() });
        }
    } catch (err) {
        console.error('[CHAT-EDICAO] Falha ao persistir estado da sessão:', (err as Error).message);
    }

    // preview: só presente quando a edição foi aplicada de verdade nesta
    // resposta (downloadUrl presente) — dá pro caller (workspaceChat.js)
    // oferecer um jeito de VER a mudança sem o usuário ter que sair do chat
    // e caçar a aba Histórico de Versões sozinho. Achado real (usuário
    // relatou "chat só promete e diz que mudou"): a única confirmação era
    // texto — nenhum link/preview aparecia depois de aplicar, então mesmo
    // uma edição real ficava indistinguível de uma que não fez nada.
    const preview = downloadUrl ? {
        xmlPath:     resultado.xmlPath || null,
        gcPath:      resultado.gcPath || null,
        siteName:    resultado.manifestoFinal?.siteName || null,
        colorPreset: resultado.manifestoFinal?.colorPreset || null,
        nichoTema:   resultado.manifestoFinal?.nichoTema || null,
    } : null;

    return { fullText: resposta + (falhaDebito ? '\n\n⚠️ Não foi possível confirmar o débito desta edição. Confira seu saldo de créditos.' : ''), downloadUrl: downloadUrl || null, preview };
}

module.exports = { processarEdicaoDeTemplate };

export {};

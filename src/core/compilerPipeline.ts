import type { WorkerCompilerBody } from './workerOrchestrator';
import type { SavedCompilation } from '../contracts/compiler';

export type PipelineStatus = (label: string) => void;
export interface PipelineUser { uid: string; email: string; plano: string }
export interface PipelineWorkspaceIds {
    wsProjetoId?: string | null;
    wsSessionId?: string | null;
}
export interface PipelineContext extends PipelineWorkspaceIds {
    slug: string;
    siteNameSanitizado: string;
    manifesto: WorkerCompilerBody;
    origem?: string;
    enriched?: boolean;
    resumoMudancas?: string | null;
}
export interface PipelineApi {
    compilarComPipeline: (
        blueprint: Readonly<Record<string, unknown>>, manifesto: WorkerCompilerBody,
        user: PipelineUser, onStatus?: PipelineStatus, wsIds?: PipelineWorkspaceIds
    ) => Promise<SavedCompilation>;
    finalizarCompilacao: (
        xmlFinal: string, ctx: PipelineContext, user: PipelineUser,
        onStatus?: PipelineStatus
    ) => Promise<SavedCompilation>;
}
interface XmlVerification { erros: string[]; avisos: string[] }
interface SavedFiles {
    gcPath: string; xmlPath: string; manifestoPath: string | null;
    nomeArquivo: string; tamanhoBytes: number;
}
interface QuotaReservation { confirmarUso(bytes: number, operationId?: string): Promise<void> }
declare function require(name: string): unknown;
declare const module: { exports: unknown };
declare const Buffer: { byteLength(value: string, encoding: 'utf8'): number };
declare const console: { log(...args: unknown[]): void; warn(...args: unknown[]): void };

const { enriquecerBlueprint } = require('./blueprintEnricher') as typeof import('./blueprintEnricher');
const { executarCompilacao } = require('./compilerWorker') as typeof import('./compilerWorker');
const { validarXmlCompilado, validarXmlEstrutura, validarSemanticaBlogger } = require('./xmlValidator') as {
    validarXmlCompilado(xml: string): string[];
    validarXmlEstrutura(xml: string): XmlVerification;
    validarSemanticaBlogger(xml: string): XmlVerification;
};
const { salvarCompilacao, reservarCota } = require('../services/storageService') as {
    salvarCompilacao(uid: string, slug: string, xml: string, manifesto: WorkerCompilerBody): Promise<SavedFiles>;
    reservarCota(email: string, plano: string, tamanhoEstimado: number): Promise<QuotaReservation>;
};
const { db } = require('../services/firebase') as { db: {
    collection(name: string): {
        doc(id: string): {
            collection(name: string): {
                add(document: Record<string, unknown>): Promise<{ id: string }>;
            };
        };
    };
}};
const admin = require('firebase-admin') as { firestore: { FieldValue: { serverTimestamp(): unknown } } };

// ──────────────────────────────────────────────────────────────────────────
// Compiler Pipeline — substitui a compilação monolítica por 5 stages
//
// Stage 1 — ENRICH   : blueprintEnricher.js expande heroHtml/customCss —
//                      hoje determinístico (sem chamada de IA), ver
//                      blueprintEnricher.js pro histórico dessa mudança.
//                      A personalização real de texto (heroSubtitle) já
//                      vem do próprio Gemini que gerou o marcador do chat.
// Stage 2 — COMPILE  : executarCompilacao() monta o XML com o manifesto rico
// Stage 3 — VERIFY   : validarXmlCompilado() garante integridade do XML
// Stage 4 — PACKAGE  : salvarCompilacao() faz upload GCS
// Stage 5 — PERSIST  : salva metadados no Firestore e retorna downloadUrl
//
// Cada stage envia um evento de status via onStatus(label).
// Se Stage 1 falhar → pipeline continua com blueprint original (degradação
// silenciosa). Se Stages 2-5 falharem → erro propagado ao caller.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Stages 3-5 do pipeline — VERIFY, PACKAGE, PERSIST.
 * Compartilhado entre a geração de template novo (compilarComPipeline) e o
 * worker de edição (templateEditWorker.aplicarEdicao) — nenhum dos dois
 * caminhos duplica esta lógica de empacotamento/persistência.
 *
 * @param {string}   xmlFinal — XML já compilado (Stage 2 já rodou no caller)
 * @param {object}   ctx      — { slug, siteNameSanitizado, manifesto, origem, enriched, wsProjetoId, wsSessionId }
 *   wsProjetoId/wsSessionId (opcionais) — presentes só quando a compilação
 *   se origina de uma sessão do Workspace; ligam o doc de `compilacoes` de
 *   volta à sessão que o gerou, pra histórico de versões por sessão
 *   (ver `GET/POST .../historico`|`reverter` em workspace.js). `null` no
 *   Firestore quando ausentes — nunca quebra compilação fora do Workspace.
 * @param {object}   user     — { uid, email, plano }
 * @param {Function} onStatus — callback(label) para eventos de status SSE
 * @returns {Promise<{ downloadUrl: string, xmlPath: string, gcPath: string }>}
 */
async function finalizarCompilacao(
    xmlFinal: string, ctx: PipelineContext, user: PipelineUser,
    onStatus: PipelineStatus = () => {}
): Promise<SavedCompilation> {
    const {
        slug, siteNameSanitizado, manifesto, origem = 'chat-pipeline', enriched = false,
        wsProjetoId = null, wsSessionId = null, resumoMudancas = null,
    } = ctx;
    const uid   = user.uid;
    const email = user.email.toLowerCase();

    // ── Stage 3 — VERIFY ──────────────────────────────────────────────────
    onStatus('Verificando integridade do template...');
    const errosValidacao = validarXmlCompilado(xmlFinal);
    if (errosValidacao.length > 0) {
        throw new Error(`[PIPELINE/VERIFY] XML inválido: ${errosValidacao.join('; ')}`);
    }
    const { erros: errosEstrutura, avisos: avisosEstrutura } = validarXmlEstrutura(xmlFinal);
    if (errosEstrutura.length > 0) {
        throw new Error(`[PIPELINE/VERIFY] Estrutura inválida: ${errosEstrutura.join('; ')}`);
    }
    if (avisosEstrutura.length > 0) {
        console.warn('[PIPELINE/VERIFY] Avisos estruturais:', avisosEstrutura.join(' | '));
    }
    // Semântica de runtime do Blogger — a classe de bug "import aceito mas
    // renderização quebrada" (Blog1, fix ff7b011). Falha ANTES do upload:
    // melhor negar a compilação do que entregar um template que não renderiza.
    const { erros: errosSemantica, avisos: avisosSemantica } = validarSemanticaBlogger(xmlFinal);
    if (errosSemantica.length > 0) {
        throw new Error(`[PIPELINE/VERIFY] Semântica Blogger inválida: ${errosSemantica.join('; ')}`);
    }
    if (avisosSemantica.length > 0) {
        console.warn('[PIPELINE/VERIFY] Avisos de semântica Blogger:', avisosSemantica.join(' | '));
    }

    // ── Stage 4 — PACKAGE ─────────────────────────────────────────────────
    onStatus('Empacotando e salvando...');
    const estimativaZip     = Buffer.byteLength(xmlFinal, 'utf8') * 0.4;
    const { confirmarUso }  = await reservarCota(email, user.plano, estimativaZip);

    const { gcPath, xmlPath, manifestoPath, nomeArquivo, tamanhoBytes } = await salvarCompilacao(uid, slug, xmlFinal, manifesto);

    // ── Stage 5 — PERSIST ─────────────────────────────────────────────────
    const docRef = await db.collection('clientes_premium')
        .doc(email)
        .collection('compilacoes')
        .add({
            arquivo:          nomeArquivo,
            gcPath,
            xmlPath,
            tamanhoBytes,
            slug,
            siteName:         siteNameSanitizado,
            nichoTema:        manifesto.nichoTema  || null,
            colorPreset:      manifesto.colorPreset || null,
            typography:       manifesto.typography  || null,
            gridLayout:       manifesto.gridLayout  || null,
            // Manifesto completo vai pro GCS (manifestoPath), não pro Firestore —
            // histórico de versões sem limite de retenção não deve acumular o
            // objeto inteiro (customCss/heroHtml/staticSections podem ser vários
            // KB cada) numa coleção sem teto. O GCS já é o armazenamento de
            // longo prazo por versão e já conta pra cota do plano.
            manifestoPath,
            origem,
            enriched,
            wsProjetoId,
            wsSessionId,
            // "Mensagem de commit" da versão — resumo em PT-BR do que mudou
            // nesta compilação especificamente (só populado por edições via
            // agente hoje; null pra geração inicial/revert, cujo próprio
            // `origem` já explica o que aconteceu). Mostrado no histórico de
            // versões do Workspace pra diferenciar edições entre si.
            resumoMudancas,
            criadoEm:         admin.firestore.FieldValue.serverTimestamp(),
        });

    // Confirma o uso real de cota (tamanho REAL do ZIP gravado, não a
    // estimativa usada em reservarCota acima).
    // The compilation history document provides a stable, unique idempotency key.
    // If Firestore applied the debit but the ACK was lost, retrying confirmation
    // for this SAME compilation cannot increment the user's quota twice.
    await confirmarUso(tamanhoBytes, `blogger-compilation:${docRef.id}`);

    const downloadUrl = `/dashboard/compilacao/${docRef.id}/download`;
    console.log(`[PIPELINE] OK | ${email} | ${siteNameSanitizado} | origem=${origem} | enriched=${enriched} | ${downloadUrl}`);
    // xmlPath/gcPath vão junto — sem eles, _snapshotDeManifesto() não consegue
    // montar um snapshot completo (o botão "Ver Demo" do Workspace depende
    // de snapshot.xmlPath; sem isso, falha com "Snapshot sem xmlPath").
    return { downloadUrl, xmlPath, gcPath };
}

/**
 * Pipeline completo de compilação com enriquecimento de blueprint.
 *
 * @param {object}   blueprint — campos do marcador [[TEMPLATE:{...}]]
 * @param {object}   manifesto — manifesto já normalizado (saído de _blueprintParaManifesto)
 * @param {object}   user      — { uid, email, plano }
 * @param {Function} onStatus  — callback(label) para eventos de status SSE
 * @param {object}   [wsIds]   — { wsProjetoId, wsSessionId } opcionais, repassados a finalizarCompilacao
 * @returns {Promise<{ downloadUrl: string, xmlPath: string, gcPath: string }>}
 */
async function compilarComPipeline(
    blueprint: Readonly<Record<string, unknown>>, manifesto: WorkerCompilerBody,
    user: PipelineUser, onStatus: PipelineStatus = () => {},
    wsIds: PipelineWorkspaceIds = {}
): Promise<SavedCompilation> {
    // ── Stage 1 — ENRICH ──────────────────────────────────────────────────
    // enriquecerBlueprint() expande heroHtml/customCss quando ausentes —
    // determinístico, sem chamada de rede (ver blueprintEnricher.js).
    // Usa o blueprint original (pré-normalização) para ter acesso a todos
    // os campos do marcador, incluindo os que o manifesto não passa adiante.
    let blueprintRico = blueprint;
    try {
        blueprintRico = await enriquecerBlueprint(blueprint, onStatus);
    } catch (_) {
        // Stage 1 opcional — falha silenciosa, usa blueprint original
    }

    // Funde o Design Package enriquecido no manifesto antes de compilar
    // (heroHtml e customCss do enricher entram no corpo do compilador)
    const manifestoFinal = { ...manifesto };
    if (blueprintRico.heroHtml  && !manifesto.heroHtml)  manifestoFinal.heroHtml  = blueprintRico.heroHtml;
    if (blueprintRico.customCss && !manifesto.customCss) manifestoFinal.customCss = blueprintRico.customCss;

    // ── Stage 2 — COMPILE ─────────────────────────────────────────────────
    onStatus('Compilando estrutura XML...');
    let resultado;
    try {
        resultado = executarCompilacao(manifestoFinal);
    } catch (err) {
        throw new Error(`[PIPELINE/COMPILE] ${(err as Error).message}`);
    }
    const { xmlFinal, slug, siteNameSanitizado } = resultado;

    return finalizarCompilacao(xmlFinal, {
        slug,
        siteNameSanitizado,
        manifesto: manifestoFinal,
        origem:    'chat-pipeline',
        wsProjetoId: wsIds.wsProjetoId || null,
        wsSessionId: wsIds.wsSessionId || null,
        enriched:  blueprintRico !== blueprint,
    }, user, onStatus);
}

const publicApi: PipelineApi = { compilarComPipeline, finalizarCompilacao };
module.exports = publicApi;
export { compilarComPipeline, finalizarCompilacao };

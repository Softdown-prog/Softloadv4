"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DIAS_RETENCAO_PADRAO = exports.COLECAO_RASTREAMENTO = void 0;
exports.salvarProjeto = salvarProjeto;
exports.carregarProjeto = carregarProjeto;
exports.apagarProjeto = apagarProjeto;
exports._estaExpirado = _estaExpirado;
exports.apagarProjetosExpirados = apagarProjetosExpirados;
// ============================================================
// SOLARIS PROJECT STORAGE — persistência de projeto enviado no GCS
// ============================================================
// Fecha o gap documentado no README: um projeto extraído de upload
// (tools/archiveExtractClient.js, via sandbox-efemoro/) só sobrevivia
// dentro da MESMA requisição —
// nenhum turno de chat seguinte conseguia perguntar sobre um arquivo
// específico. Este módulo grava/lê os arquivos extraídos no GCS
// (users/{uid}/solaris-projects/{sessionId}/...), usando o `sessionId`
// do chat como chave — cada sessão tem no máximo um projeto anexado
// por vez, sem inventar um segundo identificador.
//
// Por que GCS e não disco local: o servidor roda em Cloud Run, múltiplas
// instâncias sem estado compartilhado por padrão — um baseDir em disco
// só existiria na instância que atendeu aquele request específico. GCS
// é o único jeito de um turno de chat SEGUINTE (que pode cair numa
// instância diferente) ainda enxergar o projeto.
//
// Conteúdo persistido é opaco (texto ou bytes de assets), nunca executado
// por este módulo. Inspeção textual ignora binários (fileTools).
// Mantém a mesma
// garantia de archiveExtractClient/lerArquivo). Cota de armazenamento
// (storageService.reservarCota) é debitada aqui, mesmo pool
// `storage_usado_mb` já usado por compilações e sessões de chat — regra
// geral do projeto, nunca um contador paralelo por feature.
//
// Retenção: TTL automática via `apagarProjetosExpirados()` — cada projeto
// persistido ganha um doc de rastreamento em Firestore
// (`solaris_projetos_persistidos/{uid}_{sessionId}`, com `criadoEm` e
// `tamanhoBytes`), varrido periodicamente (ver POST
// /internal/solaris/limpar-projetos-expirados em apiRoutes.js, ou
// `npm run solaris:limpar-projetos-expirados` manual). Enumerar via
// Firestore em vez de listar o bucket inteiro: mais barato, indexável
// por data, e não depende de escanear objetos não relacionados a
// projetos Solaris que também vivem sob `users/{uid}/`.
// ============================================================
const { bucket, db } = require('../../services/firebase');
const { reservarCota, liberarCota } = require('../../services/storageService');
const { randomUUID } = require('node:crypto');
const { criarArquivo } = require('./fileTools');
exports.COLECAO_RASTREAMENTO = 'solaris_projetos_persistidos';
exports.DIAS_RETENCAO_PADRAO = 30;
function _prefixo(uid, sessionId) {
    return `users/${uid}/solaris-projects/${sessionId}`;
}
function _idRastreamento(uid, sessionId) {
    return `${uid}_${sessionId}`;
}
function _manifestoPath(uid, sessionId) {
    return `${_prefixo(uid, sessionId)}/manifesto.json`;
}
function _arquivoPath(uid, sessionId, caminhoRelativo, versao) {
    // Old projects did not have a versao. Their root/files paths remain readable.
    return versao
        ? `${_prefixo(uid, sessionId)}/versions/${versao}/files/${caminhoRelativo}`
        : `${_prefixo(uid, sessionId)}/files/${caminhoRelativo}`;
}
/**
 * Persiste um projeto no GCS sob `sessionId`. `arquivos` é o mesmo
 * formato já usado por frameworkDetector/projectInspector —
 * `{caminho, conteudo}[]` — o chamador (rota de upload) já tem isso em
 * mãos, evita reler do disco.
 *
 * Reserva cota ANTES de gravar (storageService.reservarCota) — lança
 * `Error` se estourar o limite do plano, sem gravar nada.
 *
 * @returns {Promise<{ok:true, totalArquivos:number, tamanhoBytes:number}>}
 */
async function salvarProjeto({ uid, email, plano, sessionId, framework, arquivos }) {
    const trackingRef = db.collection(exports.COLECAO_RASTREAMENTO).doc(_idRastreamento(uid, sessionId));
    // Fail closed if metadata cannot be read: never replace an unknown old project.
    const oldTrackingSnap = await trackingRef.get();
    const oldTracking = oldTrackingSnap.exists ? oldTrackingSnap.data() : null;
    let oldManifest = null;
    try {
        const [bytes] = await bucket.file(_manifestoPath(uid, sessionId)).download();
        oldManifest = JSON.parse(bytes.toString('utf-8'));
    }
    catch (error) {
        const err = error;
        if (err.code !== 404 && !err.message?.includes('No such object'))
            throw error;
    }
    const versao = randomUUID();
    const manifesto = {
        sessionId, framework, versao,
        arquivos: arquivos.map(a => a.caminho),
        criadoEm: new Date().toISOString(),
    };
    const manifestoBuf = Buffer.from(JSON.stringify(manifesto), 'utf-8');
    const tamanhoBytes = manifestoBuf.byteLength + arquivos.reduce((sum, a) => sum + Buffer.byteLength(a.conteudo || '', 'utf-8'), 0);
    const tamanhoAnterior = oldTracking?.tamanhoBytes || 0;
    const tamanhoAtivoAnterior = oldTracking?.activeTamanhoBytes ?? tamanhoAnterior;
    // Keep the previous quota accounted for until its GCS objects are deleted.
    const { confirmarUso } = await reservarCota(email, plano, tamanhoBytes);
    let quotaConfirmada = false;
    let trackingAtualizado = false;
    try {
        // Stage all files in an isolated prefix. Never overwrite active files.
        // Sequential writes avoid racing cleanup with pending writes on failure.
        for (const { caminho, conteudo } of arquivos) {
            await bucket.file(_arquivoPath(uid, sessionId, caminho, versao)).save(Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo || '', 'utf-8'), {
                metadata: { contentType: Buffer.isBuffer(conteudo) ? 'application/octet-stream' : 'text/plain; charset=utf-8' },
                resumable: false,
            });
        }
        await confirmarUso(tamanhoBytes);
        quotaConfirmada = true;
        // Both generations are counted while the prior one remains stored.
        await trackingRef.set({
            uid, sessionId, email: (email || '').toLowerCase(),
            criadoEm: manifesto.criadoEm,
            tamanhoBytes: tamanhoAnterior + tamanhoBytes,
            activeTamanhoBytes: tamanhoBytes,
        });
        trackingAtualizado = true;
        // This single manifest write publishes the new generation last.
        await bucket.file(_manifestoPath(uid, sessionId)).save(manifestoBuf, {
            metadata: { contentType: 'application/json; charset=utf-8' },
            resumable: false,
        });
    }
    catch (error) {
        // No published pointer changed: the old project remains fully readable.
        // Attempt all rollback operations even when one rollback fails.
        if (trackingAtualizado) {
            try {
                if (oldTracking)
                    await trackingRef.set(oldTracking);
                else
                    await trackingRef.delete();
            }
            catch (rollbackError) {
                console.error('[SOLARIS-STORAGE] falha restaurando rastreamento após gravação rejeitada:', rollbackError);
            }
        }
        let cleaned = false;
        try {
            await bucket.deleteFiles({ prefix: `${_prefixo(uid, sessionId)}/versions/${versao}/`, force: true });
            cleaned = true;
        }
        catch (cleanupError) {
            console.error('[SOLARIS-STORAGE] falha removendo versão incompleta:', cleanupError);
        }
        if (quotaConfirmada && cleaned) {
            try {
                await liberarCota(email, tamanhoBytes);
            }
            catch (quotaError) {
                console.error('[SOLARIS-STORAGE] falha liberando cota da versão incompleta:', quotaError);
            }
        }
        throw error;
    }
    if (oldManifest) {
        // Remove only the previous generation, NEVER the active manifest.
        // If cleanup fails, keep its bytes accounted for in the tracking document.
        const oldPrefix = oldManifest.versao
            ? `${_prefixo(uid, sessionId)}/versions/${oldManifest.versao}/`
            : `${_prefixo(uid, sessionId)}/files/`;
        try {
            await bucket.deleteFiles({ prefix: oldPrefix, force: true });
            // Once old bytes are gone, adjust the tracking size and credit pool.
            await trackingRef.set({
                uid, sessionId, email: (email || '').toLowerCase(),
                criadoEm: manifesto.criadoEm,
                tamanhoBytes: Math.max(0, tamanhoAnterior - tamanhoAtivoAnterior) + tamanhoBytes,
                activeTamanhoBytes: tamanhoBytes,
            });
            if (oldTracking && tamanhoAtivoAnterior) {
                await liberarCota(oldTracking.email, tamanhoAtivoAnterior);
            }
        }
        catch (error) {
            console.warn('[SOLARIS-STORAGE] projeto novo publicado; limpeza antiga pendente:', error);
        }
    }
    return { ok: true, totalArquivos: arquivos.length, tamanhoBytes };
}
/**
 * Baixa um projeto persistido de volta pra um diretório local
 * `destDir` (temporário, apagado pelo CHAMADOR ao fim do request —
 * mesmo padrão do baseDir de upload, nunca sobrevive além de uma
 * requisição em disco local). Retorna `null` se não existir projeto persistido
 * pra essa sessão (upload nunca feito, ou sessão sem anexo) — o
 * chamador decide como degradar, nunca lança nesse caso.
 *
 * @returns {Promise<{framework:string|null, arquivos:string[]}|null>}
 */
async function carregarProjeto(uid, sessionId, destDir) {
    let manifestoBuf;
    try {
        [manifestoBuf] = await bucket.file(_manifestoPath(uid, sessionId)).download();
    }
    catch (e) {
        const err = e;
        const is404 = err.code === 404 || err.message?.includes('No such object');
        if (is404)
            return null;
        throw e;
    }
    const manifesto = JSON.parse(manifestoBuf.toString('utf-8'));
    await Promise.all(manifesto.arquivos.map(async (caminho) => {
        const [conteudoBuf] = await bucket.file(_arquivoPath(uid, sessionId, caminho, manifesto.versao)).download();
        criarArquivo(destDir, caminho, conteudoBuf);
    }));
    return { framework: manifesto.framework || null, arquivos: manifesto.arquivos };
}
/**
 * Apaga um projeto persistido — usado quando um novo upload substitui o
 * anterior na mesma sessão (pra nunca acumular mais de um projeto por
 * sessão no GCS) ou por `apagarProjetosExpirados()` (TTL). Sempre libera
 * a cota do dono via o doc de rastreamento — sem isso, toda substituição
 * (não só expiração) vazava cota pro usuário indefinidamente.
 */
async function apagarProjeto(uid, sessionId) {
    const trackingRef = db.collection(exports.COLECAO_RASTREAMENTO).doc(_idRastreamento(uid, sessionId));
    const trackingSnap = await trackingRef.get();
    // Do not release quota or remove tracking unless storage deletion succeeds.
    await bucket.deleteFiles({ prefix: `${_prefixo(uid, sessionId)}/`, force: true });
    if (trackingSnap && trackingSnap.exists) {
        const { email, tamanhoBytes } = trackingSnap.data();
        await trackingRef.delete().catch(() => { });
        if (email && tamanhoBytes)
            await liberarCota(email, tamanhoBytes);
    }
}
// Pura — decide se um projeto está expirado dado o timestamp de criação.
// Testável isoladamente sem tocar Firestore/GCS (mesmo padrão de
// storageService.verificarCota — lógica pura separada do I/O que a
// envolve). Data inválida nunca expira sozinha (fail-safe: preferível
// reter demais a apagar por engano num dado corrompido).
function _estaExpirado(criadoEmIso, diasParaExpirar, agora = new Date()) {
    const criadoEm = new Date(criadoEmIso);
    if (Number.isNaN(criadoEm.getTime()))
        return false;
    const limiteMs = diasParaExpirar * 24 * 60 * 60 * 1000;
    return (agora.getTime() - criadoEm.getTime()) > limiteMs;
}
/**
 * Varre `solaris_projetos_persistidos` e apaga (GCS + rastreamento +
 * libera cota, via `apagarProjeto()`) todo projeto mais velho que
 * `diasParaExpirar`. Chamado pela rota interna POST
 * /internal/solaris/limpar-projetos-expirados (Cloud Scheduler ou
 * manual) ou por `npm run solaris:limpar-projetos-expirados`. Nunca
 * lança por causa de UM projeto com erro — acumula em `erros` e
 * continua os demais.
 *
 * @returns {Promise<{ apagados: string[], erros: Array<{id:string, erro:string}> }>}
 */
async function apagarProjetosExpirados({ diasParaExpirar = exports.DIAS_RETENCAO_PADRAO } = {}) {
    const snap = await db.collection(exports.COLECAO_RASTREAMENTO).get();
    const apagados = [];
    const erros = [];
    for (const doc of snap.docs) {
        const { uid, sessionId, criadoEm } = doc.data();
        if (!_estaExpirado(criadoEm, diasParaExpirar))
            continue;
        try {
            await apagarProjeto(uid, sessionId);
            apagados.push(doc.id);
        }
        catch (err) {
            erros.push({ id: doc.id, erro: err.message });
        }
    }
    return { apagados, erros };
}

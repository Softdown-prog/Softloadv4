/** GCS stores project content as bytes, Firestore tracks retention and quotas. */
export interface PersistProjectFile { caminho: string; conteudo: Buffer | string | null }
export interface PersistProjectOptions {
    uid: string; email: string; plano: string; sessionId: string;
    framework: string | null; arquivos: PersistProjectFile[];
}
export interface PersistProjectResult { ok: true; totalArquivos: number; tamanhoBytes: number }
export interface LoadedProject { framework: string | null; arquivos: string[] }
export interface ExpiredProjectsResult { apagados: string[]; erros: { id: string; erro: string }[] }
export interface CleanupOptions { diasParaExpirar?: number }
interface ProjectManifest { sessionId: string; framework: string | null; arquivos: string[]; criadoEm: string; versao?: string }
interface TrackingData { uid: string; sessionId: string; email: string; criadoEm: string; tamanhoBytes: number; activeTamanhoBytes?: number }
interface TrackingRef {
    get(): Promise<{ exists: boolean; data(): TrackingData }>;
    set(data: TrackingData): Promise<unknown>;
    delete(): Promise<unknown>;
}
interface TrackingCollection {
    doc(id: string): TrackingRef;
    get(): Promise<{ docs: { id: string; data(): TrackingData }[] }>;
}
interface GcsBucket {
    file(path: string): {
        save(data: Buffer, opts: { metadata: { contentType: string }; resumable: boolean }): Promise<unknown>;
        download(): Promise<[Buffer]>;
    };
    deleteFiles(opts: { prefix: string; force: boolean }): Promise<unknown>;
}
declare function require(name: string): unknown;
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

const { bucket, db } = require('../../services/firebase') as { bucket: GcsBucket; db: { collection(name: string): TrackingCollection } };
const { reservarCota, liberarCota } = require('../../services/storageService') as {
    reservarCota(email: string, plano: string, tamanho: number): Promise<{ confirmarUso(bytes: number): Promise<unknown> }>;
    liberarCota(email: string, bytes: number): Promise<unknown>;
};
const { randomUUID } = require('node:crypto') as typeof import('node:crypto');
const { criarArquivo } = require('./fileTools') as { criarArquivo(dir: string, path: string, data: Buffer): unknown };

export const COLECAO_RASTREAMENTO = 'solaris_projetos_persistidos';
export const DIAS_RETENCAO_PADRAO = 30;

function _prefixo(uid: string, sessionId: string): string {
    return `users/${uid}/solaris-projects/${sessionId}`;
}

function _idRastreamento(uid: string, sessionId: string): string {
    return `${uid}_${sessionId}`;
}

function _manifestoPath(uid: string, sessionId: string): string {
    return `${_prefixo(uid, sessionId)}/manifesto.json`;
}

function _arquivoPath(uid: string, sessionId: string, caminhoRelativo: string, versao?: string): string {
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
export async function salvarProjeto({ uid, email, plano, sessionId, framework, arquivos }: PersistProjectOptions): Promise<PersistProjectResult> {
    const trackingRef = db.collection(COLECAO_RASTREAMENTO).doc(_idRastreamento(uid, sessionId));
    // Fail closed if metadata cannot be read: never replace an unknown old project.
    const oldTrackingSnap = await trackingRef.get();
    const oldTracking = oldTrackingSnap.exists ? oldTrackingSnap.data() : null;

    let oldManifest: ProjectManifest | null = null;
    try {
        const [bytes] = await bucket.file(_manifestoPath(uid, sessionId)).download();
        oldManifest = JSON.parse(bytes.toString('utf-8')) as ProjectManifest;
    } catch (error) {
        const err = error as { code?: number; message?: string };
        if (err.code !== 404 && !err.message?.includes('No such object')) throw error;
    }

    const versao = randomUUID();
    const manifesto: ProjectManifest = {
        sessionId, framework, versao,
        arquivos: arquivos.map(a => a.caminho),
        criadoEm: new Date().toISOString(),
    };
    const manifestoBuf = Buffer.from(JSON.stringify(manifesto), 'utf-8');
    const tamanhoBytes = manifestoBuf.byteLength + arquivos.reduce(
        (sum, a) => sum + Buffer.byteLength(a.conteudo || '', 'utf-8'), 0,
    );
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
            await bucket.file(_arquivoPath(uid, sessionId, caminho, versao)).save(
                Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo || '', 'utf-8'), {
                    metadata: { contentType: Buffer.isBuffer(conteudo) ? 'application/octet-stream' : 'text/plain; charset=utf-8' },
                    resumable: false,
                },
            );
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
    } catch (error) {
        // No published pointer changed: the old project remains fully readable.
        // Attempt all rollback operations even when one rollback fails.
        if (trackingAtualizado) {
            try {
                if (oldTracking) await trackingRef.set(oldTracking);
                else await trackingRef.delete();
            } catch (rollbackError) {
                console.error('[SOLARIS-STORAGE] falha restaurando rastreamento após gravação rejeitada:', rollbackError);
            }
        }
        let cleaned = false;
        try {
            await bucket.deleteFiles({ prefix: `${_prefixo(uid, sessionId)}/versions/${versao}/`, force: true });
            cleaned = true;
        } catch (cleanupError) {
            console.error('[SOLARIS-STORAGE] falha removendo versão incompleta:', cleanupError);
        }
        if (quotaConfirmada && cleaned) {
            try { await liberarCota(email, tamanhoBytes); }
            catch (quotaError) { console.error('[SOLARIS-STORAGE] falha liberando cota da versão incompleta:', quotaError); }
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
        } catch (error) {
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
export async function carregarProjeto(uid: string, sessionId: string, destDir: string): Promise<LoadedProject | null> {
    let manifestoBuf: Buffer;
    try {
        [manifestoBuf] = await bucket.file(_manifestoPath(uid, sessionId)).download();
    } catch (e) {
        const err = e as { code?: number; message?: string };
        const is404 = err.code === 404 || err.message?.includes('No such object');
        if (is404) return null;
        throw e;
    }

    const manifesto = JSON.parse(manifestoBuf.toString('utf-8')) as ProjectManifest;
    await Promise.all(manifesto.arquivos.map(async (caminho) => {
        const [conteudoBuf] = await bucket.file(_arquivoPath(uid, sessionId, caminho, manifesto.versao)).download();
        criarArquivo(destDir, caminho, conteudoBuf);
    }));

    return { framework: manifesto.framework || null, arquivos: manifesto.arquivos };
}

/** Runtime check: Firestore data and caller arguments can bypass TS types. */
function _identificadoresValidos(uid: unknown, sessionId: unknown): boolean {
    return [uid, sessionId].every(value => typeof value === 'string'
        && value.length > 0 && value !== '.' && value !== '..'
        && !value.includes('/') && !value.includes('\\') && !value.includes('\0'));
}

/**
 * Apaga um projeto persistido — usado quando um novo upload substitui o
 * anterior na mesma sessão (pra nunca acumular mais de um projeto por
 * sessão no GCS) ou por `apagarProjetosExpirados()` (TTL). Sempre libera
 * a cota do dono via o doc de rastreamento — sem isso, toda substituição
 * (não só expiração) vazava cota pro usuário indefinidamente.
 */
export async function apagarProjeto(uid: string, sessionId: string): Promise<void> {
    if (!_identificadoresValidos(uid, sessionId)) {
        throw new TypeError('Identificadores de projeto Solaris inválidos.');
    }
    const trackingRef = db.collection(COLECAO_RASTREAMENTO).doc(_idRastreamento(uid, sessionId));
    const trackingSnap = await trackingRef.get();

    // Do not release quota or remove tracking unless storage deletion succeeds.
    await bucket.deleteFiles({ prefix: `${_prefixo(uid, sessionId)}/`, force: true });

    if (trackingSnap && trackingSnap.exists) {
        const { email, tamanhoBytes } = trackingSnap.data();
        await trackingRef.delete().catch(() => {});
        if (email && tamanhoBytes) await liberarCota(email, tamanhoBytes);
    }
}

// Pura — decide se um projeto está expirado dado o timestamp de criação.
// Testável isoladamente sem tocar Firestore/GCS (mesmo padrão de
// storageService.verificarCota — lógica pura separada do I/O que a
// envolve). Data inválida nunca expira sozinha (fail-safe: preferível
// reter demais a apagar por engano num dado corrompido).
export function _estaExpirado(criadoEmIso: string | undefined, diasParaExpirar: number, agora: Date = new Date()): boolean {
    const criadoEm = new Date(criadoEmIso as string);
    if (Number.isNaN(criadoEm.getTime())) return false;
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
export async function apagarProjetosExpirados({ diasParaExpirar = DIAS_RETENCAO_PADRAO }: CleanupOptions = {}): Promise<ExpiredProjectsResult> {
    // A negative/zero TTL could wipe every tracked project. Reject before any I/O.
    if (!Number.isSafeInteger(diasParaExpirar) || diasParaExpirar < 1) {
        throw new RangeError('Retenção Solaris deve ser um número inteiro positivo de dias.');
    }
    const snap = await db.collection(COLECAO_RASTREAMENTO).get();
    const apagados: string[] = [];
    const erros: { id: string; erro: string }[] = [];

    for (const doc of snap.docs) {
        const { uid, sessionId, criadoEm } = doc.data();
        if (!_estaExpirado(criadoEm, diasParaExpirar)) continue;
        try {
            // Avoid deleting an unrelated user's GCS prefix if tracking data was corrupted.
            if (!_identificadoresValidos(uid, sessionId) || doc.id !== _idRastreamento(uid, sessionId)) {
                throw new Error('Rastreamento Solaris inválido: identidade divergente.');
            }
            await apagarProjeto(uid, sessionId);
            apagados.push(doc.id);
        } catch (err) {
            erros.push({ id: doc.id, erro: (err as Error).message });
        }
    }

    return { apagados, erros };
}


